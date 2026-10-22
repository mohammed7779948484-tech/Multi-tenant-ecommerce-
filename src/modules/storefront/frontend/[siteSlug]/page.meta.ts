import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/** Public store home: anonymous by design. Per-store title and SEO tags come from the page's `generateMetadata`. */
export const metadata: PageMetadata = {
  requireAuth: false,
  navHidden: true,
}

export default metadata
