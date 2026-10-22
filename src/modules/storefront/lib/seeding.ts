import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { StorefrontPage, StorefrontPageRevision, StorefrontSite, StorefrontTheme } from '../data/entities'
import { emitStorefrontEvent } from '../events'
import { buildDefaultHomeSpec } from './blocks/defaultHome'
import { validatePageSpec } from './blocks/pageSpec'
import { HOME_PAGE_SLUG } from './publicSite'
import { siteSlugCandidates } from './slug'
import { DEFAULT_THEME_TOKENS } from './theme'

const logger = createLogger('storefront').child({ component: 'seeding' })

export type StorefrontScope = { tenantId: string; organizationId: string }

export type EnsureSiteResult =
  | { status: 'created' | 'existing'; siteId: string; slug: string; repaired: string[] }
  | { status: 'skipped'; reason: 'organization_not_found' | 'no_free_slug' }

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown } | null
  if (!candidate) return false
  if (candidate.code === '23505') return true
  if (candidate.name === 'UniqueConstraintViolationException') return true
  return typeof candidate.message === 'string' && candidate.message.includes('duplicate key value')
}

/**
 * The seeded home page and its revision 1, written together: the page's
 * `published_revision_id` points at the revision so "published ⇔ revision"
 * holds from the first row (Phase 2 data model).
 */
function persistHomePage(em: EntityManager, scope: StorefrontScope, siteId: string, storeName: string, now: Date): void {
  const spec = buildDefaultHomeSpec({ storeName })
  const validation = validatePageSpec(spec)
  if (!validation.ok) throw new Error('[internal] storefront default home template failed validation')
  const publishedSpec = validation.spec as unknown as Record<string, unknown>
  const title = storeName.slice(0, 70)
  const pageId = randomUUID()
  const revisionId = randomUUID()
  em.persist(
    em.create(StorefrontPage, {
      id: pageId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      siteId,
      slug: HOME_PAGE_SLUG,
      title,
      seoDescription: null,
      publishedSpec,
      publishedAt: now,
      publishedRevisionId: revisionId,
      draftSpec: null,
      draftUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  )
  em.persist(
    em.create(StorefrontPageRevision, {
      id: revisionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      siteId,
      pageId,
      revisionNo: 1,
      spec: publishedSpec,
      title,
      seoDescription: null,
      source: 'publish',
      sourceRevisionId: null,
      publishedByUserId: null,
      createdAt: now,
    }),
  )
}

/**
 * Idempotently gives one organization its storefront: a site, default theme
 * tokens and a published home page (owner default: new stores publish
 * immediately). Re-running it reuses the existing site and only recreates a
 * missing theme or home page. Each write runs in its own transaction; the
 * `storefront.site.created` event is emitted only after that commit.
 */
export async function ensureStorefrontSite(baseEm: EntityManager, scope: StorefrontScope): Promise<EnsureSiteResult> {
  const em = baseEm.fork()
  const existing = await em.findOne(StorefrontSite, { ...scope, deletedAt: null })
  if (existing) {
    const repaired: string[] = []
    await em.transactional(async (tem) => {
      const now = new Date()
      const theme = await tem.findOne(StorefrontTheme, { ...scope, siteId: existing.id, deletedAt: null })
      if (!theme) {
        tem.persist(
          tem.create(StorefrontTheme, {
            ...scope,
            siteId: existing.id,
            tokens: DEFAULT_THEME_TOKENS as unknown as Record<string, unknown>,
            createdAt: now,
            updatedAt: now,
          }),
        )
        repaired.push('theme')
      }
      const home = await tem.findOne(StorefrontPage, { ...scope, siteId: existing.id, slug: HOME_PAGE_SLUG, deletedAt: null })
      if (!home) {
        persistHomePage(tem, scope, existing.id, existing.name, now)
        repaired.push('home')
      }
    })
    return { status: 'existing', siteId: existing.id, slug: existing.slug, repaired }
  }

  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: scope.organizationId, tenant: scope.tenantId, deletedAt: null },
    undefined,
    scope,
  )
  if (!organization) return { status: 'skipped', reason: 'organization_not_found' }

  const storeName = (organization.name ?? '').trim().slice(0, 80) || 'Store'
  const candidates = siteSlugCandidates(organization.slug || storeName, scope.organizationId)
  const taken = new Set(
    (await em.find(StorefrontSite, { slug: { $in: candidates }, deletedAt: null }, { fields: ['slug'] })).map((row) => row.slug),
  )

  for (const slug of candidates.filter((candidate) => !taken.has(candidate))) {
    try {
      const siteId = await em.fork().transactional(async (tem) => {
        const now = new Date()
        const site = tem.create(StorefrontSite, {
          ...scope,
          slug,
          name: storeName,
          description: null,
          logoAttachmentId: null,
          defaultLocale: 'en',
          firstPublishedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        tem.persist(site)
        await tem.flush()
        tem.persist(
          tem.create(StorefrontTheme, {
            ...scope,
            siteId: site.id,
            tokens: DEFAULT_THEME_TOKENS as unknown as Record<string, unknown>,
            createdAt: now,
            updatedAt: now,
          }),
        )
        persistHomePage(tem, scope, site.id, storeName, now)
        return site.id
      })
      await emitStorefrontEvent(
        'storefront.site.created',
        { id: siteId, tenantId: scope.tenantId, organizationId: scope.organizationId, slug },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      ).catch((err: unknown) => logger.warn('storefront.site.created emit failed', { err, siteId }))
      return { status: 'created', siteId, slug, repaired: [] }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Lost a race for this slug or for the organization's single site: re-check and continue.
      const raced = await em.fork().findOne(StorefrontSite, { ...scope, deletedAt: null })
      if (raced) return { status: 'existing', siteId: raced.id, slug: raced.slug, repaired: [] }
    }
  }
  return { status: 'skipped', reason: 'no_free_slug' }
}
