import type { EntityManager } from '@mikro-orm/postgresql'
import { StorefrontPage, type StorefrontSite } from '../data/entities'
import { validatePageSpec, type ValidatedSection } from './blocks/pageSpec'

type SiteScope = Pick<StorefrontSite, 'id' | 'tenantId' | 'organizationId'>

/** Sections of every live (published, not deleted) page of the store; invalid specs contribute nothing. */
export async function loadPublishedSections(em: EntityManager, site: SiteScope): Promise<ValidatedSection[]> {
  const pages = await em.find(
    StorefrontPage,
    { siteId: site.id, tenantId: site.tenantId, organizationId: site.organizationId, deletedAt: null, publishedSpec: { $ne: null } },
    { fields: ['id', 'publishedSpec'] },
  )
  const sections: ValidatedSection[] = []
  for (const page of pages) {
    const validation = validatePageSpec(page.publishedSpec)
    if (validation.ok) sections.push(...validation.sections)
  }
  return sections
}

