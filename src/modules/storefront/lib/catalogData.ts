import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogPricingService, PricingContext } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { buildPriceRowFilter, type PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ValidatedSection } from './blocks/pageSpec'
import type { ImageRef } from './blocks/schemas'
import { isStorefrontImageMimeType } from './media'
import type { CategoryCard, ProductCard, SectionData } from './sectionDataTypes'

/**
 * Store data for commerce sections (spec P3-Q1, P3-Q5, "Failure behaviour of the
 * section data loader"). Every read is pinned to the store's tenant and
 * organization and goes through the installed catalog entities by scalar id;
 * prices come from the platform pricing engine (`catalogPricingService`).
 * Only active, non-deleted products and categories are returned. One failing
 * section never fails the page: it gets empty data and a warning in the log.
 */

const logger = createLogger('storefront').child({ component: 'catalog-data' })

export const PRODUCT_ENTITY_ID = 'catalog:catalog_product'

export type CatalogScope = { tenantId: string; organizationId: string }

export type { CategoryCard, ProductCard, SectionData } from './sectionDataTypes'

export type CatalogLinks = {
  product: (product: { id: string; handle?: string | null }) => string
  category: (category: { id: string; slug?: string | null }) => string
}

/**
 * The collection page to show for a `?page=` value: non-numeric → 1, out of range → the nearest
 * valid page (spec Phase 3 contracts).
 */
export function clampCollectionPage(raw: string | null, pageCount: number): number {
  const requested = raw && /^\d+$/.test(raw.trim()) ? Number.parseInt(raw, 10) : 1
  return Math.min(Math.max(requested, 1), Math.max(pageCount, 1))
}

export function storeCatalogLinks(basePath: string): CatalogLinks {
  return {
    product: (product) => `${basePath}/products/${encodeURIComponent(product.handle || product.id)}`,
    category: (category) => `${basePath}/collections/${encodeURIComponent(category.slug || category.id)}`,
  }
}

export type CatalogDataDeps = { em: EntityManager; container: AwilixContainer }

/** Anonymous buyer: no channel, customer, user or group, one unit, now. */
export function anonymousPricingContext(now = new Date()): PricingContext {
  return { channelId: null, offerId: null, userId: null, userGroupId: null, customerId: null, customerGroupId: null, quantity: 1, date: now }
}

/** A price row as the buyer sees it: gross when set, else net, in the row's currency and the store's locale. */
export function formatPrice(row: Pick<PriceRow, 'unitPriceGross' | 'unitPriceNet'> & { currencyCode?: string | null }, locale: string): string | null {
  const raw = row.unitPriceGross ?? row.unitPriceNet
  const amount = raw === null || raw === undefined ? NaN : Number(raw)
  if (!Number.isFinite(amount) || !row.currencyCode) return null
  try {
    return new Intl.NumberFormat(locale || 'en', { style: 'currency', currency: row.currencyCode }).format(amount)
  } catch {
    return new Intl.NumberFormat('en', { style: 'currency', currency: row.currencyCode }).format(amount)
  }
}

/** Active, non-deleted products of the scope, keyed by id (encryption-aware read). */
export async function loadActiveProducts(em: EntityManager, scope: CatalogScope, ids: string[]): Promise<Map<string, CatalogProduct>> {
  if (!ids.length) return new Map()
  const rows = await findWithDecryption(
    em,
    CatalogProduct,
    { id: { $in: ids }, ...scope, deletedAt: null, isActive: true },
    { fields: ['id', 'title', 'subtitle', 'handle', 'defaultMediaId', 'description', 'seoTitle', 'seoDescription', 'isQuoteOnly'] },
    scope,
  )
  return new Map(rows.map((row) => [row.id, row]))
}

export async function loadActiveCategories(em: EntityManager, scope: CatalogScope, ids: string[]): Promise<Map<string, CatalogProductCategory>> {
  if (!ids.length) return new Map()
  const rows = await findWithDecryption(
    em,
    CatalogProductCategory,
    { id: { $in: ids }, ...scope, deletedAt: null, isActive: true },
    { fields: ['id', 'name', 'slug', 'description', 'descendantIds'] },
    scope,
  )
  return new Map(rows.map((row) => [row.id, row]))
}

/** Product ids assigned to any of the categories, in assignment order (position, then creation). */
export async function productIdsInCategories(
  em: EntityManager,
  scope: CatalogScope,
  categoryIds: string[],
  options: { limit?: number; offset?: number } = {},
): Promise<Map<string, string[]>> {
  const byCategory = new Map<string, string[]>()
  if (!categoryIds.length) return byCategory
  const assignments = await em.find(
    CatalogProductCategoryAssignment,
    { category: { $in: categoryIds }, ...scope },
    {
      fields: ['product', 'category', 'position', 'createdAt'],
      orderBy: { position: 'asc', createdAt: 'asc' },
      // Sections show at most 12 products; inactive ones are filtered afterwards, so read a bounded margin.
      limit: options.limit ?? 500,
      offset: options.offset,
    },
  )
  for (const assignment of assignments) {
    const categoryId = typeof assignment.category === 'string' ? assignment.category : assignment.category.id
    const productId = typeof assignment.product === 'string' ? assignment.product : assignment.product.id
    const list = byCategory.get(categoryId) ?? []
    if (!list.includes(productId)) list.push(productId)
    byCategory.set(categoryId, list)
  }
  return byCategory
}

/** A category plus its active descendants (the installed tree keeps `descendant_ids` denormalised). */
export function withDescendants(category: CatalogProductCategory): string[] {
  return [category.id, ...(Array.isArray(category.descendantIds) ? category.descendantIds : [])]
}

/** Cover image per product: its default media when that is one of its own raster images, else its first image. */
export async function productImages(em: EntityManager, scope: CatalogScope, products: CatalogProduct[]): Promise<Map<string, ImageRef>> {
  const result = new Map<string, ImageRef>()
  if (!products.length) return result
  const attachments = await em.find(
    Attachment,
    { entityId: PRODUCT_ENTITY_ID, recordId: { $in: products.map((product) => product.id) }, ...scope },
    { fields: ['id', 'recordId', 'mimeType', 'createdAt'], orderBy: { createdAt: 'asc' } },
  )
  const byProduct = new Map<string, string[]>()
  for (const attachment of attachments) {
    if (!isStorefrontImageMimeType(attachment.mimeType)) continue
    const list = byProduct.get(attachment.recordId) ?? []
    list.push(attachment.id)
    byProduct.set(attachment.recordId, list)
  }
  for (const product of products) {
    const own = byProduct.get(product.id) ?? []
    const chosen = product.defaultMediaId && own.includes(product.defaultMediaId) ? product.defaultMediaId : own[0]
    if (chosen) result.set(product.id, { attachmentId: chosen, alt: product.title })
  }
  return result
}

/** Every raster image of a product, its default media first (product page gallery, at most `max`). */
export async function allProductImages(em: EntityManager, scope: CatalogScope, product: CatalogProduct, max = 8): Promise<ImageRef[]> {
  const attachments = await em.find(
    Attachment,
    { entityId: PRODUCT_ENTITY_ID, recordId: product.id, ...scope },
    { fields: ['id', 'mimeType', 'createdAt'], orderBy: { createdAt: 'asc' } },
  )
  const ids = attachments.filter((attachment) => isStorefrontImageMimeType(attachment.mimeType)).map((attachment) => attachment.id)
  const ordered = product.defaultMediaId && ids.includes(product.defaultMediaId) ? [product.defaultMediaId, ...ids.filter((id) => id !== product.defaultMediaId)] : ids
  return ordered.slice(0, max).map((attachmentId) => ({ attachmentId, alt: product.title }))
}

/** Formatted best price per product through the platform pricing engine (product and variant rows). */
export async function productPrices(deps: CatalogDataDeps, scope: CatalogScope, productIds: string[], locale: string): Promise<Map<string, string>> {
  const prices = new Map<string, string>()
  if (!productIds.length) return prices
  const { em, container } = deps
  const variants = await findWithDecryption(em, CatalogProductVariant, { product: { $in: productIds }, deletedAt: null, ...scope }, { fields: ['id', 'product'] }, scope)
  const variantToProduct = new Map<string, string>()
  for (const variant of variants) {
    const productId = typeof variant.product === 'string' ? variant.product : variant.product?.id
    if (productId) variantToProduct.set(variant.id, productId)
  }
  const context = anonymousPricingContext()
  const variantIds = [...variantToProduct.keys()]
  const where = variantIds.length ? { $or: [{ product: { $in: productIds } }, { variant: { $in: variantIds } }] } : { product: { $in: productIds } }
  const rows = await findWithDecryption<CatalogProductPrice>(
    em,
    CatalogProductPrice,
    { $and: [{ ...where, ...scope }, buildPriceRowFilter(context)] } as never,
    { populate: ['offer', 'variant', 'product', 'priceKind'] },
    scope,
  )
  const byProduct = new Map<string, PriceRow[]>()
  for (const row of rows as PriceRow[]) {
    const productId = row.product
      ? typeof row.product === 'string'
        ? row.product
        : row.product.id
      : row.variant
        ? variantToProduct.get(typeof row.variant === 'string' ? row.variant : row.variant.id)
        : undefined
    if (!productId) continue
    const list = byProduct.get(productId) ?? []
    list.push(row)
    byProduct.set(productId, list)
  }
  const entries = [...byProduct.entries()]
  const pricing = container.resolve('catalogPricingService') as CatalogPricingService
  const best = await pricing.resolvePriceMany(entries.map(([, priceRows]) => ({ rows: priceRows, context })))
  entries.forEach(([productId], index) => {
    const row = best[index]
    const formatted = row ? formatPrice(row, locale) : null
    if (formatted) prices.set(productId, formatted)
  })
  return prices
}

export async function productCards(
  deps: CatalogDataDeps,
  scope: CatalogScope,
  orderedIds: string[],
  options: { links: CatalogLinks; locale: string; withPrices: boolean; limit?: number },
): Promise<ProductCard[]> {
  const products = await loadActiveProducts(deps.em, scope, orderedIds)
  const ordered = orderedIds.map((id) => products.get(id)).filter((product): product is CatalogProduct => Boolean(product))
  const visible = options.limit ? ordered.slice(0, options.limit) : ordered
  const images = await productImages(deps.em, scope, visible)
  let prices = new Map<string, string>()
  if (options.withPrices) {
    try {
      prices = await productPrices(deps, scope, visible.filter((product) => !product.isQuoteOnly).map((product) => product.id), options.locale)
    } catch (err) {
      logger.warn('Storefront price resolution failed; showing products without prices', { err, ...scope })
    }
  }
  return visible.map((product) => ({
    id: product.id,
    title: product.title,
    subtitle: product.subtitle ?? null,
    href: options.links.product(product),
    image: images.get(product.id) ?? null,
    price: prices.get(product.id) ?? null,
  }))
}

/**
 * Data for every commerce section of a page, keyed by section id. Used by the
 * public page (published sections) and by the builder preview (draft sections);
 * both get the same view model.
 */
export async function loadSectionData(
  deps: CatalogDataDeps,
  scope: CatalogScope,
  sections: ValidatedSection[],
  options: { links: CatalogLinks; locale: string },
): Promise<Record<string, SectionData>> {
  const data: Record<string, SectionData> = {}
  for (const section of sections) {
    try {
      if (section.type === 'ProductGrid') {
        const { source, limit, showPrice } = section.props
        let ids: string[] = []
        if (source.kind === 'products') {
          ids = source.productIds
        } else {
          const category = (await loadActiveCategories(deps.em, scope, [source.categoryId])).get(source.categoryId)
          if (category) {
            const tree = withDescendants(category)
            const active = await loadActiveCategories(deps.em, scope, tree)
            const byCategory = await productIdsInCategories(deps.em, scope, tree.filter((id) => active.has(id)))
            ids = [...new Set(tree.flatMap((id) => byCategory.get(id) ?? []))]
          }
        }
        data[section.id] = { products: await productCards(deps, scope, ids, { links: options.links, locale: options.locale, withPrices: showPrice, limit }) }
      } else if (section.type === 'CollectionList') {
        const categories = await loadActiveCategories(deps.em, scope, section.props.categoryIds)
        const ordered = section.props.categoryIds.map((id) => categories.get(id)).filter((category): category is CatalogProductCategory => Boolean(category))
        // A cover comes from the category or its active sub-categories (products often sit only in the leaves).
        const trees = new Map(ordered.map((category) => [category.id, withDescendants(category)]))
        const activeTree = await loadActiveCategories(deps.em, scope, [...new Set([...trees.values()].flat())])
        const byCategory = await productIdsInCategories(deps.em, scope, [...activeTree.keys()])
        const candidatesOf = (categoryId: string) =>
          [...new Set((trees.get(categoryId) ?? []).filter((id) => activeTree.has(id)).flatMap((id) => byCategory.get(id) ?? []))].slice(0, 20)
        // Cover candidates: the first few products of each tree, not the whole tree.
        const products = await loadActiveProducts(deps.em, scope, [...new Set(ordered.flatMap((category) => candidatesOf(category.id)))])
        const covers = await productImages(deps.em, scope, [...products.values()])
        data[section.id] = {
          categories: ordered.map((category) => {
            const coverProduct = candidatesOf(category.id).find((id) => products.has(id) && covers.has(id))
            return {
              id: category.id,
              name: category.name,
              description: category.description ?? null,
              href: options.links.category(category),
              image: coverProduct ? { ...covers.get(coverProduct)!, alt: category.name } : null,
            }
          }),
        }
      }
    } catch (err) {
      logger.warn('Storefront section data failed; rendering the section empty', { err, sectionId: section.id, type: section.type, ...scope })
      data[section.id] = section.type === 'CollectionList' ? { categories: [] } : { products: [] }
    }
  }
  return data
}
