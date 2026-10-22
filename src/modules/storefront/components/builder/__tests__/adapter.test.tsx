import { describe, expect, it } from '@jest/globals'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { z } from 'zod'
import { STOREFRONT_BLOCKS, STOREFRONT_BLOCK_TYPES, type StorefrontBlockType } from '../../../lib/blocks/catalog'
import { validatePageSpec } from '../../../lib/blocks/pageSpec'
import { DEFAULT_THEME_TOKENS } from '../../../lib/theme'
import { BLOCK_EDITORS, LINK_FIELDS, blockPropsToFormValues, defaultBlockProps, formValuesToBlockProps } from '../blockEditors'
import { PAGE_ROOT_PROPS_SCHEMA, builderCatalog } from '../catalog'
import { BuilderPreview } from '../BuilderPreview'

/** TEST-015: the json-render adapter and the editor-field map stay in parity with the block catalog. */

const SITE_ID = '3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a'
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

  it('starts every new section with valid props', () => {
    for (const type of STOREFRONT_BLOCK_TYPES) {
      expect(STOREFRONT_BLOCKS[type].props.safeParse(defaultBlockProps(type, identity)).success).toBe(true)
    }
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
        labels={{ home: 'Acme home', signIn: 'Sign in', unavailable: 'Preview unavailable' }}
      />,
    )
    expect(html).toContain(`data-sf-site="${SITE_ID}"`)
    expect(html).toContain('<h1>Fresh coffee</h1>')
    expect(html).toContain('href="/acme/products-list"')
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('Ships in a day.')
    expect(html).toContain('href="/acme/about"')
    expect(html).not.toContain('Preview unavailable')
    // Only the first section renders the page heading.
    expect(html.match(/<h1>/g)).toHaveLength(1)
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
        labels={{ home: 'Acme home', signIn: 'Sign in', unavailable: 'Preview unavailable' }}
      />,
    )
    expect(html.match(/Preview unavailable/g)).toHaveLength(2)
    expect(html).not.toContain('javascript:')
  })
})
