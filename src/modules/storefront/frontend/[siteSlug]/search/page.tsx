import type { Metadata } from 'next'
import { renderSearchPage, searchPageMetadata } from '../../../lib/shopListingPages'
import type { RawSearchParams } from '../../../lib/shopListingQuery'

type Params = { siteSlug?: string }

/**
 * Store search (`/{siteSlug}/search?q=…&category=…&price=min-max&in_stock=1&sort=…&page=N`).
 * The URL is the whole state, so a result list is shareable (spec REQ-004).
 */
export default async function StorefrontSearchPage({ params, searchParams }: { params: Params; searchParams?: RawSearchParams }) {
  return renderSearchPage(params.siteSlug ?? '', searchParams)
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontSearchPage.generateMetadata = async ({ params, searchParams }: { params: Params; searchParams?: RawSearchParams }): Promise<Metadata> =>
  searchPageMetadata(params.siteSlug ?? '', searchParams)
