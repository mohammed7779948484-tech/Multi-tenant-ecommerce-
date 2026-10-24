import { expect, test, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-005: the assembled store's sections (spec TEST-013).
 * Part a — media and content sections, page images and the media route.
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
