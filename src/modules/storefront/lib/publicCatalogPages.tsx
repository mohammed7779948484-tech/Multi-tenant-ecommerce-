import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ProductPageView, type ProductPageProps } from '../components/public/CatalogViews'
import { StorefrontTheme } from '../data/entities'
import { allProductImages, productPrices, storeCatalogLinks, type CatalogScope } from './catalogData'
import { buildStorefrontMetadata } from './publicMetadata'
import { findPublicProduct, publicCategoriesOf } from './publicCatalog'
import { resolvePublicSite, storefrontMediaPath, storefrontPublicUrl } from './publicSite'
import { buildStorefrontJsonLd } from './structuredData'
import { readThemeTokens } from './theme'
import { SHOP_LOCALE } from './shopLocale'
import { loadShopShell } from './shopShell'

/**
 * Product pages and the store frame shared by every catalog page (spec P3-Q4).
 * Anonymous; the site is found by slug and every read is pinned to its tenant
 * and organization. Public products are the store's active ones (S-2).
 */

const logger = createLogger('storefront').child({ component: 'catalog-pages' })

export type Loaded<T> = { kind: 'not-found' } | { kind: 'redirect'; path: string } | { kind: 'ok'; view: T }

export function plainExcerpt(text: string | null | undefined, max = 160): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || null
}

export async function storeFrame(em: EntityManager, rawSiteSlug: string) {
  const resolved = await resolvePublicSite(em, rawSiteSlug)
  if (!resolved) return null
  const { site } = resolved
  const scope: CatalogScope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const theme = await em.findOne(StorefrontTheme, { siteId: site.id, ...scope, deletedAt: null })
  const { translate, shell } = await loadShopShell(em, site, { footer: true })
  const basePath = `/${site.slug}`
  const logoPath = site.logoAttachmentId ? storefrontMediaPath(site.slug, site.logoAttachmentId) : null
  return {
    site,
    scope,
    translate,
    frame: {
      siteId: site.id,
      siteSlug: site.slug,
      storeName: site.name,
      basePath,
      logoSrc: logoPath,
      tokens: readThemeTokens(theme?.tokens),
      labels: { home: translate('storefront.public.home', '{store} home', { store: site.name }) },
      shell,
    },
    head: (title: string, description: string | null, path: string) => {
      const storeUrl = storefrontPublicUrl(site.slug)
      const logoUrl = logoPath ? new URL(logoPath, storeUrl).toString() : null
      return {
        title,
        description: description ?? site.description ?? null,
        canonicalUrl: storefrontPublicUrl(site.slug, path),
        siteName: site.name,
        imageUrl: logoUrl,
        locale: SHOP_LOCALE,
        jsonLd: buildStorefrontJsonLd({ storeName: site.name, description: site.description ?? null, url: storeUrl, logoUrl }),
      }
    },
  }
}

export const loadProductPage = cache(async (rawSiteSlug: string, rawKey: string): Promise<Loaded<ProductPageProps>> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const store = await storeFrame(em, rawSiteSlug)
  if (!store) return { kind: 'not-found' }
  const { site, scope, frame, translate } = store
  const key = safeDecode(rawKey)
  if (key === null) return { kind: 'not-found' }
  const product = await findPublicProduct(em, site, key)
  if (!product) return { kind: 'not-found' }
  const canonicalKey = product.handle || product.id
  const canonicalPath = `/${site.slug}/products/${encodeURIComponent(canonicalKey)}`
  // Compared decoded, so a key that differs only in percent-encoding can never loop.
  if (rawSiteSlug !== site.slug || key !== canonicalKey) return { kind: 'redirect', path: canonicalPath }

  let price: string | null = null
  if (!product.isQuoteOnly) {
    try {
      price = (await productPrices({ em, container }, scope, [product.id])).get(product.id)?.formatted ?? null
    } catch (err) {
      logger.warn('Storefront product price failed; showing the product without a price', { err, siteId: site.id, productId: product.id })
    }
  }
  const images = await allProductImages(em, scope, product)
  let back: ProductPageProps['back'] = null
  const [category] = await publicCategoriesOf(em, site, product.id)
  if (category) back = { href: storeCatalogLinks(frame.basePath).category(category), label: translate('storefront.public.backTo', 'Back to {name}', { name: category.name }) }
  return {
    kind: 'ok',
    view: {
      ...frame,
      head: store.head(`${product.seoTitle || product.title} · ${site.name}`, product.seoDescription ?? plainExcerpt(product.subtitle ?? product.description), `/products/${encodeURIComponent(canonicalKey)}`),
      product: { title: product.title, subtitle: product.subtitle ?? null, description: product.description ?? null, price, images },
      back,
    },
  }
})

export function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export async function productPageMetadata(siteSlug: string, key: string): Promise<Metadata> {
  const loaded = await loadProductPage(siteSlug, key)
  return loaded.kind === 'ok' ? buildStorefrontMetadata(loaded.view.head) : {}
}

export async function renderProductPage(siteSlug: string, key: string) {
  const loaded = await loadProductPage(siteSlug, key)
  if (loaded.kind === 'not-found') notFound()
  if (loaded.kind === 'redirect') permanentRedirect(loaded.path)
  return <ProductPageView {...loaded.view} />
}
