import { beforeEach, describe, expect, it, jest } from '@jest/globals'

type Row = { id: string; title: string; isQuoteOnly: boolean; createdAt: Date; subtitle: null; handle: null; defaultMediaId: null }

const catalog: { products: Row[]; assignments: Array<{ product: string; category: string }> } = { products: [], assignments: [] }

/** Reads the `id: { $in }` restriction out of the search's where clause (plain or under `$and`). */
function restriction(where: Record<string, unknown>): Set<string> | null {
  const plain = where.$and ? (where.$and as Array<Record<string, unknown>>)[0]! : where
  const id = plain.id as { $in?: string[] } | undefined
  return id?.$in ? new Set(id.$in) : null
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>, options?: { limit?: number }) => {
    const only = restriction(where)
    const rows = catalog.products.filter((row) => !only || only.has(row.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return options?.limit ? rows.slice(0, options.limit) : rows
  }),
}))
jest.mock('../publicCatalog', () => ({
  loadPublicCategories: jest.fn(async () => [{ id: 'cat-coffee', slug: 'coffee', name: 'قهوة', depth: 0, descendantIds: [] }]),
}))
jest.mock('../catalogData', () => ({
  loadActiveCategories: jest.fn(async () => new Map()),
  productIdsInCategories: jest.fn(async () => new Map()),
  productImages: jest.fn(async () => new Map()),
  productPrices: jest.fn(async () => new Map()),
  withDescendants: (category: { id: string; descendantIds?: string[] }) => [category.id, ...(category.descendantIds ?? [])],
}))
jest.mock('../shopAvailability', () => ({
  resolveShopAvailability: jest.fn(async () => new Map()),
  stockBadge: () => null,
  stockKey: (id: string) => id,
}))

import { MAX_SEARCH_SCAN, SHOP_PAGE_SIZE, searchShopCatalog } from '../shopCatalog'
import { parseListingQuery, SEARCH_SORTS } from '../shopListingQuery'

const em = {
  find: jest.fn(async (_entity: unknown, where: { category?: { $in: string[] } }) =>
    catalog.assignments.filter((row) => !where.category || where.category.$in.includes(row.category)),
  ),
}
const deps = { em, container: {} } as never
const site = { id: 'site-1', tenantId: 't1', organizationId: 'o1' }
const links = { product: (product: { id: string }) => `/s/products/${product.id}`, category: (category: { id: string }) => `/s/collections/${category.id}` }

function product(id: string, daysAgo: number): Row {
  return { id, title: id, isQuoteOnly: false, createdAt: new Date(Date.UTC(2026, 9, 1) - daysAgo * 86_400_000), subtitle: null, handle: null, defaultMediaId: null }
}

beforeEach(() => {
  catalog.products = []
  catalog.assignments = []
})

describe('search reads the category filter in SQL, before the scan cap', () => {
  it('finds old products of a category even when more than the cap of newer products exist', async () => {
    for (let index = 0; index < MAX_SEARCH_SCAN + 100; index += 1) catalog.products.push(product(`new-${index}`, index))
    for (let index = 0; index < 3; index += 1) {
      catalog.products.push(product(`old-coffee-${index}`, 5000 + index))
      catalog.assignments.push({ product: `old-coffee-${index}`, category: 'cat-coffee' })
    }
    const result = await searchShopCatalog(deps, site, parseListingQuery({ category: 'coffee' }, { sorts: SEARCH_SORTS }), { links, categoryFacet: true })
    expect(result.total).toBe(3)
    expect(result.products.map((card) => card.id)).toEqual(['old-coffee-0', 'old-coffee-1', 'old-coffee-2'])
    expect(result.truncated).toBe(false)
    // The facet still counts over every product the text matched, and keeps the selected category.
    expect(result.facets.categories).toEqual([{ value: 'coffee', label: 'قهوة', count: 3 }])
  })

  it('reports truncation only when the matching products exceed the cap', async () => {
    for (let index = 0; index < MAX_SEARCH_SCAN + 1; index += 1) catalog.products.push(product(`p-${index}`, index))
    const result = await searchShopCatalog(deps, site, parseListingQuery({}, { sorts: SEARCH_SORTS }), { links, categoryFacet: true })
    expect(result.truncated).toBe(true)
    expect(result.total).toBe(MAX_SEARCH_SCAN)
  })
})

describe('real pagination', () => {
  it('pages through the matching products newest first, and clamps a page past the end', async () => {
    const count = SHOP_PAGE_SIZE + 6
    for (let index = 0; index < count; index += 1) catalog.products.push(product(`p-${String(index).padStart(2, '0')}`, index))
    const second = await searchShopCatalog(deps, site, parseListingQuery({ page: '2' }, { sorts: SEARCH_SORTS }), { links })
    expect(second).toMatchObject({ total: count, page: 2, pageCount: 2 })
    expect(second.products.map((card) => card.id)).toEqual(['p-24', 'p-25', 'p-26', 'p-27', 'p-28', 'p-29'])
    const beyond = await searchShopCatalog(deps, site, parseListingQuery({ page: '9' }, { sorts: SEARCH_SORTS }), { links })
    expect(beyond.page).toBe(2)
    expect(beyond.products).toHaveLength(6)
  })
})
