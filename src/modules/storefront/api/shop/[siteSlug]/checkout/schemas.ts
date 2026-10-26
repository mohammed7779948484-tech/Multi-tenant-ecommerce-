import { z } from 'zod'
import { cartViewSchema } from '../cart/schemas'

/** OpenAPI shapes of checkout and order tracking (shopping-journey spec, API contracts). */
const moneySchema = z.object({ amount: z.number(), formatted: z.string() })

export const checkoutOptionsSchema = z.object({
  governorates: z.array(z.object({ code: z.string(), name: z.string() })),
  districts: z.array(z.object({ code: z.string(), name: z.string() })),
  shippingMethods: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
      transitDays: z.number().int().nullable(),
      amount: z.number().nullable(),
      formatted: z.string().nullable(),
      currencyCode: z.string(),
    }),
  ),
  paymentMethods: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
      kind: z.enum(['cod', 'transfer']),
      instructions: z.string().nullable(),
      accountNumber: z.string().nullable(),
    }),
  ),
})

export const checkoutQuoteResponseSchema = z.object({
  lines: cartViewSchema.shape.lines,
  currencyCode: z.string(),
  subtotal: moneySchema,
  shipping: moneySchema,
  fees: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  grandTotal: moneySchema,
  quoteHash: z.string(),
  blocked: z.boolean(),
})

export const checkoutPlaceResponseSchema = z.object({ orderNumber: z.string(), trackingUrl: z.string() })

export const orderViewSchema = z.object({
  orderNumber: z.string(),
  placedAt: z.string().nullable(),
  status: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  currencyCode: z.string(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      variant: z.string().nullable(),
      personalization: z.string().nullable(),
      quantity: z.number(),
      unitPrice: moneySchema,
      total: moneySchema,
    }),
  ),
  totals: z.object({ subtotal: moneySchema, shipping: moneySchema, fees: moneySchema, discount: moneySchema, tax: moneySchema, grandTotal: moneySchema }),
  contact: z.object({ name: z.string().nullable(), phone: z.string().nullable() }),
  address: z.object({
    governorate: z.string().nullable(),
    district: z.string().nullable(),
    area: z.string().nullable(),
    landmark: z.string().nullable(),
    note: z.string().nullable(),
    gps: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  }),
  shippingMethod: z.string().nullable(),
  payment: z.object({ name: z.string().nullable(), kind: z.enum(['cod', 'transfer', 'other']), instructions: z.string().nullable(), accountNumber: z.string().nullable() }),
})
