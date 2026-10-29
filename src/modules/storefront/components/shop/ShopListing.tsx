'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyResults } from '@/components/ecomcn/empty-results'
import { FilterPanel } from '@/components/ecomcn/filter-panel'
import { FilterSheet } from '@/components/ecomcn/filter-sheet'
import type { ProductCardProduct } from '@/components/ecomcn/product-card'
import { ProductGrid } from '@/components/ecomcn/product-grid'
import { SortToolbar, type SortOption } from '@/components/ecomcn/sort-toolbar'
import { useFilterParams } from '@/hooks/use-filter-params'
import { describeActiveFilters, removeFilter, type FilterFacet } from '@/lib/filter-params'
import { SHOP_NUMBER_LOCALE, shopCountLabel } from '../../lib/shopFormat'
import { LISTING_PARAMS } from '../../lib/shopListingQuery'
import { ShopProductCard } from './ShopProductCard'

export type ShopListingProps = {
  products: ProductCardProduct[]
  total: number
  /** Built on the server from the result (category, price, in-stock), labels in Arabic. */
  facets: FilterFacet[]
  sort: string
  defaultSort: string
  sortOptions: SortOption[]
  /** The query string the page was rendered with: the URL is the listing's only state. */
  search: string
  query: string | null
}

/**
 * Filters, sort and results of a search or collection page (spec REQ-004).
 * Every change writes the URL and asks the server for the page again, so a
 * result list is shareable and works with Back. Filters sit in a sidebar from
 * 1024 px up and in a sheet below that; changes in the sheet apply once.
 */
export function ShopListing({ products, total, facets, sort, defaultSort, sortOptions, search, query }: ShopListingProps) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const navigate = React.useCallback(
    (href: string, options?: { replace: boolean }) =>
      startTransition(() => (options?.replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }))),
    [router],
  )
  const [filters, setFilters] = useFilterParams(facets, { searchParams: search, navigate })
  const formatCount = React.useCallback((count: number) => shopCountLabel(t, 'products', count), [t])
  const formatResults = React.useCallback((count: number) => shopCountLabel(t, 'results', count), [t])

  const onSortChange = (value: string) => {
    const params = new URLSearchParams(search)
    if (value === defaultSort) params.delete(LISTING_PARAMS.sort)
    else params.set(LISTING_PARAMS.sort, value)
    params.delete(LISTING_PARAMS.page)
    const next = params.toString()
    navigate(`${window.location.pathname}${next ? `?${next}` : ''}`)
  }

  const active = describeActiveFilters(filters, facets, {
    locale: SHOP_NUMBER_LOCALE,
    rangeLabels: {
      from: (min) => t('ecomcn.filters.rangeFrom', '{min} and up', { min }),
      upTo: (max) => t('ecomcn.filters.rangeUpTo', 'Up to {max}', { max }),
    },
  })

  return (
    <div className="sf-listing" data-pending={pending ? '' : undefined}>
      <aside className="sf-listing-filters" aria-label={t('ecomcn.filters.title', 'Filters')}>
        <FilterPanel facets={facets} value={filters} onValueChange={setFilters} locale={SHOP_NUMBER_LOCALE} loading={pending} />
      </aside>
      <div className="sf-listing-results">
        <SortToolbar
          total={total}
          loading={pending}
          sort={sort}
          sortOptions={sortOptions}
          onSortChange={onSortChange}
          locale={SHOP_NUMBER_LOCALE}
          formatCount={formatCount}
          filters={
            <FilterSheet
              facets={facets}
              value={filters}
              onValueChange={setFilters}
              locale={SHOP_NUMBER_LOCALE}
              loading={pending}
              formatCount={formatResults}
            />
          }
        />
        <div className="pt-6">
          {total > 0 || pending ? (
            <ProductGrid
              products={products}
              loading={pending}
              skeletonCount={Math.min(Math.max(products.length, 4), 12)}
              className="sm:grid-cols-3 xl:grid-cols-4"
              renderCard={(product) => <ShopProductCard product={product} />}
            />
          ) : (
            <EmptyResults
              query={query ?? undefined}
              locale={SHOP_NUMBER_LOCALE}
              formatCount={formatCount}
              filters={active.map((filter) => ({
                id: `${filter.facetId}:${filter.value ?? ''}`,
                label: filter.label,
                onRemove: () => setFilters(removeFilter(filters, filter.facetId, filter.value)),
              }))}
              onClearAll={active.length ? () => setFilters({}) : undefined}
              description={active.length ? undefined : t('storefront.shop.search.emptyHint', 'Try another word or browse the categories.')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
