import { z } from 'zod'

/** OpenAPI shapes of the buyer cart (shopping-journey spec, API contracts). */
const priceSchema = z.object({ amount: z.number(), currencyCode: z.string(), formatted: z.string() })

export const cartViewSchema = z.object({
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      productId: z.string().uuid(),
      variantId: z.string().uuid().nullable(),
      title: z.string().nullable(),
      href: z.string().nullable(),
      image: z.string().nullable(),
      variantLabel: z.string().nullable(),
      personalization: z.array(z.object({ code: z.string(), label: z.string(), value: z.string(), inputType: z.enum(['text', 'textarea', 'number']), required: z.boolean() })),
      quantity: z.number().int(),
      unitPrice: priceSchema.nullable(),
      lineTotal: priceSchema.nullable(),
      maxQuantity: z.number().int(),
      issues: z.array(z.enum(['unavailable', 'noPrice', 'outOfStock', 'currency'])),
    }),
  ),
  subtotal: priceSchema.nullable(),
  currencyCode: z.string().nullable(),
  count: z.number().int(),
  updatedAt: z.string().nullable(),
})

export const shopErrorSchema = z.object({ error: z.string(), code: z.string(), fieldErrors: z.record(z.string(), z.string()).optional() })
