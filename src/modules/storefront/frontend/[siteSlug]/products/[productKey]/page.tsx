import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../../../../lib/publicCatalogPages'

type Params = { siteSlug?: string; productKey?: string }

/**
 * A product of a live store (`/{siteSlug}/products/{handle or id}`). Served only
 * while a published section shows the product; everything else answers 404.
 */
export default async function StorefrontProductPage({ params }: { params: Params }) {
  return renderProductPage(params.siteSlug ?? '', params.productKey ?? '')
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontProductPage.generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> =>
  productPageMetadata(params.siteSlug ?? '', params.productKey ?? '')
