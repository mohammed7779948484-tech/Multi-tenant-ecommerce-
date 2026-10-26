import { z } from 'zod'
import type { ShippingProvider } from '@open-mercato/core/modules/sales/lib/providers/types'
import { findDistrict, findGovernorate } from './yemen'

/**
 * Delivery priced by destination (shopping-journey spec S-8): the sales
 * shipping provider `suqna-yemen-zones`. Its settings live on a sales shipping
 * method (`metadata.providerSettings`, edited in the existing shipping-method
 * screen) as rates per governorate P-code, with optional district overrides
 * and a default. The destination travels in the order's shipping-method
 * snapshot (`metadata.destination`), so the sales admin recalculates the same
 * charge later.
 */

export const YEMEN_ZONES_PROVIDER_KEY = 'suqna-yemen-zones'

const amount = z.coerce.number().finite().min(0).max(1_000_000_000)

export const yemenZoneSettingsSchema = z.object({
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  rates: z
    .array(
      z.object({
        governorate: z.string().trim().regex(/^YE\d{2}$/),
        district: z.string().trim().regex(/^YE\d{4}$/).optional(),
        amount,
      }),
    )
    .max(400)
    .default([]),
  defaultAmount: amount.optional(),
})

export type YemenZoneSettings = z.infer<typeof yemenZoneSettingsSchema>
export type YemenDestination = { governorate: string; district: string }

/**
 * The delivery charge for a destination: the district's own rate, else its
 * governorate's, else the default; `null` when the destination is not served
 * (or the codes are not a district of that governorate).
 */
export function yemenZoneRate(settings: unknown, destination: YemenDestination | null | undefined): { amount: number; currencyCode: string } | null {
  const parsed = yemenZoneSettingsSchema.safeParse(settings ?? {})
  if (!parsed.success || !destination) return null
  if (!findGovernorate(destination.governorate) || !findDistrict(destination.governorate, destination.district)) return null
  const { rates, defaultAmount, currencyCode } = parsed.data
  const district = rates.find((rate) => rate.district === destination.district && rate.governorate === destination.governorate)
  const governorate = rates.find((rate) => !rate.district && rate.governorate === destination.governorate)
  const chosen = district?.amount ?? governorate?.amount ?? defaultAmount
  return chosen === undefined ? null : { amount: chosen, currencyCode }
}

/** The destination a shipping-method snapshot carries (`metadata.destination`). */
export function destinationOf(metadata: Record<string, unknown> | null | undefined): YemenDestination | null {
  const raw = metadata?.destination
  if (!raw || typeof raw !== 'object') return null
  const { governorate, district } = raw as Record<string, unknown>
  return typeof governorate === 'string' && typeof district === 'string' ? { governorate, district } : null
}

export const yemenZonesProvider: ShippingProvider = {
  key: YEMEN_ZONES_PROVIDER_KEY,
  label: 'Yemen delivery zones',
  description: 'Delivery priced by governorate and district (P-codes), with an optional default for other areas.',
  settings: {
    fields: [
      { key: 'currencyCode', label: 'Currency', type: 'text', required: true, placeholder: 'YER' },
      {
        key: 'rates',
        label: 'Rates',
        type: 'json',
        required: true,
        description: 'A list of { "governorate": "YE15", "district": "YE1517" (optional), "amount": 1500 }. A district rate overrides its governorate.',
      },
      { key: 'defaultAmount', label: 'Default rate', type: 'number', description: 'Charged where no rate matches. Leave empty to not deliver there.' },
    ],
    schema: yemenZoneSettingsSchema,
    defaults: { currencyCode: 'YER', rates: [] },
  },
  calculate: ({ method, settings }) => {
    const rate = yemenZoneRate(settings, destinationOf(method.metadata ?? null))
    if (!rate) return { adjustments: [] }
    return {
      adjustments: [
        {
          kind: 'shipping',
          code: method.code ?? YEMEN_ZONES_PROVIDER_KEY,
          label: method.name ?? 'Delivery',
          amountNet: rate.amount,
          amountGross: rate.amount,
          currencyCode: rate.currencyCode,
          metadata: { providerKey: YEMEN_ZONES_PROVIDER_KEY, destination: destinationOf(method.metadata ?? null) },
        },
      ],
    }
  },
}
