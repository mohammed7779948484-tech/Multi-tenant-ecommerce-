import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/** Public order tracking: the order token is the only capability: anonymous by design; title and SEO tags come from the page's `generateMetadata`. */
export const metadata: PageMetadata = {
  requireAuth: false,
  navHidden: true,
}

export default metadata
