import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Storefront events. Declared here before they are emitted; both feed workflow
 * trigger discovery today (e.g. a "new store" automation) and cache
 * revalidation later (spec Phase 4).
 */
const events = [
  { id: 'storefront.site.created', label: 'Storefront Created', entity: 'site', category: 'lifecycle' },
  { id: 'storefront.brand.updated', label: 'Storefront Brand Updated', entity: 'site', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'storefront', events })
export const emitStorefrontEvent = eventsConfig.emit
export type StorefrontEventId = (typeof events)[number]['id']
export default eventsConfig
