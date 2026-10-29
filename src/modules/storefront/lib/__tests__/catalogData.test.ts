import { describe, expect, it } from '@jest/globals'
import { anonymousPricingContext, clampCollectionPage, collectionPagePath, productGridLimit, shopPriceOf, storeCatalogLinks } from '../catalogData'

describe('TEST-020 store catalog helpers', () => {
  it('prices with the gross amount, else the net amount, formatted for Arabic buyers (ar-YE)', () => {
    expect(shopPriceOf({ unitPriceGross: '12.50', unitPriceNet: '10.00', currencyCode: 'EUR' })).toEqual({
      amount: 12.5,
      currencyCode: 'EUR',
      formatted: new Intl.NumberFormat('ar-YE', { style: 'currency', currency: 'EUR' }).format(12.5),
    })
    expect(shopPriceOf({ unitPriceGross: null, unitPriceNet: '1500', currencyCode: 'YER' })?.amount).toBe(1500)
  })

  it('shows no price rather than a wrong one', () => {
    expect(shopPriceOf({ unitPriceGross: null, unitPriceNet: null, currencyCode: 'EUR' })).toBeNull()
    expect(shopPriceOf({ unitPriceGross: 'abc', unitPriceNet: null, currencyCode: 'EUR' })).toBeNull()
    expect(shopPriceOf({ unitPriceGross: '5', unitPriceNet: null, currencyCode: null })).toBeNull()
    expect(shopPriceOf({ unitPriceGross: '5', unitPriceNet: null, currencyCode: 'not-a-currency' })).toBeNull()
  })

  it('prices as an anonymous buyer: no channel, customer, user or group, one unit', () => {
    const now = new Date('2026-10-24T10:00:00Z')
    expect(anonymousPricingContext(now)).toEqual({
      channelId: null,
      offerId: null,
      userId: null,
      userGroupId: null,
      customerId: null,
      customerGroupId: null,
      quantity: 1,
      date: now,
    })
  })

  it('links by handle or slug, falling back to the id, under the store base path', () => {
    const links = storeCatalogLinks('/acme')
    expect(links.product({ id: 'p1', handle: 'house blend' })).toBe('/acme/products/house%20blend')
    expect(links.product({ id: 'p1', handle: null })).toBe('/acme/products/p1')
    expect(links.category({ id: 'c1', slug: 'beans' })).toBe('/acme/collections/beans')
    expect(storeCatalogLinks('').category({ id: 'c1' })).toBe('/collections/c1')
  })

  it('caps a category grid by its limit but shows every picked product', () => {
    const ids = Array.from({ length: 12 }, (_, n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`)
    expect(productGridLimit({ source: { kind: 'category', categoryId: ids[0]! }, limit: 8 })).toBe(8)
    expect(productGridLimit({ source: { kind: 'products', productIds: ids }, limit: 8 })).toBeUndefined()
  })

  it('gives every collection page after the first its own path (used for links and the canonical URL)', () => {
    expect(collectionPagePath('beans', 1)).toBe('/collections/beans')
    expect(collectionPagePath('beans', 3)).toBe('/collections/beans?page=3')
  })

  it('clamps collection pages to the nearest valid page', () => {
    expect(clampCollectionPage(null, 3)).toBe(1)
    expect(clampCollectionPage('2', 3)).toBe(2)
    expect(clampCollectionPage('9', 3)).toBe(3)
    expect(clampCollectionPage('0', 3)).toBe(1)
    expect(clampCollectionPage('-2', 3)).toBe(1)
    expect(clampCollectionPage('2abc', 3)).toBe(1)
    expect(clampCollectionPage('1e3', 3)).toBe(1)
    expect(clampCollectionPage('4', 0)).toBe(1)
  })
})
