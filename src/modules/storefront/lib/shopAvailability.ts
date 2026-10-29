import type { AwilixContainer } from 'awilix'
import {
  availabilityItemKey,
  resolveAvailability,
  type AvailabilityItemResult,
  type AvailabilityModuleConfigReader,
} from '@open-mercato/shared/lib/availability'
import { createLogger } from '@open-mercato/shared/lib/logger'

/**
 * Stock as the buyer sees it, through the installed availability contract
 * (the `wms` provider when enabled, else the catalog-only fallback). Advisory
 * at browse and cart time; `bypassCache` asks the provider for a live answer
 * (spec S-12).
 */

const logger = createLogger('storefront').child({ component: 'shop-availability' })

export type StockQueryItem = { productId: string; variantId?: string | null; quantity?: number }
export type ShopScope = { tenantId: string; organizationId: string }

export function stockKey(productId: string, variantId?: string | null): string {
  return availabilityItemKey({ catalogProductId: productId, catalogVariantId: variantId ?? null })
}

function moduleConfigOf(container: AwilixContainer): AvailabilityModuleConfigReader | undefined {
  try {
    return container.resolve('moduleConfigService') as AvailabilityModuleConfigReader
  } catch {
    return undefined
  }
}

/** Raised by a `strict` lookup that got no answer for every item it asked about. */
export class StockCheckFailedError extends Error {
  constructor(cause?: unknown) {
    super('[internal] Live stock could not be checked', cause === undefined ? undefined : { cause })
  }
}

/**
 * Availability per item, keyed by `stockKey`. A provider failure returns an
 * empty map: browsing never fails on stock, and callers treat a missing entry
 * as "not known". `strict` (order placement) throws `StockCheckFailedError`
 * instead, on a failure or on any item left unanswered, so an order is never
 * placed on stock nobody checked.
 */
export async function resolveShopAvailability(
  container: AwilixContainer,
  scope: ShopScope,
  items: StockQueryItem[],
  options: { bypassCache?: boolean; strict?: boolean } = {},
): Promise<Map<string, AvailabilityItemResult>> {
  const result = new Map<string, AvailabilityItemResult>()
  if (!items.length) return result
  try {
    const moduleConfig = moduleConfigOf(container)
    const answer = await resolveAvailability(
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        items: items.map((item) => ({ catalogProductId: item.productId, catalogVariantId: item.variantId ?? null, quantity: item.quantity ?? 1 })),
        bypassCache: options.bypassCache,
      },
      moduleConfig ? { moduleConfig, container } : { container },
    )
    for (const [key, value] of Object.entries(answer.byItem)) result.set(key, value)
  } catch (err) {
    if (options.strict) {
      logger.warn('Live stock check failed', { err, ...scope })
      throw new StockCheckFailedError(err)
    }
    logger.warn('Storefront availability lookup failed; showing products without stock state', { err, ...scope })
  }
  if (options.strict && items.some((item) => !result.has(stockKey(item.productId, item.variantId)))) {
    logger.warn('Live stock check left items unanswered', { ...scope })
    throw new StockCheckFailedError()
  }
  return result
}

/** The badge-worthy state of an availability answer: sold out, running low, or nothing to say. */
export function stockBadge(item: AvailabilityItemResult | undefined): 'out_of_stock' | 'low_stock' | null {
  if (!item) return null
  if (!item.canFulfil || item.state === 'out_of_stock') return 'out_of_stock'
  return item.state === 'low_stock' ? 'low_stock' : null
}
