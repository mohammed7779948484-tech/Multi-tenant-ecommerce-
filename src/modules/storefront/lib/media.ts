/**
 * Raster image types a storefront may show as its logo. SVG is excluded on
 * purpose: it is a document that can carry script, and public pages never
 * serve merchant-supplied markup.
 */
export const STOREFRONT_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

export function isStorefrontLogoMimeType(mimeType: string | null | undefined): boolean {
  return STOREFRONT_LOGO_MIME_TYPES.has(String(mimeType ?? '').trim().toLowerCase())
}
