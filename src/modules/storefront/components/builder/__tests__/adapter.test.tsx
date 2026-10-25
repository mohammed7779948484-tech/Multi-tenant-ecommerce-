import { describe, expect, it } from '@jest/globals'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { z } from 'zod'
import { STOREFRONT_BLOCKS, STOREFRONT_BLOCK_TYPES, type StorefrontBlockType } from '../../../lib/blocks/catalog'
import { validatePageSpec } from '../../../lib/blocks/pageSpec'
import { DEFAULT_THEME_TOKENS } from '../../../lib/theme'
import { BLOCK_EDITORS, LINK_FIELDS, blockPropsToFormValues, defaultBlockProps, formValuesToBlockProps } from '../blockEditors'
import { PAGE_ROOT_PROPS_SCHEMA, builderCatalog } from '../catalog'
import { BuilderPreview } from '../BuilderPreview'
import { previewDataKey } from '../usePreviewSectionData'

/** TEST-015: the json-render adapter and the editor-field map stay in parity with the block catalog. */

const SITE_ID = '3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a'
const IMG_A = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const IMG_B = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const PRODUCT_A = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const PRODUCT_B = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'
const CATEGORY_A = 'a8098c1a-f86e-41da-8ee5-2b3c4d5e6f70'
const SECTION_LABELS = {
  contactAddress: 'Address',
  contactPhone: 'Phone',
  contactEmail: 'Email',
  contactHours: 'Opening hours',
  productsEmpty: 'Products soon',
  categoriesEmpty: 'Collections soon',
}
const identity = (_key: string, fallback: string) => fallback

type ObjectSchema = z.ZodObject<Record<string, z.ZodTypeAny>>

function unwrapObject(schema: z.ZodTypeAny): ObjectSchema {
  let current: z.ZodTypeAny = schema
  // Optional/default/array wrappers around the object (zod 4 keeps the inner type on `def`).
  for (let i = 0; i < 5; i += 1) {
    if ('shape' in current) return current as ObjectSchema
    const def = (current as unknown as { def: { innerType?: z.ZodTypeAny; element?: z.ZodTypeAny } }).def
    current = (def.innerType ?? def.element) as z.ZodTypeAny
  }
  throw new Error('not an object schema')
}

const SAMPLE_PROPS: Record<StorefrontBlockType, Record<string, unknown>> = {
  Hero: { heading: 'Fresh coffee', subheading: 'Roasted weekly', cta: { label: 'Shop', href: '/products-list' }, align: 'start' },
  RichText: {
    heading: 'Our story',
    content: {
      type: 'doc',
      blocks: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: ['bold'] }] },
        { type: 'list', ordered: false, items: [[{ type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'Map' }] }]] },
      ],
    },
  },
  Features: { heading: 'Why us', items: [{ title: 'Fast', body: 'Ships in a day.' }, { title: 'Fair', body: 'Direct trade.' }] },
  Footer: { text: 'Thanks for visiting', links: [{ label: 'About', href: '/about' }] },
  Image: { image: { attachmentId: IMG_A, alt: 'Roastery front' }, caption: 'Our shop', href: '/visit', width: 'full' },
  ImageText: {
    image: { attachmentId: IMG_B, alt: 'Beans' },
    heading: 'Roasted weekly',
    body: 'Small batches.\nShipped fresh.',
    cta: { label: 'Order', href: '/order' },
    imagePosition: 'end',
  },
  Gallery: { heading: 'Inside', images: [{ attachmentId: IMG_A, alt: 'Bar' }, { attachmentId: IMG_B, alt: 'Cups' }] },
  Testimonials: { heading: 'Kind words', items: [{ quote: 'Best beans in town.', author: 'Dana', role: 'Regular' }] },
  Faq: { heading: 'FAQ', items: [{ question: 'Do you deliver?', answer: 'Yes, cash on delivery.' }] },
  ContactInfo: { heading: 'Visit', address: '1 Main St\nTown', phone: '+48 600 100 200', email: 'hello@example.com', hours: 'Daily 8–18' },
  CallToAction: { heading: 'Questions?', body: 'We answer within a day.', cta: { label: 'Contact', href: '/contact' }, tone: 'primary' },
  ProductGrid: { heading: 'Picked for you', source: { kind: 'products', productIds: [PRODUCT_A, PRODUCT_B] }, limit: 4, showPrice: false },
  CollectionList: { heading: 'Shop by category', categoryIds: [CATEGORY_A] },
}

describe('builder catalog (json-render adapter)', () => {
  it('lists the page root plus exactly the storefront blocks', () => {
    expect([...builderCatalog.componentNames].sort()).toEqual(['Page', ...STOREFRONT_BLOCK_TYPES].sort())
  })

  it('uses each block\'s own schema object and description', () => {
    const components = (builderCatalog.data as { components: Record<string, { props: unknown; description: string }> }).components
    for (const type of STOREFRONT_BLOCK_TYPES) {
      expect(components[type].props).toBe(STOREFRONT_BLOCKS[type].props)
      expect(components[type].description).toBe(STOREFRONT_BLOCKS[type].description)
    }
    expect(components.Page.props).toBe(PAGE_ROOT_PROPS_SCHEMA)
  })
})

describe('editor-field map', () => {
  it('has one editor field per block prop and nothing else', () => {
    for (const type of STOREFRONT_BLOCK_TYPES) {
      const shape = (STOREFRONT_BLOCKS[type].props as unknown as ObjectSchema).shape
      expect(BLOCK_EDITORS[type].fields.map((field) => field.id).sort()).toEqual(Object.keys(shape).sort())
      for (const field of BLOCK_EDITORS[type].fields) {
        if (field.kind === 'list') {
          const itemShape = unwrapObject(shape[field.id]).shape
          expect(field.item.map((item) => item.id).sort()).toEqual(Object.keys(itemShape).sort())
        }
        if (field.kind === 'image' || field.kind === 'images') {
          const imageShape = unwrapObject(shape[field.id]).shape
          expect(Object.keys(imageShape).sort()).toEqual(['alt', 'attachmentId'])
        }
        if (field.kind === 'link') {
          const linkShape = unwrapObject(shape[field.id]).shape
          expect(LINK_FIELDS.map((item) => item.id).sort()).toEqual(Object.keys(linkShape).sort())
        }
      }
    }
  })

  it('round-trips sample props through the inspector form values', () => {
    for (const type of STOREFRONT_BLOCK_TYPES) {
      const values = blockPropsToFormValues(type, SAMPLE_PROPS[type])
      const result = formValuesToBlockProps(type, values)
      expect(result).toEqual({ ok: true, props: STOREFRONT_BLOCKS[type].props.parse(SAMPLE_PROPS[type]) })
    }
  })

  it('maps schema issues onto the inspector fields', () => {
    const hero = formValuesToBlockProps('Hero', { heading: '  ', cta: { label: 'Go', href: 'javascript:alert(1)' }, align: 'center' })
    expect(hero).toEqual({
      ok: false,
      fieldErrors: { heading: 'storefront.validation.textRequired', cta: 'storefront.validation.unsafeHref' },
      locations: { cta: { index: undefined, subField: 'href' } },
    })
    const text = formValuesToBlockProps('RichText', { content: 'an **unclosed' })
    expect(text).toEqual({ ok: false, fieldErrors: { content: 'storefront.validation.markupUnclosed' } })
    const features = formValuesToBlockProps('Features', { items: [{ title: '', body: '' }] })
    expect(features).toEqual({ ok: false, fieldErrors: { items: 'storefront.validation.listTooShort' } })
    const halfItem = formValuesToBlockProps('Features', { items: [{ title: 'Only a title', body: '' }] })
    expect(halfItem).toEqual({
      ok: false,
      fieldErrors: { items: 'storefront.validation.textRequired' },
      locations: { items: { index: 0, subField: 'body' } },
    })
  })

  it('starts every new section with valid props, except that image and catalog sections wait for a choice', () => {
    const needsImage: Record<string, string> = { Image: 'image', ImageText: 'image', Gallery: 'images', ProductGrid: 'source', CollectionList: 'categoryIds' }
    for (const type of STOREFRONT_BLOCK_TYPES) {
      const parsed = STOREFRONT_BLOCKS[type].props.safeParse(defaultBlockProps(type, identity))
      if (needsImage[type]) {
        expect(parsed.success).toBe(false)
        expect(parsed.error!.issues.every((issue) => issue.path[0] === needsImage[type])).toBe(true)
      } else {
        expect(parsed.success).toBe(true)
      }
    }
  })

  it('asks for an image and its alt text on image fields', () => {
    expect(formValuesToBlockProps('Image', { image: { attachmentId: '', alt: '' }, width: 'contained' })).toMatchObject({
      ok: false,
      fieldErrors: { image: 'storefront.validation.imageRequired' },
    })
    expect(formValuesToBlockProps('Gallery', { images: [{ attachmentId: IMG_A, alt: 'One' }] })).toEqual({
      ok: false,
      fieldErrors: { images: 'storefront.validation.galleryTooFew' },
    })
    expect(formValuesToBlockProps('Gallery', { images: [{ attachmentId: IMG_A, alt: 'One' }, { attachmentId: IMG_B, alt: ' ' }] })).toEqual({
      ok: false,
      fieldErrors: { images: 'storefront.validation.textRequired' },
      locations: { images: { index: 1, subField: 'alt' } },
    })
    // An optional image (Hero) is simply left out when nothing was uploaded.
    expect(formValuesToBlockProps('Hero', { heading: 'Hi', image: { attachmentId: '', alt: '' }, align: 'center' })).toEqual({
      ok: true,
      props: { heading: 'Hi', align: 'center' },
    })
  })
})

describe('catalog editor fields', () => {
  it('stores only the chosen product source and keeps the other choice in the form', () => {
    const values = blockPropsToFormValues('ProductGrid', { source: { kind: 'category', categoryId: CATEGORY_A } })
    expect(values.source).toEqual({ kind: 'category', categoryId: CATEGORY_A, productIds: [] })
    expect(values.showPrice).toBe(true)
    const switched = { ...values, source: { kind: 'products', categoryId: CATEGORY_A, productIds: [PRODUCT_A] } }
    expect(formValuesToBlockProps('ProductGrid', switched)).toEqual({
      ok: true,
      props: { source: { kind: 'products', productIds: [PRODUCT_A] }, limit: 8, showPrice: true },
    })
  })

  it('names the missing category, products and categories, and rejects an out-of-range count', () => {
    expect(formValuesToBlockProps('ProductGrid', { source: { kind: 'category', categoryId: '', productIds: [] } })).toMatchObject({
      ok: false,
      fieldErrors: { source: 'storefront.validation.categoryRequired' },
    })
    expect(formValuesToBlockProps('ProductGrid', { source: { kind: 'products', categoryId: '', productIds: [] } })).toMatchObject({
      ok: false,
      fieldErrors: { source: 'storefront.validation.productsRequired' },
    })
    expect(formValuesToBlockProps('ProductGrid', { source: { kind: 'category', categoryId: CATEGORY_A }, limit: '13' })).toEqual({
      ok: false,
      fieldErrors: { limit: 'storefront.validation.numberRange' },
    })
    expect(formValuesToBlockProps('CollectionList', { categoryIds: [] })).toMatchObject({
      ok: false,
      fieldErrors: { categoryIds: 'storefront.validation.categoriesRequired' },
    })
  })
})

describe('preview registry', () => {
  it('renders every block through json-render with the public block components', () => {
    const spec = {
      root: 'page',
      elements: {
        page: { type: 'Page', props: {}, children: STOREFRONT_BLOCK_TYPES.map((type) => type.toLowerCase()) },
        ...Object.fromEntries(
          STOREFRONT_BLOCK_TYPES.map((type) => [type.toLowerCase(), { type, props: SAMPLE_PROPS[type], children: [] }]),
        ),
      },
    }
    expect(validatePageSpec(spec).ok).toBe(true)
    const html = renderToStaticMarkup(
      <BuilderPreview
        spec={spec}
        siteId={SITE_ID}
        storeName="Acme"
        basePath="/acme"
        logoSrc={null}
        tokens={DEFAULT_THEME_TOKENS}
        labels={{ home: 'Acme home', unavailable: 'Preview unavailable', sections: SECTION_LABELS }}
      />,
    )
    expect(html).toContain(`data-sf-site="${SITE_ID}"`)
    expect(html).toContain('<h1>Fresh coffee</h1>')
    expect(html).toContain('href="/acme/products-list"')
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('Ships in a day.')
    expect(html).toContain('href="/acme/about"')
    // Staff preview images come from the authenticated attachments route.
    expect(html).toContain(`/api/attachments/image/${IMG_A}?width=`)
    expect(html).toContain('alt="Roastery front"')
    expect(html).toContain('<details><summary>Do you deliver?</summary>')
    expect(html).toContain('href="tel:+48600100200"')
    expect(html).toContain('href="mailto:hello@example.com"')
    expect(html).toContain('<blockquote class="sf-pre-line">Best beans in town.</blockquote>')
    expect(html).not.toContain('Preview unavailable')
    // Only the first section renders the page heading.
    expect(html.match(/<h1>/g)).toHaveLength(1)
  })

  it('renders commerce sections from preview data keyed by their props, and the empty text without it', () => {
    const spec = {
      root: 'page',
      elements: {
        page: { type: 'Page', props: {}, children: ['grid', 'collections'] },
        grid: { type: 'ProductGrid', props: SAMPLE_PROPS.ProductGrid, children: [] },
        collections: { type: 'CollectionList', props: SAMPLE_PROPS.CollectionList, children: [] },
      },
    }
    const sectionData = new Map([
      [
        previewDataKey('ProductGrid', SAMPLE_PROPS.ProductGrid)!,
        {
          products: [
            { id: PRODUCT_A, title: 'House blend', subtitle: null, href: '/acme/products/house-blend', image: { attachmentId: IMG_A, alt: 'House blend' }, price: { amount: 12, currencyCode: 'EUR', formatted: '€12.00' } },
          ],
        },
      ],
    ])
    const props = {
      spec,
      siteId: SITE_ID,
      storeName: 'Acme',
      basePath: '/acme',
      logoSrc: null,
      tokens: DEFAULT_THEME_TOKENS,
      labels: { home: 'Acme home', unavailable: 'Preview unavailable', sections: SECTION_LABELS },
    }
    const html = renderToStaticMarkup(<I18nProvider locale="en" dict={{}}><BuilderPreview {...props} sectionData={sectionData} /></I18nProvider>)
    expect(html).toContain('House blend')
    expect(html).toContain('href="/acme/products/house-blend"')
    expect(html).toContain(`/api/attachments/image/${IMG_A}?width=`)
    // showPrice: false hides the price even when the data has one.
    expect(html).not.toContain('€12.00')
    expect(html).toContain('Collections soon')
    const empty = renderToStaticMarkup(<I18nProvider locale="en" dict={{}}><BuilderPreview {...props} /></I18nProvider>)
    expect(empty).toContain('Products soon')
    expect(empty).not.toContain('Preview unavailable')
  })

  it('shows a placeholder for a section whose props do not validate', () => {
    const spec = {
      root: 'page',
      elements: {
        page: { type: 'Page', props: {}, children: ['hero', 'footer'] },
        hero: { type: 'Hero', props: { heading: '' }, children: [] },
        footer: { type: 'Footer', props: { links: [{ label: 'x', href: 'javascript:alert(1)' }] }, children: [] },
      },
    }
    const html = renderToStaticMarkup(
      <BuilderPreview
        spec={spec}
        siteId={SITE_ID}
        storeName="Acme"
        basePath="/acme"
        logoSrc={null}
        tokens={DEFAULT_THEME_TOKENS}
        labels={{ home: 'Acme home', unavailable: 'Preview unavailable', sections: SECTION_LABELS }}
      />,
    )
    expect(html.match(/Preview unavailable/g)).toHaveLength(2)
    expect(html).not.toContain('javascript:')
  })
})
