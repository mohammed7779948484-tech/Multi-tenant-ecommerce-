import type { Metadata } from 'next'
import { collectionPageMetadata, renderCollectionPage } from '../../../../lib/publicCatalogPages'

type Params = { siteSlug?: string; categoryKey?: string }
type SearchParams = Record<string, string | string[] | undefined>

function pageParam(searchParams: SearchParams | undefined): string | null {
  const value = searchParams?.page
  return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? null) : null
}

/**
 * A collection of a live store (`/{siteSlug}/collections/{slug or id}?page=N`).
 * Served only while a published section shows the category; 24 products per page.
 */
export default async function StorefrontCollectionPage({ params, searchParams }: { params: Params; searchParams?: SearchParams }) {
  return renderCollectionPage(params.siteSlug ?? '', params.categoryKey ?? '', pageParam(searchParams))
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontCollectionPage.generateMetadata = async ({ params, searchParams }: { params: Params; searchParams?: SearchParams }): Promise<Metadata> =>
  collectionPageMetadata(params.siteSlug ?? '', params.categoryKey ?? '', pageParam(searchParams))
