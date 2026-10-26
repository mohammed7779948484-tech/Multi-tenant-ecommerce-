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
 * Text, the collection and the category filter narrow the products in SQL
 * (active, non-deleted products of the organization, newest first, reading only
 * the columns the filters need, at most `MAX_SEARCH_SCAN`). Prices come from the
 * platform pricing engine and stock from the availability contract, so price
 * range, in-stock, price sort and paging run on the server over that matching
 * set; cards load their remaining columns for the shown page only. More matches
 * than the cap set `truncated`, and the page asks the buyer to narrow.
 */

export const SHOP_PAGE_SIZE = 24
export const MAX_SEARCH_SCAN = 2000
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
type SiteScopeIds = { tenantId: string; organizationId: string }

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

/** Product id → its category ids, from the assignments of the given categories. */
async function categoriesByProduct(em: CatalogDataDeps['em'], scope: SiteScopeIds, categoryIds: string[]): Promise<Map<string, Set<string>>> {
  const byProduct = new Map<string, Set<string>>()
  if (!categoryIds.length) return byProduct
  const assignments = await em.find(CatalogProductCategoryAssignment, { category: { $in: categoryIds }, ...scope }, { fields: ['product', 'category'] })
  for (const assignment of assignments) {
    const productId = typeof assignment.product === 'string' ? assignment.product : assignment.product.id
    const categoryId = typeof assignment.category === 'string' ? assignment.category : assignment.category.id
    const set = byProduct.get(productId) ?? new Set<string>()
    set.add(categoryId)
    byProduct.set(productId, set)
  }
  return byProduct
}

/**
 * Category filter options: the top-level public categories with matching
 * products, plus every category the URL selects (any depth, or an unknown key),
 * so a selected filter always shows and can be removed. A selected option keeps
 * the URL's own key as its value, so unticking it removes exactly that key.
 */
export function categoryFacetOptions(
  categories: CatalogProductCategory[],
  selectedKeys: string[],
  countIn: (tree: Set<string>) => number,
): CategoryFacetOption[] {
  const publicIds = new Set(categories.map((category) => category.id))
  const treeOf = (category: CatalogProductCategory) => new Set(withDescendants(category).filter((id) => publicIds.has(id)))
  const keyOf = (category: CatalogProductCategory) => selectedKeys.find((key) => key === category.slug || key === category.id) ?? (category.slug || category.id)
  const options: CategoryFacetOption[] = []
  const shown = new Set<string>()
  for (const category of categories) {
    if (category.depth > 1 || options.length >= MAX_FACET_CATEGORIES) continue
    const value = keyOf(category)
    const count = countIn(treeOf(category))
    if (count > 0 || selectedKeys.includes(value)) {
      options.push({ value, label: category.name, count })
      shown.add(value)
    }
  }
  for (const key of selectedKeys) {
    if (shown.has(key)) continue
    const category = categories.find((row) => row.slug === key || row.id === key)
    options.push({ value: key, label: category?.name ?? key, count: category ? countIn(treeOf(category)) : 0 })
    shown.add(key)
  }
  return options
}

type ScanRow = Pick<CatalogProduct, 'id' | 'title' | 'isQuoteOnly' | 'createdAt'>

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
  let withinIds: string[] | null = null
  if (options.within) {
    const tree = withDescendants(options.within)
    const active = await loadActiveCategories(em, scope, tree)
    const ids = tree.filter((id) => active.has(id))
    const byCategory = await productIdsInCategories(em, scope, ids, { limit: 5000 })
    withinIds = [...new Set(ids.flatMap((id) => byCategory.get(id) ?? []))]
    withinIds.forEach((id, index) => featuredRank.set(id, index))
    if (!withinIds.length) return empty
  }

  // Categories: the URL filter narrows in SQL; the facet counts every category over the unfiltered match.
  const categories = query.categories.length || options.categoryFacet ? await loadPublicCategories(em, site) : []
  const tree = selectedTree(categories, query.categories)
  const productCategories = options.categoryFacet
    ? await categoriesByProduct(em, scope, categories.map((category) => category.id))
    : await categoriesByProduct(em, scope, tree ? [...tree] : [])
  const inTree = (productId: string, categoryTree: Set<string>) => [...(productCategories.get(productId) ?? [])].some((id) => categoryTree.has(id))
  const selectedIds = tree ? [...productCategories.keys()].filter((id) => inTree(id, tree)) : null

  const text = textFilter(query.q)
  const scan = async (restrict: string[] | null) => {
    if (restrict && !restrict.length) return { rows: [] as ScanRow[], truncated: false }
    const where: FilterQuery<CatalogProduct> = { ...scope, deletedAt: null, isActive: true }
    if (restrict) Object.assign(where, { id: { $in: restrict } })
    const rows = await findWithDecryption(
      em,
      CatalogProduct,
      (text ? { $and: [where, text] } : where) as FilterQuery<CatalogProduct>,
      { fields: ['id', 'title', 'isQuoteOnly', 'createdAt'], orderBy: { createdAt: 'desc', id: 'asc' }, limit: MAX_SEARCH_SCAN + 1 },
      scope,
    )
    return { rows: rows.slice(0, MAX_SEARCH_SCAN) as ScanRow[], truncated: rows.length > MAX_SEARCH_SCAN }
  }
  const intersect = (a: string[] | null, b: string[] | null) => (a && b ? a.filter((id) => new Set(b).has(id)) : (a ?? b))
  const matched = await scan(intersect(withinIds, selectedIds))
  // The facet needs the products the category filter left out; without a filter it is the same scan.
  // The filtered rows join it, so a selected category counts exactly even when the wider scan hit the cap.
  let facetScan = matched
  if (options.categoryFacet && tree) {
    const wider = await scan(withinIds)
    const seen = new Set(wider.rows.map((row) => row.id))
    facetScan = { rows: [...wider.rows, ...matched.rows.filter((row) => !seen.has(row.id))], truncated: wider.truncated }
  }
  const truncated = matched.truncated
  if (!matched.rows.length && !(options.categoryFacet && facetScan.rows.length)) return { ...empty, truncated, facets: { ...empty.facets, categories: options.categoryFacet ? categoryFacetOptions(categories, query.categories, () => 0) : [] } }

  // Prices for the matching products, and for the facet's when a price range narrows its counts.
  const priceIds = new Set(matched.rows.map((row) => row.id))
  if (query.price && facetScan !== matched) for (const row of facetScan.rows) priceIds.add(row.id)
  const quoteOnly = new Set([...matched.rows, ...facetScan.rows].filter((row) => row.isQuoteOnly).map((row) => row.id))
  const prices = await productPrices(deps, scope, [...priceIds].filter((id) => !quoteOnly.has(id)))

  // In stock: a live answer is not needed to browse; a missing answer counts as available.
  let stock = new Map<string, ReturnType<typeof stockBadge>>()
  const stockIds = new Set([...matched.rows, ...facetScan.rows].map((row) => row.id))
  if (query.inStock) {
    const answers = await resolveShopAvailability(container, scope, [...stockIds].map((productId) => ({ productId })))
    stock = new Map([...stockIds].map((id) => [id, stockBadge(answers.get(stockKey(id)))]))
  }
  const inStock = (row: ScanRow) => !query.inStock || stock.get(row.id) !== 'out_of_stock'

  // One currency for the price filter, the price sorts and the price facet.
  const stocked = matched.rows.filter(inStock)
  const currencyCode = dominantCurrency(stocked as CatalogProduct[], prices)
  const inPriceRange = (row: ScanRow) => {
    if (!query.price) return true
    const amount = amountIn(prices, row.id, currencyCode)
    if (amount === undefined) return false
    return (query.price.min === undefined || amount >= query.price.min) && (query.price.max === undefined || amount <= query.price.max)
  }
  const matching = stocked.filter(inPriceRange)

  let facetCategories: CategoryFacetOption[] = []
  if (options.categoryFacet) {
    const narrowed = facetScan.rows.filter((row) => inStock(row) && inPriceRange(row))
    facetCategories = categoryFacetOptions(categories, query.categories, (categoryTree) => narrowed.filter((row) => inTree(row.id, categoryTree)).length)
  }

  const total = matching.length
  const pageCount = Math.max(1, Math.ceil(total / SHOP_PAGE_SIZE))
  const page = Math.min(query.page, pageCount)
  const pageRows = sortProducts(matching as CatalogProduct[], query.sort, prices, featuredRank, currencyCode).slice((page - 1) * SHOP_PAGE_SIZE, page * SHOP_PAGE_SIZE)

  // The shown page gets its remaining card columns.
  const full = pageRows.length
    ? new Map(
        (
          await findWithDecryption(
            em,
            CatalogProduct,
            { id: { $in: pageRows.map((row) => row.id) }, ...scope, deletedAt: null, isActive: true } as FilterQuery<CatalogProduct>,
            { fields: ['id', 'title', 'subtitle', 'handle', 'defaultMediaId'] },
            scope,
          )
        ).map((row) => [row.id, row]),
      )
    : new Map<string, CatalogProduct>()
  const slice = pageRows.map((row) => full.get(row.id)).filter((row): row is CatalogProduct => Boolean(row))

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
    facets: { categories: facetCategories, price: priceFacet(stocked as CatalogProduct[], prices, currencyCode) },
    truncated,
  }
}
