import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CollectionPageView, ProductPageView, type CollectionPageProps, type ProductPageProps } from '../components/public/CatalogViews'
import { StorefrontTheme } from '../data/entities'
import {
  allProductImages,
  clampCollectionPage,
  loadActiveProducts,
  productCards,
  productIdsInCategories,
  productPrices,
  storeCatalogLinks,
  type CatalogScope,
} from './catalogData'
import { buildStorefrontMetadata } from './publicMetadata'
import { findPublicCategory, findPublicProduct, visibleCategoriesOf } from './publicCatalog'
import { resolvePublicSite, storefrontMediaPath, storefrontPublicUrl } from './publicSite'
import { buildStorefrontJsonLd } from './structuredData'
import { readThemeTokens } from './theme'

/**
 * Product and collection pages (spec P3-Q4, Q12). Anonymous; the site is found
 * by slug and every read is pinned to its tenant and organization. Products and
 * categories are served only while a published section shows them.
 */

const logger = createLogger('storefront').child({ component: 'catalog-pages' })

export const COLLECTION_PAGE_SIZE = 24

type Loaded<T> = { kind: 'not-found' } | { kind: 'redirect'; path: string } | { kind: 'ok'; view: T }

type Translate = Awaited<ReturnType<typeof resolveTranslations>>['translate']

function plainExcerpt(text: string | null | undefined, max = 160): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || null
}

async function storeFrame(em: EntityManager, rawSiteSlug: string, translate: Translate) {
  const resolved = await resolvePublicSite(em, rawSiteSlug)
  if (!resolved) return null
  const { site, organizationSlug } = resolved
  const scope: CatalogScope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const theme = await em.findOne(StorefrontTheme, { siteId: site.id, ...scope, deletedAt: null })
  const basePath = `/${site.slug}`
  const logoPath = site.logoAttachmentId ? storefrontMediaPath(site.slug, site.logoAttachmentId) : null
  return {
    site,
    scope,
    frame: {
      siteId: site.id,
      siteSlug: site.slug,
      storeName: site.name,
      basePath,
      logoSrc: logoPath,
      tokens: readThemeTokens(theme?.tokens),
      signInHref: organizationSlug ? `/${encodeURIComponent(organizationSlug)}/portal/login` : null,
      labels: {
        signIn: translate('storefront.public.signIn', 'Sign in'),
        home: translate('storefront.public.home', '{store} home', { store: site.name }),
      },
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
        locale: site.defaultLocale || 'en',
        jsonLd: buildStorefrontJsonLd({ storeName: site.name, description: site.description ?? null, url: storeUrl, logoUrl }),
      }
    },
  }
}

export const loadProductPage = cache(async (rawSiteSlug: string, rawKey: string): Promise<Loaded<ProductPageProps>> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const { translate } = await resolveTranslations()
  const store = await storeFrame(em, rawSiteSlug, translate)
  if (!store) return { kind: 'not-found' }
  const { site, scope, frame } = store
  const key = safeDecode(rawKey)
  if (key === null) return { kind: 'not-found' }
  const found = await findPublicProduct(em, site, key)
  if (!found) return { kind: 'not-found' }
  const { product, visibility } = found
  const canonicalKey = product.handle || product.id
  const canonicalPath = `/${site.slug}/products/${encodeURIComponent(canonicalKey)}`
  // Compared decoded, so a key that differs only in percent-encoding can never loop.
  if (rawSiteSlug !== site.slug || key !== canonicalKey) return { kind: 'redirect', path: canonicalPath }

  const locale = site.defaultLocale || 'en'
  let price: string | null = null
  if (!product.isQuoteOnly) {
    try {
      price = (await productPrices({ em, container }, scope, [product.id], locale)).get(product.id) ?? null
    } catch (err) {
      logger.warn('Storefront product price failed; showing the product without a price', { err, siteId: site.id, productId: product.id })
    }
  }
  const images = await allProductImages(em, scope, product)
  let back: ProductPageProps['back'] = null
  const [categoryId] = await visibleCategoriesOf(em, site, product.id, visibility)
  if (categoryId) {
    const category = await findOneWithDecryption(em, CatalogProductCategory, { id: categoryId, ...scope }, undefined, scope)
    if (category) back = { href: storeCatalogLinks(frame.basePath).category(category), label: translate('storefront.public.backTo', 'Back to {name}', { name: category.name }) }
  }
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

export const loadCollectionPage = cache(async (rawSiteSlug: string, rawKey: string, rawPage: string | null): Promise<Loaded<CollectionPageProps>> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const { translate } = await resolveTranslations()
  const store = await storeFrame(em, rawSiteSlug, translate)
  if (!store) return { kind: 'not-found' }
  const { site, scope, frame } = store
  const key = safeDecode(rawKey)
  if (key === null) return { kind: 'not-found' }
  const found = await findPublicCategory(em, site, key)
  if (!found) return { kind: 'not-found' }
  const { category, visibility } = found
  const canonicalKey = category.slug || category.id
  const canonicalPath = `/${site.slug}/collections/${encodeURIComponent(canonicalKey)}`
  // Compared decoded, so a key that differs only in percent-encoding can never loop.
  if (rawSiteSlug !== site.slug || key !== canonicalKey) return { kind: 'redirect', path: canonicalPath }

  const tree = [category.id, ...(Array.isArray(category.descendantIds) ? category.descendantIds : [])].filter((id) => visibility.categoryIds.has(id))
  const byCategory = await productIdsInCategories(em, scope, tree, { limit: 1000 })
  const orderedIds = [...new Set(tree.flatMap((id) => byCategory.get(id) ?? []))]
  const active = await loadActiveProducts(em, scope, orderedIds)
  const activeIds = orderedIds.filter((id) => active.has(id))
  const pageCount = Math.max(1, Math.ceil(activeIds.length / COLLECTION_PAGE_SIZE))
  const page = clampCollectionPage(rawPage, pageCount)
  const slice = activeIds.slice((page - 1) * COLLECTION_PAGE_SIZE, page * COLLECTION_PAGE_SIZE)
  const links = storeCatalogLinks(frame.basePath)
  const products = await productCards({ em, container }, scope, slice, { links, locale: site.defaultLocale || 'en', withPrices: true })
  const pageHref = (target: number) => (target === 1 ? canonicalPath : `${canonicalPath}?page=${target}`)
  return {
    kind: 'ok',
    view: {
      ...frame,
      head: store.head(`${category.name} · ${site.name}`, plainExcerpt(category.description), `/collections/${encodeURIComponent(canonicalKey)}`),
      category: { name: category.name, description: category.description ?? null },
      products,
      emptyLabel: translate('storefront.public.productsEmpty', 'New products are on their way.'),
      pagination: {
        page,
        pageCount,
        previousHref: page > 1 ? pageHref(page - 1) : null,
        nextHref: page < pageCount ? pageHref(page + 1) : null,
        label: translate('storefront.public.pagination', 'Pages'),
        previous: translate('storefront.public.previous', 'Previous'),
        next: translate('storefront.public.next', 'Next'),
      },
    },
  }
})

function safeDecode(value: string): string | null {
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

export async function collectionPageMetadata(siteSlug: string, key: string, page: string | null): Promise<Metadata> {
  const loaded = await loadCollectionPage(siteSlug, key, page)
  return loaded.kind === 'ok' ? buildStorefrontMetadata(loaded.view.head) : {}
}

export async function renderCollectionPage(siteSlug: string, key: string, page: string | null) {
  const loaded = await loadCollectionPage(siteSlug, key, page)
  if (loaded.kind === 'not-found') notFound()
  if (loaded.kind === 'redirect') permanentRedirect(loaded.path)
  return <CollectionPageView {...loaded.view} />
}
