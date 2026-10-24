import { describe, expect, it } from '@jest/globals'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontPage } from '../../../data/entities'
import { STOREFRONT_BLOCKS } from '../catalog'
import { validatePageSpec, type ValidatedSection } from '../pageSpec'
import { checkSectionReferences, collectSectionReferences, PAGE_ATTACHMENT_ENTITY_ID } from '../references'

/** TEST-020 (Phase 3a): section schemas and image references. */

const IMG = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const IMG2 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'
const PAGE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_PAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const parse = (type: keyof typeof STOREFRONT_BLOCKS, props: unknown) => STOREFRONT_BLOCKS[type].props.safeParse(props)
const firstMessage = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) => result.error?.issues[0]?.message

describe('Phase 3a section schemas', () => {
  it('requires an image id and alt text, and keeps image links to safe hrefs', () => {
    expect(parse('Image', { image: { attachmentId: IMG, alt: 'Shop front' } }).success).toBe(true)
    expect(firstMessage(parse('Image', { image: { attachmentId: '', alt: 'x' } }))).toBe('storefront.validation.imageRequired')
    expect(firstMessage(parse('Image', { image: { attachmentId: IMG, alt: ' ' } }))).toBe('storefront.validation.textRequired')
    expect(firstMessage(parse('Image', { image: { attachmentId: IMG, alt: 'x' }, href: 'javascript:alert(1)' }))).toBe('storefront.validation.unsafeHref')
    // A URL instead of an attachment id, or extra props, never pass.
    expect(parse('Image', { image: { attachmentId: IMG, alt: 'x', src: 'https://evil.example/x.png' } }).success).toBe(false)
    expect(parse('Image', { image: { attachmentId: 'https://evil.example/x.png', alt: 'x' } }).success).toBe(false)
  })

  it('bounds galleries to 2–12 images', () => {
    const one = { attachmentId: IMG, alt: 'a' }
    expect(firstMessage(parse('Gallery', { images: [one] }))).toBe('storefront.validation.galleryTooFew')
    expect(parse('Gallery', { images: [one, { attachmentId: IMG2, alt: 'b' }] }).success).toBe(true)
    expect(firstMessage(parse('Gallery', { images: Array.from({ length: 13 }, () => one) }))).toBe('storefront.validation.listTooLong')
  })

  it('needs at least one contact detail and validates phone and email', () => {
    expect(firstMessage(parse('ContactInfo', { heading: 'Contact' }))).toBe('storefront.validation.contactEmpty')
    expect(firstMessage(parse('ContactInfo', { phone: 'call me' }))).toBe('storefront.validation.phoneInvalid')
    expect(firstMessage(parse('ContactInfo', { email: 'not-an-email' }))).toBe('storefront.validation.emailInvalid')
    expect(parse('ContactInfo', { phone: '+48 (22) 600-100' }).success).toBe(true)
  })

  it('requires the call-to-action button and keeps optional Hero images optional', () => {
    expect(parse('CallToAction', { heading: 'Order now' }).success).toBe(false)
    expect(parse('CallToAction', { heading: 'Order now', cta: { label: 'Go', href: '/contact' } }).success).toBe(true)
    expect(parse('Hero', { heading: 'Hi' }).success).toBe(true)
    expect(parse('Hero', { heading: 'Hi', image: { attachmentId: IMG, alt: 'Bar' } }).success).toBe(true)
  })

  it('caps list sections and rejects unknown props', () => {
    const quote = { quote: 'Great', author: 'A' }
    expect(parse('Testimonials', { items: Array.from({ length: 7 }, () => quote) }).success).toBe(false)
    expect(parse('Faq', { items: [{ question: 'Q?', answer: 'A.', html: '<b>x</b>' }] }).success).toBe(false)
  })
})

function sectionsOf(elements: Record<string, { type: string; props: Record<string, unknown> }>): ValidatedSection[] {
  const ids = Object.keys(elements)
  const validation = validatePageSpec({
    root: 'page',
    elements: { page: { type: 'Page', props: {}, children: ids }, ...Object.fromEntries(ids.map((id) => [id, { ...elements[id], children: [] }])) },
  })
  if (!validation.ok) throw new Error(JSON.stringify(validation.issues))
  return validation.sections
}

describe('image references', () => {
  const sections = sectionsOf({
    hero: { type: 'Hero', props: { heading: 'Hi', image: { attachmentId: IMG, alt: 'a' } } },
    gallery: { type: 'Gallery', props: { images: [{ attachmentId: IMG, alt: 'a' }, { attachmentId: IMG2, alt: 'b' }] } },
    text: { type: 'RichText', props: { content: { type: 'doc', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }] } } },
  })

  it('collects every image id with the path the issue is reported on', () => {
    expect(collectSectionReferences(sections)).toEqual([
      { kind: 'image', id: IMG, path: 'elements.hero.props.image.attachmentId' },
      { kind: 'image', id: IMG, path: 'elements.gallery.props.images.0.attachmentId' },
      { kind: 'image', id: IMG2, path: 'elements.gallery.props.images.1.attachmentId' },
    ])
  })

  type Row = Record<string, unknown>
  function fakeEm(tables: Map<unknown, Row[]>) {
    const matches = (row: Row, where: Row) =>
      Object.entries(where).every(([key, value]) =>
        value && typeof value === 'object' && '$in' in (value as Row) ? ((value as { $in: unknown[] }).$in).includes(row[key]) : row[key] === value,
      )
    const queries: unknown[] = []
    return {
      queries,
      async find(entity: unknown, where: Row) {
        queries.push(entity)
        return (tables.get(entity) ?? []).filter((row) => matches(row, where))
      },
    }
  }
  const attachment = (id: string, overrides: Row = {}) => ({
    id,
    tenantId: TENANT,
    organizationId: ORG,
    entityId: PAGE_ATTACHMENT_ENTITY_ID,
    recordId: PAGE,
    mimeType: 'image/jpeg',
    ...overrides,
  })
  const pages = [{ id: PAGE, tenantId: TENANT, organizationId: ORG }]
  const scope = { tenantId: TENANT, organizationId: ORG }

  it('accepts raster images uploaded to this store\'s pages', async () => {
    const em = fakeEm(new Map<unknown, Row[]>([[Attachment, [attachment(IMG), attachment(IMG2, { mimeType: 'image/png' })]], [StorefrontPage, pages]]))
    expect(await checkSectionReferences(em as never, scope, sections)).toEqual([])
  })

  it('refuses another entity\'s file, another tenant\'s file, an SVG and a file of another organization\'s page the same way', async () => {
    for (const second of [
      attachment(IMG2, { entityId: 'customers:customer_person' }),
      attachment(IMG2, { tenantId: OTHER_TENANT }),
      attachment(IMG2, { mimeType: 'image/svg+xml' }),
      attachment(IMG2, { recordId: OTHER_PAGE }),
    ]) {
      const em = fakeEm(new Map<unknown, Row[]>([[Attachment, [attachment(IMG), second]], [StorefrontPage, [...pages, { id: OTHER_PAGE, tenantId: OTHER_TENANT, organizationId: ORG }]]]))
      expect(await checkSectionReferences(em as never, scope, sections)).toEqual([
        { path: 'elements.gallery.props.images.1.attachmentId', code: 'unknown_reference', message: 'storefront.validation.referenceNotFound' },
      ])
    }
  })

  it('does not query when a page references nothing', async () => {
    const em = fakeEm(new Map())
    expect(await checkSectionReferences(em as never, scope, sections.filter((section) => section.type === 'RichText'))).toEqual([])
    expect(em.queries).toEqual([])
  })
})
