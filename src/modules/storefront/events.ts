import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Storefront events. Declared here before they are emitted; both feed workflow
 * trigger discovery today (e.g. a "new store" automation) and cache
 * revalidation later (spec Phase 4).
 */
const events = [
  { id: 'storefront.site.created', label: 'Storefront Created', entity: 'site', category: 'lifecycle' },
  { id: 'storefront.brand.updated', label: 'Storefront Brand Updated', entity: 'site', category: 'crud' },
  { id: 'storefront.page.created', label: 'Storefront Page Created', entity: 'page', category: 'crud' },
  { id: 'storefront.page.updated', label: 'Storefront Page Updated', entity: 'page', category: 'crud' },
  { id: 'storefront.page.deleted', label: 'Storefront Page Deleted', entity: 'page', category: 'crud' },
  { id: 'storefront.page.published', label: 'Storefront Page Published', entity: 'page', category: 'lifecycle' },
  { id: 'storefront.page.rolled_back', label: 'Storefront Page Rolled Back', entity: 'page', category: 'lifecycle' },
  { id: 'storefront.template.applied', label: 'Storefront Template Applied', entity: 'site', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'storefront', events })
export const emitStorefrontEvent = eventsConfig.emit
export type StorefrontEventId = (typeof events)[number]['id']
export default eventsConfig
