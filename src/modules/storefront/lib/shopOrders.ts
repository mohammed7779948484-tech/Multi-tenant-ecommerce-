import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildShopCommandContext } from '../commands/cart'
import { StorefrontCart, StorefrontOrderAccess } from '../data/entities'
import { buildQuote, methodSnapshots, resolveMethods, toSalesLine, transferTextFrom, type CheckoutDestination, type CheckoutQuote } from './shopCheckout'
import { ShopError, type CartSite } from './shopCart'
import { formatShopPrice } from './shopFormat'
import { findDistrict, findGovernorate } from './yemen'

/**
 * Order placement and guest order access (shopping-journey spec REQ-008,
 * REQ-009, S-7, S-11). Placement locks the cart, prices it again with live
 * stock, and creates the order through the installed `sales.orders.create`
 * command with a system context pinned to the store, so the order is a normal
 * sales order: number, totals, events, staff notification, admin screens.
 *
 * One order per cart: a submit first claims the cart (`placing`, in a short
 * transaction under the cart row lock), creates the order outside any
 * transaction of ours, so the sales command commits and fires its events as
 * it does for staff, then records the access row and marks the cart
 * `converted`. A second submit finds the claim and waits for the first, or the
 * converted cart, and returns the same order; `storefront_order_access.cart_id`
 * unique is the last guard. A claim older than two minutes (a crashed submit)
 * can be taken over. The buyer's access token is derived from the cart token
 * (HMAC), so that replay can hand back the same link without the server
 * keeping the token; only its SHA-256 is stored.
 */

const logger = createLogger('storefront').child({ component: 'shop-orders' })

type Deps = { em: EntityManager; container: AwilixContainer }

export const ORDER_ACCESS_TTL_MS = 90 * 24 * 60 * 60 * 1000

export type CheckoutContact = { name: string; phone: string }
export type PlaceInput = { contact: CheckoutContact; destination: CheckoutDestination; shippingMethodId: string; paymentMethodId: string; quoteHash: string }
export type PlaceResult = { orderId: string; orderNumber: string; token: string; replay: boolean }

/** The buyer's order token for the cart behind `cartToken`: stable, so a repeated submit gets the same link. */
export function orderTokenFor(cartToken: string): string {
  return createHmac('sha256', cartToken).update('storefront-order-access').digest('base64url')
}

export function hashOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** One cookie per order and store, so earlier orders stay reachable from the same browser. */
export function orderCookieName(siteId: string, orderNumber: string): string {
  return `sf_ord_${siteId.replace(/-/g, '').slice(0, 12)}_${createHash('sha256').update(orderNumber).digest('hex').slice(0, 10)}`
}

function scopeOf(site: CartSite) {
  return { tenantId: site.tenantId, organizationId: site.organizationId }
}

async function statusEntryId(em: EntityManager, site: CartSite, dictionaryKey: string, value: string): Promise<string | undefined> {
  const dictionary = await em.findOne(Dictionary, { ...scopeOf(site), key: dictionaryKey, deletedAt: null })
  if (!dictionary) return undefined
  const entry = await em.findOne(DictionaryEntry, { ...scopeOf(site), dictionary: dictionary.id, value })
  return entry?.id
}

/** The sales order input of a priced quote: lines, buyer and address snapshots, methods, initial statuses. */
async function orderInput(em: EntityManager, site: CartSite, cart: StorefrontCart, quote: CheckoutQuote, input: PlaceInput) {
  const { shipping, payment } = await resolveMethods(em, site, input)
  const governorate = findGovernorate(input.destination.governorate)!
  const district = findDistrict(input.destination.governorate, input.destination.district)!
  const { shippingMethodSnapshot, paymentMethodSnapshot } = methodSnapshots(shipping, payment, input.destination)
  const address = {
    name: input.contact.name,
    phone: input.contact.phone,
    addressLine1: input.destination.area,
    addressLine2: input.destination.landmark || null,
    city: district.name,
    region: governorate.name,
    country: 'YE',
    governorateCode: governorate.code,
    districtCode: district.code,
    latitude: input.destination.gps?.latitude ?? null,
    longitude: input.destination.gps?.longitude ?? null,
    deliveryNote: input.destination.note || null,
  }
  const [statusId, paymentStatusId] = await Promise.all([
    statusEntryId(em, site, 'sales.order_status', 'pending_approval'),
    statusEntryId(em, site, 'sales.payment_status', 'pending'),
  ])
  return {
    ...scopeOf(site),
    currencyCode: quote.currencyCode,
    customerSnapshot: { customer: { displayName: input.contact.name, primaryPhone: input.contact.phone }, contact: null, source: 'storefront' },
    shippingAddressSnapshot: address,
    billingAddressSnapshot: address,
    shippingMethodId: shipping.id,
    shippingMethodSnapshot,
    paymentMethodId: payment.id,
    paymentMethodSnapshot,
    ...(statusId ? { statusEntryId: statusId } : {}),
    ...(paymentStatusId ? { paymentStatusEntryId: paymentStatusId } : {}),
    placedAt: new Date(),
    comments: input.destination.note || undefined,
    metadata: { storefront: { siteId: site.id, cartId: cart.id, quoteHash: quote.quoteHash } },
    lines: quote.lines.map((line, index) => ({
      ...toSalesLine(line, quote.currencyCode, index + 1),
      configuration: { storefront: { personalization: line.personalization.filter((field) => field.value).map(({ code, label, value }) => ({ code, label, value })) } },
    })),
  }
}

async function findAccessByCart(em: EntityManager, site: CartSite, cartId: string) {
  return em.findOne(StorefrontOrderAccess, { ...scopeOf(site), siteId: site.id, cartId })
}

/** A claim this old belongs to a submit that died; another submit may take it over. */
export const PLACING_CLAIM_TTL_MS = 2 * 60 * 1000
const REPLAY_WAIT_MS = 15_000
const REPLAY_POLL_MS = 250

type Claim = { kind: 'claimed'; cartId: string } | { kind: 'replay'; access: StorefrontOrderAccess } | { kind: 'busy'; cartId: string }

async function claimCart(em: EntityManager, site: CartSite, tokenHash: string): Promise<Claim> {
  return em.transactional(async (tem) => {
    const cart = await tem.findOne(StorefrontCart, { tokenHash, siteId: site.id, ...scopeOf(site) }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!cart) throw new ShopError(422, 'cartEmpty')
    if (cart.status === 'converted') {
      const access = await findAccessByCart(tem, site, cart.id)
      if (!access) throw new ShopError(422, 'cartEmpty')
      return { kind: 'replay', access }
    }
    const now = Date.now()
    if (cart.status === 'placing' && now - cart.updatedAt.getTime() < PLACING_CLAIM_TTL_MS) return { kind: 'busy', cartId: cart.id }
    if (cart.expiresAt.getTime() <= now) throw new ShopError(422, 'cartEmpty')
    cart.status = 'placing'
    cart.updatedAt = new Date(now)
    await tem.flush()
    return { kind: 'claimed', cartId: cart.id }
  })
}

/** Gives a claimed cart back to the buyer when its order was not created. */
async function releaseClaim(em: EntityManager, site: CartSite, cartId: string) {
  await em.nativeUpdate(StorefrontCart, { id: cartId, ...scopeOf(site), status: 'placing' }, { status: 'active', updatedAt: new Date() })
}

/** Waits for another submit of the same cart to finish, then answers with its order. */
async function awaitOtherSubmit(em: EntityManager, site: CartSite, cartId: string): Promise<StorefrontOrderAccess> {
  const deadline = Date.now() + REPLAY_WAIT_MS
  while (Date.now() < deadline) {
    const access = await findAccessByCart(em.fork(), site, cartId)
    if (access) return access
    const cart = await em.fork().findOne(StorefrontCart, { id: cartId, ...scopeOf(site) }, { fields: ['status'] })
    // The other submit gave the cart back (a changed quote, a failure): this one starts over.
    if (cart?.status === 'active') throw new ShopError(409, 'orderInProgress')
    await new Promise((resolve) => setTimeout(resolve, REPLAY_POLL_MS))
  }
  throw new ShopError(409, 'orderInProgress')
}

/**
 * Places the order for the cart behind `cartToken`. A repeated submit returns
 * the same order (`replay`). A quote that no longer matches (price, stock,
 * methods or a line that can no longer be bought) answers 409 with the new
 * quote, and nothing is created.
 */
export async function placeOrder(deps: Deps, site: CartSite, cartToken: string, input: PlaceInput): Promise<PlaceResult> {
  const tokenHash = createHash('sha256').update(cartToken).digest('hex')
  const token = orderTokenFor(cartToken)
  const claim = await claimCart(deps.em.fork(), site, tokenHash)
  if (claim.kind !== 'claimed') {
    const access = claim.kind === 'replay' ? claim.access : await awaitOtherSubmit(deps.em, site, claim.cartId)
    return { orderId: access.orderId, orderNumber: access.orderNumber, token, replay: true }
  }

  const em = deps.em.fork()
  let orderId: string | null = null
  try {
    const cart = await em.findOneOrFail(StorefrontCart, { id: claim.cartId, ...scopeOf(site) })
    const quote = await buildQuote({ ...deps, em: em.fork() }, site, cart, input, { bypassCache: true })
    if (quote.blocked || quote.quoteHash !== input.quoteHash) throw new ShopError(409, 'quoteChanged', undefined, { quote })

    const commandBus = deps.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, { orderId: string }>('sales.orders.create', {
      input: await orderInput(em, site, cart, quote, input),
      ctx: buildShopCommandContext(deps.container, site),
    })
    orderId = result.orderId
    const order = await findOneWithDecryption(em.fork(), SalesOrder, { id: result.orderId, ...scopeOf(site) }, undefined, scopeOf(site))
    if (!order) throw new Error('[internal] created order not found')
    if (Number(order.grandTotalGrossAmount) !== quote.grandTotal.amount) {
      logger.warn('Order total differs from the checkout quote', { orderId: order.id, siteId: site.id })
    }
    await em.fork().transactional(async (tem) => {
      tem.create(StorefrontOrderAccess, {
        ...scopeOf(site),
        siteId: site.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        tokenHash: hashOrderToken(token),
        cartId: claim.cartId,
        createdAt: new Date(),
      })
      await tem.nativeUpdate(StorefrontCart, { id: claim.cartId, ...scopeOf(site) }, { status: 'converted', convertedOrderId: order.id, updatedAt: new Date() })
    })
    return { orderId: order.id, orderNumber: order.orderNumber, token, replay: false }
  } catch (err) {
    if (orderId) {
      // The order exists but its access key could not be recorded: keep the claim (no second order) and say which order.
      logger.error('Order placed but its buyer access was not recorded', { err, orderId, siteId: site.id, cartId: claim.cartId })
    } else {
      await releaseClaim(deps.em.fork(), site, claim.cartId).catch((releaseErr: unknown) => logger.warn('Releasing a checkout claim failed', { err: releaseErr, cartId: claim.cartId }))
    }
    throw err
  }
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The order behind a number and token in this store, or `null` (unknown number, wrong token, another store). */
export async function findOrderAccess(em: EntityManager, site: CartSite, orderNumber: string, token: string | null): Promise<StorefrontOrderAccess | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || orderNumber.length > 191) return null
  const access = await em.findOne(StorefrontOrderAccess, { ...scopeOf(site), siteId: site.id, orderNumber })
  return access && sameHash(access.tokenHash, hashOrderToken(token)) ? access : null
}

type Money = { amount: number; formatted: string }

export type OrderView = {
  orderNumber: string
  placedAt: string | null
  /** Status values from the sales dictionaries; the page labels known ones in Arabic. */
  status: string | null
  paymentStatus: string | null
  currencyCode: string
  lines: Array<{ id: string; name: string; variant: string | null; personalization: string | null; quantity: number; unitPrice: Money; total: Money }>
  totals: { subtotal: Money; shipping: Money; fees: Money; discount: Money; tax: Money; grandTotal: Money }
  contact: { name: string | null; phone: string | null }
  address: { governorate: string | null; district: string | null; area: string | null; landmark: string | null; note: string | null; gps: { latitude: number; longitude: number } | null }
  shippingMethod: string | null
  payment: { name: string | null; kind: 'cod' | 'transfer' | 'other'; instructions: string | null; accountNumber: string | null }
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** What the tracking page shows for an order the buyer holds a key to. */
export async function loadOrderView(em: EntityManager, site: CartSite, access: StorefrontOrderAccess): Promise<OrderView | null> {
  const scope = scopeOf(site)
  const order = await findOneWithDecryption(em, SalesOrder, { id: access.orderId, ...scope, deletedAt: null }, undefined, scope)
  if (!order) return null
  const lines = await findWithDecryption(em, SalesOrderLine, { order: order.id, ...scope, deletedAt: null }, { orderBy: { lineNumber: 'asc' } }, scope)
  const currencyCode = order.currencyCode
  const money = (value: unknown): Money => {
    const amount = Number(value ?? 0)
    return { amount, formatted: formatShopPrice(amount, currencyCode) ?? String(amount) }
  }
  const address = (order.shippingAddressSnapshot ?? {}) as Record<string, unknown>
  const customer = ((order.customerSnapshot ?? {}) as { customer?: Record<string, unknown> }).customer ?? {}
  const payment = (order.paymentMethodSnapshot ?? {}) as Record<string, unknown>
  const shipping = (order.shippingMethodSnapshot ?? {}) as Record<string, unknown>
  const paymentKind = payment.providerKey === 'wire-transfer' ? 'transfer' : payment.providerKey === 'cash-on-delivery' ? 'cod' : 'other'
  const settings = (payment.providerSettings && typeof payment.providerSettings === 'object' ? payment.providerSettings : {}) as Record<string, unknown>
  const transfer = paymentKind === 'transfer' ? transferTextFrom(settings) : null
  const latitude = num(address.latitude)
  const longitude = num(address.longitude)
  return {
    orderNumber: order.orderNumber,
    placedAt: (order.placedAt ?? order.createdAt)?.toISOString() ?? null,
    status: order.status ?? null,
    paymentStatus: order.paymentStatus ?? null,
    currencyCode,
    lines: lines.map((line) => ({
      id: line.id,
      name: line.name ?? '',
      variant: line.description ?? null,
      personalization: line.comment ?? null,
      quantity: Number(line.quantity),
      unitPrice: money(line.unitPriceGross),
      total: money(line.totalGrossAmount),
    })),
    totals: {
      // The sales subtotal includes delivery and fees; the buyer's subtotal is the lines alone.
      subtotal: money(lines.reduce((sum, line) => sum + Number(line.totalGrossAmount ?? 0), 0)),
      shipping: money(order.shippingGrossAmount),
      fees: money(order.surchargeTotalAmount),
      discount: money(order.discountTotalAmount),
      tax: money(order.taxTotalAmount),
      grandTotal: money(order.grandTotalGrossAmount),
    },
    contact: { name: text(customer.displayName), phone: text(customer.primaryPhone) },
    address: {
      governorate: text(address.region),
      district: text(address.city),
      area: text(address.addressLine1),
      landmark: text(address.addressLine2),
      note: text(address.deliveryNote),
      gps: latitude !== null && longitude !== null ? { latitude, longitude } : null,
    },
    shippingMethod: text(shipping.name),
    payment: {
      name: text(payment.name),
      kind: paymentKind,
      instructions: transfer?.instructions ?? null,
      accountNumber: transfer?.accountNumber ?? null,
    },
  }
}
