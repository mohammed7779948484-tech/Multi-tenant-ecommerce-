import type { FilterQuery } from '@mikro-orm/core'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
} from '@open-mercato/core/modules/catalog/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StorefrontSite } from '../data/entities'
import {
  loadActiveCategories,
  productIdsInCategories,
  productImages,
  productPrices,
  withDescendants,
  type CatalogDataDeps,
  type CatalogLinks,
  type ShopPrice,
} from './catalogData'
import { loadPublicCategories } from './publicCatalog'
import type { ListingQuery } from './shopListingQuery'
import { resolveShopAvailability, stockBadge, stockKey } from './shopAvailability'
import type { ProductCard } from './sectionDataTypes'

/**
 * Buyer search and browse over the store's public catalog (shopping-journey
 * spec step 5, S-2). Every read is pinned to the store's tenant and
 * organization; the URL query is the only input.
 *
 * Text and category narrow the candidates in SQL (active, non-deleted products
 * of the organization, newest first, at most `MAX_SEARCH_CANDIDATES`). Prices
 * come from the platform pricing engine and stock from the availability
 * contract, so price range, in-stock, price sort and paging run over that
 * bounded candidate set on the server. A store with more matching products
 * than the cap shows the newest ones and reports `truncated`.
 */

export const SHOP_PAGE_SIZE = 24
export const MAX_SEARCH_CANDIDATES = 500
const MAX_QUERY_WORDS = 5
const MAX_FACET_CATEGORIES = 40

export type CategoryFacetOption = { value: string; label: string; count: number }

export type ListingResult = {
  products: ProductCard[]
  total: number
  page: number
  pageCount: number
  facets: {
    categories: CategoryFacetOption[]
    /** Whole-unit bounds of the prices in the result, or `null` when there is nothing to narrow. */
    price: { min: number; max: number; currencyCode: string } | null
  }
  truncated: boolean
}

type SiteScope = Pick<StorefrontSite, 'id' | 'tenantId' | 'organizationId'>

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Every word must appear in the title, subtitle or SKU (word order does not matter). */
export function textFilter(q: string | null): FilterQuery<CatalogProduct> | null {
  const words = (q ?? '').split(' ').filter(Boolean).slice(0, MAX_QUERY_WORDS)
  if (!words.length) return null
  return {
    $and: words.map((word) => {
      const like = `%${escapeLike(word)}%`
      return { $or: [{ title: { $ilike: like } }, { subtitle: { $ilike: like } }, { sku: { $ilike: like } }] }
    }),
  } as FilterQuery<CatalogProduct>
}

/** The category keys of the URL (slug or id) resolved to public category trees; unknown keys match nothing. */
export function selectedTree(categories: CatalogProductCategory[], keys: string[]): Set<string> | null {
  if (!keys.length) return null
  const publicIds = new Set(categories.map((category) => category.id))
  const tree = new Set<string>()
  for (const key of keys) {
    const category = categories.find((row) => row.slug === key || row.id === key)
    if (!category) continue
    for (const id of withDescendants(category)) if (publicIds.has(id)) tree.add(id)
  }
  return tree
}

/** The currency most candidates are priced in: price filters and price sorts compare amounts in it only. */
export function dominantCurrency(products: CatalogProduct[], prices: Map<string, ShopPrice>): string | null {
  const counts = new Map<string, number>()
  for (const product of products) {
    const code = prices.get(product.id)?.currencyCode
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

/** A product's amount in `currencyCode`; a price in another currency counts as no price. */
function amountIn(prices: Map<string, ShopPrice>, productId: string, currencyCode: string | null): number | undefined {
  const price = prices.get(productId)
  return price && price.currencyCode === currencyCode ? price.amount : undefined
}

export function sortProducts(
  products: CatalogProduct[],
  sort: ListingQuery['sort'],
  prices: Map<string, ShopPrice>,
  featuredRank: Map<string, number>,
  currencyCode: string | null = dominantCurrency(products, prices),
) {
  const newest = (a: CatalogProduct, b: CatalogProduct) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
  const byPrice = (direction: 1 | -1) => (a: CatalogProduct, b: CatalogProduct) => {
    const pa = amountIn(prices, a.id, currencyCode)
    const pb = amountIn(prices, b.id, currencyCode)
    // Products without a price (or priced in another currency) go last in both directions.
    if (pa === undefined || pb === undefined) return pa === undefined ? (pb === undefined ? newest(a, b) : 1) : -1
    return pa === pb ? newest(a, b) : (pa - pb) * direction
  }
  const comparators: Record<ListingQuery['sort'], (a: CatalogProduct, b: CatalogProduct) => number> = {
    featured: (a, b) => (featuredRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (featuredRank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || newest(a, b),
    newest,
    price_asc: byPrice(1),
    price_desc: byPrice(-1),
    name: (a, b) => a.title.localeCompare(b.title, 'ar') || newest(a, b),
  }
  return [...products].sort(comparators[sort])
}

export function priceFacet(
  products: CatalogProduct[],
  prices: Map<string, ShopPrice>,
  currencyCode: string | null = dominantCurrency(products, prices),
): ListingResult['facets']['price'] {
  if (!currencyCode) return null
  const amounts = products.map((product) => amountIn(prices, product.id, currencyCode)).filter((amount): amount is number => amount !== undefined)
  if (!amounts.length) return null
  const min = Math.floor(Math.min(...amounts))
  const max = Math.ceil(Math.max(...amounts))
  return max > min ? { min, max, currencyCode } : null
}

/**
 * One page of the store's public products matching `query`. `within` limits the
 * listing to a category tree (collection pages, which also gain the `featured`
 * sort: the merchant's assignment order). `categoryFacet` adds the category
 * filter options (search page).
 */
export async function searchShopCatalog(
  deps: CatalogDataDeps,
  site: SiteScope,
  query: ListingQuery,
  options: { links: CatalogLinks; within?: CatalogProductCategory | null; categoryFacet?: boolean },
): Promise<ListingResult> {
  const { em, container } = deps
  const scope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const empty: ListingResult = { products: [], total: 0, page: 1, pageCount: 1, facets: { categories: [], price: null }, truncated: false }

  const featuredRank = new Map<string, number>()
  let restrictTo: string[] | null = null
  if (options.within) {
    const tree = withDescendants(options.within)
    const active = await loadActiveCategories(em, scope, tree)
    const ids = tree.filter((id) => active.has(id))
    const byCategory = await productIdsInCategories(em, scope, ids, { limit: 5000 })
    restrictTo = [...new Set(ids.flatMap((id) => byCategory.get(id) ?? []))]
    restrictTo.forEach((id, index) => featuredRank.set(id, index))
    if (!restrictTo.length) return empty
  }

  const where: FilterQuery<CatalogProduct> = { ...scope, deletedAt: null, isActive: true }
  if (restrictTo) Object.assign(where, { id: { $in: restrictTo } })
  const text = textFilter(query.q)
  const rows = await findWithDecryption(
    em,
    CatalogProduct,
    (text ? { $and: [where, text] } : where) as FilterQuery<CatalogProduct>,
    { fields: ['id', 'title', 'subtitle', 'handle', 'defaultMediaId', 'isQuoteOnly', 'createdAt'], orderBy: { createdAt: 'desc' }, limit: MAX_SEARCH_CANDIDATES + 1 },
    scope,
  )
  const truncated = rows.length > MAX_SEARCH_CANDIDATES
  let candidates = rows.slice(0, MAX_SEARCH_CANDIDATES)
  if (!candidates.length) return { ...empty, truncated }

  // Categories of each candidate: the category filter and its counts.
  const categories = query.categories.length || options.categoryFacet ? await loadPublicCategories(em, site) : []
  const productCategories = new Map<string, Set<string>>()
  if (categories.length) {
    const assignments = await em.find(
      CatalogProductCategoryAssignment,
      { product: { $in: candidates.map((product) => product.id) }, ...scope },
      { fields: ['product', 'category'] },
    )
    for (const assignment of assignments) {
      const productId = typeof assignment.product === 'string' ? assignment.product : assignment.product.id
      const categoryId = typeof assignment.category === 'string' ? assignment.category : assignment.category.id
      const set = productCategories.get(productId) ?? new Set<string>()
      set.add(categoryId)
      productCategories.set(productId, set)
    }
  }
  const inTree = (productId: string, tree: Set<string>) => [...(productCategories.get(productId) ?? [])].some((id) => tree.has(id))

  const prices = await productPrices(deps, scope, candidates.filter((product) => !product.isQuoteOnly).map((product) => product.id))

  // In stock: a live answer is not needed to browse; a missing answer counts as available.
  let stock = new Map<string, ReturnType<typeof stockBadge>>()
  if (query.inStock) {
    const answers = await resolveShopAvailability(container, scope, candidates.map((product) => ({ productId: product.id })))
    stock = new Map(candidates.map((product) => [product.id, stockBadge(answers.get(stockKey(product.id)))]))
    candidates = candidates.filter((product) => stock.get(product.id) !== 'out_of_stock')
  }

  // One currency for the price filter, the price sorts and the price facet.
  const currencyCode = dominantCurrency(candidates, prices)
  const inPriceRange = (product: CatalogProduct) => {
    if (!query.price) return true
    const amount = amountIn(prices, product.id, currencyCode)
    if (amount === undefined) return false
    return (query.price.min === undefined || amount >= query.price.min) && (query.price.max === undefined || amount <= query.price.max)
  }

  const tree = selectedTree(categories, query.categories)
  const inCategory = candidates.filter((product) => !tree || inTree(product.id, tree))
  const matching = inCategory.filter(inPriceRange)

  const facetCategories: CategoryFacetOption[] = []
  if (options.categoryFacet) {
    const priced = candidates.filter(inPriceRange)
    const publicIds = new Set(categories.map((category) => category.id))
    for (const category of categories) {
      if (category.depth > 1 || facetCategories.length >= MAX_FACET_CATEGORIES) continue
      const categoryTree = new Set(withDescendants(category).filter((id) => publicIds.has(id)))
      const count = priced.filter((product) => inTree(product.id, categoryTree)).length
      const value = category.slug || category.id
      if (count > 0 || query.categories.includes(value)) facetCategories.push({ value, label: category.name, count })
    }
  }

  const total = matching.length
  const pageCount = Math.max(1, Math.ceil(total / SHOP_PAGE_SIZE))
  const page = Math.min(query.page, pageCount)
  const slice = sortProducts(matching, query.sort, prices, featuredRank, currencyCode).slice((page - 1) * SHOP_PAGE_SIZE, page * SHOP_PAGE_SIZE)

  const images = await productImages(em, scope, slice)
  if (!query.inStock) {
    const answers = await resolveShopAvailability(container, scope, slice.map((product) => ({ productId: product.id })))
    stock = new Map(slice.map((product) => [product.id, stockBadge(answers.get(stockKey(product.id)))]))
  }

  return {
    products: slice.map((product) => ({
      id: product.id,
      title: product.title,
      subtitle: product.subtitle ?? null,
      href: options.links.product(product),
      image: images.get(product.id) ?? null,
      price: prices.get(product.id) ?? null,
      stock: stock.get(product.id) ?? null,
    })),
    total,
    page,
    pageCount,
    facets: { categories: facetCategories, price: priceFacet(inCategory, prices, currencyCode) },
    truncated,
  }
}
