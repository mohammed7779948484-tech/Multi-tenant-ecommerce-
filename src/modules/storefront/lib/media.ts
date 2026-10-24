/**
 * Raster image types a storefront may show as its logo. SVG is excluded on
 * purpose: it is a document that can carry script, and public pages never
 * serve merchant-supplied markup.
 */
export const STOREFRONT_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

export function isStorefrontLogoMimeType(mimeType: string | null | undefined): boolean {
  return STOREFRONT_LOGO_MIME_TYPES.has(String(mimeType ?? '').trim().toLowerCase())
}

/** Page and product images follow the logo rule: raster types only, never SVG. */
export const isStorefrontImageMimeType = isStorefrontLogoMimeType

/**
 * Widths the public media route resizes to (`?w=`). Images are never upscaled;
 * any other width answers 404, so the route cannot be used to mint arbitrary
 * variants.
 */
export const STOREFRONT_IMAGE_WIDTHS = [320, 640, 960, 1280, 1920] as const
export type StorefrontImageWidth = (typeof STOREFRONT_IMAGE_WIDTHS)[number]

export function isStorefrontImageWidth(value: number): value is StorefrontImageWidth {
  return (STOREFRONT_IMAGE_WIDTHS as readonly number[]).includes(value)
}
