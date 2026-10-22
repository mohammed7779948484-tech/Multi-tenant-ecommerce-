import type { StorefrontPage } from '../data/entities'
import { HOME_PAGE_SLUG_VALUE } from './slug'

/** Hard cap per store, home page included (spec: Caps). */
export const MAX_PAGES_PER_SITE = 30

export type PageStatus = 'draft' | 'published' | 'changed'

/**
 * `draft` — never published; `published` — nothing saved since the last
 * publish; `changed` — a draft spec, title or SEO description was saved after
 * it. Publish and rollback always clear `draft_updated_at`, so a non-null value
 * on a published page means exactly "changed" (and the list can filter on it).
 */
export function pageStatus(page: Pick<StorefrontPage, 'publishedRevisionId' | 'draftUpdatedAt'>): PageStatus {
  if (!page.publishedRevisionId) return 'draft'
  return page.draftUpdatedAt ? 'changed' : 'published'
}

export function isHomePage(page: Pick<StorefrontPage, 'slug'>): boolean {
  return page.slug === HOME_PAGE_SLUG_VALUE
}

/** Public path of a page under its store. */
export function pagePublicPath(siteSlug: string, pageSlug: string): string {
  return pageSlug === HOME_PAGE_SLUG_VALUE ? `/${siteSlug}` : `/${siteSlug}/${pageSlug}`
}
