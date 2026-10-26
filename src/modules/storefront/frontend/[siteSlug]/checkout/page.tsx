import type { Metadata } from 'next'
import { checkoutPageMetadata, renderCheckoutPage } from '../../../lib/shopCheckoutPages'

type Params = { siteSlug?: string }

/** Guest checkout in a live store (`/{siteSlug}/checkout`); cart, options and quote load from the shop API. */
export default async function StorefrontCheckoutPage({ params }: { params: Params }) {
  return renderCheckoutPage(params.siteSlug ?? '')
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontCheckoutPage.generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => checkoutPageMetadata(params.siteSlug ?? '')
