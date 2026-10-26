import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesShippingMethod } from '@open-mercato/core/modules/sales/data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildShopCommandContext } from '../commands/cart'
import { YEMEN_ZONES_PROVIDER_KEY, type YemenZoneSettings } from './yemenZones'

/**
 * DEVELOPMENT DATA ONLY (shopping-journey spec Phase 4): a Yemen-zones delivery
 * method with sample rates, so a local store can take orders before its
 * merchant configures delivery. The rates are invented; the method's name and
 * description say so. Created through the installed
 * `sales.shipping-methods.create` command, so it appears (and is edited or
 * removed) in the sales configuration screens like any other method.
 */

export const DEV_ZONE_METHOD_CODE = 'yemen-zones-dev'

export const DEV_ZONE_SETTINGS: YemenZoneSettings = {
  currencyCode: 'YER',
  rates: [
    { governorate: 'YE13', amount: 1000 }, // Sana'a City
    { governorate: 'YE23', amount: 1500 }, // Sana'a
    { governorate: 'YE15', amount: 2000 }, // Ta'iz
    { governorate: 'YE24', amount: 2500 }, // Aden
    { governorate: 'YE18', amount: 2500 }, // Al Hodeidah
  ],
  defaultAmount: 3500,
}

export type FixtureScope = { tenantId: string; organizationId: string }

/** Creates the development delivery method unless the organization already has one with its code. */
export async function ensureDevZoneShippingMethod(deps: { em: EntityManager; container: AwilixContainer }, scope: FixtureScope): Promise<'created' | 'existing'> {
  const existing = await deps.em.findOne(SalesShippingMethod, { ...scope, code: DEV_ZONE_METHOD_CODE, deletedAt: null })
  if (existing) return 'existing'
  const commandBus = deps.container.resolve('commandBus') as CommandBus
  await commandBus.execute('sales.shipping-methods.create', {
    input: {
      ...scope,
      code: DEV_ZONE_METHOD_CODE,
      name: 'توصيل (بيانات تطوير)',
      description: 'Development data: sample delivery rates by governorate. Replace with real rates before selling.',
      providerKey: YEMEN_ZONES_PROVIDER_KEY,
      currencyCode: DEV_ZONE_SETTINGS.currencyCode,
      estimatedTransitDays: 3,
      isActive: true,
      providerSettings: DEV_ZONE_SETTINGS,
    },
    ctx: buildShopCommandContext(deps.container, { id: '', slug: '', ...scope }),
  })
  return 'created'
}
