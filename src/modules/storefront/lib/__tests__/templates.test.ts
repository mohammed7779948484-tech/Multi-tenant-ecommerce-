import { describe, expect, it } from '@jest/globals'
import { validatePageSpec } from '../blocks/pageSpec'
import { collectSectionReferences } from '../blocks/references'
import { buildStoreTemplate, listStoreTemplates, STORE_TEMPLATE_IDS, type TemplateStoreData } from '../templates'

/** TEST-021 (pure part): every template is a valid page set for any store data. */

const identity = (_key: string, fallback: string, params?: Record<string, string | number>) =>
  fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
const category = (n: number) => ({ id: `0000000${n}-0000-4000-8000-000000000000`.slice(-36), slug: n % 2 ? `cat-${n}` : null, name: `Category ${n}` })

const stores: Record<string, TemplateStoreData> = {
  empty: { storeName: 'A', description: null, categories: [] },
  one: { storeName: 'Atlas Coffee', description: 'Fresh beans.', categories: [category(1)] },
  many: { storeName: 'X'.repeat(200), description: 'Y'.repeat(400), categories: [1, 2, 3, 4, 5, 6].map(category) },
}

describe('store templates', () => {
  for (const id of STORE_TEMPLATE_IDS) {
    for (const [name, data] of Object.entries(stores)) {
      it(`${id} with ${name} store data builds valid pages with unique slugs`, () => {
        const pages = buildStoreTemplate(id, data, identity)
        expect(pages[0]!.slug).toBe('index')
        expect(new Set(pages.map((page) => page.slug)).size).toBe(pages.length)
        for (const page of pages) {
          const validation = validatePageSpec(page.spec)
          expect(validation.ok ? [] : validation.issues).toEqual([])
          expect(page.title.length).toBeLessThanOrEqual(70)
          expect((page.seoDescription ?? '').length).toBeLessThanOrEqual(160)
        }
      })
    }
  }

  it('references only the store\'s first four categories, and nothing else', () => {
    const [home] = buildStoreTemplate('classic', stores.many, identity)
    const validation = validatePageSpec(home!.spec)
    if (!validation.ok) throw new Error('invalid')
    const ids = new Set(collectSectionReferences(validation.sections).map((reference) => reference.id))
    expect([...ids].sort()).toEqual([1, 2, 3, 4].map((n) => category(n).id).sort())
  })

  it('links the hero to the first category by slug, else id, and footer links point at template pages', () => {
    const [home] = buildStoreTemplate('classic', stores.one, identity)
    const elements = home!.spec.elements
    expect(elements.hero!.props.cta).toEqual({ label: 'Shop now', href: '/collections/cat-1' })
    expect((elements.footer!.props.links as Array<{ href: string }>).map((link) => link.href)).toEqual(['/about', '/faq', '/contact'])
    const [noSlugHome] = buildStoreTemplate('classic', { ...stores.one, categories: [category(2)] }, identity)
    expect((noSlugHome!.spec.elements.hero!.props.cta as { href: string }).href).toBe(`/collections/${category(2).id}`)
  })

  it('lists templates with translated names and the pages they would draft', () => {
    const list = listStoreTemplates((key, fallback) => `${key}|${fallback}`, stores.empty)
    expect(list.map((item) => item.id)).toEqual(['classic', 'showcase'])
    expect(list[0]!.name).toBe('storefront.templates.classic.name|Classic shop')
    expect(list[0]!.pages.map((page) => page.slug)).toEqual(['index', 'about', 'faq', 'contact'])
    expect(list[1]!.pages.map((page) => page.slug)).toEqual(['index', 'contact'])
  })
})
