import { z } from 'zod'
import { themeTokensSchema } from '../lib/theme'

/** Store identity edited in the brand wizard. */
export const siteNameSchema = z.string().trim().min(1, 'storefront.validation.nameRequired').max(80, 'storefront.validation.nameTooLong')
export const siteDescriptionSchema = z
  .string()
  .trim()
  .max(160, 'storefront.validation.descriptionTooLong')
  .transform((value) => (value.length ? value : null))
  .nullable()

/**
 * `PUT /api/storefront/brand` body. Strict: request bodies never carry
 * `tenantId`/`organizationId` (scope comes from the session), and unknown keys
 * are rejected rather than ignored.
 */
export const brandUpdateSchema = z
  .object({
    name: siteNameSchema,
    description: siteDescriptionSchema.optional().default(null),
    logoAttachmentId: z.string().uuid('storefront.validation.logoInvalid').nullable().optional().default(null),
    tokens: themeTokensSchema,
  })
  .strict()

export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>

/** Command input: the validated body plus the trusted site id resolved by the route. */
export const brandUpdateCommandSchema = z.object({
  siteId: z.string().uuid(),
  name: siteNameSchema,
  description: z.string().max(160).nullable(),
  logoAttachmentId: z.string().uuid().nullable(),
  tokens: themeTokensSchema,
})

export type BrandUpdateCommandInput = z.infer<typeof brandUpdateCommandSchema>

export const mediaParamsSchema = z.object({
  siteSlug: z.string().min(1).max(48),
  attachmentId: z.string().uuid(),
})

// ── Phase 2: pages ────────────────────────────────────────────────────────────

export const pageTitleSchema = z.string().trim().min(1, 'storefront.validation.titleRequired').max(70, 'storefront.validation.titleTooLong')
export const pageSeoDescriptionSchema = z
  .string()
  .trim()
  .max(160, 'storefront.validation.descriptionTooLong')
  .transform((value) => (value.length ? value : null))
  .nullable()
/** Grammar and reserved words are checked by the command (`pageSlugIssue`) so they map to readable field errors. */
export const pageSlugInputSchema = z.string().trim().min(1, 'storefront.validation.slugInvalid').max(48, 'storefront.validation.slugInvalid')

/** `POST /api/storefront/pages`. Strict: scope and publish state never come from the body. */
export const pageCreateSchema = z
  .object({
    title: pageTitleSchema,
    slug: pageSlugInputSchema,
    seoDescription: pageSeoDescriptionSchema.optional().default(null),
  })
  .strict()
export type PageCreateInput = z.infer<typeof pageCreateSchema>

/** `PUT /api/storefront/pages`. `draftSpec` is validated by `validatePageSpec` (issues with paths), not here. */
export const pageUpdateSchema = z
  .object({
    id: z.string().uuid(),
    title: pageTitleSchema.optional(),
    slug: pageSlugInputSchema.optional(),
    seoDescription: pageSeoDescriptionSchema.optional(),
    draftSpec: z.unknown().optional(),
  })
  .strict()
export type PageUpdateInput = z.infer<typeof pageUpdateSchema>

export const pageDeleteSchema = z.object({ id: z.string().uuid() }).strict()
export const pagePublishSchema = z.object({ id: z.string().uuid() }).strict()
export const pageRollbackBodySchema = z.object({ revisionId: z.string().uuid() }).strict()
export const pageRollbackSchema = z.object({ id: z.string().uuid(), revisionId: z.string().uuid() }).strict()

/**
 * Buyer cart bodies (shopping-journey spec, API contracts). Strict: no tenant,
 * organization, price or currency is ever accepted from the client; the store
 * comes from the URL slug and prices from the pricing engine.
 */
const personalizationInputSchema = z
  .record(z.string().max(64), z.union([z.string().max(2000), z.number()]))
  .refine((value) => Object.keys(value).length <= 64, 'storefront.shop.errors.personalizationInvalid')

export const cartLineAddSchema = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(99).default(1),
    personalization: personalizationInputSchema.optional(),
  })
  .strict()

export const cartLineUpdateSchema = z
  .object({
    quantity: z.number().int().min(1).max(99).optional(),
    personalization: personalizationInputSchema.optional(),
  })
  .strict()
  .refine((value) => value.quantity !== undefined || value.personalization !== undefined, 'storefront.shop.errors.nothingToUpdate')

export type CartLineAddInput = z.infer<typeof cartLineAddSchema>
export type CartLineUpdateInput = z.infer<typeof cartLineUpdateSchema>

/**
 * Checkout bodies (shopping-journey spec REQ-007/REQ-008). Strict: no price,
 * total, currency or scope is accepted; codes are checked against the bundled
 * Yemen dataset and methods against the store's own by the service. Messages
 * are storefront keys so the route can name each field in Arabic.
 */
const checkoutKey = (field: string) => `storefront.shop.checkout.errors.${field}`

export const checkoutDestinationSchema = z
  .object({
    governorate: z.string().trim().regex(/^YE\d{2}$/, checkoutKey('governorate')),
    district: z.string().trim().regex(/^YE\d{4}$/, checkoutKey('district')),
    area: z.string().trim().min(1, checkoutKey('area')).max(200, checkoutKey('tooLong')),
    landmark: z.string().trim().max(200, checkoutKey('tooLong')).nullable().optional(),
    note: z.string().trim().max(500, checkoutKey('tooLong')).nullable().optional(),
    gps: z
      .object({ latitude: z.number().finite(), longitude: z.number().finite() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()

export const checkoutQuoteSchema = z
  .object({
    destination: checkoutDestinationSchema,
    shippingMethodId: z.string().uuid(checkoutKey('shipping')),
    paymentMethodId: z.string().uuid(checkoutKey('payment')),
  })
  .strict()

export const checkoutPlaceSchema = checkoutQuoteSchema
  .extend({
    contact: z
      .object({
        name: z.string().trim().min(2, checkoutKey('name')).max(120, checkoutKey('tooLong')),
        phone: z.string().trim().min(1, checkoutKey('phone')).max(24, checkoutKey('phone')),
      })
      .strict(),
    quoteHash: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict()

const proofKey = (key: string) => `storefront.shop.proof.errors.${key}`

/** The text fields of a transfer proof (multipart; the receipt file is checked by the route). */
export const proofFieldsSchema = z
  .object({
    reference: z.string().trim().min(1, proofKey('reference')).max(100, proofKey('tooLong')),
    senderName: z.string().trim().max(120, proofKey('tooLong')).optional().transform((value) => value || null),
  })
  .strict()

export type CheckoutQuoteInput = z.infer<typeof checkoutQuoteSchema>
export type CheckoutPlaceInput = z.infer<typeof checkoutPlaceSchema>
