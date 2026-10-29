import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import { resolveStatusEntryIdByValue } from '@open-mercato/core/modules/sales/lib/statusHelpers'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildShopCommandContext } from '../commands/cart'
import { StorefrontCart, StorefrontOrderAccess } from '../data/entities'
import { priceCart, toSalesLine, transferTextFrom, type CheckoutDestination, type CheckoutQuote, type PricedCart } from './shopCheckout'
import { ShopError, type CartSite } from './shopCart'
import { formatShopPrice } from './shopFormat'
import { proofAllowed } from './shopProof'
import { findDistrict, findGovernorate } from './yemen'

/**
 * Order placement and guest order access (shopping-journey spec REQ-008,
 * REQ-009, S-7, S-11). Placement prices the cart again with live stock and
 * creates the order through the installed `sales.orders.create` command with a
 * system context pinned to the store, so the order is a normal sales order:
 * number, totals, events, staff notification, admin screens.
 *
 * One order per cart:
 * - Each submit holds a database lock for its cart (a Postgres advisory lock in
 *   a transaction of its own, on its own connection) from start to finish. A
 *   second submit of the same cart waits for it, then finds the order; the lock
 *   ends with the submit's connection, so a crashed submit never blocks the
 *   cart and never leaves a claim another submit must guess about.
 * - Under the lock, a cart that already has an order (saved on the cart, or
 *   found by the order's plain `externalReference`) is finished, never placed
 *   again: the access row is written and the cart closed.
 * - The order is created outside any transaction of ours (L22), then the
 *   access row is recorded. When that fails, or the command fails after its
 *   own commit, the same request looks the order up and finishes it.
 * The buyer's access token is derived from the cart token (HMAC), so a replay
 * hands back the same link without the server keeping the token; only its
 * SHA-256 is stored.
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

/**
 * The entry id of a sales status value, matched the way the sales module
 * matches it (normalized value). A store without the dictionary or the entry
 * still gets its order, without that status, and the gap is logged for staff.
 */
async function statusEntryId(em: EntityManager, site: CartSite, dictionaryKey: 'sales.order_status' | 'sales.payment_status', value: string): Promise<string | undefined> {
  let id: string | null = null
  if (dictionaryKey === 'sales.order_status') {
    id = await resolveStatusEntryIdByValue(em, { ...scopeOf(site), value })
  } else {
    const dictionary = await em.findOne(Dictionary, { ...scopeOf(site), key: dictionaryKey, deletedAt: null })
    const entry = dictionary ? await em.findOne(DictionaryEntry, { ...scopeOf(site), dictionary: dictionary.id, normalizedValue: normalizeDictionaryValue(value) }) : null
    id = entry?.id ?? null
  }
  if (!id) logger.warn('Sales status entry missing; the order is placed without it', { dictionaryKey, value, siteId: site.id, ...scopeOf(site) })
  return id ?? undefined
}

/** The sales order input of a priced cart: lines, buyer and address snapshots, the methods it was priced with, initial statuses. */
async function orderInput(em: EntityManager, site: CartSite, cart: StorefrontCart, priced: PricedCart, input: PlaceInput) {
  const { quote, shipping, payment, snapshots } = priced
  const governorate = findGovernorate(input.destination.governorate)!
  const district = findDistrict(input.destination.governorate, input.destination.district)!
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
    statusEntryId(em.fork(), site, 'sales.payment_status', 'pending'),
  ])
  return {
    ...scopeOf(site),
    currencyCode: quote.currencyCode,
    customerSnapshot: { customer: { displayName: input.contact.name, primaryPhone: input.contact.phone }, contact: null, source: 'storefront' },
    shippingAddressSnapshot: address,
    billingAddressSnapshot: address,
    shippingMethodId: shipping.id,
    shippingMethodSnapshot: snapshots.shippingMethodSnapshot,
    paymentMethodId: payment.id,
    paymentMethodSnapshot: snapshots.paymentMethodSnapshot,
    ...(statusId ? { statusEntryId: statusId } : {}),
    ...(paymentStatusId ? { paymentStatusEntryId: paymentStatusId } : {}),
    placedAt: new Date(),
    comments: input.destination.note || undefined,
    // Plain (unencrypted) and unique per cart: a later submit finds this order even if nothing after the create was saved.
    externalReference: orderReferenceFor(cart.id),
    metadata: { storefront: { siteId: site.id, cartId: cart.id, quoteHash: quote.quoteHash } },
    lines: quote.lines.map((line, index) => ({
      ...toSalesLine(line, quote.currencyCode, index + 1),
      configuration: { storefront: { personalization: line.personalization.filter((field) => field.value).map(({ code, label, value }) => ({ code, label, value })) } },
    })),
  }
}

/** The sales order's external reference for the order of a storefront cart. */
export function orderReferenceFor(cartId: string): string {
  return `storefront-cart:${cartId}`
}

/** The advisory-lock key of one cart's placement (also used by the regression test that holds it). */
export function placementLockKey(siteId: string, cartTokenHash: string): string {
  return `storefront-place:${siteId}:${cartTokenHash}`
}

async function findAccessByCart(em: EntityManager, site: CartSite, cartId: string) {
  return em.findOne(StorefrontOrderAccess, { ...scopeOf(site), siteId: site.id, cartId })
}

/** How long a submit waits for another submit of the same cart before answering 409 `orderInProgress`. */
export const PLACEMENT_WAIT_MS = 15_000
/** How often the lock's own transaction runs a statement, so the database's idle-in-transaction timeout never ends it. */
const LOCK_KEEPALIVE_MS = 20_000

/** How often a waiting submit tries the lock again; it holds no database connection in between. */
const LOCK_RETRY_MS = 250

/**
 * Runs `work` while holding the placement lock of one cart. The lock lives in a
 * transaction bound to a manager of its own (its own connection), which no
 * other manager joins, so the work's own reads, writes and the sales command
 * run as usual. It is released when the work ends, or by the database when
 * the process dies. A submit that finds the lock taken gives its connection
 * back and tries again for up to `PLACEMENT_WAIT_MS`, so waiting buyers never
 * pile up on the connection pool.
 */
async function withPlacementLock<T>(em: EntityManager, key: string, work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + PLACEMENT_WAIT_MS
  const lockEm = em.fork()
  for (;;) {
    await lockEm.begin()
    let locked = false
    try {
      const rows = (await lockEm.execute('select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as locked', [key])) as Array<{ locked: boolean }>
      locked = rows[0]?.locked === true
    } finally {
      if (!locked) await lockEm.rollback().catch(() => undefined)
    }
    if (locked) break
    // Another submit of this cart is still running.
    if (Date.now() >= deadline) throw new ShopError(409, 'orderInProgress')
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
  }
  const keepalive = setInterval(() => {
    lockEm.execute('select 1').catch((err: unknown) => logger.warn('Keeping a placement lock alive failed', { err }))
  }, LOCK_KEEPALIVE_MS)
  try {
    return await work()
  } finally {
    clearInterval(keepalive)
    // Ending the transaction releases the lock; a failure here means the connection is gone, which releases it too.
    await lockEm.rollback().catch((err: unknown) => logger.warn('Releasing a placement lock failed', { err }))
  }
}

type Claim = { kind: 'claimed'; cartId: string } | { kind: 'replay'; access: StorefrontOrderAccess }

/**
 * Under the placement lock: the cart's existing order (replay), or the cart
 * claimed (`placing`, so cart edits wait) for a new one. No other submit of
 * this cart runs now, so a `placing` cart is one an earlier submit left
 * unfinished: it is finished when its order exists, and placed otherwise.
 */
async function claimCart(em: EntityManager, site: CartSite, tokenHash: string, orderTokenHash: string): Promise<Claim> {
  return em.transactional(async (tem) => {
    const cart = await tem.findOne(StorefrontCart, { tokenHash, siteId: site.id, ...scopeOf(site) }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!cart) throw new ShopError(422, 'cartEmpty')
    if (cart.status === 'converted') {
      const access = await findAccessByCart(tem, site, cart.id)
      if (!access) throw new ShopError(422, 'cartEmpty')
      return { kind: 'replay', access }
    }
    // An earlier submit may have created the order without finishing (a failed write, a crash):
    // finish that order now, found by its saved id or its reference, and never place a second one.
    const access = await recordOrderAccess(tem, site, cart, orderTokenHash, cart.convertedOrderId ?? null)
    if (access) return { kind: 'replay', access }
    // No order exists for this cart (or the merchant removed it): the cart may be placed.
    const now = Date.now()
    cart.convertedOrderId = null
    if (cart.expiresAt.getTime() <= now) throw new ShopError(422, 'cartEmpty')
    cart.status = 'placing'
    cart.updatedAt = new Date(now)
    await tem.flush()
    return { kind: 'claimed', cartId: cart.id }
  })
}

/**
 * Records the buyer's access to the cart's order and closes the cart, inside a
 * transaction that holds the cart row lock. The order is found by `orderId`, or
 * by the cart's order reference when no id was saved. Returns `null` when the
 * cart has no order.
 */
async function recordOrderAccess(tem: EntityManager, site: CartSite, cart: StorefrontCart, orderTokenHash: string, orderId: string | null): Promise<StorefrontOrderAccess | null> {
  const existing = await findAccessByCart(tem, site, cart.id)
  const where = orderId ? { id: orderId, ...scopeOf(site) } : { externalReference: orderReferenceFor(cart.id), ...scopeOf(site), deletedAt: null }
  const order = existing ? null : await findOneWithDecryption(tem, SalesOrder, where, { fields: ['id', 'orderNumber'] }, scopeOf(site))
  if (!existing && !order) return null
  const access =
    existing ??
    tem.create(StorefrontOrderAccess, {
      ...scopeOf(site),
      siteId: site.id,
      orderId: order!.id,
      orderNumber: order!.orderNumber,
      tokenHash: orderTokenHash,
      cartId: cart.id,
      createdAt: new Date(),
    })
  cart.status = 'converted'
  cart.convertedOrderId = access.orderId
  cart.updatedAt = new Date()
  await tem.flush()
  return access
}

/** After a create: records the cart's order (by id, else by reference) under the cart row lock; `null` when it has none. */
async function finishCartOrder(em: EntityManager, site: CartSite, cartId: string, orderTokenHash: string, orderId: string | null) {
  return em.fork().transactional(async (tem) => {
    const locked = await tem.findOneOrFail(StorefrontCart, { id: cartId, ...scopeOf(site) }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (locked.status === 'converted') return findAccessByCart(tem, site, cartId)
    return recordOrderAccess(tem, site, locked, orderTokenHash, orderId)
  })
}

/** Gives a claimed cart back to the buyer when it has no order. */
async function releaseClaim(em: EntityManager, site: CartSite, cartId: string) {
  await em.nativeUpdate(StorefrontCart, { id: cartId, ...scopeOf(site), status: 'placing', convertedOrderId: null }, { status: 'active', updatedAt: new Date() })
}

/**
 * Places the order for the cart behind `cartToken`. A repeated submit returns
 * the same order (`replay`). A quote that no longer matches (price, stock,
 * methods or a line that can no longer be bought) answers 409 with the new
 * quote, and nothing is created; stock that cannot be checked answers 503.
 */
export async function placeOrder(deps: Deps, site: CartSite, cartToken: string, input: PlaceInput): Promise<PlaceResult> {
  const tokenHash = createHash('sha256').update(cartToken).digest('hex')
  const token = orderTokenFor(cartToken)
  const orderTokenHash = hashOrderToken(token)
  return withPlacementLock(deps.em, placementLockKey(site.id, tokenHash), async () => {
    const claim = await claimCart(deps.em.fork(), site, tokenHash, orderTokenHash)
    if (claim.kind === 'replay') return { orderId: claim.access.orderId, orderNumber: claim.access.orderNumber, token, replay: true }

    const em = deps.em.fork()
    let createStarted = false
    let orderId: string | null = null
    try {
      const cart = await em.findOneOrFail(StorefrontCart, { id: claim.cartId, ...scopeOf(site) })
      const priced = await priceCart({ ...deps, em: em.fork() }, site, cart, input, { bypassCache: true, strictStock: true })
      if (priced.quote.blocked || priced.quote.quoteHash !== input.quoteHash) throw new ShopError(409, 'quoteChanged', undefined, { quote: priced.quote })

      const commandBus = deps.container.resolve('commandBus') as CommandBus
      const orderData = await orderInput(em, site, cart, priced, input)
      createStarted = true
      const { result } = await commandBus.execute<Record<string, unknown>, { orderId: string }>('sales.orders.create', {
        input: orderData,
        ctx: buildShopCommandContext(deps.container, site),
      })
      orderId = result.orderId
      // First thing after the create: a later submit finds this order instead of placing another.
      await deps.em.fork().nativeUpdate(StorefrontCart, { id: claim.cartId, ...scopeOf(site), status: 'placing' }, { convertedOrderId: orderId, updatedAt: new Date() })
      const access = await finishCartOrder(deps.em, site, claim.cartId, orderTokenHash, orderId)
      if (!access) throw new Error('[internal] created order not found')
      await checkOrderTotal(em, site, access.orderId, priced.quote)
      return { orderId: access.orderId, orderNumber: access.orderNumber, token, replay: false }
    } catch (err) {
      if (!createStarted) {
        await releaseClaim(deps.em.fork(), site, claim.cartId).catch((releaseErr: unknown) => logger.warn('Releasing a checkout claim failed', { err: releaseErr, cartId: claim.cartId }))
        throw err
      }
      // The order may exist: the command can fail after its own commit (post-commit steps), and the
      // access write can fail after the order was saved. Find it (saved id, else reference) and finish it.
      const access = await finishCartOrder(deps.em, site, claim.cartId, orderTokenHash, orderId).catch((finishErr: unknown) => {
        logger.error('Finishing a placed order failed', { err: finishErr, orderId, siteId: site.id, cartId: claim.cartId })
        return undefined
      })
      if (access) {
        logger.warn('Order placement recovered after a failure', { err, orderId: access.orderId, siteId: site.id, cartId: claim.cartId })
        return { orderId: access.orderId, orderNumber: access.orderNumber, token, replay: false }
      }
      if (access === null) {
        // No order exists: the create failed before committing. The buyer may try again.
        await releaseClaim(deps.em.fork(), site, claim.cartId).catch((releaseErr: unknown) => logger.warn('Releasing a checkout claim failed', { err: releaseErr, cartId: claim.cartId }))
      } else {
        // Unknown (the lookup failed too): keep the claim; the next submit of this cart finds the order or places it.
        logger.error('Order placement left unfinished', { err, orderId, siteId: site.id, cartId: claim.cartId })
      }
      throw err
    }
  })
}

/**
 * The quote and the order are calculated from the same lines and method
 * snapshots, so their totals agree; a difference means the sales calculation
 * changed underneath and is reported for staff with both amounts (no buyer data).
 */
async function checkOrderTotal(em: EntityManager, site: CartSite, orderId: string, quote: CheckoutQuote) {
  try {
    const order = await findOneWithDecryption(em.fork(), SalesOrder, { id: orderId, ...scopeOf(site) }, { fields: ['id', 'grandTotalGrossAmount'] }, scopeOf(site))
    if (order && Number(order.grandTotalGrossAmount) !== quote.grandTotal.amount) {
      logger.error('Order total differs from the checkout quote', { orderId, siteId: site.id, orderTotal: Number(order.grandTotalGrossAmount), quoteTotal: quote.grandTotal.amount })
    }
  } catch (err) {
    logger.warn('Checking an order total failed', { err, orderId })
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

/**
 * The order behind a confirmation link token or this browser's order cookie,
 * tried in that order, with the token that opened it (for the permalink). A
 * stale or mistyped link token never hides a valid cookie.
 */
export async function resolveOrderAccess(
  em: EntityManager,
  site: CartSite,
  orderNumber: string,
  tokens: { link: string | null; cookie: string | null },
): Promise<{ access: StorefrontOrderAccess; token: string } | null> {
  for (const token of [tokens.link, tokens.cookie]) {
    const access = token ? await findOrderAccess(em, site, orderNumber, token) : null
    if (access && token) return { access, token }
  }
  return null
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
  /** Bank-transfer proof: `open` while one can be sent, `submitted` once sent, `none` for other payments or a settled order. */
  proof: { state: 'open' | 'submitted' | 'none'; submittedAt: string | null }
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
  const proofState = access.proofSubmittedAt ? 'submitted' : proofAllowed(payment, order.paymentStatus ?? null) === 'ok' ? 'open' : 'none'
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
    proof: { state: proofState, submittedAt: access.proofSubmittedAt?.toISOString() ?? null },
  }
}
