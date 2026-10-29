import type { Metadata } from 'next'
import { collectionPageMetadata, renderCollectionPage } from '../../../../lib/shopListingPages'
import type { RawSearchParams } from '../../../../lib/shopListingQuery'

type Params = { siteSlug?: string; categoryKey?: string }

/**
 * A category of a live store (`/{siteSlug}/collections/{slug or id}`) with its
 * sub-categories, filters, sort and pages. Served for every active category (spec S-2).
 */
export default async function StorefrontCollectionPage({ params, searchParams }: { params: Params; searchParams?: RawSearchParams }) {
  return renderCollectionPage(params.siteSlug ?? '', params.categoryKey ?? '', searchParams)
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontCollectionPage.generateMetadata = async ({ params, searchParams }: { params: Params; searchParams?: RawSearchParams }): Promise<Metadata> =>
  collectionPageMetadata(params.siteSlug ?? '', params.categoryKey ?? '', searchParams)
