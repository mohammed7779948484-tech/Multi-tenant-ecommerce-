import type { EntityManager } from '@mikro-orm/postgresql'
import { StorefrontPage, StorefrontPageRevision, type StorefrontSite } from '../data/entities'
import { pagePublicPath } from './pages'
import { HOME_PAGE_SLUG } from './publicSite'

/** One link of the store menu and footer. */
export type ShopNavLink = { href: string; label: string }

/** At most this many store pages appear in the menu (the store has up to 30 pages). */
export const MAX_NAV_PAGES = 8

/**
 * The store's published pages other than home, in creation order, labelled with
 * their live revision's title (never the working copy). Pinned to the store's
 * tenant and organization.
 */
export async function loadStorePageLinks(em: EntityManager, site: Pick<StorefrontSite, 'id' | 'slug' | 'tenantId' | 'organizationId'>): Promise<ShopNavLink[]> {
  const scope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const pages = await em.find(
    StorefrontPage,
    { siteId: site.id, ...scope, deletedAt: null, publishedRevisionId: { $ne: null }, slug: { $ne: HOME_PAGE_SLUG } },
    { fields: ['id', 'slug', 'publishedRevisionId'], orderBy: { createdAt: 'asc' }, limit: MAX_NAV_PAGES },
  )
  const revisionIds = pages.map((page) => page.publishedRevisionId).filter((id): id is string => Boolean(id))
  if (!revisionIds.length) return []
  const revisions = await em.find(StorefrontPageRevision, { id: { $in: revisionIds }, siteId: site.id, ...scope }, { fields: ['id', 'title'] })
  const titles = new Map(revisions.map((revision) => [revision.id, revision.title]))
  const links: ShopNavLink[] = []
  for (const page of pages) {
    const title = page.publishedRevisionId ? titles.get(page.publishedRevisionId) : undefined
    if (title) links.push({ href: pagePublicPath(site.slug, page.slug), label: title })
  }
  return links
}
