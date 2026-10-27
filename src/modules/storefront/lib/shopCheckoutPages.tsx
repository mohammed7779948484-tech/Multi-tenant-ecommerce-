import { cache } from 'react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { StorefrontFrame, StorefrontJsonLd } from '../components/public/StorefrontView'
import { ShopCheckout } from '../components/shop/ShopCheckout'
import { ShopOrderView } from '../components/shop/ShopOrderView'
import { buildStorefrontMetadata } from './publicMetadata'
import { safeDecode, storeFrame } from './publicCatalogPages'
import { findOrderAccess, loadOrderView, orderCookieName } from './shopOrders'

/**
 * Checkout (`/{siteSlug}/checkout`) and order tracking
 * (`/{siteSlug}/orders/{orderNumber}`), shopping-journey spec J-003/J-004.
 * Checkout is the store frame around a client island that reads the cart and
 * quote from the shop API with the buyer's cookie. The order page is rendered
 * on the server for the holder of the order's token (the order cookie, or `k`
 * from the confirmation link); without it the page is the same 404 as an
 * unknown order. Neither page is indexed or cached.
 */

const loadCheckoutPage = cache(async (rawSiteSlug: string) => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return null
  const title = store.translate('storefront.shop.checkout.title', 'Checkout')
  return { ...store.frame, title, head: store.head(`${title} · ${store.site.name}`, null, '/checkout') }
})

export async function checkoutPageMetadata(siteSlug: string): Promise<Metadata> {
  const view = await loadCheckoutPage(siteSlug)
  return view ? { ...buildStorefrontMetadata(view.head), robots: { index: false, follow: false } } : {}
}

export async function renderCheckoutPage(siteSlug: string) {
  const view = await loadCheckoutPage(siteSlug)
  if (!view) notFound()
  return (
    <>
      <StorefrontJsonLd data={view.head.jsonLd} />
      <StorefrontFrame {...view}>
        <section className="sf-section">
          <div className="sf-container">
            <h1 className="sf-section-title">{view.title}</h1>
            <ShopCheckout siteSlug={view.siteSlug} cartHref={`${view.basePath}/cart`} shopHref={view.basePath || '/'} />
          </div>
        </section>
      </StorefrontFrame>
    </>
  )
}

const loadOrderPage = cache(async (rawSiteSlug: string, rawNumber: string, linkToken: string | null) => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return null
  const orderNumber = safeDecode(rawNumber)
  if (orderNumber === null) return null
  const site = { id: store.site.id, slug: store.site.slug, tenantId: store.site.tenantId, organizationId: store.site.organizationId }
  const cookieToken = (await cookies()).get(orderCookieName(site.id, orderNumber))?.value ?? null
  const linkAccess = await findOrderAccess(em, site, orderNumber, linkToken)
  const access = linkAccess ?? (await findOrderAccess(em, site, orderNumber, cookieToken))
  const order = access ? await loadOrderView(em, site, access) : null
  if (!order) return null
  const title = store.translate('storefront.shop.order.title', 'Order {number}', { number: order.orderNumber })
  // The permalink carries the token that opened the order (a stale link token falls back to the cookie's).
  const token = linkAccess ? linkToken : cookieToken
  return {
    ...store.frame,
    title,
    order,
    permalink: token ? `/${site.slug}/orders/${encodeURIComponent(order.orderNumber)}?k=${token}` : null,
    head: store.head(`${title} · ${store.site.name}`, null, `/orders/${encodeURIComponent(order.orderNumber)}`),
  }
})

type OrderSearch = { k?: string | string[]; placed?: string | string[] }
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null

export async function orderPageMetadata(siteSlug: string, orderNumber: string, search: OrderSearch | undefined): Promise<Metadata> {
  const view = await loadOrderPage(siteSlug, orderNumber, first(search?.k))
  // Never indexed; the token stays out of the canonical URL.
  return view ? { ...buildStorefrontMetadata(view.head), robots: { index: false, follow: false }, referrer: 'no-referrer' } : { robots: { index: false, follow: false } }
}

export async function renderOrderPage(siteSlug: string, orderNumber: string, search: OrderSearch | undefined) {
  const view = await loadOrderPage(siteSlug, orderNumber, first(search?.k))
  if (!view) notFound()
  return (
    <StorefrontFrame {...view}>
      <section className="sf-section">
        <div className="sf-container">
          <ShopOrderView order={view.order} permalink={view.permalink} justPlaced={first(search?.placed) === '1'} shopHref={view.basePath || '/'} />
        </div>
      </section>
    </StorefrontFrame>
  )
}
