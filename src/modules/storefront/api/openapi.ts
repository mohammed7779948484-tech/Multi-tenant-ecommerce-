import { z } from 'zod'

/** Shared OpenAPI pieces for storefront routes. */
export const storefrontTag = 'Storefront'

export const storefrontErrorSchema = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})
