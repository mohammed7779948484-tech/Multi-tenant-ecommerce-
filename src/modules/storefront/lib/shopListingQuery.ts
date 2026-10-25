/**
 * The URL is the state of a search or collection listing (spec REQ-004), so a
 * result list is shareable. Client-safe and pure: the server parses it to run
 * the search, the filter panel writes it (ecomcn `filter-params` format:
 * repeated `category`, `price=min-max`, `in_stock=1`).
 *
 *   /{site}/search?q=قهوة&category=coffee&price=10-50&in_stock=1&sort=price_asc&page=2
 */

export const LISTING_PARAMS = { q: 'q', category: 'category', price: 'price', inStock: 'in_stock', sort: 'sort', page: 'page' } as const

export type ShopSort = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'name'

/** Search sorts; collection pages add `featured` (the merchant's own order) and default to it. */
export const SEARCH_SORTS: readonly ShopSort[] = ['newest', 'price_asc', 'price_desc', 'name']
export const COLLECTION_SORTS: readonly ShopSort[] = ['featured', ...SEARCH_SORTS]

export const MAX_QUERY_LENGTH = 100
const MAX_CATEGORY_FILTERS = 20

export type ListingQuery = {
  q: string | null
  /** Category slugs or ids, as written in the URL. */
  categories: string[]
  price: { min?: number; max?: number } | null
  inStock: boolean
  sort: ShopSort
  /** Requested page (≥ 1); clamped to the result's page count by the search. */
  page: number
}

export type RawSearchParams = Record<string, string | string[] | undefined>

function all(params: RawSearchParams, key: string): string[] {
  const value = params[key]
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function first(params: RawSearchParams, key: string): string | null {
  return all(params, key)[0] ?? null
}

const RANGE = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/

/** Invalid values never fail the page: they are dropped or clamped (spec "invalid params clamp"). */
export function parseListingQuery(params: RawSearchParams, options: { sorts: readonly ShopSort[] }): ListingQuery {
  const rawQ = (first(params, LISTING_PARAMS.q) ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  const categories = [...new Set(all(params, LISTING_PARAMS.category).map((value) => value.trim()).filter((value) => value && value.length <= 200))].slice(0, MAX_CATEGORY_FILTERS)
  let price: ListingQuery['price'] = null
  const range = RANGE.exec(first(params, LISTING_PARAMS.price) ?? '')
  if (range && (range[1] !== undefined || range[2] !== undefined)) {
    let min = range[1] === undefined ? undefined : Number(range[1])
    let max = range[2] === undefined ? undefined : Number(range[2])
    if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min]
    price = { min, max }
  }
  const inStock = ['1', 'true'].includes(first(params, LISTING_PARAMS.inStock) ?? '')
  const rawSort = first(params, LISTING_PARAMS.sort) as ShopSort | null
  const sort = rawSort && options.sorts.includes(rawSort) ? rawSort : options.sorts[0]!
  const rawPage = first(params, LISTING_PARAMS.page)
  const page = rawPage && /^\d{1,6}$/.test(rawPage.trim()) ? Math.max(1, Number.parseInt(rawPage, 10)) : 1
  return { q: rawQ || null, categories, price, inStock, sort, page }
}

/** The listing URL for a state; default values are left out, so equal states give equal URLs. */
export function listingHref(path: string, query: ListingQuery, defaults: { sort: ShopSort }): string {
  const params = new URLSearchParams()
  if (query.q) params.set(LISTING_PARAMS.q, query.q)
  for (const category of query.categories) params.append(LISTING_PARAMS.category, category)
  if (query.price && (query.price.min !== undefined || query.price.max !== undefined)) {
    params.set(LISTING_PARAMS.price, `${query.price.min ?? ''}-${query.price.max ?? ''}`)
  }
  if (query.inStock) params.set(LISTING_PARAMS.inStock, '1')
  if (query.sort !== defaults.sort) params.set(LISTING_PARAMS.sort, query.sort)
  if (query.page > 1) params.set(LISTING_PARAMS.page, String(query.page))
  const search = params.toString()
  return search ? `${path}?${search}` : path
}
