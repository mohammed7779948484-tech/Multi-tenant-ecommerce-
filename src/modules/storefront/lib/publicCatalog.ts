import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
} from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StorefrontSite } from '../data/entities'

/**
 * Which products and categories a live store shows publicly (shopping-journey
 * spec S-2, superseding DECISIONS K2 for the shop).
 *
 * - A product is public when it is active and not deleted in the store's
 *   organization.
 * - A category is public when it is active and not deleted in the store's
 *   organization.
 *
 * The merchant controls visibility with the product's and category's active
 * flag in the catalog admin. Everything else, including every row of another
 * tenant or organization, answers 404 on the product, collection and media
 * routes, exactly like an unknown id.
 */

type SiteScope = Pick<StorefrontSite, 'id' | 'tenantId' | 'organizationId'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

function publicWhere(site: SiteScope) {
  return { tenantId: site.tenantId, organizationId: site.organizationId, deletedAt: null, isActive: true }
}

function scopeOf(site: SiteScope) {
  return { tenantId: site.tenantId, organizationId: site.organizationId }
}

/** Public categories a product is assigned to, in assignment order. */
export async function publicCategoriesOf(em: EntityManager, site: SiteScope, productId: string): Promise<CatalogProductCategory[]> {
  const scope = scopeOf(site)
  const assignments = await em.find(
    CatalogProductCategoryAssignment,
    { product: productId, ...scope },
    { fields: ['category', 'position'], orderBy: { position: 'asc' } },
  )
  const ids = assignments.map((assignment) => (typeof assignment.category === 'string' ? assignment.category : assignment.category.id))
  if (!ids.length) return []
  const rows = await findWithDecryption(em, CatalogProductCategory, { id: { $in: ids }, ...publicWhere(site) }, undefined, scope)
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.map((id) => byId.get(id)).filter((row): row is CatalogProductCategory => Boolean(row))
}

/** Active, in-scope product. */
export async function isProductPublic(em: EntityManager, site: SiteScope, productId: string): Promise<boolean> {
  if (!UUID.test(productId)) return false
  const product = await findOneWithDecryption(em, CatalogProduct, { id: productId, ...publicWhere(site) }, { fields: ['id'] }, scopeOf(site))
  return Boolean(product)
}

/** The public product behind a URL key (its handle, else its id), or `null` for anything not public. */
export async function findPublicProduct(em: EntityManager, site: SiteScope, key: string): Promise<CatalogProduct | null> {
  const scope = scopeOf(site)
  const where = publicWhere(site)
  const byHandle = await findOneWithDecryption(em, CatalogProduct, { ...where, handle: key }, undefined, scope)
  if (byHandle) return byHandle
  return UUID.test(key) ? findOneWithDecryption(em, CatalogProduct, { ...where, id: key }, undefined, scope) : null
}

/** The public category behind a URL key (its slug, else its id), or `null`. */
export async function findPublicCategory(em: EntityManager, site: SiteScope, key: string): Promise<CatalogProductCategory | null> {
  const scope = scopeOf(site)
  const where = publicWhere(site)
  const bySlug = await findOneWithDecryption(em, CatalogProductCategory, { ...where, slug: key }, undefined, scope)
  if (bySlug) return bySlug
  return UUID.test(key) ? findOneWithDecryption(em, CatalogProductCategory, { ...where, id: key }, undefined, scope) : null
}

/** Every public category of the store, by depth then name (the collections index and the category filter). */
export async function loadPublicCategories(em: EntityManager, site: SiteScope): Promise<CatalogProductCategory[]> {
  return findWithDecryption(
    em,
    CatalogProductCategory,
    publicWhere(site),
    { fields: ['id', 'name', 'slug', 'description', 'parentId', 'depth', 'descendantIds', 'childIds'], orderBy: { depth: 'asc', name: 'asc' }, limit: 500 },
    scopeOf(site),
  )
}
