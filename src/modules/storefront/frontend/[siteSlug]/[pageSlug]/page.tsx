import type { Metadata } from 'next'
import { renderStorefrontPage, storefrontPageMetadata } from '../../../lib/publicPageLoader'

type Params = { siteSlug?: string; pageSlug?: string }

/**
 * A published store page (`/{siteSlug}/{pageSlug}`). Drafts, deleted pages and
 * reserved slugs answer 404; `/{siteSlug}/index` and mixed case redirect to the
 * canonical path.
 */
export default async function StorefrontPage({ params }: { params: Params }) {
  return renderStorefrontPage(params.siteSlug ?? '', params.pageSlug ?? '')
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontPage.generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> =>
  storefrontPageMetadata(params.siteSlug ?? '', params.pageSlug ?? '')
