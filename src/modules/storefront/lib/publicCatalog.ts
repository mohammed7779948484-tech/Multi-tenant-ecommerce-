import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
} from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StorefrontSite } from '../data/entities'
import { collectSectionReferences } from './blocks/references'
import { loadPublishedSections } from './publishedSections'

/**
 * Which products and categories a live store shows publicly (spec Q12).
 *
 * - Visible categories: those a published ProductGrid or CollectionList of the
 *   store references, plus their descendants, when active and not deleted.
 * - Visible products: those a published ProductGrid picks, plus products
 *   assigned to a visible category, when active and not deleted.
 *
 * Everything else, including every product of another tenant or organization,
 * answers 404 on the product, collection and media routes. Marking a product
 * active in the back office does not publish it; a published section does.
 */

type SiteScope = Pick<StorefrontSite, 'id' | 'tenantId' | 'organizationId' | 'logoAttachmentId'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CatalogVisibility = { categoryIds: Set<string>; pickedProductIds: Set<string> }

function scopeOf(site: SiteScope) {
  return { tenantId: site.tenantId, organizationId: site.organizationId }
}

export async function resolveCatalogVisibility(em: EntityManager, site: SiteScope): Promise<CatalogVisibility> {
  const references = collectSectionReferences(await loadPublishedSections(em, site))
  const pickedProductIds = new Set(references.filter((reference) => reference.kind === 'product').map((reference) => reference.id))
  const referencedCategories = [...new Set(references.filter((reference) => reference.kind === 'category').map((reference) => reference.id))]
  const categoryIds = new Set<string>()
  if (referencedCategories.length) {
    const scope = scopeOf(site)
    const roots = await findWithDecryption(
      em,
      CatalogProductCategory,
      { id: { $in: referencedCategories }, ...scope, deletedAt: null, isActive: true },
      { fields: ['id', 'descendantIds'] },
      scope,
    )
    const candidates = [...new Set(roots.flatMap((root) => [root.id, ...(Array.isArray(root.descendantIds) ? root.descendantIds : [])]))]
    const active = await findWithDecryption(
      em,
      CatalogProductCategory,
      { id: { $in: candidates }, ...scope, deletedAt: null, isActive: true },
      { fields: ['id'] },
      scope,
    )
    for (const category of active) categoryIds.add(category.id)
  }
  return { categoryIds, pickedProductIds }
}

/** Visible categories a product is assigned to, in assignment order. */
export async function visibleCategoriesOf(em: EntityManager, site: SiteScope, productId: string, visibility: CatalogVisibility): Promise<string[]> {
  if (!visibility.categoryIds.size) return []
  const assignments = await em.find(
    CatalogProductCategoryAssignment,
    { product: productId, category: { $in: [...visibility.categoryIds] }, ...scopeOf(site) },
    { fields: ['category', 'position'], orderBy: { position: 'asc' } },
  )
  return assignments.map((assignment) => (typeof assignment.category === 'string' ? assignment.category : assignment.category.id))
}

/** Active, in-scope product that a published section shows (picked, or in a visible category). */
export async function isProductPublic(em: EntityManager, site: SiteScope, productId: string, visibility?: CatalogVisibility): Promise<boolean> {
  if (!UUID.test(productId)) return false
  const scope = scopeOf(site)
  const product = await findOneWithDecryption(em, CatalogProduct, { id: productId, ...scope, deletedAt: null, isActive: true }, { fields: ['id'] }, scope)
  if (!product) return false
  const resolved = visibility ?? (await resolveCatalogVisibility(em, site))
  if (resolved.pickedProductIds.has(productId)) return true
  return (await visibleCategoriesOf(em, site, productId, resolved)).length > 0
}

/** The public product behind a URL key (its handle, else its id), or `null` for anything not public. */
export async function findPublicProduct(em: EntityManager, site: SiteScope, key: string): Promise<{ product: CatalogProduct; visibility: CatalogVisibility } | null> {
  const scope = scopeOf(site)
  const where = { ...scope, deletedAt: null, isActive: true }
  let product = await findOneWithDecryption(em, CatalogProduct, { ...where, handle: key }, undefined, scope)
  if (!product && UUID.test(key)) product = await findOneWithDecryption(em, CatalogProduct, { ...where, id: key }, undefined, scope)
  if (!product) return null
  const visibility = await resolveCatalogVisibility(em, site)
  if (!(await isProductPublic(em, site, product.id, visibility))) return null
  return { product, visibility }
}

/** The public category behind a URL key (its slug, else its id), or `null`. */
export async function findPublicCategory(em: EntityManager, site: SiteScope, key: string): Promise<{ category: CatalogProductCategory; visibility: CatalogVisibility } | null> {
  const scope = scopeOf(site)
  const where = { ...scope, deletedAt: null, isActive: true }
  let category = await findOneWithDecryption(em, CatalogProductCategory, { ...where, slug: key }, undefined, scope)
  if (!category && UUID.test(key)) category = await findOneWithDecryption(em, CatalogProductCategory, { ...where, id: key }, undefined, scope)
  if (!category) return null
  const visibility = await resolveCatalogVisibility(em, site)
  return visibility.categoryIds.has(category.id) ? { category, visibility } : null
}
