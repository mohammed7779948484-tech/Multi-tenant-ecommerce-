import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import { z } from 'zod'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { StorefrontPage } from '../data/entities'
import { emitStorefrontEvent } from '../events'
import { validatePageSpec, type ValidatedSection } from '../lib/blocks/pageSpec'
import { checkSectionReferences } from '../lib/blocks/references'
import { conflictError, ensureCommandScope, parseCommandInput, storefrontNotFound, unprocessable } from '../lib/commandScope'
import { MAX_PAGES_PER_SITE } from '../lib/pages'
import { HOME_PAGE_SLUG_VALUE } from '../lib/slug'
import { loadTemplateStoreData } from '../lib/templateData'
import { buildStoreTemplate, STORE_TEMPLATE_IDS, type TemplatePage } from '../lib/templates'
import {
  emitPageEvent,
  enforcePageLock,
  forkEm,
  loadSiteForUpdate,
  PAGE_RESOURCE_KIND,
  serializePage,
  specIssuesError,
  type PageSnapshot,
} from './pages'

/**
 * `storefront.templates.apply` (spec P3-Q6, contracts): writes a template as
 * drafts in one transaction under the site row lock. The home page draft
 * (spec, title, SEO description) is replaced, guarded by the home page's
 * optimistic-lock version; other template pages are created when their slug is
 * free and reported as skipped otherwise. Nothing is published. Undo restores
 * the home draft and soft-deletes the created pages, and refuses with 409 when
 * any of them changed after the apply.
 */

export const TEMPLATE_COMMAND_ID = 'storefront.templates.apply'

const logger = createLogger('storefront').child({ component: 'template-commands' })

const applyInputSchema = z.object({ templateId: z.enum(STORE_TEMPLATE_IDS) }).strict()

export type TemplateApplyResult = {
  tenantId: string
  organizationId: string
  siteId: string
  templateId: string
  homePageId: string
  createdPages: Array<{ id: string; slug: string }>
  skippedSlugs: string[]
  updatedAt: string
  /** Home page before the apply (undo restores its draft). */
  homeBefore: PageSnapshot
  /** Every page the apply wrote, as it stood right after the commit (undo compares `updatedAt`). */
  written: PageSnapshot[]
}

type TemplateUndo = UndoPayload<TemplateApplyResult>

/** Generated specs must pass the same validator and reference check as a merchant's save. */
async function validateTemplatePages(pages: TemplatePage[], em: ReturnType<typeof forkEm>, scope: { tenantId: string; organizationId: string }) {
  const sections: ValidatedSection[] = []
  for (const page of pages) {
    const validation = validatePageSpec(page.spec)
    if (!validation.ok) {
      logger.error('Store template produced an invalid page spec', { slug: page.slug, issues: validation.issues.slice(0, 5) })
      throw new Error('[internal] store template produced an invalid page spec')
    }
    sections.push(...validation.sections)
  }
  const issues = await checkSectionReferences(em, scope, sections)
  if (issues.length) throw await specIssuesError(issues)
}

const applyTemplateCommand: CommandHandler<Record<string, unknown>, TemplateApplyResult> = {
  id: TEMPLATE_COMMAND_ID,
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = await parseCommandInput(applyInputSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const { translate } = await resolveTranslations()
    const em = forkEm(ctx)
    const data = await loadTemplateStoreData(em, scope)
    if (!data) throw await storefrontNotFound()
    const pages = buildStoreTemplate(input.templateId, data, translate)
    await validateTemplatePages(pages, em, scope)

    const now = new Date()
    let home: StorefrontPage | null = null
    let homeBefore: PageSnapshot | null = null
    const created: StorefrontPage[] = []
    const skippedSlugs: string[] = []
    await withAtomicFlush(
      em,
      [
        async () => {
          // The site row lock serialises page creation per store, so the slug and cap checks cannot race.
          const site = await loadSiteForUpdate(em, scope)
          home = await em.findOne(
            StorefrontPage,
            { siteId: site.id, slug: HOME_PAGE_SLUG_VALUE, ...scope, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          )
          if (!home) throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
          enforcePageLock(home, ctx)
          homeBefore = serializePage(home)
          const others = pages.filter((page) => page.slug !== HOME_PAGE_SLUG_VALUE)
          const taken = others.length
            ? await em.find(StorefrontPage, { siteId: site.id, slug: { $in: others.map((page) => page.slug) }, deletedAt: null }, { fields: ['slug'] })
            : []
          const takenSlugs = new Set(taken.map((page) => page.slug))
          const toCreate = others.filter((page) => !takenSlugs.has(page.slug))
          skippedSlugs.push(...others.filter((page) => takenSlugs.has(page.slug)).map((page) => page.slug))
          const count = await em.count(StorefrontPage, { siteId: site.id, ...scope, deletedAt: null })
          if (count + toCreate.length > MAX_PAGES_PER_SITE) {
            throw await unprocessable('storefront.errors.pageLimit', 'A store can have at most 30 pages.')
          }
          for (const page of toCreate) {
            const row = em.create(StorefrontPage, {
              id: randomUUID(),
              ...scope,
              siteId: site.id,
              slug: page.slug,
              title: page.title,
              seoDescription: page.seoDescription,
              draftSpec: page.spec as unknown as Record<string, unknown>,
              draftUpdatedAt: now,
              publishedSpec: null,
              publishedAt: null,
              publishedRevisionId: null,
              createdAt: now,
              updatedAt: now,
            })
            em.persist(row)
            created.push(row)
          }
        },
        () => {
          const homePage = pages.find((page) => page.slug === HOME_PAGE_SLUG_VALUE)!
          const target = home!
          target.draftSpec = homePage.spec as unknown as Record<string, unknown>
          target.title = homePage.title
          target.seoDescription = homePage.seoDescription
          target.draftUpdatedAt = now
          target.updatedAt = now
        },
      ],
      { transaction: true, label: TEMPLATE_COMMAND_ID },
    )

    const homeAfter = serializePage(home!)
    const result: TemplateApplyResult = {
      ...scope,
      siteId: data.siteId,
      templateId: input.templateId,
      homePageId: homeAfter.id,
      createdPages: created.map((page) => ({ id: page.id, slug: page.slug })),
      skippedSlugs,
      updatedAt: homeAfter.updatedAt!,
      homeBefore: homeBefore!,
      written: [homeAfter, ...created.map(serializePage)],
    }
    await emitPageEvent(ctx, 'storefront.page.updated', { id: homeAfter.id, ...scope, siteId: data.siteId })
    for (const page of created) await emitPageEvent(ctx, 'storefront.page.created', { id: page.id, ...scope, siteId: data.siteId })
    try {
      await emitStorefrontEvent(
        'storefront.template.applied',
        { ...scope, siteId: data.siteId, templateId: input.templateId, pageIds: result.written.map((page) => page.id) },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
    } catch (err) {
      logger.warn('Storefront template event emit failed', { err, siteId: data.siteId })
    }
    return result
  },
  captureAfter: async (_input, result) => result,
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('storefront.audit.templateApply', 'Apply store template'),
      resourceKind: PAGE_RESOURCE_KIND,
      resourceId: result.homePageId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotBefore: result.homeBefore,
      snapshotAfter: { templateId: result.templateId, pages: result.written.map((page) => ({ id: page.id, slug: page.slug })), skippedSlugs: result.skippedSlugs },
      payload: { undo: { before: null, after: result } satisfies TemplateUndo },
    }
  },
  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<TemplateUndo>(logEntry)?.after
    if (!after?.homePageId || !Array.isArray(after.written)) throw new Error('[internal] Missing snapshot for storefront template undo')
    const scope = await ensureCommandScope(ctx)
    if (after.tenantId !== scope.tenantId || after.organizationId !== scope.organizationId) {
      throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
    }
    const em = forkEm(ctx)
    const createdIds = new Set(after.createdPages.map((page) => page.id))
    await withAtomicFlush(
      em,
      [
        async () => {
          const rows = await em.find(
            StorefrontPage,
            { id: { $in: after.written.map((page) => page.id) }, ...scope },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          )
          const byId = new Map(rows.map((row) => [row.id, row]))
          // Any edit, publish or delete since the apply changes `updated_at`: then nothing is reverted.
          const changed = after.written.some((page) => {
            const row = byId.get(page.id)
            return !row || row.deletedAt || (row.updatedAt?.toISOString() ?? null) !== page.updatedAt
          })
          if (changed) {
            throw await conflictError('storefront.errors.undoTemplateChanged', 'A page from this template changed since, so the template cannot be undone.')
          }
          const now = new Date()
          const home = byId.get(after.homePageId)!
          home.draftSpec = after.homeBefore.draftSpec
          home.title = after.homeBefore.title
          home.seoDescription = after.homeBefore.seoDescription
          home.draftUpdatedAt = after.homeBefore.draftUpdatedAt ? new Date(after.homeBefore.draftUpdatedAt) : null
          home.updatedAt = now
          for (const id of createdIds) {
            const page = byId.get(id)!
            page.deletedAt = now
            page.updatedAt = now
          }
        },
      ],
      { transaction: true, label: `${TEMPLATE_COMMAND_ID}.undo` },
    )
    await emitPageEvent(ctx, 'storefront.page.updated', { id: after.homePageId, ...scope, siteId: after.siteId })
    for (const id of createdIds) await emitPageEvent(ctx, 'storefront.page.deleted', { id, ...scope, siteId: after.siteId })
  },
}

registerCommand(applyTemplateCommand)

export { applyTemplateCommand }
