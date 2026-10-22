import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi'

/**
 * TC-STOREFRONT-003: pages list and section builder in a real browser (spec TEST-018).
 *
 * Runs as the env-configured superadmin's organization. Pages carry run-unique
 * slugs and are deleted afterwards.
 */

const LOCK = 'x-om-ext-optimistic-lock-expected-updated-at'
const RUN = Date.now().toString(36)

type PageItem = { id: string; slug: string; title: string; status: string; updatedAt: string }

let token = ''
let siteSlug = ''
const createdPageIds: string[] = []

async function getPage(request: APIRequestContext, id: string): Promise<PageItem | null> {
  const res = await apiRequest(request, 'GET', `/api/storefront/pages?id=${id}`, { token })
  return (await readJsonSafe<{ items: PageItem[] }>(res))?.items?.[0] ?? null
}

async function createPage(request: APIRequestContext, slug: string, title: string): Promise<PageItem> {
  const res = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title, slug } })
  expect(res.status(), `create ${slug}`).toBe(201)
  const id = (await readJsonSafe<{ id: string }>(res))!.id
  createdPageIds.push(id)
  return (await getPage(request, id))!
}

function sectionList(page: Page) {
  return page.getByRole('list', { name: 'Page sections' })
}

async function sectionNames(page: Page): Promise<string[]> {
  const rows = sectionList(page).getByRole('listitem')
  const count = await rows.count()
  const names: string[] = []
  for (let i = 0; i < count; i += 1) {
    names.push(((await rows.nth(i).getByRole('button').first().textContent()) ?? '').replace(/^\d+/, '').trim())
  }
  return names
}

async function openBuilder(page: Page, id: string) {
  await page.goto(`/backend/storefront/pages/${id}/builder`)
  await expect(page.getByRole('heading', { name: /Sections \(/ })).toBeVisible({ timeout: 60_000 })
}

async function applyInspector(page: Page) {
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Apply' }).last().click()
  await expect(drawer).toBeHidden()
}

async function publicHtml(request: APIRequestContext, path: string): Promise<{ status: number; html: string }> {
  const res = await request.get(path)
  return { status: res.status(), html: await res.text() }
}

test.describe('TC-STOREFRONT-003: page builder UI', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    const brand = await apiRequest(request, 'GET', '/api/storefront/brand', { token })
    siteSlug = (await readJsonSafe<{ slug: string }>(brand))!.slug
  })

  test.afterAll(async ({ request }) => {
    for (const id of createdPageIds) {
      const item = await getPage(request, id)
      if (item) await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${id}`, { token, headers: { [LOCK]: item.updatedAt } })
    }
  })

  test('pages list: create from the form, delete with confirmation, stale delete conflicts', async ({ page, request }) => {
    test.setTimeout(180_000)
    await login(page, 'superadmin')

    // Create through the form; the slug follows the title until edited.
    await page.goto('/backend/storefront/pages/create')
    await page.getByPlaceholder('About us').fill(`Visit ${RUN}`)
    await expect(page.locator('#slug')).toHaveValue(`visit-${RUN}`)
    await page.getByRole('button', { name: 'Create page' }).first().click()
    await page.waitForURL(/\/builder/, { timeout: 60_000 })
    const createdId = page.url().split('/').slice(-2)[0]
    createdPageIds.push(createdId)

    // Delete from the list with confirmation.
    await page.goto('/backend/storefront/pages')
    await page.getByPlaceholder('Search by title or path').fill(`visit-${RUN}`)
    const row = page.getByRole('row').filter({ hasText: `Visit ${RUN}` })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(`Visit ${RUN}`)
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
    expect(await getPage(request, createdId)).toBeNull()

    // A row loaded before someone else edited the page cannot be deleted.
    const stale = await createPage(request, `tc3-stale-${RUN}`, `Stale ${RUN}`)
    await page.getByPlaceholder('Search by title or path').fill(`tc3-stale-${RUN}`)
    const staleRow = page.getByRole('row').filter({ hasText: `Stale ${RUN}` })
    await expect(staleRow).toBeVisible()
    const bump = await apiRequest(request, 'PUT', '/api/storefront/pages', { token, data: { id: stale.id, title: `Stale ${RUN} (edited)` }, headers: { [LOCK]: stale.updatedAt } })
    expect(bump.status()).toBe(200)
    await staleRow.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expectConflictBanner(page)
    expect(await getPage(request, stale.id)).not.toBeNull()
  })

  test('builder: add, edit, reorder, remove, save, publish and restore', async ({ page, request }) => {
    test.setTimeout(300_000)
    const slug = `tc3-${RUN}`
    const created = await createPage(request, slug, `Builder ${RUN}`)
    await login(page, 'superadmin')
    await openBuilder(page, created.id)
    expect(await sectionNames(page)).toEqual(['Hero', 'Footer'])

    // Edit the hero from the keyboard: Enter on the selected row opens the inspector.
    await sectionList(page).getByRole('button', { name: /Hero/ }).first().focus()
    await page.keyboard.press('Enter')
    const inspector = page.getByRole('dialog')
    await expect(inspector).toContainText('Section 1 · Hero')
    await inspector.getByRole('textbox').first().fill(`Hello from ${RUN}`)
    await inspector.locator('#cta-label').fill('Read more')
    await inspector.locator('#cta-href').fill('javascript:alert(1)')
    await inspector.getByRole('button', { name: 'Apply' }).last().click()
    await expect(inspector).toContainText('https:// link or a path')
    await inspector.locator('#cta-href').fill('/about')
    await applyInspector(page)

    // Add a rich-text section from the picker with the keyboard.
    await page.getByRole('button', { name: 'Add section' }).first().click()
    const picker = page.getByRole('dialog')
    await picker.getByRole('option', { name: /Hero/ }).focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toContainText('Section 2 · Rich text')
    await page.locator('#content').fill(`Our **roastery** opened in ${RUN}.\n\n- Fresh\n- [Visit](/visit)`)
    await applyInspector(page)

    // Footer links: a list field.
    await sectionList(page).getByRole('button', { name: 'Edit section 3' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Add link' }).click()
    await page.locator('#links-0-label').fill('Contact')
    await page.locator('#links-0-href').fill('https://example.com/contact')
    await applyInspector(page)
    expect(await sectionNames(page)).toEqual(['Hero', 'Rich text', 'Footer'])

    // Reorder with Alt+ArrowUp, then remove the hero with Delete.
    await sectionList(page).getByRole('button', { name: /Rich text/ }).first().focus()
    await page.keyboard.press('Alt+ArrowUp')
    expect(await sectionNames(page)).toEqual(['Rich text', 'Hero', 'Footer'])
    await sectionList(page).getByRole('button', { name: /Hero/ }).first().focus()
    await page.keyboard.press('Delete')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    expect(await sectionNames(page)).toEqual(['Rich text', 'Footer'])

    // The preview shows the draft; nothing is public before publish.
    const preview = page.getByRole('region', { name: 'Preview of the draft' })
    await expect(preview.locator('strong', { hasText: 'roastery' })).toBeVisible()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect((await publicHtml(request, `/${siteSlug}/${slug}`)).status).toBe(404)

    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible()
    const live1 = await publicHtml(request, `/${siteSlug}/${slug}`)
    expect(live1.status).toBe(200)
    expect(live1.html).toContain('<strong>roastery</strong>')
    expect(live1.html).toContain('https://example.com/contact')
    expect(live1.html).not.toContain('javascript:')

    // A saved draft stays private; restore brings revision 1 back after a warning.
    await sectionList(page).getByRole('button', { name: 'Edit section 1' }).click()
    await page.locator('#content').fill(`Second version ${RUN}.`)
    await applyInspector(page)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Published as revision 2', { exact: false })).toBeVisible()
    expect((await publicHtml(request, `/${siteSlug}/${slug}`)).html).toContain(`Second version ${RUN}.`)

    await sectionList(page).getByRole('button', { name: 'Edit section 1' }).click()
    await page.locator('#content').fill(`Unpublished draft ${RUN}.`)
    await applyInspector(page)
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Unpublished changes').first()).toBeVisible()
    expect((await publicHtml(request, `/${siteSlug}/${slug}`)).html).not.toContain(`Unpublished draft ${RUN}.`)

    await page.getByRole('button', { name: 'Revisions' }).click()
    const revisions = page.getByRole('dialog')
    const revisionOne = revisions.getByRole('listitem').filter({ hasText: 'Revision 1' })
    await revisionOne.getByRole('button', { name: 'Restore' }).click()
    const warning = page.getByRole('alertdialog')
    await expect(warning).toContainText('replaces your current draft')
    await warning.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByText('Revision 1 restored and published as revision 3', { exact: false })).toBeVisible()
    const live3 = await publicHtml(request, `/${siteSlug}/${slug}`)
    expect(live3.html).toContain('<strong>roastery</strong>')
    expect(live3.html).not.toContain('Unpublished draft')
  })

  test('builder: a save from a stale tab shows the conflict bar', async ({ page, context, request }) => {
    test.setTimeout(180_000)
    const created = await createPage(request, `tc3-conflict-${RUN}`, `Conflict ${RUN}`)
    await login(page, 'superadmin')
    await openBuilder(page, created.id)
    const other = await context.newPage()
    await openBuilder(other, created.id)

    await sectionList(other).getByRole('button', { name: 'Edit section 1' }).click()
    await other.getByRole('dialog').getByRole('textbox').first().fill('Saved in the other tab')
    await applyInspector(other)
    await other.getByRole('button', { name: 'Save draft' }).click()
    await expect(other.getByRole('button', { name: 'Save draft' })).toBeDisabled()

    await sectionList(page).getByRole('button', { name: 'Edit section 1' }).click()
    await page.getByRole('dialog').getByRole('textbox').first().fill('Saved in the stale tab')
    await applyInspector(page)
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expectConflictBanner(page)
    await other.close()
  })

  test('narrow width and dark admin theme keep the screens usable', async ({ page, request }) => {
    test.setTimeout(180_000)
    const created = await createPage(request, `tc3-narrow-${RUN}`, `Narrow ${RUN}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await login(page, 'superadmin')
    for (const path of ['/backend/storefront/pages', `/backend/storefront/pages/${created.id}`, `/backend/storefront/pages/${created.id}/builder`]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1)
    }
    // The preview keeps the merchant's light theme inside the dark admin chrome.
    await expect(page.getByRole('region', { name: 'Preview of the draft' }).locator('.sf-root')).toBeVisible()
  })
})
