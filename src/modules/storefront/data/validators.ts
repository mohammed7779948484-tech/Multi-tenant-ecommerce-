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
