import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-001: brand API, permissions, locking and the public page
 * (spec 2026-10-22-storefront-builder, TEST-006/007/008).
 *
 * Runs as the env-configured superadmin's organization, whose storefront is
 * seeded by `onTenantCreated` (or backfilled by `storefront ensure-sites`).
 * The original brand is restored afterwards. Two-tenant isolation through real
 * self-service signups is exercised by the Phase 1 E2E recorded in the spec.
 */

type Brand = {
  siteId: string
  slug: string
  name: string
  description: string | null
  logoAttachmentId: string | null
  tokens: { colors: Record<string, string>; [key: string]: unknown }
  updatedAt: string
}

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

async function readBrand(request: APIRequestContext, token: string): Promise<Brand> {
  const response = await apiRequest(request, 'GET', '/api/storefront/brand', { token })
  expect(response.status(), 'GET /api/storefront/brand').toBe(200)
  return (await readJsonSafe<Brand>(response))!
}

function bodyFrom(brand: Brand, overrides: Record<string, unknown> = {}) {
  return {
    name: brand.name,
    description: brand.description,
    logoAttachmentId: brand.logoAttachmentId,
    tokens: brand.tokens,
    ...overrides,
  }
}

test.describe('TC-STOREFRONT-001: storefront brand and public page', () => {
  let token = ''
  let original: Brand | null = null
  let employeeId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    original = await readBrand(request, token)
  })

  test.afterAll(async ({ request }) => {
    if (employeeId) await deleteUserIfExists(request, token, employeeId)
    if (!original) return
    const current = await readBrand(request, token)
    await apiRequest(request, 'PUT', '/api/storefront/brand', {
      token,
      data: bodyFrom(original),
      headers: { [LOCK_HEADER]: current.updatedAt },
    })
  })

  test('rejects anonymous access and unknown stores without leaking', async ({ request }) => {
    expect((await request.get('/api/storefront/brand')).status()).toBe(401)
    expect((await request.get('/no-such-store-tc001')).status()).toBe(404)
    const media = await request.get(`/api/storefront/media/${original!.slug}/00000000-0000-4000-8000-000000000000`)
    expect(media.status()).toBe(404)
  })

  test('validates field by field and refuses scope or styling smuggling', async ({ request }) => {
    const brand = await readBrand(request, token)
    const response = await apiRequest(request, 'PUT', '/api/storefront/brand', {
      token,
      data: bodyFrom(brand, {
        name: '',
        tokens: { ...brand.tokens, colors: { ...brand.tokens.colors, primary: 'red' } },
        css: 'body{display:none}',
      }),
      headers: { [LOCK_HEADER]: brand.updatedAt },
    })
    expect(response.status()).toBe(422)
    const body = await readJsonSafe<{ fieldErrors: Record<string, string> }>(response)
    expect(Object.keys(body!.fieldErrors)).toEqual(expect.arrayContaining(['name', 'tokens.colors.primary', 'css']))
    const smuggled = await apiRequest(request, 'PUT', '/api/storefront/brand', {
      token,
      data: bodyFrom(brand, { organizationId: '00000000-0000-4000-8000-000000000000' }),
    })
    expect(smuggled.status()).toBe(422)
  })

  test('saves the brand, refuses a stale version and renders it publicly', async ({ request, page: browserPage }) => {
    const brand = await readBrand(request, token)
    const tokens = { ...brand.tokens, colors: { ...brand.tokens.colors, primary: '#2a6f4e' } }
    const saved = await apiRequest(request, 'PUT', '/api/storefront/brand', {
      token,
      data: bodyFrom(brand, { description: 'TC-STOREFRONT-001 description', tokens }),
      headers: { [LOCK_HEADER]: brand.updatedAt },
    })
    expect(saved.status()).toBe(200)

    const stale = await apiRequest(request, 'PUT', '/api/storefront/brand', {
      token,
      data: bodyFrom(brand, { name: 'Stale write' }),
      headers: { [LOCK_HEADER]: brand.updatedAt },
    })
    expect(stale.status()).toBe(409)

    const page = await request.get(`/${brand.slug}`)
    expect(page.status()).toBe(200)
    const html = await page.text()
    expect(html).toContain('--sf-color-primary:#2a6f4e')
    expect(html).toContain(`<link rel="canonical" href="`)
    expect(html).toContain('<meta name="description" content="TC-STOREFRONT-001 description"/>')
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html).toContain('application/ld+json')
    expect(html.toLowerCase()).not.toContain('json-render')

    // The store name in the header uses the text colour, not the link (primary) colour.
    await browserPage.goto(`/${brand.slug}`)
    const colors = await browserPage.locator('.sf-brand').evaluate((brandLink) => ({
      brand: getComputedStyle(brandLink).color,
      text: getComputedStyle(brandLink.closest('.sf-root')!).color,
    }))
    expect(colors.brand).toBe(colors.text)
    expect(colors.brand).not.toBe('rgb(42, 111, 78)')
  })

  test('an employee can read the brand but not change it', async ({ request }) => {
    const { organizationId } = getTokenContext(token)
    const email = `tc-storefront-${Date.now()}@example.com`
    const password = 'Suqna-Staff-2026!tc'
    employeeId = await createUserFixture(request, token, { email, password, organizationId, roles: ['employee'] })
    const employeeToken = await getAuthToken(request, email, password)
    const brand = await readBrand(request, employeeToken)
    const response = await apiRequest(request, 'PUT', '/api/storefront/brand', {
      token: employeeToken,
      data: bodyFrom(brand, { name: 'Employee write' }),
      headers: { [LOCK_HEADER]: brand.updatedAt },
    })
    expect(response.status()).toBe(403)
  })
})
