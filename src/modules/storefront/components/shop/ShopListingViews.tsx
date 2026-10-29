import * as React from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { CategoryRail, type CategoryRailItem } from '@/components/ecomcn/category-rail'
import { MAX_QUERY_LENGTH } from '../../lib/shopListingQuery'
import { formatShopNumber } from '../../lib/shopFormat'
import type { CategoryCard } from '../../lib/sectionDataTypes'
import { publicMediaResolver } from '../../lib/mediaUrls'
import { CollectionListBlock, StoreImage, type SectionLabels } from '../public/blocks'
import { StorefrontFrame, StorefrontJsonLd, type StorefrontViewProps } from '../public/StorefrontView'
import { ShopListing, type ShopListingProps } from './ShopListing'

/**
 * Search, collections index and collection pages (shopping-journey spec
 * REQ-003, REQ-004). Server components inside the store frame; the listing
 * itself is a client island that writes the URL.
 */

type FrameProps = Pick<StorefrontViewProps, 'siteId' | 'siteSlug' | 'storeName' | 'basePath' | 'logoSrc' | 'tokens' | 'labels' | 'shell' | 'head'>

export type ListingPagination = {
  page: number
  pageCount: number
  /** Href of every page the control links to, keyed by page number. */
  hrefs: Record<number, string>
  labels: { nav: string; previous: string; next: string; more: string; status: string }
}

/** Pages shown: first, last, and the current one with its neighbours; gaps become an ellipsis. */
export function visiblePages(page: number, pageCount: number): Array<number | 'gap'> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount))
  const sorted = [...wanted].sort((a, b) => a - b)
  const result: Array<number | 'gap'> = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1]! > 1) result.push('gap')
    result.push(value)
  })
  return result
}

export function ListingPager({ pagination }: { pagination: ListingPagination }) {
  const { page, pageCount, hrefs, labels } = pagination
  if (pageCount <= 1) return null
  return (
    <Pagination aria-label={labels.nav} className="mt-10">
      <PaginationContent>
        {page > 1 ? (
          <PaginationItem>
            <PaginationPrevious href={hrefs[page - 1]} rel="prev" label={labels.previous} aria-label={labels.previous} />
          </PaginationItem>
        ) : null}
        {visiblePages(page, pageCount).map((value, index) =>
          value === 'gap' ? (
            <PaginationItem key={`gap-${index}`}>
              <PaginationEllipsis label={labels.more} />
            </PaginationItem>
          ) : (
            <PaginationItem key={value}>
              <PaginationLink href={hrefs[value]} isActive={value === page} aria-current={value === page ? 'page' : undefined}>
                {formatShopNumber(value)}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        {page < pageCount ? (
          <PaginationItem>
            <PaginationNext href={hrefs[page + 1]} rel="next" label={labels.next} aria-label={labels.next} />
          </PaginationItem>
        ) : null}
      </PaginationContent>
      <p className="sr-only">{labels.status}</p>
    </Pagination>
  )
}

export type SearchPageProps = FrameProps & {
  title: string
  form: { action: string; label: string; placeholder: string; submit: string; value: string }
  listing: ShopListingProps
  pagination: ListingPagination
  /** More products match than the search reads; shown so the buyer narrows the query. */
  truncatedNotice: string | null
}

export function SearchPageView(props: SearchPageProps) {
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        <section className="sf-section">
          <div className="sf-container">
            <h1 className="sf-section-title">{props.title}</h1>
            <form role="search" action={props.form.action} method="get" className="mb-8 flex max-w-xl gap-2">
              <label htmlFor="sf-search-q" className="sr-only">
                {props.form.label}
              </label>
              <Input
                id="sf-search-q"
                type="search"
                name="q"
                defaultValue={props.form.value}
                placeholder={props.form.placeholder}
                maxLength={MAX_QUERY_LENGTH}
                autoFocus={!props.form.value}
                enterKeyHint="search"
                className="h-11 flex-1"
              />
              <Button type="submit" className="h-11 gap-2">
                <SearchIcon aria-hidden="true" />
                {props.form.submit}
              </Button>
            </form>
            {props.truncatedNotice ? <p className="sf-lead">{props.truncatedNotice}</p> : null}
            <ShopListing {...props.listing} />
            <ListingPager pagination={props.pagination} />
          </div>
        </section>
      </StorefrontFrame>
    </>
  )
}

export type CollectionsIndexProps = FrameProps & {
  title: string
  categories: CategoryCard[]
  sectionLabels: SectionLabels
}

/** Every top-level public category, in the same cards the merchant's CollectionList section uses. */
export function CollectionsIndexView(props: CollectionsIndexProps) {
  const media = publicMediaResolver(props.siteSlug)
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        <CollectionListBlock
          props={{ heading: props.title, categoryIds: props.categories.map((category) => category.id) }}
          context={{ basePath: props.basePath, isFirst: true, media, labels: props.sectionLabels, data: { categories: props.categories } }}
        />
      </StorefrontFrame>
    </>
  )
}

export type CollectionPageProps = FrameProps & {
  category: { name: string; description: string | null }
  subcategories: CategoryCard[]
  subcategoriesTitle: string
  listing: ShopListingProps
  pagination: ListingPagination
}

export function CollectionPageView(props: CollectionPageProps) {
  const media = publicMediaResolver(props.siteSlug)
  const rail: CategoryRailItem[] = props.subcategories.map((category) => ({
    id: category.id,
    label: category.name,
    href: category.href,
    image: category.image ? <StoreImage image={category.image} media={media} sizes="(min-width: 64rem) 20vw, 46vw" /> : undefined,
  }))
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        <section className="sf-section">
          <div className="sf-container">
            <h1 className="sf-section-title">{props.category.name}</h1>
            {props.category.description ? <p className="sf-pre-line sf-lead">{props.category.description}</p> : null}
            {rail.length ? <CategoryRail items={rail} title={props.subcategoriesTitle} numbered={false} className="mb-10" /> : null}
            <ShopListing {...props.listing} />
            <ListingPager pagination={props.pagination} />
          </div>
        </section>
      </StorefrontFrame>
    </>
  )
}
