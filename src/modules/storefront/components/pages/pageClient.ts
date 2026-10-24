import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'
import type { PageStatus } from '../../lib/pages'

export const PAGES_API_PATH = 'storefront/pages'
export const PAGES_HREF = '/backend/storefront/pages'
export const PAGE_CREATE_HREF = `${PAGES_HREF}/create`
/** Generated entity id of a page (CrudForm/DataTable extension hosts). */
export const PAGE_ENTITY_ID = 'storefront:storefront_page'
/** Stable DataTable extension id for the page list. */
export const PAGES_TABLE_ID = 'storefront.pages'

export const pageSettingsHref = (id: string) => `${PAGES_HREF}/${encodeURIComponent(id)}`
export const pageBuilderHref = (id: string) => `${PAGES_HREF}/${encodeURIComponent(id)}/builder`

export const PAGE_STATUS_VARIANTS: StatusMap<PageStatus> = {
  draft: 'neutral',
  published: 'success',
  changed: 'warning',
}

export const PAGE_STATUS_LABEL_KEYS: Record<PageStatus, [string, string]> = {
  draft: ['storefront.pages.status.draft', 'Draft'],
  published: ['storefront.pages.status.published', 'Published'],
  changed: ['storefront.pages.status.changed', 'Unpublished changes'],
}
