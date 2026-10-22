import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StorefrontPage, StorefrontSite, StorefrontTheme } from '../data/entities'
import { readThemeTokens, type ThemeTokens } from './theme'
import { isValidSiteSlug } from './slug'

export const HOME_PAGE_SLUG = 'index'

export type PublicStorefront = {
  site: StorefrontSite
  tokens: ThemeTokens
  home: StorefrontPage | null
  /** The organization slug, for links into that tenant's customer portal. */
  organizationSlug: string | null
}

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

/** A live site plus its theme tokens and home page, all read in the site's scope. */
export async function resolvePublicStorefront(em: EntityManager, slug: string): Promise<PublicStorefront | null> {
  const resolved = await resolvePublicSite(em, slug)
  if (!resolved) return null
  const { site } = resolved
  const scope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const theme = await em.findOne(StorefrontTheme, { siteId: site.id, ...scope, deletedAt: null })
  const home = await em.findOne(StorefrontPage, { siteId: site.id, ...scope, slug: HOME_PAGE_SLUG, deletedAt: null })
  return {
    site,
    tokens: readThemeTokens(theme?.tokens),
    home,
    organizationSlug: resolved.organizationSlug,
  }
}

/** Absolute public URL of a store on the platform host. */
export function storefrontPublicUrl(slug: string, path = ''): string {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/${slug}${path}`
}

export function storefrontMediaPath(slug: string, attachmentId: string): string {
  return `/api/storefront/media/${encodeURIComponent(slug)}/${encodeURIComponent(attachmentId)}`
}
