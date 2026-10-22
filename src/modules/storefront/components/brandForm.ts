import { COLOR_TOKEN_KEYS, type ColorTokenKey, type ThemeTokens } from '../lib/theme'

/** `GET`/`PUT /api/storefront/brand` response. */
export type BrandPayload = {
  siteId: string
  slug: string
  publicUrl: string
  name: string
  description: string | null
  logoAttachmentId: string | null
  logoUrl: string | null
  tokens: ThemeTokens
  updatedAt: string | null
}

export const BRAND_API_PATH = 'storefront/brand'
export const OVERVIEW_HREF = '/backend/storefront'
export const BRAND_HREF = '/backend/storefront/brand'
/** Generated entity id of the site; attachments uploaded as logos are filed under it. */
export const SITE_ENTITY_ID = 'storefront:storefront_site'

export type ColorFieldId = `colors.${ColorTokenKey}`
export const colorFieldId = (key: ColorTokenKey): ColorFieldId => `colors.${key}`

/**
 * CrudForm values. Field ids mirror the API's field-error paths without the
 * `tokens.` prefix (`colors.primary`, `fonts.heading`, `radius`), so server
 * errors land on the right input.
 */
export type BrandFormValues = {
  /** Record id: puts CrudForm in edit mode, which attaches the optimistic-lock header from `updatedAt`. */
  id: string
  siteId: string
  slug: string
  publicUrl: string
  name: string
  description: string
  logoAttachmentId: string | null
  /** Preview only: the public logo URL or a local object URL after an upload. */
  logoPreviewUrl: string | null
  'fonts.heading': ThemeTokens['fonts']['heading']
  'fonts.body': ThemeTokens['fonts']['body']
  radius: ThemeTokens['radius']
  density: ThemeTokens['density']
  updatedAt: string | null
} & Record<ColorFieldId, string>

export function toBrandFormValues(payload: BrandPayload): BrandFormValues {
  const colors = Object.fromEntries(
    COLOR_TOKEN_KEYS.map((key) => [colorFieldId(key), payload.tokens.colors[key]]),
  ) as Record<ColorFieldId, string>
  return {
    id: payload.siteId,
    siteId: payload.siteId,
    slug: payload.slug,
    publicUrl: payload.publicUrl,
    name: payload.name,
    description: payload.description ?? '',
    logoAttachmentId: payload.logoAttachmentId,
    logoPreviewUrl: payload.logoUrl,
    'fonts.heading': payload.tokens.fonts.heading,
    'fonts.body': payload.tokens.fonts.body,
    radius: payload.tokens.radius,
    density: payload.tokens.density,
    updatedAt: payload.updatedAt,
    ...colors,
  }
}

/** Builds the strict `PUT` body: identity plus the full token set, nothing else. */
export function toBrandRequestBody(values: Partial<BrandFormValues> & Record<string, unknown>) {
  const colors = Object.fromEntries(
    COLOR_TOKEN_KEYS.map((key) => [key, String(values[colorFieldId(key)] ?? '')]),
  ) as ThemeTokens['colors']
  const description = typeof values.description === 'string' ? values.description.trim() : ''
  return {
    name: typeof values.name === 'string' ? values.name : '',
    description: description.length ? description : null,
    logoAttachmentId: typeof values.logoAttachmentId === 'string' && values.logoAttachmentId ? values.logoAttachmentId : null,
    tokens: {
      version: 1 as const,
      colors,
      fonts: { heading: values['fonts.heading'], body: values['fonts.body'] },
      radius: values.radius,
      density: values.density,
    },
  }
}

/** Maps API field-error paths (`tokens.colors.primary`) onto form field ids (`colors.primary`). */
export function toFormFieldErrors(fieldErrors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([path, message]) => [path.startsWith('tokens.') ? path.slice('tokens.'.length) : path, message]),
  )
}
