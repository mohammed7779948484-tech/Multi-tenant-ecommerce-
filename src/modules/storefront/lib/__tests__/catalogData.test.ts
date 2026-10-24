import { describe, expect, it } from '@jest/globals'
import { anonymousPricingContext, clampCollectionPage, formatPrice, storeCatalogLinks } from '../catalogData'

describe('TEST-020 store catalog helpers', () => {
  it('formats the gross price, else the net price, in the store locale', () => {
    expect(formatPrice({ unitPriceGross: '12.50', unitPriceNet: '10.00', currencyCode: 'EUR' }, 'de')).toBe(
      new Intl.NumberFormat('de', { style: 'currency', currency: 'EUR' }).format(12.5),
    )
    expect(formatPrice({ unitPriceGross: null, unitPriceNet: '10', currencyCode: 'USD' }, 'en')).toBe('$10.00')
  })

  it('shows no price rather than a wrong one', () => {
    expect(formatPrice({ unitPriceGross: null, unitPriceNet: null, currencyCode: 'EUR' }, 'en')).toBeNull()
    expect(formatPrice({ unitPriceGross: 'abc', unitPriceNet: null, currencyCode: 'EUR' }, 'en')).toBeNull()
    expect(formatPrice({ unitPriceGross: '5', unitPriceNet: null, currencyCode: null }, 'en')).toBeNull()
  })

  it('falls back to English formatting for a locale the runtime rejects', () => {
    expect(formatPrice({ unitPriceGross: '5', unitPriceNet: null, currencyCode: 'EUR' }, 'not a locale!')).toBe('€5.00')
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
