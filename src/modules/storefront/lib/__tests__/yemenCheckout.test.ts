import { describe, expect, it } from '@jest/globals'
import { toLatinDigits } from '@/lib/digits'
import { findDistrict, findGovernorate, isInYemen, normalizeYemeniMobile, yemenGovernorates, YEMEN_DATASET } from '../yemen'
import { destinationOf, yemenZoneRate, yemenZonesProvider } from '../yemenZones'
import { destinationErrors, SEEDED_TRANSFER_INSTRUCTIONS, transferTextFrom } from '../shopCheckout'
import { orderTokenFor, hashOrderToken, orderCookieName } from '../shopOrders'

describe('TEST-J06 Yemen administrative divisions', () => {
  it('bundles 22 governorates and 335 districts with P-codes and Arabic names (OCHA COD-AB v01)', () => {
    const governorates = yemenGovernorates()
    expect(governorates).toHaveLength(22)
    expect(governorates.reduce((sum, row) => sum + row.districts.length, 0)).toBe(335)
    expect(YEMEN_DATASET).toMatchObject({ version: 'v01', validOn: '2019-11-22', licence: 'CC BY-IGO 3.0' })
    expect(findGovernorate('YE24')?.nameEn).toBe('Aden')
  })

  it('accepts a district only inside its governorate', () => {
    const aden = findGovernorate('YE24')!
    const district = aden.districts[0]!
    expect(findDistrict('YE24', district.code)).toEqual(district)
    expect(findDistrict('YE15', district.code)).toBeNull()
    expect(findDistrict('YE24', 'YE9999')).toBeNull()
    expect(findGovernorate('YE99')).toBeNull()
  })

  it('normalizes Yemeni mobiles to E.164, Arabic digits included', () => {
    for (const input of ['771234567', '0771234567', '+967 771 234 567', '00967771234567', '967-77-123-4567']) {
      expect(normalizeYemeniMobile(input)).toBe('+967771234567')
    }
    expect(normalizeYemeniMobile('٧٧١٢٣٤٥٦٧', toLatinDigits)).toBe('+967771234567')
    for (const input of ['721234567', '77123456', '7712345678', '+966771234567', '']) expect(normalizeYemeniMobile(input)).toBeNull()
  })

  it('accepts GPS points in Yemen only', () => {
    expect(isInYemen(15.35, 44.2)).toBe(true)
    expect(isInYemen(24.7, 46.7)).toBe(false)
  })

  it('validates a destination field by field', () => {
    const district = findGovernorate('YE13')!.districts[0]!.code
    expect(destinationErrors({ governorate: 'YE13', district, area: 'شارع حدة' })).toBeNull()
    expect(destinationErrors({ governorate: 'YE15', district, area: ' ', gps: { latitude: 1, longitude: 1 } })).toEqual({
      'destination.district': 'storefront.shop.checkout.errors.district',
      'destination.area': 'storefront.shop.checkout.errors.area',
      'destination.gps': 'storefront.shop.checkout.errors.gps',
    })
  })
})

describe('TEST-J06 Yemen delivery zones', () => {
  const aden = findGovernorate('YE24')!
  const [crater, mualla] = aden.districts
  const settings = { currencyCode: 'YER', rates: [{ governorate: 'YE24', amount: 2500 }, { governorate: 'YE24', district: crater!.code, amount: 1500 }], defaultAmount: 4000 }

  it('prices by district, then governorate, then the default; unserved without a default', () => {
    expect(yemenZoneRate(settings, { governorate: 'YE24', district: crater!.code })).toEqual({ amount: 1500, currencyCode: 'YER' })
    expect(yemenZoneRate(settings, { governorate: 'YE24', district: mualla!.code })).toEqual({ amount: 2500, currencyCode: 'YER' })
    const taiz = findGovernorate('YE15')!.districts[0]!.code
    expect(yemenZoneRate(settings, { governorate: 'YE15', district: taiz })).toEqual({ amount: 4000, currencyCode: 'YER' })
    expect(yemenZoneRate({ ...settings, defaultAmount: undefined }, { governorate: 'YE15', district: taiz })).toBeNull()
    expect(yemenZoneRate(settings, { governorate: 'YE15', district: crater!.code })).toBeNull()
    expect(yemenZoneRate({ rates: 'broken' }, { governorate: 'YE24', district: crater!.code })).toBeNull()
  })

  it('reads the destination from the shipping-method snapshot, so a later recalculation charges the same', async () => {
    const metadata = { destination: { governorate: 'YE24', district: crater!.code } }
    expect(destinationOf(metadata)).toEqual(metadata.destination)
    const result = await yemenZonesProvider.calculate!({ method: { code: 'zones', name: 'توصيل', metadata }, settings } as never)
    expect(result?.adjustments).toEqual([expect.objectContaining({ kind: 'shipping', amountNet: 1500, amountGross: 1500, currencyCode: 'YER' })])
    expect((await yemenZonesProvider.calculate!({ method: { metadata: null }, settings } as never))?.adjustments).toEqual([])
  })
})

describe('TEST-J07 payment and order access', () => {
  it('hides bank transfer while its instructions are missing or the seeded example', () => {
    expect(transferTextFrom({})).toBeNull()
    expect(transferTextFrom({ instructions: SEEDED_TRANSFER_INSTRUCTIONS, accountNumber: 'ACME' })).toBeNull()
    expect(transferTextFrom({ instructions: 'حوّل إلى بنك الكريمي', accountNumber: ' 123 ' })).toEqual({ instructions: 'حوّل إلى بنك الكريمي', accountNumber: '123' })
  })

  it('derives a stable 256-bit order token from the cart token and stores only its hash', () => {
    const token = orderTokenFor('a'.repeat(43))
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(orderTokenFor('a'.repeat(43))).toBe(token)
    expect(orderTokenFor('b'.repeat(43))).not.toBe(token)
    expect(hashOrderToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(orderCookieName('11111111-2222-3333-4444-555555555555', 'SO-1')).toMatch(/^sf_ord_111111112222_[0-9a-f]{10}$/)
  })
})

describe('TEST-J07 order lines match the installed sales.orders.create schema', () => {
  it('a simple product line (no variant, no options) and a personalized variant line both parse', async () => {
    const { orderCreateSchema } = await import('@open-mercato/core/modules/sales/data/validators')
    const { toSalesLine } = await import('../shopCheckout')
    const base = { id: 'l1', productId: '11111111-1111-4111-8111-111111111111', title: 'تمر', href: null, image: null, quantity: 2, unitPrice: { amount: 1200, currencyCode: 'YER', formatted: '' }, lineTotal: null, maxQuantity: 99, issues: [] }
    const simple = toSalesLine({ ...base, variantId: null, variantLabel: null, personalization: [] }, 'YER', 1)
    const personalized = toSalesLine(
      { ...base, variantId: '22222222-2222-4222-8222-222222222222', variantLabel: 'كبير', personalization: [{ code: 'recipient', label: 'الاسم', value: 'أحمد', inputType: 'text', required: true }] },
      'YER',
      2,
    )
    expect(personalized).toMatchObject({ productVariantId: '22222222-2222-4222-8222-222222222222', description: 'كبير', comment: 'الاسم: أحمد' })
    const parsed = orderCreateSchema.safeParse({
      tenantId: '33333333-3333-4333-8333-333333333333',
      organizationId: '44444444-4444-4444-8444-444444444444',
      currencyCode: 'YER',
      customerSnapshot: { customer: { displayName: 'سارة', primaryPhone: '+967771234567' }, contact: null, source: 'storefront' },
      shippingAddressSnapshot: { addressLine1: 'كريتر', city: 'صيرة', region: 'عدن', country: 'YE' },
      lines: [simple, personalized],
    })
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
  })
})
