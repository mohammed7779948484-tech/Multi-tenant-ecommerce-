import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-007: the Arabic store shell (shopping-journey spec Phase 1,
 * TEST-J02). Runs against the env-configured superadmin's store, in a browser
 * with the OS in dark mode, at phone and desktop widths, under two themes:
 * the store keeps its own colours, the page and its menu sheet read right to
 * left, the sheet mounts inside the themed store root and opens from the right
 * edge, Escape returns focus to the menu button, and the platform notice bars
 * stay off the page. The original brand is restored afterwards.
 */

type Brand = {
  slug: string
  name: string
  description: string | null
  logoAttachmentId: string | null
  tokens: { colors: Record<string, string>; [key: string]: unknown }
  updatedAt: string
}

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const DESERT = {
  background: '#fbf6ee',
  surface: '#f2e6d3',
  text: '#3b2a1a',
  mutedText: '#7a6248',
  primary: '#b4532a',
  onPrimary: '#ffffff',
  accent: '#3f7d6e',
  border: '#e3d2b8',
}

function rgb(hex: string): string {
  const value = hex.replace('#', '')
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`
}

async function readBrand(request: APIRequestContext, token: string): Promise<Brand> {
  const response = await apiRequest(request, 'GET', '/api/storefront/brand', { token })
  expect(response.status(), 'GET /api/storefront/brand').toBe(200)
  return (await readJsonSafe<Brand>(response))!
}

async function saveBrand(request: APIRequestContext, token: string, brand: Brand, colors: Record<string, string>) {
  const response = await apiRequest(request, 'PUT', '/api/storefront/brand', {
    token,
    data: { name: brand.name, description: brand.description, logoAttachmentId: brand.logoAttachmentId, tokens: { ...brand.tokens, colors } },
    headers: { [LOCK_HEADER]: brand.updatedAt },
  })
  expect(response.status(), 'PUT /api/storefront/brand').toBe(200)
}

async function expectShell(page: Page, slug: string, background: string) {
  await page.goto(`/${slug}`)
  const root = page.locator('.sf-root.sf-shop')
  await expect(root).toHaveAttribute('dir', 'rtl')
  await expect(root).toHaveAttribute('lang', 'ar')
  // OS dark mode is on, but neither the store nor the page around it turns dark.
  await expect(root).toHaveCSS('background-color', background)
  await expect(page.locator('body')).toHaveCSS('background-color', background)
  await expect(page.locator('body')).toHaveCSS('direction', 'rtl')
  const notices = page.locator('[data-om-notice-bars]')
  if (await notices.count()) await expect(notices).toBeHidden()

  const trigger = page.getByRole('button', { name: 'فتح القائمة' })
  await trigger.click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page')
  await expect(sheet.getByRole('button', { name: 'إغلاق القائمة' })).toBeVisible()
  await expect(sheet).toHaveCSS('background-color', background)
  const placement = await sheet.evaluate((element) => ({
    insideRoot: Boolean(element.closest('.sf-root.sf-shop')),
    rightGap: Math.round(window.innerWidth - element.getBoundingClientRect().right),
  }))
  expect(placement.insideRoot).toBe(true)
  // Animation done: the sheet rests against the right edge (the reading start).
  await expect.poll(async () => sheet.evaluate((element) => Math.round(window.innerWidth - element.getBoundingClientRect().right))).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(trigger).toBeFocused()
}

test.describe('TC-STOREFRONT-007: Arabic store shell', () => {
  // Both cases change the same store's brand.
  test.describe.configure({ mode: 'serial' })
  test.use({ colorScheme: 'dark' })

  let token = ''
  let original: Brand | null = null

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    original = await readBrand(request, token)
  })

  test.afterAll(async ({ request }) => {
    if (!original) return
    const current = await readBrand(request, token)
    await saveBrand(request, token, { ...current, name: original.name, description: original.description, logoAttachmentId: original.logoAttachmentId, tokens: original.tokens }, original.tokens.colors)
  })

  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    test(`two themes at ${viewport.width}px: RTL, own colours, themed menu sheet`, async ({ page, request }) => {
      await page.setViewportSize(viewport)
      const brand = await readBrand(request, token)
      await expectShell(page, brand.slug, rgb(brand.tokens.colors.background))

      await saveBrand(request, token, brand, DESERT)
      await expectShell(page, brand.slug, rgb(DESERT.background))

      const current = await readBrand(request, token)
      await saveBrand(request, token, current, original!.tokens.colors)
    })
  }
})
