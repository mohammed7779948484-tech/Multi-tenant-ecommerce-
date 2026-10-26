import type { Metadata } from 'next'
import { orderPageMetadata, renderOrderPage } from '../../../../lib/shopCheckoutPages'

type Params = { siteSlug?: string; orderNumber?: string }
type Search = { k?: string | string[]; placed?: string | string[] }

/** A guest's order (`/{siteSlug}/orders/{orderNumber}?k=…`): confirmation and tracking for the holder of its token. */
export default async function StorefrontOrderPage({ params, searchParams }: { params: Params; searchParams?: Search }) {
  return renderOrderPage(params.siteSlug ?? '', params.orderNumber ?? '', searchParams)
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontOrderPage.generateMetadata = async ({ params, searchParams }: { params: Params; searchParams?: Search }): Promise<Metadata> =>
  orderPageMetadata(params.siteSlug ?? '', params.orderNumber ?? '', searchParams)
