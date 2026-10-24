import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

/**
 * TC-STOREFRONT-006: store templates and the assembled store in the builder
 * (spec TEST-021 integration part, TEST-022).
 *
 * Runs as the env-configured superadmin's organization. Template pages and
 * catalog rows the test creates are removed afterwards. The home page draft is
 * restored by undo; only the 409 case leaves the template's home draft in place
 * (status "Unpublished changes"), because a refused undo cannot be reverted.
 */

const LOCK = 'x-om-ext-optimistic-lock-expected-updated-at'
const RUN = Date.now().toString(36)
const TEMPLATE_SLUGS = ['about', 'faq', 'contact']

type PageItem = {
  id: string
  slug: string
  title: string
  status: string
  isHome: boolean
  updatedAt: string
  publishedRevisionNo: number | null
  draftSpec?: unknown
  publishedSpec?: unknown
}

let token = ''
let siteSlug = ''
let orgCookie = ''

async function listPages(request: APIRequestContext): Promise<PageItem[]> {
  const res = await apiRequest(request, 'GET', '/api/storefront/pages?pageSize=50', { token })
  return (await readJsonSafe<{ items: PageItem[] }>(res))!.items
}

async function getPage(request: APIRequestContext, id: string): Promise<PageItem | null> {
  const res = await apiRequest(request, 'GET', `/api/storefront/pages?id=${id}`, { token })
  return (await readJsonSafe<{ items: PageItem[] }>(res))?.items?.[0] ?? null
}

async function homePage(request: APIRequestContext): Promise<PageItem> {
  const home = (await listPages(request)).find((page) => page.isHome)!
  return (await getPage(request, home.id))!
}

async function deletePage(request: APIRequestContext, id: string) {
  const item = await getPage(request, id)
  if (item) await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${id}`, { token, headers: { [LOCK]: item.updatedAt } })
}

/** Template slugs must be free so the apply creates them; leftovers from an interrupted run are removed. */
async function freeTemplateSlugs(request: APIRequestContext) {
  for (const page of await listPages(request)) if (TEMPLATE_SLUGS.includes(page.slug)) await deletePage(request, page.id)
}

/**
 * The dev server's runtime-diagnostics banner (development builds only) floats over
 * the bottom of the screen after unrelated dev-runtime incidents and can cover the
 * inspector's Apply button; dismiss it when present.
 */
async function dismissDevBanner(page: Page) {
  const banner = page.getByTestId('dev-runtime-diagnostics-banner')
  if (await banner.isVisible().catch(() => false)) await banner.getByRole('button', { name: 'Dismiss' }).click()
}

async function applyTemplate(request: APIRequestContext, templateId: string, lock: string) {
  return apiRequest(request, 'POST', `/api/storefront/templates/${templateId}/apply`, { token, data: {}, headers: { [LOCK]: lock } })
}

async function undo(request: APIRequestContext, header: string | undefined) {
  const operation = deserializeOperationMetadata(header)
  expect(operation?.commandId).toBe('storefront.templates.apply')
  return apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken: operation!.undoToken } })
}

test.describe('TC-STOREFRONT-006: store templates', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { orgId?: string }
    orgCookie = `om_selected_org=${claims.orgId}`
    siteSlug = (await readJsonSafe<{ slug: string }>(await apiRequest(request, 'GET', '/api/storefront/brand', { token })))!.slug
  })

  test('lists templates, drafts pages without publishing, and undo restores the home draft', async ({ request }) => {
    await freeTemplateSlugs(request)
    const list = await readJsonSafe<{ items: Array<{ id: string; pages: Array<{ slug: string }> }> }>(await apiRequest(request, 'GET', '/api/storefront/templates', { token }))
    expect(list!.items.map((item) => item.id)).toEqual(['classic', 'showcase'])
    expect(list!.items[0]!.pages.map((page) => page.slug)).toEqual(['index', ...TEMPLATE_SLUGS])

    const before = await homePage(request)
    expect((await applyTemplate(request, 'classic', '2020-01-01T00:00:00.000Z')).status()).toBe(409)
    expect((await applyTemplate(request, 'nope', before.updatedAt)).status()).toBe(404)
    expect((await apiRequest(request, 'POST', '/api/storefront/templates/classic/apply', { token, data: { publish: true }, headers: { [LOCK]: before.updatedAt } })).status()).toBe(422)

    const applied = await applyTemplate(request, 'classic', before.updatedAt)
    expect(applied.status(), await applied.text()).toBe(200)
    const result = (await readJsonSafe<{ homePageId: string; createdPages: Array<{ id: string; slug: string }>; skippedSlugs: string[] }>(applied))!
    expect(result.homePageId).toBe(before.id)
    expect(result.createdPages.map((page) => page.slug).sort()).toEqual([...TEMPLATE_SLUGS].sort())
    expect(result.skippedSlugs).toEqual([])
    for (const created of result.createdPages) {
      expect((await getPage(request, created.id))!.status).toBe('draft')
      expect((await request.get(`/${siteSlug}/${created.slug}`)).status()).toBe(404)
    }
    const home = await homePage(request)
    expect(JSON.stringify(home.draftSpec)).toContain('"type":"Features"')
    // Nothing is published: the live revision of the home page is unchanged.
    expect(home.publishedRevisionNo).toBe(before.publishedRevisionNo)
    expect(home.publishedSpec).toEqual(before.publishedSpec)
    expect(home.status).toBe('changed')

    const undone = await undo(request, applied.headers()['x-om-operation'])
    expect(undone.status(), await undone.text()).toBe(200)
    const restored = await homePage(request)
    expect(restored.draftSpec ?? null).toEqual(before.draftSpec ?? null)
    expect(restored.status).toBe(before.status)
    expect(restored.title).toBe(before.title)
    for (const created of result.createdPages) expect(await getPage(request, created.id)).toBeNull()
  })

  test('builder: template dialog with undo, then an image and a product section, published', async ({ page, request }) => {
    test.setTimeout(300_000)
    await freeTemplateSlugs(request)
    const catalog = (method: 'POST' | 'DELETE', path: string, data?: unknown) => apiRequest(request, method, path, { token, data, headers: { Cookie: orgCookie } })
    const categoryRes = await catalog('POST', '/api/catalog/categories', { name: `Roasts ${RUN}`, slug: `tc6-roasts-${RUN}` })
    const categoryId = (await readJsonSafe<{ id: string }>(categoryRes))!.id
    const productRes = await catalog('POST', '/api/catalog/products', {
      title: `Morning roast ${RUN}`,
      handle: `tc6-morning-${RUN}`,
      description: 'A product created by the storefront template test.',
      categoryIds: [categoryId],
    })
    const productId = (await readJsonSafe<{ id: string }>(productRes))!.id
    const productImage = await uploadAttachmentFixture(request, token, {
      entityId: 'catalog:catalog_product',
      recordId: productId,
      fileName: 'roast.jpg',
      mimeType: 'image/jpeg',
      buffer: await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 90, g: 50, b: 20 } } }).jpeg().toBuffer(),
    })
    const pageRes = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: `Shop ${RUN}`, slug: `tc6-shop-${RUN}` } })
    const pageId = (await readJsonSafe<{ id: string }>(pageRes))!.id
    const homeBefore = await homePage(request)
    try {
      await login(page, 'superadmin')
      await page.goto('/backend/storefront/pages')
      await page.getByRole('button', { name: 'Start from a template' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('radio', { name: /Classic shop/ })).toBeChecked()
      // Keyboard only: Tab into the group, arrow to the next template, Space selects, Ctrl+Enter applies.
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('radio', { name: /Classic shop/ })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(dialog.getByRole('radio', { name: /Simple showcase/ })).toBeFocused()
      await page.keyboard.press('Space')
      await expect(dialog.getByRole('radio', { name: /Simple showcase/ })).toBeChecked()
      await page.keyboard.press('Control+Enter')
      // The same Ctrl+Enter must not confirm the warning unseen.
      const warning = page.getByRole('alertdialog')
      await expect(warning).toContainText('replaces the home page draft')
      // Escape cancels and brings the template dialog back with the same choice.
      await page.keyboard.press('Escape')
      await expect(warning).toBeHidden()
      await expect(page.getByRole('dialog').getByRole('radio', { name: /Simple showcase/ })).toBeChecked()
      expect((await listPages(request)).some((item) => item.slug === 'contact')).toBe(false)
      await page.getByRole('dialog').getByRole('radio', { name: /Simple showcase/ }).focus()
      await page.keyboard.press('Control+Enter')
      await expect(warning).toContainText('replaces the home page draft')
      await warning.getByRole('button', { name: 'Apply template' }).click()
      await expect(page.getByText('Template applied', { exact: false })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Contact', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect.poll(async () => (await listPages(request)).some((item) => item.slug === 'contact'), { timeout: 30_000 }).toBe(false)
      expect((await homePage(request)).draftSpec ?? null).toEqual(homeBefore.draftSpec ?? null)

      // The assembled store: an uploaded image and a product section picked from the catalog.
      await page.goto(`/backend/storefront/pages/${pageId}/builder`)
      await expect(page.getByRole('heading', { name: /Sections \(/ })).toBeVisible({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Add section' }).first().click()
      await page.getByRole('dialog').getByRole('option', { name: /^Image One image/ }).dblclick()
      const inspector = page.getByRole('dialog')
      await inspector.locator('input[type=file]').first().setInputFiles({
        name: 'shop.jpg',
        mimeType: 'image/jpeg',
        buffer: await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 110, b: 90 } } }).jpeg().toBuffer(),
      })
      // Alt text typed while the upload runs must survive the upload finishing.
      await inspector.getByLabel('Describe the image (alt text)').fill(`Shop front ${RUN}`)
      await expect(inspector.getByRole('status').filter({ hasText: 'Uploading' })).toBeHidden({ timeout: 30_000 })
      await expect(inspector.getByLabel('Describe the image (alt text)')).toHaveValue(`Shop front ${RUN}`)
      await dismissDevBanner(page)
      await inspector.getByRole('button', { name: 'Apply' }).last().click()
      await expect(inspector).toBeHidden()

      await page.getByRole('button', { name: 'Add section' }).first().click()
      await page.getByRole('dialog').getByRole('option', { name: /^Products/ }).dblclick()
      const products = page.getByRole('dialog')
      await products.getByPlaceholder('Search categories…').fill(`Roasts ${RUN}`)
      await products.getByText(`Roasts ${RUN}`).first().click()
      await dismissDevBanner(page)
      await products.getByRole('button', { name: 'Apply' }).last().click()
      await expect(products).toBeHidden()
      const preview = page.getByRole('region', { name: 'Preview of the draft' })
      await expect(preview).toContainText(`Morning roast ${RUN}`, { timeout: 30_000 })

      await dismissDevBanner(page)
      await page.getByRole('button', { name: 'Publish' }).click()
      await expect(page.getByText('Published', { exact: true }).first()).toBeVisible()
      const live = await (await request.get(`/${siteSlug}/tc6-shop-${RUN}`)).text()
      expect(live).toContain(`alt="Shop front ${RUN}"`)
      expect(live).toContain(`Morning roast ${RUN}`)
      expect(live).toContain(`/api/storefront/media/${siteSlug}/${productImage.id}`)
      expect((await request.get(`/${siteSlug}/products/tc6-morning-${RUN}`)).status()).toBe(200)

      // Narrow width and the dark admin theme: the pages list and the template dialog stay usable.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.goto('/backend/storefront/pages')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.getByRole('button', { name: 'Start from a template' }).click()
      await expect(page.getByRole('dialog').getByRole('radio', { name: /Classic shop/ })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
    } finally {
      await deletePage(request, pageId)
      await freeTemplateSlugs(request)
      await deleteAttachmentIfExists(request, token, productImage.id)
      await catalog('DELETE', `/api/catalog/products?id=${productId}`).catch(() => null)
      await catalog('DELETE', `/api/catalog/categories?id=${categoryId}`).catch(() => null)
    }
  })

  test('a second apply skips existing pages, and undo refuses with 409 once a page changed', async ({ request }) => {
    await freeTemplateSlugs(request)
    const keep = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: `Kept ${RUN}`, slug: 'faq' } })
    expect(keep.status()).toBe(201)
    const keptId = (await readJsonSafe<{ id: string }>(keep))!.id
    try {
      const applied = await applyTemplate(request, 'classic', (await homePage(request)).updatedAt)
      expect(applied.status()).toBe(200)
      const result = (await readJsonSafe<{ createdPages: Array<{ id: string; slug: string }>; skippedSlugs: string[] }>(applied))!
      expect(result.skippedSlugs).toEqual(['faq'])
      expect((await getPage(request, keptId))!.title).toBe(`Kept ${RUN}`)

      const about = result.createdPages.find((page) => page.slug === 'about')!
      const aboutItem = (await getPage(request, about.id))!
      const edit = await apiRequest(request, 'PUT', '/api/storefront/pages', { token, data: { id: about.id, title: `Edited ${RUN}` }, headers: { [LOCK]: aboutItem.updatedAt } })
      expect(edit.status()).toBe(200)
      const refused = await undo(request, applied.headers()['x-om-operation'])
      expect(refused.status()).toBe(409)
      expect((await readJsonSafe<{ error: string }>(refused))!.error).toContain('changed since')
      expect((await getPage(request, about.id))!.title).toBe(`Edited ${RUN}`)
    } finally {
      await freeTemplateSlugs(request)
    }
  })
})
