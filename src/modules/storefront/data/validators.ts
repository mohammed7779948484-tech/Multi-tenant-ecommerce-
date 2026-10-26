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
