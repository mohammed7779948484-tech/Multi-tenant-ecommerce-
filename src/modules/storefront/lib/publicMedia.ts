import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontPage, type StorefrontSite } from '../data/entities'
import { collectSectionReferences, PAGE_ATTACHMENT_ENTITY_ID } from './blocks/references'
import { PRODUCT_ENTITY_ID } from './catalogData'
import { isStorefrontImageMimeType } from './media'
import { isProductPublic } from './publicCatalog'
import { loadPublishedSections } from './publishedSections'

/**
 * Which images a live store may serve anonymously (spec "Reference rules"):
 * its logo, page images referenced by one of its published pages, and images of
 * products a published section shows (spec Q12). Everything is pinned to the site's tenant and
 * organization; drafts never make an image public.
 */

type SiteScope = Pick<StorefrontSite, 'id' | 'tenantId' | 'organizationId' | 'logoAttachmentId'>

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
  if (attachment.entityId === PRODUCT_ENTITY_ID) {
    return (await isProductPublic(em, site, attachment.recordId)) ? attachment : null
  }
  return null
}
