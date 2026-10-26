import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { StorefrontFrame, StorefrontJsonLd } from '../components/public/StorefrontView'
import { ShopCartPage } from '../components/shop/ShopCartPage'
import { buildStorefrontMetadata } from './publicMetadata'
import { storeFrame } from './publicCatalogPages'

/**
 * The cart page (`/{siteSlug}/cart`, shopping-journey spec REQ-006). The page
 * itself is the store frame; the cart is read by the client from the cart API
 * with the browser's cookie, so the HTML is the same for every buyer and never
 * cached with someone's cart in it. Not indexed.
 */

const loadCartPage = cache(async (rawSiteSlug: string) => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return null
  const title = store.translate('storefront.shop.cart.pageTitle', 'Your cart')
  return { ...store.frame, title, head: store.head(`${title} · ${store.site.name}`, null, '/cart') }
})

export async function cartPageMetadata(siteSlug: string): Promise<Metadata> {
  const view = await loadCartPage(siteSlug)
  return view ? { ...buildStorefrontMetadata(view.head), robots: { index: false, follow: false } } : {}
}

export async function renderCartPage(siteSlug: string) {
  const view = await loadCartPage(siteSlug)
  if (!view) notFound()
  return (
    <>
      <StorefrontJsonLd data={view.head.jsonLd} />
      <StorefrontFrame {...view}>
        <ShopCartPage title={view.title} shopHref={view.basePath || '/'} />
      </StorefrontFrame>
    </>
  )
}
