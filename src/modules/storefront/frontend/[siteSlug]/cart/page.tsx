import type { Metadata } from 'next'
import { cartPageMetadata, renderCartPage } from '../../../lib/shopCartPage'

type Params = { siteSlug?: string }

/** The buyer's cart in a live store (`/{siteSlug}/cart`); the cart itself loads from the cart API. */
export default async function StorefrontCartPage({ params }: { params: Params }) {
  return renderCartPage(params.siteSlug ?? '')
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontCartPage.generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => cartPageMetadata(params.siteSlug ?? '')
