import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-004: public storefront pages ship no json-render code (spec TEST-012).
 *
 * Collects every script a page loads in a real browser. json-render is detected
 * by its own runtime log prefix (kept by minifiers) or by a chunk URL naming the
 * package, so a code comment that mentions it does not count. The builder is the
 * positive control: the same detector must find json-render there.
 */

const LOCK = 'x-om-ext-optimistic-lock-expected-updated-at'
const RUN = Date.now().toString(36)

type Script = { url: string; body: string }

const isJsonRender = (script: Script) =>
  script.body.includes('[json-render]') || /json-render/.test(decodeURIComponent(script.url))

async function loadedScripts(browser: Browser, url: string, options: { staff?: boolean; ready?: string } = {}): Promise<Script[]> {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (options.staff) await login(page, 'superadmin')
  const scripts: Script[] = []
  const pending: Promise<void>[] = []
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return
    pending.push(
      response
        .text()
        .then((body) => {
          scripts.push({ url: response.url(), body })
        })
        .catch(() => undefined),
    )
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  if (options.ready) {
    // The positive control needs the lazy preview mounted, not just the page header: wait for the
    // preview region to render the page's own heading and for its loading fallback to go away.
    const preview = page.getByRole('region', { name: 'Preview of the draft' })
    await expect(preview.getByText(options.ready, { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    await expect(preview.getByText('Loading preview…')).toHaveCount(0)
  }
  await page.waitForLoadState('networkidle')
  await Promise.all(pending)
  await context.close()
  return scripts
}

async function publishPage(request: APIRequestContext, token: string, slug: string): Promise<string> {
  const created = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: 'Bundle check', slug } })
  expect(created.status()).toBe(201)
  const id = (await readJsonSafe<{ id: string }>(created))!.id
  const list = await apiRequest(request, 'GET', `/api/storefront/pages?id=${id}`, { token })
  const page = (await readJsonSafe<{ items: Array<{ updatedAt: string }> }>(list))!.items[0]
  const published = await apiRequest(request, 'POST', `/api/storefront/pages/${id}/publish`, { token, data: {}, headers: { [LOCK]: page.updatedAt } })
  expect(published.status()).toBe(200)
  return id
}

test.describe('TC-STOREFRONT-004: public bundle stays free of json-render', () => {
  let token = ''
  let pageId: string | null = null

  test.afterAll(async ({ request }) => {
    if (!pageId) return
    const list = await apiRequest(request, 'GET', `/api/storefront/pages?id=${pageId}`, { token })
    const item = (await readJsonSafe<{ items: Array<{ updatedAt: string }> }>(list))?.items?.[0]
    if (item) await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${pageId}`, { token, headers: { [LOCK]: item.updatedAt } })
  })

  test('public home and page load no json-render; the builder does', async ({ browser, request }) => {
    test.setTimeout(300_000)
    token = await getAuthToken(request, 'superadmin')
    const brand = await apiRequest(request, 'GET', '/api/storefront/brand', { token })
    const siteSlug = (await readJsonSafe<{ slug: string }>(brand))!.slug
    const slug = `tc4-${RUN}`
    pageId = await publishPage(request, token, slug)

    for (const path of [`/${siteSlug}`, `/${siteSlug}/${slug}`]) {
      const scripts = await loadedScripts(browser, path)
      expect(scripts.length, `${path} loads scripts`).toBeGreaterThan(0)
      expect(scripts.filter(isJsonRender).map((script) => script.url), `${path} must not load json-render`).toEqual([])
    }

    const builderScripts = await loadedScripts(browser, `/backend/storefront/pages/${pageId}/builder`, { staff: true, ready: 'Bundle check' })
    expect(builderScripts.filter(isJsonRender).length, 'positive control: the builder loads json-render').toBeGreaterThan(0)
  })
})
