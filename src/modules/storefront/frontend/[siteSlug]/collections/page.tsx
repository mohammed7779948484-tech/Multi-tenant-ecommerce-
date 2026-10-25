import type { Metadata } from 'next'
import { collectionsIndexMetadata, renderCollectionsIndex } from '../../../lib/shopListingPages'

type Params = { siteSlug?: string }

/** Every top-level category of a live store (`/{siteSlug}/collections`, spec REQ-003). */
export default async function StorefrontCollectionsIndexPage({ params }: { params: Params }) {
  return renderCollectionsIndex(params.siteSlug ?? '')
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontCollectionsIndexPage.generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> =>
  collectionsIndexMetadata(params.siteSlug ?? '')
