import { STOREFRONT_IMAGE_WIDTHS } from './media'

/**
 * Image URLs for store sections. Pure (no ORM, no React), so the public page and
 * the client-side builder preview share it.
 */

export type MediaResolver = {
  src: (attachmentId: string, width: number) => string
  srcSet: (attachmentId: string) => string | undefined
}

/** Public URL of a store image; the route re-checks that the image is public before serving it. */
export function storefrontMediaPath(slug: string, attachmentId: string, width?: number): string {
  const path = `/api/storefront/media/${encodeURIComponent(slug)}/${encodeURIComponent(attachmentId)}`
  return width ? `${path}?w=${width}` : path
}

function nearestWidth(width: number): number {
  return STOREFRONT_IMAGE_WIDTHS.find((candidate) => candidate >= width) ?? STOREFRONT_IMAGE_WIDTHS[STOREFRONT_IMAGE_WIDTHS.length - 1]
}

/** Buyer-facing images: the store's media route at the fixed widths it serves. */
export function publicMediaResolver(siteSlug: string): MediaResolver {
  return {
    src: (attachmentId, width) => storefrontMediaPath(siteSlug, attachmentId, nearestWidth(width)),
    srcSet: (attachmentId) =>
      STOREFRONT_IMAGE_WIDTHS.map((width) => `${storefrontMediaPath(siteSlug, attachmentId, width)} ${width}w`).join(', '),
  }
}

/** Builder preview (staff only): the attachments module's authenticated image route. */
export function staffMediaResolver(): MediaResolver {
  const url = (attachmentId: string, width: number) => `/api/attachments/image/${encodeURIComponent(attachmentId)}?width=${width}`
  return {
    src: (attachmentId, width) => url(attachmentId, nearestWidth(width)),
    srcSet: (attachmentId) => STOREFRONT_IMAGE_WIDTHS.map((width) => `${url(attachmentId, width)} ${width}w`).join(', '),
  }
}

/** No images: tests and pages that render without a store. */
export const NO_MEDIA: MediaResolver = { src: () => '', srcSet: () => undefined }
