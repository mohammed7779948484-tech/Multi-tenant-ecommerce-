import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StorefrontCart, StorefrontCartLine, type StorefrontSite } from '../data/entities'
import { productImages, storeCatalogLinks, type ShopPrice } from './catalogData'
import { storefrontMediaPath } from './mediaUrls'
import { stablePersonalization, validatePersonalization, type PersonalizationError } from './productOptions'
import { isUuid } from './publicCatalog'
import { formatShopPrice } from './shopFormat'
import { loadPurchaseModel, type PurchaseModel, type PurchaseStock } from './shopProduct'

/**
 * The persisted buyer cart (shopping-journey spec REQ-006). One active cart per
 * store and browser, found by the SHA-256 of an opaque cookie token. Lines keep
 * ids, quantity and personalization; every read re-prices them through the
 * pricing engine and re-checks stock, so the cart never shows a stored price.
 * Every query is pinned to the store's tenant, organization and site; a line or
 * cart of another store is indistinguishable from an unknown id.
 */

export const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_CART_LINES = 50
export const MAX_LINE_QUANTITY = 99
const PURGE_BATCH = 50

export type CartSite = Pick<StorefrontSite, 'id' | 'slug' | 'tenantId' | 'organizationId'>
type Deps = { em: EntityManager; container: AwilixContainer }

/** A buyer-facing refusal: status, a stable code (translated by the route) and optional field errors. */
export class ShopError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(code)
  }
}

export function newCartToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashCartToken(token) }
}

export function hashCartToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Per-store cookie, so one store's cart never reaches another. */
export function cartCookieName(siteId: string): string {
  return `sf_cart_${siteId.replace(/-/g, '').slice(0, 12)}`
}

function scopeOf(site: CartSite) {
  return { tenantId: site.tenantId, organizationId: site.organizationId }
}

/**
 * The active cart behind a token. `lock` (inside a transaction) takes the cart
 * row `FOR UPDATE`, so writes to one cart run one after another: two taps on
 * "add" both count, and an edit sees the quantity the previous write left.
 */
export async function findActiveCart(em: EntityManager, site: CartSite, tokenHash: string | null, now = new Date(), options: { lock?: boolean } = {}): Promise<StorefrontCart | null> {
  if (!tokenHash) return null
  return em.findOne(
    StorefrontCart,
    { tokenHash, siteId: site.id, ...scopeOf(site), status: 'active', expiresAt: { $gt: now } },
    options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
  )
}

function lineKeyOf(productId: string, variantId: string | null, personalization: Record<string, string>): string {
  return createHash('sha256').update(`${productId}|${variantId ?? ''}|${stablePersonalization(personalization)}`).digest('hex')
}

const PERSONALIZATION_ERROR: Record<PersonalizationError, string> = {
  required: 'storefront.shop.errors.fieldRequired',
  tooLong: 'storefront.shop.errors.fieldTooLong',
  notNumber: 'storefront.shop.errors.fieldNumber',
  unknown: 'storefront.shop.errors.fieldUnknown',
}

type Purchasable = { product: CatalogProduct; variantId: string | null; personalization: Record<string, string>; price: ShopPrice; stock: PurchaseStock | null }

/** The product, variant and personalization the buyer asked for, re-validated against the live catalog. */
async function resolvePurchasable(deps: Deps, site: CartSite, input: { productId: string; variantId?: string | null; personalization?: unknown }, quantity: number): Promise<Purchasable> {
  const scope = scopeOf(site)
  const [product] = isUuid(input.productId)
    ? await findWithDecryption(deps.em, CatalogProduct, { id: input.productId, ...scope, deletedAt: null, isActive: true }, undefined, scope)
    : []
  if (!product) throw new ShopError(404, 'productNotFound')
  const model = await loadPurchaseModel(deps, scope, product)
  let variantId: string | null
  let price: ShopPrice | null
  let stock: PurchaseStock | null
  if (model.configurable) {
    if (!input.variantId) throw new ShopError(422, 'variantRequired')
    const variant = model.variants.find((row) => row.id === input.variantId)
    if (!variant) throw new ShopError(422, 'variantUnavailable')
    ;({ id: variantId, price, stock } = variant)
  } else {
    if (input.variantId && input.variantId !== model.base.variantId) throw new ShopError(422, 'variantUnavailable')
    ;({ variantId, price, stock } = model.base)
  }
  const personalization = validatePersonalization(model.fields, input.personalization ?? {})
  if (!personalization.ok) {
    const fieldErrors = Object.fromEntries(Object.entries(personalization.errors).map(([code, error]) => [`personalization.${code}`, PERSONALIZATION_ERROR[error]]))
    throw new ShopError(422, 'personalizationInvalid', fieldErrors)
  }
  if (model.quoteOnly || !price) throw new ShopError(422, 'noPrice')
  if (stock && (!stock.canFulfil || exceedsStock(stock, quantity))) throw new ShopError(422, 'unavailable')
  return { product, variantId, personalization: personalization.value, price, stock }
}

/** True when stock is tracked and `quantity` units are more than it has. */
function exceedsStock(stock: PurchaseStock | null, quantity: number): boolean {
  return stock !== null && stock.available !== null && quantity > stock.available
}

/** Each new cart deletes at most a batch of this store's expired carts (no scheduler needed). */
async function purgeExpiredCarts(em: EntityManager, site: CartSite, now: Date) {
  const expired = await em.find(StorefrontCart, { siteId: site.id, ...scopeOf(site), expiresAt: { $lt: now } }, { fields: ['id'], limit: PURGE_BATCH })
  if (!expired.length) return
  const ids = expired.map((cart) => cart.id)
  await em.nativeDelete(StorefrontCartLine, { cartId: { $in: ids }, ...scopeOf(site) })
  await em.nativeDelete(StorefrontCart, { id: { $in: ids }, ...scopeOf(site) })
}

function touch(cart: StorefrontCart, now: Date) {
  cart.expiresAt = new Date(now.getTime() + CART_TTL_MS)
  cart.updatedAt = now
}

/** Adds a line (or more of the same line) to the cart behind `tokenHash`, creating the cart when there is none. */
export async function addCartLine(
  deps: Deps,
  site: CartSite,
  tokenHash: string,
  input: { productId: string; variantId?: string | null; quantity: number; personalization?: unknown },
): Promise<{ cartId: string; created: boolean }> {
  const purchasable = await resolvePurchasable(deps, site, input, input.quantity)
  try {
    return await writeLine(deps.em, site, tokenHash, input.quantity, purchasable)
  } catch (err) {
    // A simultaneous add of the same line (double tap) inserted it first: once more merges into it.
    if (!(err instanceof UniqueConstraintViolationException)) throw err
    return writeLine(deps.em.fork(), site, tokenHash, input.quantity, purchasable)
  }
}

async function writeLine(rootEm: EntityManager, site: CartSite, tokenHash: string, addQuantity: number, purchasable: Purchasable) {
  return rootEm.transactional(async (em) => {
    const now = new Date()
    let cart = await findActiveCart(em, site, tokenHash, now, { lock: true })
    const created = !cart
    const lines = cart ? await findWithDecryption(em, StorefrontCartLine, { cartId: cart.id, ...scopeOf(site) }, undefined, scopeOf(site)) : []
    if (cart?.currencyCode && lines.length && cart.currencyCode !== purchasable.price.currencyCode) throw new ShopError(422, 'currencyMismatch')
    const lineKey = lineKeyOf(purchasable.product.id, purchasable.variantId, purchasable.personalization)
    const existing = lines.find((line) => line.lineKey === lineKey)
    const quantity = (existing?.quantity ?? 0) + addQuantity
    if (quantity > MAX_LINE_QUANTITY) throw new ShopError(422, 'quantityLimit')
    if (exceedsStock(purchasable.stock, quantity)) throw new ShopError(422, 'unavailable')
    if (!existing && lines.length >= MAX_CART_LINES) throw new ShopError(422, 'lineLimit')
    if (!cart) {
      await purgeExpiredCarts(em, site, now)
      cart = em.create(StorefrontCart, { id: randomUUID(), ...scopeOf(site), siteId: site.id, tokenHash, status: 'active', expiresAt: now, createdAt: now, updatedAt: now })
    }
    cart.currencyCode = purchasable.price.currencyCode
    touch(cart, now)
    if (existing) {
      existing.quantity = quantity
      existing.updatedAt = now
    } else {
      em.create(StorefrontCartLine, {
        ...scopeOf(site),
        cartId: cart.id,
        productId: purchasable.product.id,
        variantId: purchasable.variantId,
        quantity,
        personalization: purchasable.personalization,
        lineKey,
        createdAt: now,
        updatedAt: now,
      })
    }
    await em.flush()
    return { cartId: cart.id, created }
  })
}

async function lineOf(em: EntityManager, site: CartSite, tokenHash: string | null, lineId: string, now: Date) {
  const cart = await findActiveCart(em, site, tokenHash, now, { lock: true })
  const line = cart && isUuid(lineId) ? await findOneWithDecryption(em, StorefrontCartLine, { id: lineId, cartId: cart.id, ...scopeOf(site) }, undefined, scopeOf(site)) : null
  // Another browser's or another store's line answers like an unknown one.
  if (!cart || !line) throw new ShopError(404, 'lineNotFound')
  return { cart, line }
}

/**
 * Changes a line's quantity and/or personalization; an edit that makes it equal
 * to another line merges them. The line is read under the cart lock and the
 * final quantity (merged lines included) is checked against stock.
 */
export async function updateCartLine(deps: Deps, site: CartSite, tokenHash: string | null, lineId: string, input: { quantity?: number; personalization?: unknown }) {
  return deps.em.transactional(async (em) => {
    const now = new Date()
    const { cart, line } = await lineOf(em, site, tokenHash, lineId, now)
    const quantity = input.quantity ?? line.quantity
    const purchasable = await resolvePurchasable(
      { ...deps, em },
      site,
      { productId: line.productId, variantId: line.variantId, personalization: input.personalization ?? line.personalization },
      quantity,
    )
    const lineKey = lineKeyOf(line.productId, line.variantId ?? null, purchasable.personalization)
    const twin = lineKey === line.lineKey ? null : await findOneWithDecryption(em, StorefrontCartLine, { cartId: cart.id, lineKey, ...scopeOf(site) }, undefined, scopeOf(site))
    const merged = quantity + (twin?.quantity ?? 0)
    if (merged > MAX_LINE_QUANTITY) throw new ShopError(422, 'quantityLimit')
    if (exceedsStock(purchasable.stock, merged)) throw new ShopError(422, 'unavailable')
    if (twin) {
      twin.quantity = merged
      twin.updatedAt = now
      em.remove(line)
    } else {
      line.quantity = quantity
      line.personalization = purchasable.personalization
      line.lineKey = lineKey
      line.updatedAt = now
    }
    touch(cart, now)
    await em.flush()
    return { cartId: cart.id }
  })
}

export async function removeCartLine(deps: Deps, site: CartSite, tokenHash: string | null, lineId: string) {
  return deps.em.transactional(async (em) => {
    const now = new Date()
    const { cart, line } = await lineOf(em, site, tokenHash, lineId, now)
    em.remove(line)
    const left = await em.count(StorefrontCartLine, { cartId: cart.id, ...scopeOf(site), id: { $ne: line.id } })
    if (!left) cart.currencyCode = null
    touch(cart, now)
    await em.flush()
    return { cartId: cart.id }
  })
}

export type CartLineIssue = 'unavailable' | 'noPrice' | 'outOfStock' | 'currency'

export type CartLineView = {
  id: string
  productId: string
  variantId: string | null
  /** `null` once the product is gone from the catalog. */
  title: string | null
  href: string | null
  image: string | null
  /** Chosen options as text: "كبير · ذهبي". */
  variantLabel: string | null
  personalization: Array<{ code: string; label: string; value: string; inputType: 'text' | 'textarea' | 'number'; required: boolean }>
  quantity: number
  unitPrice: ShopPrice | null
  lineTotal: ShopPrice | null
  maxQuantity: number
  issues: CartLineIssue[]
}

export type CartView = {
  lines: CartLineView[]
  /** Lines that can be bought, priced now. */
  subtotal: ShopPrice | null
  currencyCode: string | null
  /** Units in the cart (the header badge). */
  count: number
  updatedAt: string | null
}

export const EMPTY_CART: CartView = { lines: [], subtotal: null, currencyCode: null, count: 0, updatedAt: null }

function money(amount: number, currencyCode: string): ShopPrice | null {
  const formatted = formatShopPrice(amount, currencyCode)
  return formatted ? { amount, currencyCode, formatted } : null
}

/** The cart as the buyer sees it now: live prices, stock and labels; problems per line instead of failures. */
export async function buildCartView(deps: Deps, site: CartSite, cart: StorefrontCart | null): Promise<CartView> {
  if (!cart) return EMPTY_CART
  const scope = scopeOf(site)
  const lines = await findWithDecryption(deps.em, StorefrontCartLine, { cartId: cart.id, ...scope }, { orderBy: { createdAt: 'asc' } }, scope)
  if (!lines.length) return { ...EMPTY_CART, updatedAt: cart.updatedAt.toISOString() }
  const productIds = [...new Set(lines.map((line) => line.productId))]
  const products = new Map(
    (await findWithDecryption(deps.em, CatalogProduct, { id: { $in: productIds }, ...scope, deletedAt: null }, undefined, scope)).map((product) => [product.id, product]),
  )
  // One purchase model per product and line quantity (quantity tiers), loaded side by side on forked managers.
  const modelKey = (productId: string, quantity: number) => `${productId}|${quantity}`
  const wanted = [...new Map(lines.filter((line) => products.get(line.productId)?.isActive).map((line) => [modelKey(line.productId, line.quantity), line])).values()]
  const models = new Map<string, PurchaseModel>(
    await Promise.all(
      wanted.map(async (line) => {
        const model = await loadPurchaseModel({ ...deps, em: deps.em.fork() }, scope, products.get(line.productId)!, { quantity: line.quantity })
        return [modelKey(line.productId, line.quantity), model] as const
      }),
    ),
  )
  const images = await productImages(deps.em, scope, [...products.values()])
  const links = storeCatalogLinks(`/${site.slug}`)

  let subtotal = 0
  let count = 0
  const views = lines.map((line): CartLineView => {
    const product = products.get(line.productId)
    const model = models.get(modelKey(line.productId, line.quantity))
    const issues: CartLineIssue[] = []
    const variant = model?.configurable ? model.variants.find((row) => row.id === line.variantId) : null
    const target = model ? (model.configurable ? variant : line.variantId === model.base.variantId ? model.base : null) : null
    if (!model || !target) issues.push('unavailable')
    const price = target?.price ?? null
    if (target && !price) issues.push('noPrice')
    if (target?.stock && (!target.stock.canFulfil || (target.stock.available !== null && line.quantity > target.stock.available))) issues.push('outOfStock')
    if (price && cart.currencyCode && price.currencyCode !== cart.currencyCode) issues.push('currency')
    const lineTotal = price ? money(price.amount * line.quantity, price.currencyCode) : null
    if (!issues.length && lineTotal) subtotal += lineTotal.amount
    count += line.quantity
    const image = product ? images.get(product.id) : undefined
    return {
      id: line.id,
      productId: line.productId,
      variantId: line.variantId ?? null,
      title: product?.title ?? null,
      href: product?.isActive ? links.product(product) : null,
      image: image ? storefrontMediaPath(site.slug, image.attachmentId, 320) : null,
      variantLabel: variant && model ? model.axes.map((axis) => axis.choices.find((choice) => choice.code === variant.values[axis.code])?.label).filter(Boolean).join(' · ') || null : null,
      // Every field, blank ones included, so the buyer can fill an optional one in later.
      personalization: (model?.fields ?? []).map((field) => ({ code: field.code, label: field.label, value: line.personalization?.[field.code] ?? '', inputType: field.inputType, required: field.required })),
      quantity: line.quantity,
      unitPrice: price,
      lineTotal,
      maxQuantity: Math.max(1, Math.min(MAX_LINE_QUANTITY, target?.stock?.available ?? MAX_LINE_QUANTITY)),
      issues,
    }
  })
  return {
    lines: views,
    subtotal: cart.currencyCode ? money(subtotal, cart.currencyCode) : null,
    currencyCode: cart.currencyCode ?? null,
    count,
    updatedAt: cart.updatedAt.toISOString(),
  }
}
