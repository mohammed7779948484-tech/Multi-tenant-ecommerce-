import { describe, expect, it } from '@jest/globals'
import type { CatalogProduct, CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { COLLECTION_SORTS, SEARCH_SORTS, listingHref, parseListingQuery } from '../shopListingQuery'
import { dominantCurrency, priceFacet, selectedTree, sortProducts, textFilter } from '../shopCatalog'
import { formatShopNumber, formatShopPrice, shopCountLabel } from '../shopFormat'
import { visiblePages } from '../../components/shop/ShopListingViews'
import type { ShopPrice } from '../catalogData'

const product = (id: string, title: string, createdAt: string) => ({ id, title, createdAt: new Date(createdAt) }) as CatalogProduct
const price = (amount: number, currencyCode = 'YER'): ShopPrice => ({ amount, currencyCode, formatted: String(amount) })

describe('TEST-J03 listing URL state', () => {
  it('parses q, repeated categories, price range, in-stock, sort and page', () => {
    const query = parseListingQuery(
      { q: '  قهوة   عربية ', category: ['coffee', 'tea', 'coffee'], price: '50-10', in_stock: '1', sort: 'price_asc', page: '3' },
      { sorts: SEARCH_SORTS },
    )
    expect(query).toEqual({ q: 'قهوة عربية', categories: ['coffee', 'tea'], price: { min: 10, max: 50 }, inStock: true, sort: 'price_asc', page: 3 })
  })

  it('clamps or drops invalid values instead of failing', () => {
    const query = parseListingQuery({ q: 'x'.repeat(500), price: 'abc', sort: 'featured', page: '-2', in_stock: 'yes' }, { sorts: SEARCH_SORTS })
    expect(query.q).toHaveLength(100)
    expect(query.price).toBeNull()
    // `featured` is a collection sort only; search falls back to its default.
    expect(query.sort).toBe('newest')
    expect(query.page).toBe(1)
    expect(query.inStock).toBe(false)
    expect(parseListingQuery({ price: '-20' }, { sorts: SEARCH_SORTS }).price).toEqual({ min: undefined, max: 20 })
    // A bound that would parse to Infinity is dropped, not written back into page links.
    expect(parseListingQuery({ price: `5-${'9'.repeat(400)}` }, { sorts: SEARCH_SORTS }).price).toBeNull()
    expect(parseListingQuery({ price: '0-999999999.5' }, { sorts: SEARCH_SORTS }).price).toEqual({ min: 0, max: 999999999.5 })
    expect(parseListingQuery({}, { sorts: COLLECTION_SORTS }).sort).toBe('featured')
  })

  it('writes the same URL for the same state and leaves defaults out', () => {
    const query = parseListingQuery({ category: ['a', 'b'], price: '5-', sort: 'newest', page: '1' }, { sorts: SEARCH_SORTS })
    expect(listingHref('/acme/search', query, { sort: 'newest' })).toBe('/acme/search?category=a&category=b&price=5-')
    expect(listingHref('/acme/search', { ...query, page: 2, sort: 'name' }, { sort: 'newest' })).toBe('/acme/search?category=a&category=b&price=5-&sort=name&page=2')
  })
})

describe('TEST-J03 search rules', () => {
  it('requires every word of the query (in any order) in the title, subtitle or SKU, with LIKE wildcards escaped', () => {
    expect(textFilter(null)).toBeNull()
    expect(textFilter('100%_off قهوة')).toEqual({
      $and: [
        { $or: [{ title: { $ilike: '%100\\%\\_off%' } }, { subtitle: { $ilike: '%100\\%\\_off%' } }, { sku: { $ilike: '%100\\%\\_off%' } }] },
        { $or: [{ title: { $ilike: '%قهوة%' } }, { subtitle: { $ilike: '%قهوة%' } }, { sku: { $ilike: '%قهوة%' } }] },
      ],
    })
  })

  it('resolves category keys (slug or id) to public trees; unknown keys match nothing', () => {
    const categories = [
      { id: 'c1', slug: 'coffee', descendantIds: ['c2', 'c-off'] },
      { id: 'c2', slug: null, descendantIds: [] },
    ] as unknown as CatalogProductCategory[]
    expect(selectedTree(categories, [])).toBeNull()
    // c-off is not public (inactive or another store's), so it never joins the tree.
    expect([...selectedTree(categories, ['coffee'])!].sort()).toEqual(['c1', 'c2'])
    expect([...selectedTree(categories, ['c2'])!]).toEqual(['c2'])
    expect(selectedTree(categories, ['other-store-category'])!.size).toBe(0)
  })

  it('sorts by newest, price both ways (unpriced last), name, and the merchant order', () => {
    const a = product('a', 'بن', '2026-10-01')
    const b = product('b', 'تمر', '2026-10-03')
    const c = product('c', 'عسل', '2026-10-02')
    const prices = new Map([
      ['a', price(30)],
      ['b', price(10)],
    ])
    const ids = (sort: Parameters<typeof sortProducts>[1], rank = new Map<string, number>()) => sortProducts([a, b, c], sort, prices, rank).map((row) => row.id)
    expect(ids('newest')).toEqual(['b', 'c', 'a'])
    expect(ids('price_asc')).toEqual(['b', 'a', 'c'])
    expect(ids('price_desc')).toEqual(['a', 'b', 'c'])
    expect(ids('name')).toEqual(['a', 'b', 'c'])
    expect(ids('featured', new Map([['c', 0], ['a', 1]]))).toEqual(['c', 'a', 'b'])
  })

  it('offers a price range in whole units of the most common currency', () => {
    const rows = ['a', 'b', 'c'].map((id) => product(id, id, '2026-10-01'))
    expect(priceFacet(rows, new Map([['a', price(12.5)], ['b', price(99.2)], ['c', price(5, 'USD')]]))).toEqual({ min: 12, max: 100, currencyCode: 'YER' })
    expect(priceFacet(rows, new Map([['a', price(10)]]))).toBeNull()
  })

  it('compares prices in one currency only: another currency sorts like no price', () => {
    const a = product('a', 'a', '2026-10-01')
    const b = product('b', 'b', '2026-10-02')
    const c = product('c', 'c', '2026-10-03')
    const prices = new Map([['a', price(30)], ['b', price(10)], ['c', price(5, 'USD')]])
    expect(dominantCurrency([a, b, c], prices)).toBe('YER')
    expect(sortProducts([a, b, c], 'price_asc', prices, new Map()).map((row) => row.id)).toEqual(['b', 'a', 'c'])
    expect(sortProducts([a, b, c], 'price_desc', prices, new Map()).map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(priceFacet([a, b, c], prices, 'USD')).toBeNull()
  })
})

describe('TEST-J03 Arabic numbers and pages', () => {
  it('formats prices and counts for ar-YE with the right plural form', () => {
    expect(formatShopPrice(1500, 'YER')).toBe(new Intl.NumberFormat('ar-YE', { style: 'currency', currency: 'YER' }).format(1500))
    expect(formatShopPrice(Number.NaN, 'YER')).toBeNull()
    const translate = (key: string, fallback: string, params?: Record<string, string | number>) => `${key}|${params?.count ?? fallback}`
    expect(shopCountLabel(translate, 'products', 1)).toBe(`storefront.shop.count.products.one|${formatShopNumber(1)}`)
    expect(shopCountLabel(translate, 'products', 3)).toBe(`storefront.shop.count.products.few|${formatShopNumber(3)}`)
    expect(shopCountLabel(translate, 'products', 11)).toBe(`storefront.shop.count.products.many|${formatShopNumber(11)}`)
  })

  it('shows first, last and the neighbours of the current page', () => {
    expect(visiblePages(1, 1)).toEqual([1])
    expect(visiblePages(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10])
    expect(visiblePages(2, 4)).toEqual([1, 2, 3, 4])
  })
})
