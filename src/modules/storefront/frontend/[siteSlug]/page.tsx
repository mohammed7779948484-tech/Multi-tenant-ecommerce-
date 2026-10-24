import type { Metadata } from 'next'
import { renderStorefrontPage, storefrontPageMetadata } from '../../lib/publicPageLoader'

type Params = { siteSlug?: string }

/** The store's home page (`/{siteSlug}`): the published `index` page, server-rendered. */
export default async function StorefrontHomePage({ params }: { params: Params }) {
  return renderStorefrontPage(params.siteSlug ?? '', null)
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontHomePage.generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> =>
  storefrontPageMetadata(params.siteSlug ?? '', null)
