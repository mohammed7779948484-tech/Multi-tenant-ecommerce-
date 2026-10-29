import { describe, expect, it, jest } from '@jest/globals'

const resolveAvailability = jest.fn<(query: { items: Array<{ catalogProductId: string; catalogVariantId: string | null }> }) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/availability', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/shared/lib/availability')>('@open-mercato/shared/lib/availability')
  return { ...actual, resolveAvailability: (query: { items: Array<{ catalogProductId: string; catalogVariantId: string | null }> }) => resolveAvailability(query) }
})

import { resolveShopAvailability, StockCheckFailedError, stockKey } from '../shopAvailability'
import { calculationLine, methodSnapshots, salesProviderContext } from '../shopCheckout'
import { cheapestPrice } from '../shopProduct'

const container = { resolve: () => undefined } as never
const scope = { tenantId: 't', organizationId: 'o' }
const price = (amount: number, currencyCode: string) => ({ amount, currencyCode, formatted: `${amount} ${currencyCode}` })

describe('the from-price compares amounts in one currency', () => {
  it('never calls a small amount in another currency the cheapest', () => {
    // 20 USD is not cheaper than 5,000 YER: the variants are mostly priced in YER.
    expect(cheapestPrice([price(7000, 'YER'), price(20, 'USD'), price(5000, 'YER')])).toEqual(price(5000, 'YER'))
  })

  it('keeps the first listed currency on a tie, and handles no prices', () => {
    expect(cheapestPrice([price(30, 'USD'), price(9000, 'YER')])).toEqual(price(30, 'USD'))
    expect(cheapestPrice([])).toBeNull()
  })
})

describe('stock for placement is checked or refused', () => {
  const items = [{ productId: 'p1', variantId: 'v1', quantity: 2 }]

  it('browsing treats a failed stock lookup as unknown', async () => {
    resolveAvailability.mockRejectedValueOnce(new Error('provider down'))
    await expect(resolveShopAvailability(container, scope, items)).resolves.toEqual(new Map())
  })

  it('a strict lookup fails when the provider fails', async () => {
    resolveAvailability.mockRejectedValueOnce(new Error('provider down'))
    await expect(resolveShopAvailability(container, scope, items, { strict: true })).rejects.toBeInstanceOf(StockCheckFailedError)
  })

  it('a strict lookup fails when an item is left unanswered', async () => {
    resolveAvailability.mockResolvedValueOnce({ byItem: {} })
    await expect(resolveShopAvailability(container, scope, items, { strict: true })).rejects.toBeInstanceOf(StockCheckFailedError)
    const answer = { state: 'in_stock', canFulfil: true, availableQuantity: 4 }
    resolveAvailability.mockResolvedValueOnce({ byItem: { [stockKey('p1', 'v1')]: answer } })
    await expect(resolveShopAvailability(container, scope, items, { strict: true })).resolves.toEqual(new Map([[stockKey('p1', 'v1'), answer]]))
  })
})

describe('the quote is calculated from the input the order is calculated from', () => {
  const shipping = {
    id: 'ship',
    code: 'yemen-zones',
    name: 'توصيل',
    description: null,
    carrierCode: null,
    providerKey: 'suqna-yemen-zones',
    serviceLevel: null,
    estimatedTransitDays: 2,
    baseRateNet: '0.0000',
    baseRateGross: '0.0000',
    currencyCode: null,
    metadata: { providerSettings: { currencyCode: 'YER', rates: [] } },
  }
  const payment = { id: 'pay', code: 'cod', name: 'الدفع عند الاستلام', description: null, providerKey: 'cash-on-delivery', terms: null, metadata: { providerSettings: { feeFlat: 500 } } }

  it('builds the method context the way sales.orders.create normalizes the stored snapshots', () => {
    const snapshots = methodSnapshots(shipping as never, payment as never, { governorate: 'YE24', district: 'YE2401' })
    const context = salesProviderContext(snapshots, 'YER')
    expect(context.shippingMethod).toEqual({
      id: 'ship',
      code: 'yemen-zones',
      name: 'توصيل',
      providerKey: 'suqna-yemen-zones',
      // A method without its own currency takes the order's, as the sales normalizer does.
      currencyCode: 'YER',
      baseRateNet: 0,
      baseRateGross: 0,
      metadata: { providerSettings: { currencyCode: 'YER', rates: [] }, destination: { governorate: 'YE24', district: 'YE2401' } },
      providerSettings: { currencyCode: 'YER', rates: [] },
    })
    expect(context.paymentMethod).toEqual({
      id: 'pay',
      code: 'cod',
      name: 'الدفع عند الاستلام',
      providerKey: 'cash-on-delivery',
      terms: null,
      metadata: { providerSettings: { feeFlat: 500 } },
      providerSettings: { feeFlat: 500 },
    })
  })

  it('gives a line the defaults the order line gets', () => {
    const line = calculationLine({ lineNumber: 1, kind: 'product', productId: 'p1', quantity: 3, currencyCode: 'YER', unitPriceNet: 100, unitPriceGross: 100, discountAmountBasis: 'unit' })
    expect(line).toMatchObject({ productVariantId: null, quantity: 3, normalizedQuantity: 3, quantityUnit: null, normalizedUnit: null, taxRate: null, discountAmount: null })
  })
})
