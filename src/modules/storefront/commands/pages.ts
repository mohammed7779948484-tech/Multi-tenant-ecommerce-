import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildChanges, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StorefrontPage, StorefrontPageRevision, StorefrontSite } from '../data/entities'
import {
  pageCreateSchema,
  pageDeleteSchema,
  pagePublishSchema,
  pageRollbackSchema,
  pageUpdateSchema,
} from '../data/validators'
import { emitStorefrontEvent, type StorefrontEventId } from '../events'
import { buildStarterPageSpec } from '../lib/blocks/starterPage'
import { validatePageSpec, type PageSpecIssue, type ValidatedSection } from '../lib/blocks/pageSpec'
import { checkSectionReferences } from '../lib/blocks/references'
import {
  conflictError,
  ensureCommandScope,
  parseCommandInput,
  storefrontNotFound,
  unprocessable,
  type StorefrontCommandScope,
} from '../lib/commandScope'
import { isHomePage, MAX_PAGES_PER_SITE } from '../lib/pages'
import { pageSlugIssue } from '../lib/slug'

export const PAGE_RESOURCE_KIND = 'storefront.page'
export const PAGE_COMMAND_IDS = {
  create: 'storefront.pages.create',
  update: 'storefront.pages.update',
  delete: 'storefront.pages.delete',
  publish: 'storefront.pages.publish',
  rollback: 'storefront.pages.rollback',
} as const

const logger = createLogger('storefront').child({ component: 'page-commands' })

type Scope = StorefrontCommandScope

/** Everything undo needs to restore a page; merchant-visible marketing content only. */
export type PageSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  siteId: string
  slug: string
  title: string
  seoDescription: string | null
  draftSpec: Record<string, unknown> | null
  draftUpdatedAt: string | null
  publishedRevisionId: string | null
  deletedAt: string | null
  updatedAt: string | null
}

export type PublishResult = {
  pageId: string
  tenantId: string
  organizationId: string
  siteId: string
  revisionId: string
  revisionNo: number
  publishedAt: string
  updatedAt: string
}

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null)

export function serializePage(page: StorefrontPage): PageSnapshot {
  return {
    id: page.id,
    tenantId: page.tenantId,
    organizationId: page.organizationId,
    siteId: page.siteId,
    slug: page.slug,
    title: page.title,
    seoDescription: page.seoDescription ?? null,
    draftSpec: page.draftSpec ?? null,
    draftUpdatedAt: iso(page.draftUpdatedAt),
    publishedRevisionId: page.publishedRevisionId ?? null,
    deletedAt: iso(page.deletedAt),
    updatedAt: iso(page.updatedAt),
  }
}

export function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; name?: unknown } | null
  return candidate?.code === '23505' || candidate?.name === 'UniqueConstraintViolationException'
}

/** 422 carrying every spec issue with a translated message plus a summary on the `draftSpec` field. */
export async function specIssuesError(issues: PageSpecIssue[], summaryKey = 'storefront.errors.specIssues'): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  const translated = issues.slice(0, 50).map((issue) => ({
    ...issue,
    message: issue.message.startsWith('storefront.validation.')
      ? translate(issue.message, issue.message)
      : translate('storefront.validation.invalidValue', 'Enter a valid value.'),
  }))
  const error = translate(summaryKey, 'The page has problems to fix before it can be saved.')
  return new CrudHttpError(422, { error, fieldErrors: { draftSpec: translated[0]?.message ?? error }, issues: translated })
}

/** Section references (images, later products and categories) must belong to this store; 422 with paths otherwise. */
async function assertSectionReferences(
  ctx: CommandRuntimeContext,
  scope: Scope,
  sections: ValidatedSection[],
  summaryKey?: string,
): Promise<void> {
  const issues = await checkSectionReferences(forkEm(ctx), scope, sections)
  if (issues.length) throw await specIssuesError(issues, summaryKey)
}

async function slugError(issue: 'slugInvalid' | 'slugReserved' | 'slugTaken' | 'slugFrozen'): Promise<CrudHttpError> {
  const fallbacks: Record<typeof issue, string> = {
    slugInvalid: 'Use lower-case letters, digits and hyphens (up to 48 characters).',
    slugReserved: 'This address is reserved. Choose another one.',
    slugTaken: 'Another page already uses this address.',
    slugFrozen: 'The address cannot change after the page was published.',
  }
  return unprocessable(`storefront.validation.${issue}`, fallbacks[issue], 'slug')
}

export async function loadSiteForUpdate(em: EntityManager, scope: Scope): Promise<StorefrontSite> {
  const site = await em.findOne(StorefrontSite, { ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
  if (!site) throw await storefrontNotFound()
  return site
}

async function loadPage(em: EntityManager, id: string, scope: Scope, lock = false): Promise<StorefrontPage> {
  const page = await em.findOne(
    StorefrontPage,
    { id, ...scope, deletedAt: null },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
  )
  if (!page) throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
  return page
}

export function enforcePageLock(page: StorefrontPage, ctx: CommandRuntimeContext): void {
  enforceCommandOptimisticLock({
    resourceKind: PAGE_RESOURCE_KIND,
    resourceId: page.id,
    current: page.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}

async function assertSlugFree(em: EntityManager, siteId: string, slug: string, exceptPageId?: string): Promise<void> {
  const existing = await em.findOne(StorefrontPage, { siteId, slug, deletedAt: null }, { fields: ['id'] })
  if (existing && existing.id !== exceptPageId) throw await slugError('slugTaken')
}

/** The query index entry of pages (list search reads it once any page of the tenant is indexed). */
export const PAGE_INDEXER = { entityType: 'storefront:storefront_page' } as const

/**
 * After-commit side effects of every page write: the typed storefront event, and
 * a query-index refresh of the page. Reindexing (`mercato init`, `query_index
 * reindex`) indexes pages like any entity, and once a tenant has indexed pages
 * the list search reads search tokens; without this refresh, pages created or
 * renamed afterwards would be missing from the search.
 */
export async function emitPageEvent(ctx: CommandRuntimeContext, id: StorefrontEventId, payload: Record<string, unknown> & Scope): Promise<void> {
  try {
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: id === 'storefront.page.created' ? 'created' : id === 'storefront.page.deleted' ? 'deleted' : 'updated',
      entity: payload,
      identifiers: { id: String(payload.id), tenantId: payload.tenantId, organizationId: payload.organizationId },
      indexer: PAGE_INDEXER,
    })
  } catch (err) {
    logger.warn('Storefront page index refresh could not be queued', { err, eventId: id, pageId: payload.id })
  }
  try {
    await emitStorefrontEvent(id, payload, {
      persistent: true,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (err) {
    // The write is committed; a failed emit must not turn it into an error response.
    logger.warn('Storefront page event emit failed', { err, eventId: id, pageId: payload.id })
  }
}

async function nextRevisionNo(em: EntityManager, pageId: string): Promise<number> {
  const latest = await em.findOne(
    StorefrontPageRevision,
    { pageId },
    { orderBy: { revisionNo: 'desc' }, fields: ['revisionNo'] },
  )
  return (latest?.revisionNo ?? 0) + 1
}

// ── create ───────────────────────────────────────────────────────────────────

const createPageCommand: CommandHandler<Record<string, unknown>, PageSnapshot> = {
  id: PAGE_COMMAND_IDS.create,
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = await parseCommandInput(pageCreateSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const issue = pageSlugIssue(input.slug)
    if (issue) throw await slugError(issue)
    const em = forkEm(ctx)
    let page: StorefrontPage | null = null
    const now = new Date()
    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            // The site row lock serialises page creation per store, so the cap check cannot race.
            const site = await loadSiteForUpdate(em, scope)
            const count = await em.count(StorefrontPage, { siteId: site.id, ...scope, deletedAt: null })
            if (count >= MAX_PAGES_PER_SITE) {
              throw await unprocessable('storefront.errors.pageLimit', 'A store can have at most 30 pages.')
            }
            await assertSlugFree(em, site.id, input.slug)
            page = em.create(StorefrontPage, {
              id: randomUUID(),
              ...scope,
              siteId: site.id,
              slug: input.slug,
              title: input.title,
              seoDescription: input.seoDescription,
              draftSpec: buildStarterPageSpec(input.title) as unknown as Record<string, unknown>,
              draftUpdatedAt: now,
              publishedSpec: null,
              publishedAt: null,
              publishedRevisionId: null,
              createdAt: now,
              updatedAt: now,
            })
            em.persist(page)
          },
        ],
        { transaction: true, label: PAGE_COMMAND_IDS.create },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw await slugError('slugTaken')
      throw err
    }
    const snapshot = serializePage(page!)
    await emitPageEvent(ctx, 'storefront.page.created', { id: snapshot.id, ...scope, siteId: snapshot.siteId })
    return snapshot
  },
  captureAfter: async (_input, result) => result,
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('storefront.audit.pageCreate', 'Create storefront page'),
      resourceKind: PAGE_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotAfter: result,
      payload: { undo: { before: null, after: result } satisfies UndoPayload<PageSnapshot> },
    }
  },
  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<PageSnapshot>>(logEntry)?.after
    if (!after?.id) throw new Error('[internal] Missing snapshot for storefront page create undo')
    const scope = await ensureCommandScope(ctx)
    if (after.tenantId !== scope.tenantId || after.organizationId !== scope.organizationId) {
      throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
    }
    const em = forkEm(ctx)
    let changed = false
    await withAtomicFlush(
      em,
      [
        async () => {
          const page = await em.findOne(StorefrontPage, { id: after.id, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (!page) return
          page.deletedAt = new Date()
          page.updatedAt = new Date()
          changed = true
        },
      ],
      { transaction: true, label: `${PAGE_COMMAND_IDS.create}.undo` },
    )
    if (changed) await emitPageEvent(ctx, 'storefront.page.deleted', { id: after.id, ...scope, siteId: after.siteId })
  },
}

// ── update (settings + draft) ────────────────────────────────────────────────

const updatePageCommand: CommandHandler<Record<string, unknown>, PageSnapshot> = {
  id: PAGE_COMMAND_IDS.update,
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = await parseCommandInput(pageUpdateSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const page = await loadPage(forkEm(ctx), input.id, scope)
    enforcePageLock(page, ctx)
    return { before: serializePage(page) }
  },
  async execute(rawInput, ctx) {
    const input = await parseCommandInput(pageUpdateSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    let draftSpec: Record<string, unknown> | undefined
    if (input.draftSpec !== undefined) {
      const validation = validatePageSpec(input.draftSpec)
      if (!validation.ok) throw await specIssuesError(validation.issues)
      await assertSectionReferences(ctx, scope, validation.sections)
      draftSpec = validation.spec as unknown as Record<string, unknown>
    }
    if (input.slug !== undefined) {
      // Grammar fails fast; the reserved-word check waits for the row because
      // re-sending an unchanged slug is fine (the home page's `index` is reserved).
      const issue = pageSlugIssue(input.slug)
      if (issue && issue !== 'slugReserved') throw await slugError(issue)
    }
    const em = forkEm(ctx)
    let page: StorefrontPage | null = null
    const now = new Date()
    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            page = await loadPage(em, input.id, scope, true)
            enforcePageLock(page, ctx)
            if (input.slug !== undefined && input.slug !== page.slug) {
              if (isHomePage(page) || page.publishedRevisionId) throw await slugError('slugFrozen')
              const issue = pageSlugIssue(input.slug)
              if (issue) throw await slugError(issue)
              await assertSlugFree(em, page.siteId, input.slug, page.id)
            }
          },
          () => {
            const target = page!
            let draftChanged = false
            if (input.title !== undefined && input.title !== target.title) {
              target.title = input.title
              draftChanged = true
            }
            if (input.seoDescription !== undefined && input.seoDescription !== (target.seoDescription ?? null)) {
              target.seoDescription = input.seoDescription
              draftChanged = true
            }
            if (draftSpec !== undefined) {
              target.draftSpec = draftSpec
              draftChanged = true
            }
            if (input.slug !== undefined) target.slug = input.slug
            if (draftChanged) target.draftUpdatedAt = now
            target.updatedAt = now
          },
        ],
        { transaction: true, label: PAGE_COMMAND_IDS.update },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw await slugError('slugTaken')
      throw err
    }
    const snapshot = serializePage(page!)
    await emitPageEvent(ctx, 'storefront.page.updated', { id: snapshot.id, ...scope, siteId: snapshot.siteId })
    return snapshot
  },
  captureAfter: async (_input, result) => result,
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PageSnapshot | undefined
    const flatten = (snapshot: PageSnapshot) => ({
      title: snapshot.title,
      slug: snapshot.slug,
      seoDescription: snapshot.seoDescription,
      draftSpec: JSON.stringify(snapshot.draftSpec),
    })
    return {
      actionLabel: translate('storefront.audit.pageUpdate', 'Update storefront page'),
      resourceKind: PAGE_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      changes: buildChanges(before ? flatten(before) : null, flatten(result), ['title', 'slug', 'seoDescription', 'draftSpec']),
      snapshotBefore: before ?? null,
      snapshotAfter: result,
      payload: { undo: { before: before ?? null, after: result } satisfies UndoPayload<PageSnapshot> },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<PageSnapshot>>(logEntry)?.before
    if (!before?.id) throw new Error('[internal] Missing snapshot for storefront page update undo')
    const scope = await ensureCommandScope(ctx)
    if (before.tenantId !== scope.tenantId || before.organizationId !== scope.organizationId) {
      throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
    }
    const em = forkEm(ctx)
    let page: StorefrontPage | null = null
    await withAtomicFlush(
      em,
      [
        async () => {
          page = await loadPage(em, before.id, scope, true)
          // A published page's address is frozen; undo never moves a live URL.
          if (before.slug !== page.slug) {
            if (page.publishedRevisionId) {
              throw await conflictError('storefront.errors.undoSlugFrozen', 'The page was published since, so its address cannot be restored.')
            }
            await assertSlugFree(em, page.siteId, before.slug, page.id)
          }
        },
        () => {
          const target = page!
          target.title = before.title
          target.seoDescription = before.seoDescription
          target.slug = before.slug
          target.draftSpec = before.draftSpec
          const now = new Date()
          // A publish or rollback since the update made another revision live: the
          // restored draft no longer matches it, so the page must read "changed"
          // (and stay publishable) rather than the snapshot's old state.
          const liveChanged = (target.publishedRevisionId ?? null) !== (before.publishedRevisionId ?? null)
          target.draftUpdatedAt = liveChanged && target.publishedRevisionId
            ? now
            : before.draftUpdatedAt ? new Date(before.draftUpdatedAt) : null
          target.updatedAt = now
        },
      ],
      { transaction: true, label: `${PAGE_COMMAND_IDS.update}.undo` },
    ).catch(async (err: unknown) => {
      // Another page took the restored address between the check and the write.
      if (isUniqueViolation(err)) throw await conflictError('storefront.errors.undoSlugTaken', 'Another page now uses this address.')
      throw err
    })
    await emitPageEvent(ctx, 'storefront.page.updated', { id: before.id, ...scope, siteId: before.siteId })
  },
}

// ── delete ───────────────────────────────────────────────────────────────────

const deletePageCommand: CommandHandler<Record<string, unknown>, PageSnapshot> = {
  id: PAGE_COMMAND_IDS.delete,
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = await parseCommandInput(pageDeleteSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const page = await loadPage(forkEm(ctx), input.id, scope)
    enforcePageLock(page, ctx)
    return { before: serializePage(page) }
  },
  async execute(rawInput, ctx) {
    const input = await parseCommandInput(pageDeleteSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const em = forkEm(ctx)
    let page: StorefrontPage | null = null
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        async () => {
          page = await loadPage(em, input.id, scope, true)
          enforcePageLock(page, ctx)
          if (isHomePage(page)) throw await unprocessable('storefront.errors.homeNotDeletable', 'The home page cannot be deleted.')
        },
        () => {
          page!.deletedAt = now
          page!.updatedAt = now
        },
      ],
      { transaction: true, label: PAGE_COMMAND_IDS.delete },
    )
    const snapshot = serializePage(page!)
    await emitPageEvent(ctx, 'storefront.page.deleted', { id: snapshot.id, ...scope, siteId: snapshot.siteId })
    return snapshot
  },
  captureAfter: async (_input, result) => result,
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PageSnapshot | undefined
    return {
      actionLabel: translate('storefront.audit.pageDelete', 'Delete storefront page'),
      resourceKind: PAGE_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: result,
      payload: { undo: { before: before ?? null, after: result } satisfies UndoPayload<PageSnapshot> },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<PageSnapshot>>(logEntry)?.before
    if (!before?.id) throw new Error('[internal] Missing snapshot for storefront page delete undo')
    const scope = await ensureCommandScope(ctx)
    if (before.tenantId !== scope.tenantId || before.organizationId !== scope.organizationId) {
      throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
    }
    const em = forkEm(ctx)
    let changed = false
    await withAtomicFlush(
      em,
      [
        async () => {
          const site = await loadSiteForUpdate(em, scope)
          const page = await em.findOne(StorefrontPage, { id: before.id, ...scope, siteId: site.id }, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (!page) throw await storefrontNotFound('storefront.errors.pageNotFound', 'Page not found.')
          if (!page.deletedAt) return
          const count = await em.count(StorefrontPage, { siteId: site.id, ...scope, deletedAt: null })
          if (count >= MAX_PAGES_PER_SITE) {
            throw await unprocessable('storefront.errors.pageLimit', 'A store can have at most 30 pages.')
          }
          const taken = await em.findOne(StorefrontPage, { siteId: site.id, slug: page.slug, deletedAt: null }, { fields: ['id'] })
          if (taken) throw await conflictError('storefront.errors.undoSlugTaken', 'Another page now uses this address.')
          page.deletedAt = null
          page.updatedAt = new Date()
          changed = true
        },
      ],
      { transaction: true, label: `${PAGE_COMMAND_IDS.delete}.undo` },
    ).catch(async (err: unknown) => {
      if (isUniqueViolation(err)) throw await conflictError('storefront.errors.undoSlugTaken', 'Another page now uses this address.')
      throw err
    })
    if (changed) await emitPageEvent(ctx, 'storefront.page.updated', { id: before.id, ...scope, siteId: before.siteId })
  },
}

// ── publish / rollback ───────────────────────────────────────────────────────

function toPublishResult(page: StorefrontPage, revision: StorefrontPageRevision): PublishResult {
  return {
    pageId: page.id,
    tenantId: page.tenantId,
    organizationId: page.organizationId,
    siteId: page.siteId,
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    publishedAt: page.publishedAt!.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}

async function markSiteFirstPublished(em: EntityManager, page: StorefrontPage, now: Date): Promise<void> {
  const site = await em.findOne(StorefrontSite, { id: page.siteId, tenantId: page.tenantId, organizationId: page.organizationId })
  if (site && !site.firstPublishedAt) site.firstPublishedAt = now
}

/**
 * Publishes the saved draft (spec + title + SEO description) as a new numbered,
 * immutable revision. Not undoable: rolling back to the previous revision is the reverse.
 */
const publishPageCommand: CommandHandler<Record<string, unknown>, PublishResult> = {
  id: PAGE_COMMAND_IDS.publish,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = await parseCommandInput(pagePublishSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const em = forkEm(ctx)
    let page: StorefrontPage | null = null
    let revision: StorefrontPageRevision | null = null
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        async () => {
          page = await loadPage(em, input.id, scope, true)
          enforcePageLock(page, ctx)
          if (page.publishedRevisionId && !page.draftUpdatedAt) {
            throw await unprocessable('storefront.errors.nothingToPublish', 'There are no saved changes to publish.')
          }
          const source = page.draftSpec ?? page.publishedSpec
          if (!source) throw await unprocessable('storefront.errors.nothingToPublish', 'There are no saved changes to publish.')
          const validation = validatePageSpec(source)
          if (!validation.ok) throw await specIssuesError(validation.issues)
          await assertSectionReferences(ctx, scope, validation.sections)
          const spec = validation.spec as unknown as Record<string, unknown>
          const revisionNo = await nextRevisionNo(em, page.id)
          revision = em.create(StorefrontPageRevision, {
            id: randomUUID(),
            tenantId: page.tenantId,
            organizationId: page.organizationId,
            siteId: page.siteId,
            pageId: page.id,
            revisionNo,
            spec,
            title: page.title,
            seoDescription: page.seoDescription ?? null,
            source: 'publish',
            sourceRevisionId: null,
            publishedByUserId: ctx.auth?.sub ?? null,
            createdAt: now,
          })
          em.persist(revision)
          await markSiteFirstPublished(em, page, now)
        },
        () => {
          const target = page!
          const published = revision!
          target.publishedSpec = published.spec
          target.draftSpec = published.spec
          target.publishedAt = now
          target.publishedRevisionId = published.id
          target.draftUpdatedAt = null
          target.updatedAt = now
        },
      ],
      { transaction: true, label: PAGE_COMMAND_IDS.publish },
    )
    const result = toPublishResult(page!, revision!)
    await emitPageEvent(ctx, 'storefront.page.published', {
      id: result.pageId,
      ...scope,
      siteId: result.siteId,
      revisionId: result.revisionId,
      revisionNo: result.revisionNo,
    })
    return result
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('storefront.audit.pagePublish', 'Publish storefront page'),
      resourceKind: PAGE_RESOURCE_KIND,
      resourceId: result.pageId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotAfter: result,
    }
  },
}

/**
 * Re-publishes an older revision as a new `rollback` revision and resets the
 * draft (spec, title, SEO description) to it, replacing unpublished draft
 * changes (owner-confirmed default P2-Q4). Not undoable: roll back again.
 */
const rollbackPageCommand: CommandHandler<Record<string, unknown>, PublishResult> = {
  id: PAGE_COMMAND_IDS.rollback,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = await parseCommandInput(pageRollbackSchema, rawInput)
    const scope = await ensureCommandScope(ctx)
    const em = forkEm(ctx)
    let page: StorefrontPage | null = null
    let revision: StorefrontPageRevision | null = null
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        async () => {
          page = await loadPage(em, input.id, scope, true)
          enforcePageLock(page, ctx)
          const target = await em.findOne(StorefrontPageRevision, { id: input.revisionId, pageId: page.id, ...scope })
          if (!target) throw await storefrontNotFound('storefront.errors.revisionNotFound', 'Revision not found.')
          if (target.id === page.publishedRevisionId) {
            throw await unprocessable('storefront.errors.alreadyCurrent', 'This revision is already live.')
          }
          const validation = validatePageSpec(target.spec)
          if (!validation.ok) throw await specIssuesError(validation.issues, 'storefront.errors.revisionInvalid')
          await assertSectionReferences(ctx, scope, validation.sections, 'storefront.errors.revisionInvalid')
          revision = em.create(StorefrontPageRevision, {
            id: randomUUID(),
            tenantId: page.tenantId,
            organizationId: page.organizationId,
            siteId: page.siteId,
            pageId: page.id,
            revisionNo: await nextRevisionNo(em, page.id),
            spec: validation.spec as unknown as Record<string, unknown>,
            title: target.title,
            seoDescription: target.seoDescription ?? null,
            source: 'rollback',
            sourceRevisionId: target.id,
            publishedByUserId: ctx.auth?.sub ?? null,
            createdAt: now,
          })
          em.persist(revision)
        },
        () => {
          const current = page!
          const published = revision!
          current.publishedSpec = published.spec
          current.draftSpec = published.spec
          current.title = published.title
          current.seoDescription = published.seoDescription ?? null
          current.publishedAt = now
          current.publishedRevisionId = published.id
          current.draftUpdatedAt = null
          current.updatedAt = now
        },
      ],
      { transaction: true, label: PAGE_COMMAND_IDS.rollback },
    )
    const result = toPublishResult(page!, revision!)
    await emitPageEvent(ctx, 'storefront.page.rolled_back', {
      id: result.pageId,
      ...scope,
      siteId: result.siteId,
      revisionId: result.revisionId,
      revisionNo: result.revisionNo,
    })
    return result
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('storefront.audit.pageRollback', 'Roll back storefront page'),
      resourceKind: PAGE_RESOURCE_KIND,
      resourceId: result.pageId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotAfter: result,
    }
  },
}

registerCommand(createPageCommand)
registerCommand(updatePageCommand)
registerCommand(deletePageCommand)
registerCommand(publishPageCommand)
registerCommand(rollbackPageCommand)

export { createPageCommand, updatePageCommand, deletePageCommand, publishPageCommand, rollbackPageCommand }
