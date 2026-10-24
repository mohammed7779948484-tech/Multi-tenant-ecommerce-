import { describe, expect, it } from '@jest/globals'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CatalogProduct, CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
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
const PRODUCT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PRODUCT2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CATEGORY = '12121212-1212-4121-8121-121212121212'

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

describe('Phase 3b commerce section schemas', () => {
  it('takes either a category or 1–12 distinct products, with defaults for count and prices', () => {
    const byCategory = parse('ProductGrid', { source: { kind: 'category', categoryId: CATEGORY } })
    expect(byCategory.success && byCategory.data).toEqual({ source: { kind: 'category', categoryId: CATEGORY }, limit: 8, showPrice: true })
    expect(firstMessage(parse('ProductGrid', { source: { kind: 'category', categoryId: '' } }))).toBe('storefront.validation.categoryRequired')
    expect(firstMessage(parse('ProductGrid', { source: { kind: 'products', productIds: [] } }))).toBe('storefront.validation.productsRequired')
    expect(firstMessage(parse('ProductGrid', { source: { kind: 'products', productIds: [PRODUCT, PRODUCT] } }))).toBe('storefront.validation.duplicateItems')
    expect(parse('ProductGrid', { source: { kind: 'products', productIds: Array.from({ length: 13 }, () => PRODUCT) } }).success).toBe(false)
    expect(parse('ProductGrid', { source: { kind: 'category', categoryId: CATEGORY }, limit: 13 }).success).toBe(false)
    // Mixing both kinds, or a product query instead of ids, never passes.
    expect(parse('ProductGrid', { source: { kind: 'category', categoryId: CATEGORY, productIds: [PRODUCT] } }).success).toBe(false)
    expect(parse('ProductGrid', { source: { kind: 'query', where: { tenantId: OTHER_TENANT } } }).success).toBe(false)
  })

  it('takes 1–12 distinct categories for a collection list', () => {
    expect(parse('CollectionList', { categoryIds: [CATEGORY] }).success).toBe(true)
    expect(firstMessage(parse('CollectionList', { categoryIds: [] }))).toBe('storefront.validation.categoriesRequired')
    expect(firstMessage(parse('CollectionList', { categoryIds: [CATEGORY, CATEGORY] }))).toBe('storefront.validation.duplicateItems')
  })
})

describe('catalog references', () => {
  const sections = sectionsOf({
    picked: { type: 'ProductGrid', props: { source: { kind: 'products', productIds: [PRODUCT, PRODUCT2] } } },
    'by-category': { type: 'ProductGrid', props: { source: { kind: 'category', categoryId: CATEGORY } } },
    collections: { type: 'CollectionList', props: { categoryIds: [CATEGORY] } },
  })
  type Row = Record<string, unknown>
  const fakeEm = (tables: Map<unknown, Row[]>) => ({
    async find(entity: unknown, where: Row) {
      const ids = (where.id as { $in: unknown[] }).$in
      return (tables.get(entity) ?? []).filter((row) => ids.includes(row.id) && row.tenantId === where.tenantId && row.organizationId === where.organizationId)
    },
  })
  const scope = { tenantId: TENANT, organizationId: ORG }
  const own = (id: string, extra: Row = {}) => ({ id, tenantId: TENANT, organizationId: ORG, ...extra })

  it('collects product and category ids with their issue paths', () => {
    expect(collectSectionReferences(sections)).toEqual([
      { kind: 'product', id: PRODUCT, path: 'elements.picked.props.source.productIds.0' },
      { kind: 'product', id: PRODUCT2, path: 'elements.picked.props.source.productIds.1' },
      { kind: 'category', id: CATEGORY, path: 'elements.by-category.props.source.categoryId' },
      { kind: 'category', id: CATEGORY, path: 'elements.collections.props.categoryIds.0' },
    ])
  })

  it('accepts this organization\'s rows, including inactive or deleted ones', async () => {
    const em = fakeEm(
      new Map<unknown, Row[]>([
        [CatalogProduct, [own(PRODUCT), own(PRODUCT2, { isActive: false, deletedAt: new Date() })]],
        [CatalogProductCategory, [own(CATEGORY)]],
      ]),
    )
    expect(await checkSectionReferences(em as never, scope, sections)).toEqual([])
  })

  it('refuses another tenant\'s or organization\'s product and category with the same issue as an unknown id', async () => {
    const em = fakeEm(
      new Map<unknown, Row[]>([
        [CatalogProduct, [own(PRODUCT), { id: PRODUCT2, tenantId: OTHER_TENANT, organizationId: ORG }]],
        [CatalogProductCategory, [{ id: CATEGORY, tenantId: TENANT, organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]],
      ]),
    )
    const issue = (path: string) => ({ path, code: 'unknown_reference', message: 'storefront.validation.referenceNotFound' })
    expect(await checkSectionReferences(em as never, scope, sections)).toEqual([
      issue('elements.picked.props.source.productIds.1'),
      issue('elements.by-category.props.source.categoryId'),
      issue('elements.collections.props.categoryIds.0'),
    ])
  })
})
