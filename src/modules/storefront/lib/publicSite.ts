import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StorefrontPage, StorefrontPageRevision, StorefrontSite, StorefrontTheme } from '../data/entities'
import { readThemeTokens, type ThemeTokens } from './theme'
import { isValidSiteSlug, RESERVED_PAGE_SLUGS, SITE_SLUG_PATTERN } from './slug'

export const HOME_PAGE_SLUG = 'index'

export type PublicSite = {
  site: StorefrontSite
  /** The organization slug, for links into that tenant's customer portal. */
  organizationSlug: string | null
}

/**
 * Resolves a live site from its slug — the only anonymous entry point.
 *
 * The site row is found by its globally unique slug; every following read is
 * pinned to that row's `tenant_id` + `organization_id`. A deactivated tenant, a
 * deleted or inactive organization, or a soft-deleted site resolves to `null`
 * (the caller answers 404), so nothing about such a store leaks.
 */
export async function resolvePublicSite(em: EntityManager, slug: string): Promise<PublicSite | null> {
  const normalized = slug.trim().toLowerCase()
  if (!isValidSiteSlug(normalized)) return null
  const site = await em.findOne(StorefrontSite, { slug: normalized, deletedAt: null })
  if (!site) return null
  const scope = { tenantId: site.tenantId, organizationId: site.organizationId }

  const tenant = await em.findOne(Tenant, { id: scope.tenantId, deletedAt: null })
  if (!tenant || !tenant.isActive) return null
  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: scope.organizationId, tenant: scope.tenantId, deletedAt: null },
    undefined,
    scope,
  )
  if (!organization || !organization.isActive) return null
  return { site, organizationSlug: organization.slug ?? null }
}

export type PublicStorefrontPage = {
  site: StorefrontSite
  tokens: ThemeTokens
  organizationSlug: string | null
  /** The published page; `null` when the slug is unknown, unpublished or deleted. */
  page: Pick<StorefrontPage, 'id' | 'siteId' | 'slug' | 'title' | 'publishedSpec' | 'publishedRevisionId'> | null
  /** The live revision (title and SEO description buyers see). */
  revision: Pick<StorefrontPageRevision, 'id' | 'title' | 'seoDescription'> | null
}

/**
 * A live store plus one of its **published** pages (`pageSlug = 'index'` for the
 * home page). Every read is pinned to the site's tenant and organization; drafts
 * are never returned: the page must carry a published spec, and its title/SEO
 * description come from the live revision, not the working copy.
 */
export async function resolvePublicStorefrontPage(
  em: EntityManager,
  siteSlug: string,
  pageSlug: string,
): Promise<PublicStorefrontPage | null> {
  const resolved = await resolvePublicSite(em, siteSlug)
  if (!resolved) return null
  const { site } = resolved
  const scope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const theme = await em.findOne(StorefrontTheme, { siteId: site.id, ...scope, deletedAt: null })
  const base = { site, tokens: readThemeTokens(theme?.tokens), organizationSlug: resolved.organizationSlug }
  const slug = pageSlug.trim().toLowerCase()
  const isHome = slug === HOME_PAGE_SLUG
  if (!isHome && (!SITE_SLUG_PATTERN.test(slug) || RESERVED_PAGE_SLUGS.has(slug))) return { ...base, page: null, revision: null }
  // Buyers never need the working copy: the draft spec (up to 64 KB) is not read.
  const page = await em.findOne(
    StorefrontPage,
    { siteId: site.id, ...scope, slug, deletedAt: null },
    { fields: ['id', 'siteId', 'slug', 'title', 'publishedSpec', 'publishedRevisionId'] },
  )
  if (!page || !page.publishedSpec) return { ...base, page: null, revision: null }
  const revision = page.publishedRevisionId
    ? await em.findOne(StorefrontPageRevision, { id: page.publishedRevisionId, pageId: page.id, ...scope }, { fields: ['id', 'title', 'seoDescription'] })
    : null
  return { ...base, page, revision }
}

/**
 * Absolute public URL of a store on the platform host (canonical, Open Graph,
 * JSON-LD). The base comes from the framework's configured-URL rule: `APP_URL`,
 * required in production (a missing value throws instead of publishing
 * `localhost` canonicals), with the local default only outside production.
 */
export function storefrontPublicUrl(slug: string, path = '', env: Record<string, string | undefined> = process.env): string {
  return `${getSecurityEmailBaseUrl(undefined, env)}/${slug}${path}`
}

export function storefrontMediaPath(slug: string, attachmentId: string): string {
  return `/api/storefront/media/${encodeURIComponent(slug)}/${encodeURIComponent(attachmentId)}`
}
