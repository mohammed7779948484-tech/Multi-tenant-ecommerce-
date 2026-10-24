import { expect, test, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-005: the assembled store's sections (spec TEST-013).
 * Part a — media and content sections, page images and the media route.
 * Part b — commerce sections, product and collection pages, the visibility rule,
 * product images on the media route, catalog references and preview data.
 *
 * Runs as the env-configured superadmin's organization; every page and upload it
 * creates is removed afterwards.
 */

const LOCK = 'x-om-ext-optimistic-lock-expected-updated-at'
const RUN = Date.now().toString(36)
const PAGE_ENTITY = 'storefront:storefront_page'

type PageItem = { id: string; slug: string; updatedAt: string }
type Issue = { path: string; code: string }

async function getPage(request: APIRequestContext, token: string, id: string): Promise<PageItem> {
  const res = await apiRequest(request, 'GET', `/api/storefront/pages?id=${id}`, { token })
  expect(res.status()).toBe(200)
  return (await readJsonSafe<{ items: PageItem[] }>(res))!.items[0]!
}

async function saveDraft(request: APIRequestContext, token: string, id: string, draftSpec: unknown) {
  const page = await getPage(request, token, id)
  return apiRequest(request, 'PUT', '/api/storefront/pages', { token, data: { id, draftSpec }, headers: { [LOCK]: page.updatedAt } })
}

async function publish(request: APIRequestContext, token: string, id: string) {
  const page = await getPage(request, token, id)
  return apiRequest(request, 'POST', `/api/storefront/pages/${id}/publish`, { token, data: {}, headers: { [LOCK]: page.updatedAt } })
}

function spec(elements: Record<string, { type: string; props: Record<string, unknown> }>) {
  const ids = Object.keys(elements)
  return {
    root: 'page',
    elements: { page: { type: 'Page', props: {}, children: ids }, ...Object.fromEntries(ids.map((id) => [id, { ...elements[id], children: [] }])) },
  }
}

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .jpeg({ quality: 90 })
    .toBuffer()
}

test.describe('TC-STOREFRONT-005a: media and content sections', () => {
  let token = ''
  let siteSlug = ''
  let siteId = ''
  let pageId = ''
  const uploads: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    const brand = await readJsonSafe<{ slug: string; siteId: string }>(await apiRequest(request, 'GET', '/api/storefront/brand', { token }))
    siteSlug = brand!.slug
    siteId = brand!.siteId
    const created = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: 'Media check', slug: `tc5-media-${RUN}` } })
    expect(created.status()).toBe(201)
    pageId = (await readJsonSafe<{ id: string }>(created))!.id
  })

  test.afterAll(async ({ request }) => {
    if (pageId) {
      const page = await getPage(request, token, pageId).catch(() => null)
      if (page) await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${pageId}`, { token, headers: { [LOCK]: page.updatedAt } })
    }
    for (const id of uploads) await deleteAttachmentIfExists(request, token, id)
  })

  async function upload(request: APIRequestContext, entityId: string, recordId: string, name: string, buffer: Buffer, mimeType = 'image/jpeg') {
    const item = await uploadAttachmentFixture(request, token, { entityId, recordId, fileName: name, mimeType, buffer })
    uploads.push(item.id)
    return item.id
  }

  test('page images: checked on save, publish and rollback; public only while published; resized on request', async ({ request }) => {
    test.setTimeout(240_000)
    const big = await noisyJpeg(1600, 1200)
    const photo = await upload(request, PAGE_ENTITY, pageId, 'shop.jpg', big)
    const second = await upload(request, PAGE_ENTITY, pageId, 'cups.png', await sharp(await noisyJpeg(400, 400)).png().toBuffer(), 'image/png')
    const unreferenced = await upload(request, PAGE_ENTITY, pageId, 'spare.jpg', await noisyJpeg(300, 300))
    // Same organization, another entity: never usable in a page.
    const otherEntity = await upload(request, 'storefront:storefront_site', siteId, 'other.jpg', await noisyJpeg(300, 300))

    for (const id of [otherEntity, '00000000-0000-4000-8000-000000000000']) {
      const refused = await saveDraft(request, token, pageId, spec({ pic: { type: 'Image', props: { image: { attachmentId: id, alt: 'x' } } } }))
      expect(refused.status()).toBe(422)
      const body = await readJsonSafe<{ issues: Issue[] }>(refused)
      expect(body!.issues).toEqual([expect.objectContaining({ path: 'elements.pic.props.image.attachmentId', code: 'unknown_reference' })])
    }

    const full = spec({
      hero: { type: 'Hero', props: { heading: `Store ${RUN}`, image: { attachmentId: photo, alt: 'Our shop front' } } },
      gallery: { type: 'Gallery', props: { heading: 'Inside', images: [{ attachmentId: photo, alt: 'The bar' }, { attachmentId: second, alt: 'Cups' }] } },
      story: { type: 'ImageText', props: { image: { attachmentId: second, alt: 'Beans' }, heading: 'Roasted weekly', body: 'Small batches.\nShipped fresh.', imagePosition: 'end' } },
      pic: { type: 'Image', props: { image: { attachmentId: photo, alt: 'Wide shot' }, caption: 'Since 2019', width: 'full' } },
      quotes: { type: 'Testimonials', props: { items: [{ quote: `Best beans ${RUN}`, author: 'Dana', role: 'Regular' }] } },
      faq: { type: 'Faq', props: { items: [{ question: 'Do you deliver?', answer: 'Yes, cash on delivery.' }] } },
      contact: { type: 'ContactInfo', props: { phone: '+48 600 100 200', email: 'hello@example.com', hours: 'Daily 8–18' } },
      cta: { type: 'CallToAction', props: { heading: 'Questions?', cta: { label: 'Write to us', href: '/contact' }, tone: 'primary' } },
    })
    expect((await saveDraft(request, token, pageId, full)).status()).toBe(200)
    // A draft never makes an image public.
    expect((await request.get(`/api/storefront/media/${siteSlug}/${photo}`)).status()).toBe(404)

    const first = await publish(request, token, pageId)
    expect(first.status()).toBe(200)
    const firstRevision = (await readJsonSafe<{ revisionId: string }>(first))!.revisionId

    const html = await (await request.get(`/${siteSlug}/tc5-media-${RUN}`)).text()
    expect(html).toContain(`/api/storefront/media/${siteSlug}/${photo}?w=640 640w`)
    expect(html).toContain('alt="Our shop front"')
    expect(html).toContain('<details><summary>Do you deliver?</summary>')
    expect(html).toContain('href="tel:+48600100200"')
    expect(html).toContain('href="mailto:hello@example.com"')
    expect(html).toContain(`Best beans ${RUN}`)
    expect(html).toContain(`href="/${siteSlug}/contact"`)
    expect(html.toLowerCase()).not.toContain('json-render')

    const original = await request.get(`/api/storefront/media/${siteSlug}/${photo}`)
    expect(original.status()).toBe(200)
    expect(original.headers()['content-type']).toBe('image/jpeg')
    const resized = await request.get(`/api/storefront/media/${siteSlug}/${photo}?w=640`)
    expect(resized.status()).toBe(200)
    const resizedBody = await resized.body()
    expect(resizedBody.byteLength).toBeLessThan((await original.body()).byteLength)
    expect((await sharp(resizedBody).metadata()).width).toBe(640)
    // Never upscaled: the 400 px PNG stays 400 px at w=960.
    expect((await sharp(await (await request.get(`/api/storefront/media/${siteSlug}/${second}?w=960`)).body()).metadata()).width).toBe(400)
    expect((await request.get(`/api/storefront/media/${siteSlug}/${photo}?w=500`)).status()).toBe(404)
    expect((await request.get(`/api/storefront/media/${siteSlug}/${unreferenced}`)).status()).toBe(404)
    expect((await request.get(`/api/storefront/media/${siteSlug}/${otherEntity}`)).status()).toBe(404)

    // Without the PNG, a new revision publishes; once the PNG is deleted, rolling back to revision 1 is refused.
    const withoutSecond = spec({ hero: { type: 'Hero', props: { heading: `Store ${RUN}`, image: { attachmentId: photo, alt: 'Our shop front' } } } })
    expect((await saveDraft(request, token, pageId, withoutSecond)).status()).toBe(200)
    expect((await publish(request, token, pageId)).status()).toBe(200)
    expect((await request.get(`/api/storefront/media/${siteSlug}/${second}`)).status()).toBe(404)
    await deleteAttachmentIfExists(request, token, second)
    const page = await getPage(request, token, pageId)
    const rollback = await apiRequest(request, 'POST', `/api/storefront/pages/${pageId}/rollback`, {
      token,
      data: { revisionId: firstRevision },
      headers: { [LOCK]: page.updatedAt },
    })
    expect(rollback.status()).toBe(422)
    expect((await readJsonSafe<{ issues: Issue[] }>(rollback))!.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unknown_reference' })]),
    )
  })
})

test.describe('TC-STOREFRONT-005b: commerce sections and catalog pages', () => {
  let token = ''
  let siteSlug = ''
  let pageId = ''
  const pageSlug = `tc5-shop-${RUN}`
  const ids = { parent: '', child: '', unrelated: '', a: '', b: '', inactive: '', picked: '', hidden: '' }
  const images = { a: '', hidden: '' }
  const handle = (name: string) => `tc5b-${name}-${RUN}`
  const uploads: string[] = []

  let orgCookie = ''

  /** Catalog writes need a selected organization: the session's own, the one the store belongs to. */
  function catalog(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
    return apiRequest(request, method, path, { token, data, headers: { Cookie: orgCookie } })
  }

  async function create(request: APIRequestContext, path: string, data: Record<string, unknown>) {
    const res = await catalog(request, 'POST', path, data)
    expect(res.status(), await res.text()).toBe(201)
    return (await readJsonSafe<{ id: string }>(res))!.id
  }

  const product = (request: APIRequestContext, name: string, data: Record<string, unknown>) =>
    create(request, '/api/catalog/products', {
      title: `Product ${name} ${RUN}`,
      handle: handle(name),
      sku: `TC5B-${name}-${RUN}`.toUpperCase(),
      description: 'A product created by the storefront integration test.',
      ...data,
    })

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { orgId?: string }
    orgCookie = `om_selected_org=${claims.orgId}`
    siteSlug = (await readJsonSafe<{ slug: string }>(await apiRequest(request, 'GET', '/api/storefront/brand', { token })))!.slug
    ids.parent = await create(request, '/api/catalog/categories', { name: `Coffee ${RUN}`, slug: handle('coffee') })
    ids.child = await create(request, '/api/catalog/categories', { name: `Beans ${RUN}`, parentId: ids.parent })
    ids.unrelated = await create(request, '/api/catalog/categories', { name: `Tea ${RUN}`, slug: handle('tea') })
    ids.a = await product(request, 'a', { categoryIds: [ids.child], subtitle: 'House blend' })
    ids.b = await product(request, 'b', { categoryIds: [ids.parent] })
    ids.inactive = await product(request, 'off', { categoryIds: [ids.child], isActive: false })
    ids.picked = await product(request, 'picked', {})
    ids.hidden = await product(request, 'hidden', { categoryIds: [ids.unrelated] })

    const kinds = await readJsonSafe<{ items: Array<{ id: string; code: string }> }>(await catalog(request, 'GET', '/api/catalog/price-kinds?pageSize=100'))
    const regular = kinds!.items.find((kind) => kind.code === 'regular') ?? kinds!.items[0]
    await create(request, '/api/catalog/prices', { productId: ids.a, priceKindId: regular!.id, currencyCode: 'EUR', unitPriceNet: '12.50', unitPriceGross: '12.50' })

    for (const [key, productId] of [['a', ids.a], ['hidden', ids.hidden]] as const) {
      const item = await uploadAttachmentFixture(request, token, {
        entityId: 'catalog:catalog_product',
        recordId: productId,
        fileName: `${key}.jpg`,
        mimeType: 'image/jpeg',
        buffer: await noisyJpeg(800, 800),
      })
      images[key] = item.id
      uploads.push(item.id)
    }

    const created = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: 'Shop check', slug: pageSlug } })
    expect(created.status()).toBe(201)
    pageId = (await readJsonSafe<{ id: string }>(created))!.id
    const draft = spec({
      grid: { type: 'ProductGrid', props: { heading: 'From the coffee shelf', source: { kind: 'category', categoryId: ids.parent } } },
      picks: { type: 'ProductGrid', props: { heading: 'Staff picks', source: { kind: 'products', productIds: [ids.picked] }, showPrice: false } },
      collections: { type: 'CollectionList', props: { heading: 'Shop by category', categoryIds: [ids.parent] } },
    })
    const saved = await saveDraft(request, token, pageId, draft)
    expect(saved.status(), await saved.text()).toBe(200)
    expect((await publish(request, token, pageId)).status()).toBe(200)
  })

  test.afterAll(async ({ request }) => {
    if (pageId) {
      const page = await getPage(request, token, pageId).catch(() => null)
      if (page) await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${pageId}`, { token, headers: { [LOCK]: page.updatedAt } })
    }
    for (const id of uploads) await deleteAttachmentIfExists(request, token, id)
    for (const id of [ids.a, ids.b, ids.inactive, ids.picked, ids.hidden]) if (id) await catalog(request, 'DELETE', `/api/catalog/products?id=${id}`).catch(() => null)
    for (const id of [ids.child, ids.parent, ids.unrelated]) if (id) await catalog(request, 'DELETE', `/api/catalog/categories?id=${id}`).catch(() => null)
  })

  test('the published page shows exactly the visible products, with prices and product images', async ({ request }) => {
    const html = await (await request.get(`/${siteSlug}/${pageSlug}`)).text()
    expect(html).toContain(`Product a ${RUN}`)
    expect(html).toContain(`Product b ${RUN}`)
    expect(html).toContain(`Product picked ${RUN}`)
    expect(html).not.toContain(`Product off ${RUN}`)
    expect(html).not.toContain(`Product hidden ${RUN}`)
    expect(html).toContain('€12.50')
    expect(html).toContain(`href="/${siteSlug}/products/${handle('a')}"`)
    expect(html).toContain(`/api/storefront/media/${siteSlug}/${images.a}`)
    // The collection card links by slug and uses a product image as its cover.
    expect(html).toContain(`href="/${siteSlug}/collections/${handle('coffee')}"`)
    expect(html).toContain(`Coffee ${RUN}`)
    // Its cover comes from the sub-category's product: the parent has no product with an image.
    const collectionCard = html.slice(html.indexOf('sf-collection'), html.indexOf('</li>', html.indexOf('sf-collection')))
    expect(collectionCard).toContain(`/api/storefront/media/${siteSlug}/${images.a}`)
  })

  test('product pages: visible products only, canonical by handle', async ({ request }) => {
    const page = await request.get(`/${siteSlug}/products/${handle('a')}`)
    expect(page.status()).toBe(200)
    const html = await page.text()
    expect(html).toContain(`<h1 class="sf-product-heading">Product a ${RUN}</h1>`)
    expect(html).toContain('€12.50')
    expect(html).toContain(`Back to Beans ${RUN}`)
    expect(html).toContain(`<link rel="canonical" href="`)
    expect(html).toContain(`/${siteSlug}/products/${handle('a')}"`)
    const byId = await request.get(`/${siteSlug}/products/${ids.a}`, { maxRedirects: 0 })
    expect(byId.status()).toBe(308)
    expect(byId.headers()['location']).toContain(`/${siteSlug}/products/${handle('a')}`)
    expect((await request.get(`/${siteSlug}/products/${handle('picked')}`)).status()).toBe(200)
    for (const key of [handle('off'), handle('hidden'), ids.hidden, '00000000-0000-4000-8000-000000000000']) {
      expect((await request.get(`/${siteSlug}/products/${key}`)).status(), key).toBe(404)
    }
    // A malformed escape is refused before the page runs (Next answers 400); it never renders.
    expect([400, 404]).toContain((await request.get(`/${siteSlug}/products/%E0%A4%A`)).status())
  })

  test('collection pages: the category tree, pagination clamp, and 404 for unreferenced categories', async ({ request }) => {
    const page = await request.get(`/${siteSlug}/collections/${handle('coffee')}`)
    expect(page.status()).toBe(200)
    const html = await page.text()
    expect(html).toContain(`<h1 class="sf-section-title">Coffee ${RUN}</h1>`)
    expect(html).toContain(`Product a ${RUN}`)
    expect(html).toContain(`Product b ${RUN}`)
    expect(html).not.toContain(`Product off ${RUN}`)
    expect((await request.get(`/${siteSlug}/collections/${handle('coffee')}?page=99`)).status()).toBe(200)
    expect((await request.get(`/${siteSlug}/collections/${handle('coffee')}?page=abc`)).status()).toBe(200)
    const byId = await request.get(`/${siteSlug}/collections/${ids.parent}`, { maxRedirects: 0 })
    expect(byId.status()).toBe(308)
    // The sub-category is visible through its parent and has no slug, so its id is canonical.
    expect((await request.get(`/${siteSlug}/collections/${ids.child}`)).status()).toBe(200)
    expect((await request.get(`/${siteSlug}/collections/${ids.unrelated}`)).status()).toBe(404)
  })

  test('product images are public only while the product is', async ({ request }) => {
    const shown = await request.get(`/api/storefront/media/${siteSlug}/${images.a}?w=320`)
    expect(shown.status()).toBe(200)
    expect(shown.headers()['content-type']).toBe('image/jpeg')
    expect((await request.get(`/api/storefront/media/${siteSlug}/${images.hidden}`)).status()).toBe(404)
  })

  test('drafts may only reference this organization\'s catalog rows', async ({ request }) => {
    const unknown = spec({ grid: { type: 'ProductGrid', props: { source: { kind: 'products', productIds: ['00000000-0000-4000-8000-000000000000'] } } } })
    const res = await saveDraft(request, token, pageId, unknown)
    expect(res.status()).toBe(422)
    expect((await readJsonSafe<{ issues: Issue[] }>(res))!.issues).toEqual([
      expect.objectContaining({ path: 'elements.grid.props.source.productIds.0', code: 'unknown_reference' }),
    ])
  })

  test('preview data shows draft sections without the published condition, and nothing for unknown ids', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/storefront/preview-data', {
      token,
      data: {
        sections: [
          { id: 'tea', type: 'ProductGrid', props: { source: { kind: 'category', categoryId: ids.unrelated } } },
          { id: 'ghost', type: 'ProductGrid', props: { source: { kind: 'products', productIds: ['00000000-0000-4000-8000-000000000000'] } } },
          { id: 'broken', type: 'ProductGrid', props: { source: { kind: 'category' } } },
          { id: 'hero', type: 'Hero', props: { heading: 'Hi' } },
        ],
      },
    })
    expect(res.status()).toBe(200)
    const body = (await readJsonSafe<{ sections: Record<string, { products?: Array<{ title: string; image: { attachmentId: string } | null }> }> }>(res))!
    expect(Object.keys(body.sections).sort()).toEqual(['ghost', 'tea'])
    expect(body.sections.tea.products!.map((item) => item.title)).toEqual([`Product hidden ${RUN}`])
    expect(body.sections.tea.products![0].image?.attachmentId).toBe(images.hidden)
    expect(body.sections.ghost.products).toEqual([])
    const tooMany = await apiRequest(request, 'POST', '/api/storefront/preview-data', {
      token,
      data: { sections: Array.from({ length: 41 }, (_, index) => ({ id: `s${index}`, type: 'Hero', props: {} })) },
    })
    expect(tooMany.status()).toBe(422)
  })
})
