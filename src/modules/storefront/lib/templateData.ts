import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StorefrontSite } from '../data/entities'
import { MAX_TEMPLATE_CATEGORIES, type TemplateStoreData } from './templates'

/**
 * The store data a template is filled with (spec P3-Q7): the site's name and
 * description, and up to four active top-level categories in creation order.
 * Every read is pinned to the caller's trusted scope.
 */
export async function loadTemplateStoreData(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<(TemplateStoreData & { siteId: string }) | null> {
  const site = await em.findOne(StorefrontSite, { ...scope, deletedAt: null }, { fields: ['id', 'name', 'description'] })
  if (!site) return null
  const categories = await findWithDecryption(
    em,
    CatalogProductCategory,
    { ...scope, parentId: null, isActive: true, deletedAt: null },
    { fields: ['id', 'name', 'slug'], orderBy: { createdAt: 'asc' }, limit: MAX_TEMPLATE_CATEGORIES },
    scope,
  )
  return {
    siteId: site.id,
    storeName: site.name,
    description: site.description ?? null,
    categories: categories.map((category) => ({ id: category.id, slug: category.slug ?? null, name: category.name })),
  }
}
