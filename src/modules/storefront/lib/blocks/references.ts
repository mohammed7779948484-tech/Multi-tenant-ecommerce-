import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontPage } from '../../data/entities'
import { isStorefrontImageMimeType } from '../media'
import type { PageSpecIssue, ValidatedSection } from './pageSpec'

/**
 * Records a page spec points at by id (spec "Reference rules", P3-Q2/P3-Q3).
 * Collection is pure; the check reads the database, pinned to the trusted scope.
 */

export const PAGE_ATTACHMENT_ENTITY_ID = 'storefront:storefront_page'

export type SpecReferenceKind = 'image' | 'product' | 'category'
export type SpecReference = { kind: SpecReferenceKind; id: string; path: string }

function propsPath(section: ValidatedSection, ...rest: Array<string | number>): string {
  return ['elements', section.id, 'props', ...rest].join('.')
}

export function collectSectionReferences(sections: ValidatedSection[]): SpecReference[] {
  const references: SpecReference[] = []
  const image = (section: ValidatedSection, id: string, ...rest: Array<string | number>) =>
    references.push({ kind: 'image', id, path: propsPath(section, ...rest, 'attachmentId') })
  for (const section of sections) {
    switch (section.type) {
      case 'Hero':
        if (section.props.image) image(section, section.props.image.attachmentId, 'image')
        break
      case 'Image':
      case 'ImageText':
        image(section, section.props.image.attachmentId, 'image')
        break
      case 'Gallery':
        section.props.images.forEach((entry, index) => image(section, entry.attachmentId, 'images', index))
        break
      default:
        break
    }
  }
  return references
}

export type ReferenceScope = { tenantId: string; organizationId: string }

const unknownReference = (path: string): PageSpecIssue => ({ path, code: 'unknown_reference', message: 'storefront.validation.referenceNotFound' })

/**
 * Image references must be raster attachments uploaded to a page of this store
 * (`entity_id = storefront:storefront_page`, recorded on one of the scope's pages,
 * deleted pages included so a rollback keeps working). Any other id, including
 * another entity's attachment of the same organization or another tenant's,
 * gives the same issue, so the answer never reveals that a record exists.
 */
export async function checkSectionReferences(
  em: EntityManager,
  scope: ReferenceScope,
  sections: ValidatedSection[],
): Promise<PageSpecIssue[]> {
  const references = collectSectionReferences(sections)
  if (references.length === 0) return []
  const issues: PageSpecIssue[] = []

  const imageRefs = references.filter((reference) => reference.kind === 'image')
  if (imageRefs.length) {
    const ids = [...new Set(imageRefs.map((reference) => reference.id))]
    const attachments = await em.find(
      Attachment,
      { id: { $in: ids }, tenantId: scope.tenantId, organizationId: scope.organizationId, entityId: PAGE_ATTACHMENT_ENTITY_ID },
      { fields: ['id', 'recordId', 'mimeType'] },
    )
    const recordIds = [...new Set(attachments.map((attachment) => attachment.recordId))]
    const pages = recordIds.length
      ? await em.find(StorefrontPage, { id: { $in: recordIds }, tenantId: scope.tenantId, organizationId: scope.organizationId }, { fields: ['id'] })
      : []
    const pageIds = new Set(pages.map((page) => page.id))
    const allowed = new Set(
      attachments
        .filter((attachment) => pageIds.has(attachment.recordId) && isStorefrontImageMimeType(attachment.mimeType))
        .map((attachment) => attachment.id),
    )
    for (const reference of imageRefs) if (!allowed.has(reference.id)) issues.push(unknownReference(reference.path))
  }
  return issues
}
