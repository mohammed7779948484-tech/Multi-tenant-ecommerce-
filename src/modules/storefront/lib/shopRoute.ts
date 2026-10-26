import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { buildShopCommandContext } from '../commands/cart'
import { resolvePublicSite } from './publicSite'
import { CART_TTL_MS, cartCookieName, hashCartToken, ShopError, type CartSite } from './shopCart'
import { shopTranslations, type ShopTranslate } from './shopLocale'

/**
 * Plumbing shared by the public shop API (`/api/storefront/shop/{siteSlug}/…`):
 * the store from the slug (never from the body), the per-store cart cookie,
 * per-IP-and-store rate limits, a same-origin check on writes, and Arabic error
 * bodies. Every answer is `no-store`.
 */

const logger = createLogger('storefront').child({ component: 'shop-route' })

/** Writes per buyer (IP, else cart) and store per minute; generous enough for a buyer, tight enough for a script. */
const WRITE_LIMIT = { points: 120, duration: 60, keyPrefix: 'storefront-shop-write' }
/**
 * Without a trusted proxy depth the client IP is unknown. Buyers are then told
 * apart by their cart token; first writes (no cart yet) share one per-store
 * bucket with a higher ceiling, so one busy store never throttles every buyer
 * at 120 a minute. Production should set the trusted proxy depth.
 */
const NEW_CART_LIMIT = { points: 600, duration: 60, keyPrefix: 'storefront-shop-new-cart' }

/** Set by the client after an answer set the cart cookie: a later write without the cookie means cookies are blocked. */
export const CART_EXPECTED_HEADER = 'x-sf-cart-expected'

export type ShopRequest = {
  container: AwilixContainer
  em: EntityManager
  site: CartSite
  token: string | null
  tokenHash: string | null
  translate: ShopTranslate
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function noStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { 'Cache-Control': 'no-store' } })
}

export async function errorResponse(status: number, code: string, fieldErrors?: Record<string, string>, translate?: ShopTranslate) {
  const t = translate ?? (await shopTranslations()).translate
  const translated = fieldErrors ? Object.fromEntries(Object.entries(fieldErrors).map(([field, key]) => [field, t(key, key)])) : undefined
  return noStore({ error: t(`storefront.shop.errors.${code}`, code), code, ...(translated ? { fieldErrors: translated } : {}) }, { status })
}

/** The store and the cart cookie of a shop request, or `null` (answer 404) for an unknown or offline store. */
export async function resolveShopRequest(req: Request, rawSlug: string): Promise<ShopRequest | null> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const resolved = await resolvePublicSite(em, rawSlug)
  if (!resolved) return null
  const { site } = resolved
  const token = readCookie(req, cartCookieName(site.id))
  const validToken = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
  const { translate } = await shopTranslations()
  return {
    container,
    em,
    site: { id: site.id, slug: site.slug, tenantId: site.tenantId, organizationId: site.organizationId },
    token: validToken,
    tokenHash: validToken ? hashCartToken(validToken) : null,
    translate,
  }
}

/** Write guard: same-origin browsers only (Origin, when sent, must match), then the rate limit. */
export async function guardShopWrite(req: Request, shop: ShopRequest): Promise<NextResponse | null> {
  const origin = req.headers.get('origin')
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    let sameOrigin = false
    try {
      sameOrigin = new URL(origin).host === host
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) return errorResponse(403, 'crossOrigin', undefined, shop.translate)
  }
  let limiter: RateLimiterService | null = null
  try {
    limiter = shop.container.resolve('rateLimiterService') as RateLimiterService
  } catch {
    limiter = null
  }
  if (!limiter) return null
  const ip = getClientIp(req, limiter.trustProxyDepth)
  const [config, buyerKey] = ip ? [WRITE_LIMIT, `ip:${ip}`] : shop.tokenHash ? [WRITE_LIMIT, `cart:${shop.tokenHash}`] : [NEW_CART_LIMIT, 'new-cart']
  return checkRateLimit(limiter, config, `${shop.site.id}:${buyerKey}`, shop.translate('storefront.shop.errors.rateLimited', 'Too many requests. Try again in a minute.'), {
    failClosed: true,
    unavailableMessage: shop.translate('storefront.shop.errors.busy', 'The store is busy. Try again in a moment.'),
  })
}

/** Sets (or refreshes) the store's cart cookie: HttpOnly, SameSite=Lax, 30 days. */
export function withCartCookie(res: NextResponse, req: Request, site: CartSite, token: string) {
  res.cookies.set(cartCookieName(site.id), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: Math.floor(CART_TTL_MS / 1000),
  })
  return res
}

export function runShopCommand<TInput, TResult>(shop: ShopRequest, commandId: string, input: TInput) {
  const commandBus = shop.container.resolve('commandBus') as CommandBus
  return commandBus.execute<TInput, TResult>(commandId, { input, ctx: buildShopCommandContext(shop.container, shop.site) })
}

/** Maps a refusal to its answer; anything unexpected is logged (ids only) and answers 500. */
export async function shopFailure(err: unknown, shop: ShopRequest) {
  if (err instanceof ShopError) return errorResponse(err.status, err.code, err.fieldErrors, shop.translate)
  logger.error('Storefront shop request failed', { err, siteId: shop.site.id })
  return errorResponse(500, 'failed', undefined, shop.translate)
}
