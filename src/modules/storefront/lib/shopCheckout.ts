import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesPaymentMethod, SalesShippingMethod } from '@open-mercato/core/modules/sales/data/entities'
import type { SalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'
import type { SalesLineSnapshot } from '@open-mercato/core/modules/sales/lib/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StorefrontCart } from '../data/entities'
import { buildCartView, ShopError, type CartLineView, type CartSite, type CartView } from './shopCart'
import { formatShopPrice } from './shopFormat'
import { stableStringify } from './stableJson'
import { findDistrict, findGovernorate, isInYemen } from './yemen'
import { YEMEN_ZONES_PROVIDER_KEY, yemenZoneRate, type YemenDestination } from './yemenZones'

/**
 * Checkout options and the server quote (shopping-journey spec REQ-007, S-7,
 * S-8). Delivery comes from active sales shipping methods of the Yemen-zones
 * provider, priced for the buyer's district; payment from active cash-on-
 * delivery and bank-transfer methods. The quote runs the cart's live lines and
 * both methods through the installed `salesCalculationService`, exactly as
 * `sales.orders.create` will, so the totals shown are the order's totals.
 */

type Deps = { em: EntityManager; container: AwilixContainer }

export const COD_PROVIDER_KEY = 'cash-on-delivery'
export const TRANSFER_PROVIDER_KEY = 'wire-transfer'
/** The transfer instructions the sales seed ships (an example account). Never shown to a buyer. */
export const SEEDED_TRANSFER_INSTRUCTIONS = 'Please wire funds to ACME Corp, IBAN XX00 0000 0000 0000 0000 0000.'

export type CheckoutDestination = YemenDestination & {
  area: string
  landmark?: string | null
  note?: string | null
  gps?: { latitude: number; longitude: number } | null
}

export type CheckoutShippingOption = { id: string; name: string; description: string | null; transitDays: number | null; amount: number | null; formatted: string | null; currencyCode: string }
export type CheckoutPaymentOption = { id: string; name: string; description: string | null; kind: 'cod' | 'transfer'; instructions: string | null; accountNumber: string | null }

function settingsOf(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const settings = metadata?.providerSettings
  return settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
}

function scopeOf(site: CartSite) {
  return { tenantId: site.tenantId, organizationId: site.organizationId }
}

/** Transfer instructions from a method's provider settings, or `null` while missing or still the seeded example. */
export function transferTextFrom(settings: Record<string, unknown>): { instructions: string; accountNumber: string | null } | null {
  const instructions = typeof settings.instructions === 'string' ? settings.instructions.trim() : ''
  if (!instructions || instructions === SEEDED_TRANSFER_INSTRUCTIONS) return null
  const accountNumber = typeof settings.accountNumber === 'string' && settings.accountNumber.trim() ? settings.accountNumber.trim() : null
  return { instructions, accountNumber }
}

function transferDetails(method: SalesPaymentMethod) {
  return transferTextFrom(settingsOf(method.metadata as Record<string, unknown> | null))
}

/** Active Yemen-zones shipping methods and buyer-usable payment methods of the store. */
export async function loadCheckoutMethods(em: EntityManager, site: CartSite) {
  const scope = scopeOf(site)
  const [shipping, payment] = await Promise.all([
    findWithDecryption(em, SalesShippingMethod, { ...scope, deletedAt: null, isActive: true, providerKey: YEMEN_ZONES_PROVIDER_KEY }, { orderBy: { name: 'asc' } }, scope),
    findWithDecryption(em, SalesPaymentMethod, { ...scope, deletedAt: null, isActive: true, providerKey: { $in: [COD_PROVIDER_KEY, TRANSFER_PROVIDER_KEY] } }, { orderBy: { name: 'asc' } }, scope),
  ])
  const payments = payment.filter((method) => method.providerKey === COD_PROVIDER_KEY || transferDetails(method))
  return { shipping, payment: payments }
}

export function toPaymentOption(method: SalesPaymentMethod): CheckoutPaymentOption {
  const transfer = method.providerKey === TRANSFER_PROVIDER_KEY ? transferDetails(method) : null
  return {
    id: method.id,
    name: method.name,
    description: method.description ?? null,
    kind: method.providerKey === TRANSFER_PROVIDER_KEY ? 'transfer' : 'cod',
    instructions: transfer?.instructions ?? null,
    accountNumber: transfer?.accountNumber ?? null,
  }
}

/**
 * Shipping options for a destination. With a destination, only methods that
 * serve it in the cart's currency are listed, each with its price; without one
 * every method is listed unpriced (the buyer has not chosen a district yet).
 */
export function shippingOptionsFor(methods: SalesShippingMethod[], destination: YemenDestination | null, currencyCode: string | null): CheckoutShippingOption[] {
  const options: CheckoutShippingOption[] = []
  for (const method of methods) {
    const settings = settingsOf(method.metadata as Record<string, unknown> | null)
    const rate = destination ? yemenZoneRate(settings, destination) : null
    if (destination && (!rate || (currencyCode && rate.currencyCode !== currencyCode))) continue
    options.push({
      id: method.id,
      name: method.name,
      description: method.description ?? null,
      transitDays: method.estimatedTransitDays ?? null,
      amount: rate?.amount ?? null,
      formatted: rate ? formatShopPrice(rate.amount, rate.currencyCode) : null,
      currencyCode: rate?.currencyCode ?? (typeof settings.currencyCode === 'string' ? settings.currencyCode : currencyCode ?? ''),
    })
  }
  return options
}

/** Field errors for a destination (keys like `destination.district`), or `null` when it is valid. */
export function destinationErrors(destination: CheckoutDestination): Record<string, string> | null {
  const errors: Record<string, string> = {}
  if (!findGovernorate(destination.governorate)) errors['destination.governorate'] = 'storefront.shop.checkout.errors.governorate'
  else if (!findDistrict(destination.governorate, destination.district)) errors['destination.district'] = 'storefront.shop.checkout.errors.district'
  if (!destination.area.trim()) errors['destination.area'] = 'storefront.shop.checkout.errors.area'
  if (destination.gps && !isInYemen(destination.gps.latitude, destination.gps.longitude)) errors['destination.gps'] = 'storefront.shop.checkout.errors.gps'
  return Object.keys(errors).length ? errors : null
}

export type QuoteMoney = { amount: number; formatted: string }

export type CheckoutQuote = {
  lines: CartLineView[]
  currencyCode: string
  subtotal: QuoteMoney
  shipping: QuoteMoney
  /** Payment-method fees (cash-on-delivery fee). */
  fees: QuoteMoney
  discount: QuoteMoney
  tax: QuoteMoney
  grandTotal: QuoteMoney
  /** Changes whenever anything the buyer would pay changes: lines, prices, stock problems, methods, destination. */
  quoteHash: string
  /** Lines that cannot be bought now (removed, unpriced, out of stock): placement refuses until they go. */
  blocked: boolean
}

export type QuoteInput = { destination: CheckoutDestination; shippingMethodId: string; paymentMethodId: string }

/** The method snapshots an order carries; the destination rides in the shipping snapshot's metadata. */
export function methodSnapshots(shipping: SalesShippingMethod, payment: SalesPaymentMethod, destination: YemenDestination) {
  const shippingMetadata = { ...((shipping.metadata as Record<string, unknown> | null) ?? {}), destination: { governorate: destination.governorate, district: destination.district } }
  const paymentMetadata = (payment.metadata as Record<string, unknown> | null) ?? null
  return {
    shippingMethodSnapshot: {
      id: shipping.id,
      code: shipping.code,
      name: shipping.name,
      description: shipping.description ?? null,
      carrierCode: shipping.carrierCode ?? null,
      providerKey: shipping.providerKey ?? null,
      serviceLevel: shipping.serviceLevel ?? null,
      estimatedTransitDays: shipping.estimatedTransitDays ?? null,
      baseRateNet: shipping.baseRateNet,
      baseRateGross: shipping.baseRateGross,
      currencyCode: shipping.currencyCode ?? null,
      metadata: shippingMetadata,
      providerSettings: settingsOf(shippingMetadata),
    },
    paymentMethodSnapshot: {
      id: payment.id,
      code: payment.code,
      name: payment.name,
      description: payment.description ?? null,
      providerKey: payment.providerKey ?? null,
      terms: payment.terms ?? null,
      metadata: paymentMetadata,
      providerSettings: settingsOf(paymentMetadata),
    },
  }
}

type MethodSnapshots = ReturnType<typeof methodSnapshots>

const numeric = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The provider context `salesCalculationService` gets for these method
 * snapshots, built the way `sales.orders.create` builds it from the snapshots
 * it stores (numeric base rates, the document currency for a method without
 * one, provider settings): the quote is calculated from the same input as the
 * order it promises.
 */
export function salesProviderContext(snapshots: MethodSnapshots, currencyCode: string) {
  const { shippingMethodSnapshot: shipping, paymentMethodSnapshot: payment } = snapshots
  return {
    shippingMethod: {
      id: shipping.id,
      code: shipping.code ?? null,
      name: shipping.name ?? null,
      providerKey: shipping.providerKey,
      currencyCode: shipping.currencyCode ?? currencyCode,
      baseRateNet: numeric(shipping.baseRateNet),
      baseRateGross: numeric(shipping.baseRateGross),
      metadata: structuredClone(shipping.metadata),
      providerSettings: structuredClone(shipping.providerSettings),
    },
    paymentMethod: {
      id: payment.id,
      code: payment.code ?? null,
      name: payment.name ?? null,
      providerKey: payment.providerKey,
      terms: payment.terms,
      metadata: payment.metadata ? structuredClone(payment.metadata) : null,
      providerSettings: structuredClone(payment.providerSettings),
    },
  }
}

/** The calculation line of an order line input, with the defaults `sales.orders.create` gives the same input. */
export function calculationLine(line: SalesLineSnapshot): SalesLineSnapshot {
  return {
    ...line,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantityUnit: null,
    normalizedQuantity: line.quantity,
    normalizedUnit: null,
    discountAmount: null,
    discountPercent: null,
    taxRate: null,
    taxAmount: null,
  }
}

/** The sales line of a cart line: the live unit price as gross (no tax configured for buyers), the variant and personalization verbatim. */
export function toSalesLine(line: CartLineView, currencyCode: string, lineNumber: number): SalesLineSnapshot {
  const amount = line.unitPrice?.amount ?? 0
  // Absent rather than null: the sales order schema takes optional fields, not nulls.
  return {
    lineNumber,
    kind: 'product',
    productId: line.productId,
    ...(line.variantId ? { productVariantId: line.variantId } : {}),
    ...(line.title ? { name: line.title } : {}),
    ...(line.variantLabel ? { description: line.variantLabel } : {}),
    ...(personalizationText(line) ? { comment: personalizationText(line)! } : {}),
    quantity: line.quantity,
    currencyCode,
    unitPriceNet: amount,
    unitPriceGross: amount,
    discountAmountBasis: 'unit',
  }
}

/** "label: value · label: value", the way the cart shows it; `null` without values. */
export function personalizationText(line: Pick<CartLineView, 'personalization'>): string | null {
  const text = line.personalization.filter((field) => field.value).map((field) => `${field.label}: ${field.value}`).join(' · ')
  return text || null
}

function money(amount: number | undefined, currencyCode: string): QuoteMoney {
  const value = Number.isFinite(amount) ? Number(amount) : 0
  return { amount: value, formatted: formatShopPrice(value, currencyCode) ?? String(value) }
}

/** Resolves the chosen methods among the ones the store offers; anything else answers like an unknown id. */
export async function resolveMethods(em: EntityManager, site: CartSite, input: Pick<QuoteInput, 'shippingMethodId' | 'paymentMethodId'>) {
  const { shipping, payment } = await loadCheckoutMethods(em, site)
  const shippingMethod = shipping.find((method) => method.id === input.shippingMethodId)
  const paymentMethod = payment.find((method) => method.id === input.paymentMethodId)
  if (!shippingMethod) throw new ShopError(422, 'shippingUnavailable', { shippingMethodId: 'storefront.shop.checkout.errors.shipping' })
  if (!paymentMethod) throw new ShopError(422, 'paymentUnavailable', { paymentMethodId: 'storefront.shop.checkout.errors.payment' })
  return { shipping: shippingMethod, payment: paymentMethod }
}

/** A quote with the method rows and snapshots it was priced with: placement builds the order from exactly these. */
export type PricedCart = { quote: CheckoutQuote; shipping: SalesShippingMethod; payment: SalesPaymentMethod; snapshots: MethodSnapshots }

/**
 * The quote for the cart behind `cart`: live lines, the chosen methods and the
 * destination, totalled by `salesCalculationService`. Refuses an empty cart,
 * an invalid destination, a method the store does not offer there, and a
 * delivery rate in another currency than the cart.
 */
export async function buildQuote(deps: Deps, site: CartSite, cart: StorefrontCart | null, input: QuoteInput, options: { bypassCache?: boolean; strictStock?: boolean } = {}): Promise<CheckoutQuote> {
  return (await priceCart(deps, site, cart, input, options)).quote
}

export async function priceCart(deps: Deps, site: CartSite, cart: StorefrontCart | null, input: QuoteInput, options: { bypassCache?: boolean; strictStock?: boolean } = {}): Promise<PricedCart> {
  const view: CartView = await buildCartView(deps, site, cart, options)
  if (!view.lines.length || !view.currencyCode) throw new ShopError(422, 'cartEmpty')
  const fieldErrors = destinationErrors(input.destination)
  if (fieldErrors) throw new ShopError(422, 'destinationInvalid', fieldErrors)
  const { shipping, payment } = await resolveMethods(deps.em, site, input)
  const rate = yemenZoneRate(settingsOf(shipping.metadata as Record<string, unknown> | null), input.destination)
  if (!rate) throw new ShopError(422, 'destinationNotServed', { shippingMethodId: 'storefront.shop.checkout.errors.notServed' })
  if (rate.currencyCode !== view.currencyCode) throw new ShopError(422, 'shippingUnavailable', { shippingMethodId: 'storefront.shop.checkout.errors.shipping' })

  const currencyCode = view.currencyCode
  const buyable = view.lines.filter((line) => !line.issues.length && line.unitPrice)
  const snapshots = methodSnapshots(shipping, payment, input.destination)
  const calculation = await (deps.container.resolve('salesCalculationService') as SalesCalculationService).calculateDocumentTotals({
    documentKind: 'order',
    lines: buyable.map((line, index) => calculationLine(toSalesLine(line, currencyCode, index + 1))),
    adjustments: [],
    context: { tenantId: site.tenantId, organizationId: site.organizationId, currencyCode, metadata: salesProviderContext(snapshots, currencyCode) },
  })
  const totals = calculation.totals
  // The sales `subtotal` is a running total (items, delivery and fees): the buyer's subtotal is the items alone.
  const itemsTotal = calculation.lines.reduce((sum, line) => sum + (Number(line.grossAmount) || 0), 0)
  const quote = {
    lines: view.lines,
    currencyCode,
    subtotal: money(itemsTotal, currencyCode),
    shipping: money(totals.shippingGrossAmount, currencyCode),
    fees: money(totals.surchargeTotalAmount, currencyCode),
    discount: money(totals.discountTotalAmount, currencyCode),
    tax: money(totals.taxTotalAmount, currencyCode),
    grandTotal: money(totals.grandTotalGrossAmount, currencyCode),
    blocked: view.lines.some((line) => line.issues.length > 0),
  }
  const fingerprint = {
    lines: view.lines.map((line) => [line.id, line.productId, line.variantId, line.quantity, line.unitPrice?.amount ?? null, line.unitPrice?.currencyCode ?? null, line.issues]),
    totals: [quote.subtotal.amount, quote.shipping.amount, quote.fees.amount, quote.discount.amount, quote.tax.amount, quote.grandTotal.amount, currencyCode],
    methods: [shipping.id, payment.id],
    destination: [input.destination.governorate, input.destination.district],
  }
  return {
    quote: { ...quote, quoteHash: createHash('sha256').update(stableStringify(fingerprint)).digest('hex').slice(0, 32) },
    shipping,
    payment,
    snapshots,
  }
}
