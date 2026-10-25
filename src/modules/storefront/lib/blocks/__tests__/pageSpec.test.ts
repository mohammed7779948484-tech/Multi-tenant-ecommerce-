import { describe, expect, it } from '@jest/globals'
import { MAX_SECTIONS_PER_PAGE, validatePageSpec } from '../pageSpec'
import { buildDefaultHomeSpec } from '../defaultHome'
import { STOREFRONT_BLOCKS, STOREFRONT_BLOCK_TYPES } from '../catalog'
import { isSafeHref } from '../schemas'

type Spec = { root: string; elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> }

function specWith(section: { type: string; props: Record<string, unknown>; children?: string[] }): Spec {
  return {
    root: 'page',
    elements: {
      page: { type: 'Page', props: {}, children: ['s1'] },
      s1: { type: section.type, props: section.props, children: section.children ?? [] },
    },
  }
}

const hero = (props: Record<string, unknown>) => specWith({ type: 'Hero', props: { heading: 'Hi', ...props } })

function issueCodes(raw: unknown): string[] {
  const result = validatePageSpec(raw)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('TEST-001 page spec validation', () => {
  it('accepts the default home template', () => {
    const result = validatePageSpec(buildDefaultHomeSpec({ storeName: 'Acme Store', description: 'Fine goods' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.sections.map((section) => section.type)).toEqual(['Hero', 'Features', 'RichText', 'Footer'])
  })

  it('accepts the default template for extreme store names', () => {
    for (const name of ['x'.repeat(200), '</script><script>alert(1)</script>', '   ', 'متجر سوقنا']) {
      expect(validatePageSpec(buildDefaultHomeSpec({ storeName: name })).ok).toBe(true)
    }
  })

  it('rejects an unknown block type', () => {
    expect(issueCodes(specWith({ type: 'Script', props: {} }))).toContain('unknown_block')
    expect(issueCodes(specWith({ type: 'constructor', props: {} }))).toContain('unknown_block')
  })

  it.each([
    ['className', { className: 'evil' }],
    ['style', { style: { color: 'red' } }],
    ['dangerouslySetInnerHTML', { dangerouslySetInnerHTML: { __html: '<img onerror=1>' } }],
    ['ref', { ref: 'x' }],
  ])('rejects the merchant-controlled prop %s', (_name, extra) => {
    expect(issueCodes(hero(extra))).toContain('unknown_prop')
  })

  it('rejects json-render dynamic expressions in props', () => {
    expect(validatePageSpec(hero({ heading: { $state: '/user/name' } })).ok).toBe(false)
    expect(validatePageSpec(hero({ subheading: { $cond: { $state: '/x' }, $then: 'a', $else: 'b' } })).ok).toBe(false)
    expect(validatePageSpec(hero({ heading: { $t: 'greeting' } })).ok).toBe(false)
  })

  it('rejects json-render element fields we do not support', () => {
    const spec = specWith({ type: 'Hero', props: { heading: 'Hi' } }) as unknown as Record<string, any>
    spec.elements.s1.visible = { $state: '/x' }
    expect(validatePageSpec(spec).ok).toBe(false)
    const withOn = specWith({ type: 'Hero', props: { heading: 'Hi' } }) as unknown as Record<string, any>
    withOn.elements.s1.on = { press: { action: 'setState' } }
    expect(validatePageSpec(withOn).ok).toBe(false)
  })

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'http://example.com', '//evil.example', '/\\evil', 'https://user:pw@evil.example', ' javascript:x', 'vbscript:x', '/a\u0000b', '/../backend', '/a/../../api/x', '/%2e%2e/other-store', '/./x', '/..', 'https:example.com', 'https:/example.com', 'HTTPS:example.com'])(
    'rejects the href %p',
    (href) => {
      expect(validatePageSpec(hero({ cta: { label: 'Go', href } })).ok).toBe(false)
    },
  )

  it.each(['/', '/about', '/products?sort=new#top', 'https://example.com/path', '/.well-known/x', '/a..b', '/x?next=../y'])('accepts the href %p', (href) => {
    expect(isSafeHref(href)).toBe(true)
    expect(validatePageSpec(hero({ cta: { label: 'Go', href } })).ok).toBe(true)
  })

  it('rejects links inside rich text that are unsafe', () => {
    const spec = specWith({
      type: 'RichText',
      props: {
        content: {
          type: 'doc',
          blocks: [{ type: 'paragraph', children: [{ type: 'link', href: 'javascript:alert(1)', children: [{ type: 'text', text: 'x' }] }] }],
        },
      },
    })
    expect(validatePageSpec(spec).ok).toBe(false)
  })

  it('rejects HTML-shaped rich text nodes but keeps HTML-looking text as text', () => {
    const htmlNode = specWith({ type: 'RichText', props: { content: { type: 'doc', blocks: [{ type: 'html', value: '<b>x</b>' }] } } })
    expect(validatePageSpec(htmlNode).ok).toBe(false)
    const htmlText = specWith({
      type: 'RichText',
      props: { content: { type: 'doc', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: '<b>not markup</b>' }] }] } },
    })
    expect(validatePageSpec(htmlText).ok).toBe(true)
  })

  it('enforces text length limits with a field path', () => {
    const result = validatePageSpec(hero({ subheading: 'x'.repeat(201) }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]).toMatchObject({ path: 'elements.s1.props.subheading', code: 'invalid_prop' })
  })

  it('rejects dangling, duplicated, orphaned and nested elements', () => {
    expect(issueCodes({ root: 'page', elements: { page: { type: 'Page', props: {}, children: ['missing'] } } })).toContain('missing_child')
    const dup = specWith({ type: 'Hero', props: { heading: 'Hi' } })
    dup.elements.page.children = ['s1', 's1']
    expect(issueCodes(dup)).toContain('duplicate_reference')
    const orphan = specWith({ type: 'Hero', props: { heading: 'Hi' } })
    orphan.elements.loose = { type: 'Hero', props: { heading: 'x' }, children: [] }
    expect(issueCodes(orphan)).toContain('orphan_element')
    expect(issueCodes(specWith({ type: 'Hero', props: { heading: 'Hi' }, children: ['page'] }))).toContain('nested_children')
    expect(issueCodes({ root: 'page', elements: { page: { type: 'Hero', props: {}, children: [] } } })).toContain('invalid_root')
  })

  it('caps sections per page and spec size', () => {
    const many: Spec = { root: 'page', elements: { page: { type: 'Page', props: {}, children: [] } } }
    for (let i = 0; i <= MAX_SECTIONS_PER_PAGE; i += 1) {
      many.elements.page.children.push(`s${i}`)
      many.elements[`s${i}`] = { type: 'Hero', props: { heading: `H${i}` }, children: [] }
    }
    expect(issueCodes(many)).toContain('too_many_sections')
    const huge = hero({ heading: 'x' })
    ;(huge.elements as Record<string, unknown>).padding = { type: 'Hero', props: { heading: 'x'.repeat(70_000) }, children: [] }
    expect(issueCodes(huge)).toEqual(['too_large'])
  })

  it('rejects non-objects and unexpected top-level keys', () => {
    expect(validatePageSpec(null).ok).toBe(false)
    expect(validatePageSpec('page').ok).toBe(false)
    expect(validatePageSpec({ ...hero({}), script: 'x' }).ok).toBe(false)
  })

  it('keeps the catalog in the json-render component shape', () => {
    for (const type of STOREFRONT_BLOCK_TYPES) {
      expect(typeof STOREFRONT_BLOCKS[type].description).toBe('string')
      expect(typeof STOREFRONT_BLOCKS[type].props.safeParse).toBe('function')
    }
  })
})
