import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontPage, type StorefrontSite } from '../data/entities'
import { validatePageSpec, type ValidatedSection } from './blocks/pageSpec'
import { collectSectionReferences, PAGE_ATTACHMENT_ENTITY_ID } from './blocks/references'
import { isStorefrontImageMimeType } from './media'

/**
 * Which images a live store may serve anonymously (spec "Reference rules"):
 * its logo, and page images referenced by one of its published pages. Product
 * images join in Phase 3b. Everything is pinned to the site's tenant and
 * organization; drafts never make an image public.
 */

type SiteScope = Pick<StorefrontSite, 'id' | 'tenantId' | 'organizationId' | 'logoAttachmentId'>

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

export async function publishedImageIds(em: EntityManager, site: SiteScope): Promise<Set<string>> {
  const sections = await loadPublishedSections(em, site)
  return new Set(collectSectionReferences(sections).filter((reference) => reference.kind === 'image').map((reference) => reference.id))
}

/**
 * The attachment to serve, or `null` for every case that must answer 404:
 * unknown id, another tenant's or organization's file, another entity's file,
 * an upload no published page references, a non-raster type.
 */
export async function resolvePublicStoreImage(em: EntityManager, site: SiteScope, attachmentId: string): Promise<Attachment | null> {
  const attachment = await em.findOne(Attachment, { id: attachmentId, tenantId: site.tenantId, organizationId: site.organizationId })
  if (!attachment || !isStorefrontImageMimeType(attachment.mimeType)) return null
  if (site.logoAttachmentId === attachmentId) return attachment
  if (attachment.entityId === PAGE_ATTACHMENT_ENTITY_ID) {
    const page = await em.findOne(
      StorefrontPage,
      { id: attachment.recordId, siteId: site.id, tenantId: site.tenantId, organizationId: site.organizationId },
      { fields: ['id'] },
    )
    if (!page) return null
    return (await publishedImageIds(em, site)).has(attachmentId) ? attachment : null
  }
  return null
}
