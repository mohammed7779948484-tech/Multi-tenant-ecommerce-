import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { FilterFacet } from '@/lib/filter-params'
import {
  CollectionPageView,
  CollectionsIndexView,
  SearchPageView,
  visiblePages,
  type CollectionPageProps,
  type CollectionsIndexProps,
  type ListingPagination,
  type SearchPageProps,
} from '../components/shop/ShopListingViews'
import { toCardProduct } from '../components/shop/ShopProductCard'
import { resolveSectionLabels } from '../components/public/blocks'
import type { ShopListingProps } from '../components/shop/ShopListing'
import type { ValidatedSection } from './blocks/pageSpec'
import { collectionPagePath, loadSectionData, storeCatalogLinks, type CatalogDataDeps } from './catalogData'
import { publicMediaResolver } from './mediaUrls'
import { findPublicCategory, loadPublicCategories } from './publicCatalog'
import { plainExcerpt, safeDecode, storeFrame, type Loaded } from './publicCatalogPages'
import { buildStorefrontMetadata } from './publicMetadata'
import type { CategoryCard } from './sectionDataTypes'
import { searchShopCatalog, type ListingResult } from './shopCatalog'
import { shopCountLabel, SHOP_NUMBER_LOCALE, formatShopNumber } from './shopFormat'
import type { ShopTranslate } from './shopLocale'
import {
  COLLECTION_SORTS,
  LISTING_PARAMS,
  SEARCH_SORTS,
  listingHref,
  parseListingQuery,
  type ListingQuery,
  type RawSearchParams,
  type ShopSort,
} from './shopListingQuery'

/**
 * Loaders of the search page, the collections index and collection pages
 * (shopping-journey spec step 6). Anonymous; the store is found by slug and
 * every read is pinned to its tenant and organization.
 */

const MAX_INDEX_CATEGORIES = 48

/** Next's `searchParams` as a stable query string (the `cache` key and the listing's URL state). */
export function toSearchString(params: RawSearchParams | undefined): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item)
  }
  return search.toString()
}

function fromSearchString(search: string): RawSearchParams {
  const params: RawSearchParams = {}
  for (const [key, value] of new URLSearchParams(search)) {
    const current = params[key]
    params[key] = current === undefined ? value : [...(Array.isArray(current) ? current : [current]), value]
  }
  return params
}

function currencySymbol(currencyCode: string): string {
  try {
    const parts = new Intl.NumberFormat(SHOP_NUMBER_LOCALE, { style: 'currency', currency: currencyCode }).formatToParts(1)
    return parts.find((part) => part.type === 'currency')?.value ?? currencyCode
  } catch {
    return currencyCode
  }
}

function listingFacets(result: ListingResult, query: ListingQuery, translate: ShopTranslate, categoryFacet: boolean): FilterFacet[] {
  const facets: FilterFacet[] = []
  if (categoryFacet && result.facets.categories.length) {
    facets.push({ id: LISTING_PARAMS.category, type: 'list', label: translate('storefront.shop.filters.category', 'Category'), options: result.facets.categories })
  }
  // An applied price filter keeps its facet (and its chip) even when the result has a single price.
  const range = result.facets.price ?? (query.price ? { min: query.price.min ?? 0, max: query.price.max ?? (query.price.min ?? 0) + 1, currencyCode: '' } : null)
  if (range) {
    facets.push({
      id: LISTING_PARAMS.price,
      type: 'range',
      label: translate('storefront.shop.filters.price', 'Price'),
      min: Math.min(range.min, query.price?.min ?? range.min),
      max: Math.max(range.max, query.price?.max ?? range.max),
      step: 1,
      format: 'number',
      unit: range.currencyCode ? currencySymbol(range.currencyCode) : undefined,
    })
  }
  facets.push({ id: LISTING_PARAMS.inStock, type: 'toggle', label: translate('storefront.shop.filters.inStock', 'In stock only') })
  return facets
}

function sortOptions(sorts: readonly ShopSort[], translate: ShopTranslate) {
  const labels: Record<ShopSort, string> = {
    featured: translate('storefront.shop.sort.featured', 'Featured'),
    newest: translate('storefront.shop.sort.newest', 'Newest'),
    price_asc: translate('storefront.shop.sort.priceAsc', 'Price, low to high'),
    price_desc: translate('storefront.shop.sort.priceDesc', 'Price, high to low'),
    name: translate('storefront.shop.sort.name', 'Name'),
  }
  return sorts.map((value) => ({ value, label: labels[value] }))
}

function listingPagination(path: string, query: ListingQuery, defaultSort: ShopSort, result: ListingResult, translate: ShopTranslate): ListingPagination {
  const hrefs: Record<number, string> = {}
  for (const value of new Set([...visiblePages(result.page, result.pageCount), result.page - 1, result.page + 1])) {
    if (typeof value === 'number' && value >= 1 && value <= result.pageCount) hrefs[value] = listingHref(path, { ...query, page: value }, { sort: defaultSort })
  }
  return {
    page: result.page,
    pageCount: result.pageCount,
    hrefs,
    labels: {
      nav: translate('storefront.public.pagination', 'Pages'),
      previous: translate('storefront.public.previous', 'Previous'),
      next: translate('storefront.public.next', 'Next'),
      more: translate('storefront.shop.pagination.more', 'More pages'),
      status: translate('storefront.shop.pageOf', 'Page {page} of {count}', { page: formatShopNumber(result.page), count: formatShopNumber(result.pageCount) }),
    },
  }
}

function listingProps(siteSlug: string, result: ListingResult, query: ListingQuery, options: { sorts: readonly ShopSort[]; search: string; categoryFacet: boolean; translate: ShopTranslate }): ShopListingProps {
  const { translate } = options
  const media = publicMediaResolver(siteSlug)
  const stockLabels = { soldOut: translate('storefront.shop.stock.soldOut', 'Sold out'), lowStock: translate('storefront.shop.stock.lowStock', 'Only a few left') }
  return {
    products: result.products.map((product) => toCardProduct(product, media, stockLabels)),
    total: result.total,
    facets: listingFacets(result, query, translate, options.categoryFacet),
    sort: query.sort,
    defaultSort: options.sorts[0]!,
    sortOptions: sortOptions(options.sorts, translate),
    search: options.search,
    query: query.q,
  }
}

/** Category cards with covers, through the same loader as the merchant's CollectionList section. */
async function categoryCards(deps: CatalogDataDeps, scope: { tenantId: string; organizationId: string }, basePath: string, categories: CatalogProductCategory[]): Promise<CategoryCard[]> {
  if (!categories.length) return []
  const section = { id: 'categories', type: 'CollectionList', props: { categoryIds: categories.map((category) => category.id) } } as ValidatedSection
  const data = await loadSectionData(deps, scope, [section], { links: storeCatalogLinks(basePath) })
  return data.categories?.categories ?? []
}

export const loadSearchPage = cache(async (rawSiteSlug: string, search: string): Promise<Loaded<SearchPageProps>> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return { kind: 'not-found' }
  const { site, frame, translate } = store
  const query = parseListingQuery(fromSearchString(search), { sorts: SEARCH_SORTS })
  const path = `${frame.basePath}/search`
  const result = await searchShopCatalog({ em, container }, site, query, { links: storeCatalogLinks(frame.basePath), categoryFacet: true })
  const title = translate('storefront.shop.search.title', 'Search')
  return {
    kind: 'ok',
    view: {
      ...frame,
      head: store.head(`${query.q ? `${query.q} · ` : ''}${title} · ${site.name}`, null, '/search'),
      title,
      form: {
        action: path,
        label: translate('storefront.shop.search.label', 'Search the store'),
        placeholder: translate('storefront.shop.search.placeholder', 'What are you looking for?'),
        submit: translate('storefront.shop.search.submit', 'Search'),
        value: query.q ?? '',
      },
      listing: listingProps(site.slug, result, query, { sorts: SEARCH_SORTS, search, categoryFacet: true, translate }),
      pagination: listingPagination(path, query, SEARCH_SORTS[0]!, result, translate),
      truncatedNotice: result.truncated
        ? translate('storefront.shop.search.truncated', 'Showing the newest {count}. Add a word or a filter to narrow the search.', { count: shopCountLabel(translate, 'products', result.total) })
        : null,
    },
  }
})

export const loadCollectionsIndex = cache(async (rawSiteSlug: string): Promise<Loaded<CollectionsIndexProps>> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return { kind: 'not-found' }
  const { site, scope, frame, translate } = store
  const roots = (await loadPublicCategories(em, site)).filter((category) => !category.parentId).slice(0, MAX_INDEX_CATEGORIES)
  const title = translate('storefront.shop.collections.title', 'All categories')
  return {
    kind: 'ok',
    view: {
      ...frame,
      head: store.head(`${title} · ${site.name}`, null, '/collections'),
      title,
      categories: await categoryCards({ em, container }, scope, frame.basePath, roots),
      sectionLabels: resolveSectionLabels(translate),
    },
  }
})

export const loadCollectionPage = cache(async (rawSiteSlug: string, rawKey: string, search: string): Promise<Loaded<CollectionPageProps>> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return { kind: 'not-found' }
  const { site, scope, frame, translate } = store
  const key = safeDecode(rawKey)
  if (key === null) return { kind: 'not-found' }
  const category = await findPublicCategory(em, site, key)
  if (!category) return { kind: 'not-found' }
  const canonicalKey = category.slug || category.id
  const path = `/${site.slug}/collections/${encodeURIComponent(canonicalKey)}`
  // Compared decoded, so a key that differs only in percent-encoding can never loop.
  if (rawSiteSlug !== site.slug || key !== canonicalKey) return { kind: 'redirect', path: search ? `${path}?${search}` : path }

  const query = parseListingQuery(fromSearchString(search), { sorts: COLLECTION_SORTS })
  // The collection is the category: a `category` filter here has no control to remove it, so it is dropped.
  if (query.categories.length) return { kind: 'redirect', path: listingHref(path, { ...query, categories: [] }, { sort: COLLECTION_SORTS[0]! }) }
  const result = await searchShopCatalog({ em, container }, site, query, { links: storeCatalogLinks(frame.basePath), within: category })
  const children = (await loadPublicCategories(em, site)).filter((row) => row.parentId === category.id)
  return {
    kind: 'ok',
    view: {
      ...frame,
      // Each page of a collection is its own canonical URL, so products past page 1 stay indexable.
      head: store.head(`${category.name} · ${site.name}`, plainExcerpt(category.description), collectionPagePath(canonicalKey, result.page)),
      category: { name: category.name, description: category.description ?? null },
      subcategories: await categoryCards({ em, container }, scope, frame.basePath, children),
      subcategoriesTitle: translate('storefront.shop.collections.subcategories', 'Browse by type'),
      listing: listingProps(site.slug, result, query, { sorts: COLLECTION_SORTS, search, categoryFacet: false, translate }),
      pagination: listingPagination(path, query, COLLECTION_SORTS[0]!, result, translate),
    },
  }
})

function render<T>(loaded: Loaded<T>, View: (props: T) => React.ReactNode) {
  if (loaded.kind === 'not-found') notFound()
  if (loaded.kind === 'redirect') permanentRedirect(loaded.path)
  return View(loaded.view)
}

export async function searchPageMetadata(siteSlug: string, params: RawSearchParams | undefined): Promise<Metadata> {
  const loaded = await loadSearchPage(siteSlug, toSearchString(params))
  // Result lists are not indexed; their products are, through their own pages.
  return loaded.kind === 'ok' ? { ...buildStorefrontMetadata(loaded.view.head), robots: { index: false, follow: true } } : {}
}

export async function renderSearchPage(siteSlug: string, params: RawSearchParams | undefined) {
  return render(await loadSearchPage(siteSlug, toSearchString(params)), (view) => <SearchPageView {...view} />)
}

export async function collectionsIndexMetadata(siteSlug: string): Promise<Metadata> {
  const loaded = await loadCollectionsIndex(siteSlug)
  return loaded.kind === 'ok' ? buildStorefrontMetadata(loaded.view.head) : {}
}

export async function renderCollectionsIndex(siteSlug: string) {
  return render(await loadCollectionsIndex(siteSlug), (view) => <CollectionsIndexView {...view} />)
}

export async function collectionPageMetadata(siteSlug: string, key: string, params: RawSearchParams | undefined): Promise<Metadata> {
  const loaded = await loadCollectionPage(siteSlug, key, toSearchString(params))
  return loaded.kind === 'ok' ? buildStorefrontMetadata(loaded.view.head) : {}
}

export async function renderCollectionPage(siteSlug: string, key: string, params: RawSearchParams | undefined) {
  return render(await loadCollectionPage(siteSlug, key, toSearchString(params)), (view) => <CollectionPageView {...view} />)
}
