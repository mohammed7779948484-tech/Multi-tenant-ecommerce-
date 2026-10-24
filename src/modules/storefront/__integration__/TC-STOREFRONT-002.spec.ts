import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-002: page authoring API and public pages (spec TEST-011).
 *
 * Runs as the env-configured superadmin's organization. Every page it creates
 * carries a run-unique slug and is deleted afterwards; the extra role and users
 * are removed too.
 */

const LOCK = 'x-om-ext-optimistic-lock-expected-updated-at'
const RUN = Date.now().toString(36)

type PageItem = { id: string; slug: string; title: string; status: string; updatedAt: string; publicPath: string | null; publishedRevisionNo: number | null }
type PublishResult = { revisionId: string; revisionNo: number; updatedAt: string }

function spec(heading: string, extra: Record<string, unknown> = {}) {
  return {
    root: 'page',
    elements: {
      page: { type: 'Page', props: {}, children: ['hero', 'footer'] },
      hero: { type: 'Hero', props: { heading, align: 'center' }, children: [] },
      footer: { type: 'Footer', props: { links: [] }, children: [] },
      ...extra,
    },
  }
}

async function getPage(request: APIRequestContext, token: string, id: string): Promise<PageItem> {
  const res = await apiRequest(request, 'GET', `/api/storefront/pages?id=${id}`, { token })
  expect(res.status()).toBe(200)
  const body = await readJsonSafe<{ items: PageItem[] }>(res)
  return body!.items[0]!
}

async function save(request: APIRequestContext, token: string, page: PageItem, data: Record<string, unknown>) {
  return apiRequest(request, 'PUT', '/api/storefront/pages', { token, data: { id: page.id, ...data }, headers: { [LOCK]: page.updatedAt } })
}

async function publish(request: APIRequestContext, token: string, page: PageItem) {
  return apiRequest(request, 'POST', `/api/storefront/pages/${page.id}/publish`, { token, data: {}, headers: { [LOCK]: page.updatedAt } })
}

test.describe('TC-STOREFRONT-002: page authoring and publishing', () => {
  let token = ''
  let siteSlug = ''
  const createdPageIds: string[] = []
  const createdUserIds: string[] = []
  let roleId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    const brand = await apiRequest(request, 'GET', '/api/storefront/brand', { token })
    siteSlug = (await readJsonSafe<{ slug: string }>(brand))!.slug
  })

  test.afterAll(async ({ request }) => {
    for (const id of createdPageIds) {
      const res = await apiRequest(request, 'GET', `/api/storefront/pages?id=${id}`, { token })
      const item = (await readJsonSafe<{ items: PageItem[] }>(res))?.items?.[0]
      if (item) await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${id}`, { token, headers: { [LOCK]: item.updatedAt } })
    }
    for (const id of createdUserIds) await deleteUserIfExists(request, token, id)
    if (roleId) await deleteRoleIfExists(request, token, roleId)
  })

  async function createPage(request: APIRequestContext, slug: string, title: string) {
    const res = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title, slug } })
    expect(res.status(), `create ${slug}`).toBe(201)
    const id = (await readJsonSafe<{ id: string }>(res))!.id
    createdPageIds.push(id)
    return getPage(request, token, id)
  }

  test('draft → publish → edit → publish → rollback round trip; drafts never public', async ({ request }) => {
    const slug = `tc-${RUN}`
    let page = await createPage(request, slug, 'Our story')
    expect(page.status).toBe('draft')
    expect((await request.get(`/${siteSlug}/${slug}`)).status()).toBe(404)

    // Invalid drafts are rejected with path-level issues.
    const unknownBlock = await save(request, token, page, { draftSpec: { root: 'page', elements: { page: { type: 'Page', props: {}, children: ['x'] }, x: { type: 'Script', props: {}, children: [] } } } })
    expect(unknownBlock.status()).toBe(422)
    expect((await readJsonSafe<{ issues: Array<{ code: string }> }>(unknownBlock))!.issues[0]!.code).toBe('unknown_block')
    const unsafeLink = await save(request, token, page, {
      draftSpec: spec('Our story', { footer: { type: 'Footer', props: { links: [{ label: 'x', href: 'javascript:alert(1)' }] }, children: [] } }),
    })
    expect(unsafeLink.status()).toBe(422)
    const many = spec('Our story')
    const children = Array.from({ length: 41 }, (_, i) => `s${i}`)
    many.elements.page.children = children
    for (const id of children) (many.elements as Record<string, unknown>)[id] = { type: 'Hero', props: { heading: id }, children: [] }
    expect((await save(request, token, page, { draftSpec: many })).status()).toBe(422)
    const smuggled = await save(request, token, page, { tenantId: '00000000-0000-4000-8000-000000000000', publishedSpec: {} })
    expect(smuggled.status()).toBe(422)

    // Valid draft; stale save conflicts.
    const saved = await save(request, token, page, { draftSpec: spec('Version one') })
    expect(saved.status()).toBe(200)
    expect((await save(request, token, page, { title: 'Stale' })).status()).toBe(409)
    page = await getPage(request, token, page.id)

    const first = await publish(request, token, page)
    expect(first.status()).toBe(200)
    const rev1 = (await readJsonSafe<PublishResult>(first))!
    expect(rev1.revisionNo).toBe(1)
    page = await getPage(request, token, page.id)
    expect(page).toMatchObject({ status: 'published', publishedRevisionNo: 1, publicPath: `/${siteSlug}/${slug}` })
    expect((await publish(request, token, page)).status()).toBe(422)

    const live1 = await request.get(`/${siteSlug}/${slug}`)
    expect(live1.status()).toBe(200)
    expect(await live1.text()).toContain('Version one')

    // A saved draft and a draft title stay private until publish.
    expect((await save(request, token, page, { draftSpec: spec('Version two'), title: 'Our story, retold' })).status()).toBe(200)
    page = await getPage(request, token, page.id)
    expect(page.status).toBe('changed')
    const stillLive = await (await request.get(`/${siteSlug}/${slug}`)).text()
    expect(stillLive).toContain('Version one')
    expect(stillLive).not.toContain('Version two')
    expect(stillLive).not.toContain('Our story, retold')

    const second = (await readJsonSafe<PublishResult>(await publish(request, token, page)))!
    expect(second.revisionNo).toBe(2)
    const live2 = await (await request.get(`/${siteSlug}/${slug}`)).text()
    expect(live2).toContain('Version two')
    expect(live2).toContain('<title>Our story, retold</title>')

    // The address freezes after the first publish.
    page = await getPage(request, token, page.id)
    const rename = await save(request, token, page, { slug: `${slug}-renamed` })
    expect(rename.status()).toBe(422)
    expect((await readJsonSafe<{ fieldErrors: Record<string, string> }>(rename))!.fieldErrors.slug).toBeTruthy()

    // Rollback appends a copy of revision 1 and resets the draft and title.
    const rolled = await apiRequest(request, 'POST', `/api/storefront/pages/${page.id}/rollback`, { token, data: { revisionId: rev1.revisionId }, headers: { [LOCK]: page.updatedAt } })
    expect(rolled.status()).toBe(200)
    const rev3 = (await readJsonSafe<PublishResult>(rolled))!
    expect(rev3.revisionNo).toBe(3)
    const live3 = await (await request.get(`/${siteSlug}/${slug}`)).text()
    expect(live3).toContain('Version one')
    expect(live3).toContain('<title>Our story</title>')
    page = await getPage(request, token, page.id)
    expect(page).toMatchObject({ status: 'published', title: 'Our story', publishedRevisionNo: 3 })
    const again = await apiRequest(request, 'POST', `/api/storefront/pages/${page.id}/rollback`, { token, data: { revisionId: rev3.revisionId }, headers: { [LOCK]: page.updatedAt } })
    expect(again.status()).toBe(422)

    const revisions = await apiRequest(request, 'GET', `/api/storefront/pages/${page.id}/revisions?pageSize=2`, { token })
    const revBody = (await readJsonSafe<{ items: Array<{ revisionNo: number; source: string; sourceRevisionNo: number | null; isCurrent: boolean }>; total: number; totalPages: number }>(revisions))!
    expect(revBody).toMatchObject({ total: 3, totalPages: 2 })
    expect(revBody.items[0]).toMatchObject({ revisionNo: 3, source: 'rollback', sourceRevisionNo: 1, isCurrent: true })

    // Canonical paths.
    const index = await request.get(`/${siteSlug}/index`, { maxRedirects: 0 })
    expect(index.status()).toBe(308)
    expect(index.headers()['location']).toMatch(new RegExp(`/${siteSlug}$`))
    const mixed = await request.get(`/${siteSlug}/${slug.toUpperCase()}`, { maxRedirects: 0 })
    expect(mixed.status()).toBe(308)

    // Delete takes the page off the public site.
    const del = await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${page.id}`, { token, headers: { [LOCK]: page.updatedAt } })
    expect(del.status()).toBe(200)
    expect((await request.get(`/${siteSlug}/${slug}`)).status()).toBe(404)
  })

  test('the page list rejects malformed ids as a client error, never a database error', async ({ request }) => {
    const created = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: 'Ids check', slug: `tc2-ids-${RUN}` } })
    expect(created.status()).toBe(201)
    const id = (await readJsonSafe<{ id: string }>(created))!.id
    createdPageIds.push(id)
    expect((await apiRequest(request, 'GET', '/api/storefront/pages?ids=abc', { token })).status()).toBe(400)
    expect((await apiRequest(request, 'GET', `/api/storefront/pages?ids=abc,${id}`, { token })).status()).toBe(400)
    // A list with no usable entry is refused too (it used to reach SQL as `IN ()` and answer 500).
    expect((await apiRequest(request, 'GET', '/api/storefront/pages?ids=,', { token })).status()).toBe(400)
    expect((await apiRequest(request, 'GET', '/api/storefront/pages?ids=%20,%20', { token })).status()).toBe(400)
    const valid = await apiRequest(request, 'GET', `/api/storefront/pages?ids=${id},00000000-0000-4000-8000-000000000000`, { token })
    expect(valid.status()).toBe(200)
    expect((await readJsonSafe<{ items: Array<{ id: string }> }>(valid))!.items.map((item) => item.id)).toEqual([id])
  })

  test('slug rules, the home page and the 30-page cap', async ({ request }) => {
    for (const slug of ['portal', 'index', 'Bad Slug']) {
      const res = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: 'X', slug } })
      expect(res.status(), slug).toBe(422)
    }
    const list = await apiRequest(request, 'GET', '/api/storefront/pages?pageSize=100', { token })
    const items = (await readJsonSafe<{ items: PageItem[]; total: number }>(list))!
    const home = items.items.find((item) => item.slug === 'index')!
    expect((await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${home.id}`, { token, headers: { [LOCK]: home.updatedAt } })).status()).toBe(422)

    const capPages: PageItem[] = []
    for (let i = items.total; i < 30; i += 1) capPages.push(await createPage(request, `tc-${RUN}-cap-${i}`, `Cap ${i}`))
    const overflow = await apiRequest(request, 'POST', '/api/storefront/pages', { token, data: { title: 'One too many', slug: `tc-${RUN}-overflow` } })
    expect(overflow.status()).toBe(422)

    // Free the slots again so later tests can create pages.
    for (const capPage of capPages) {
      const del = await apiRequest(request, 'DELETE', `/api/storefront/pages?id=${capPage.id}`, { token, headers: { [LOCK]: capPage.updatedAt } })
      expect(del.status()).toBe(200)
      createdPageIds.splice(createdPageIds.indexOf(capPage.id), 1)
    }
  })

  test('employees cannot write; manage-only staff cannot publish', async ({ request }) => {
    const { organizationId, tenantId } = getTokenContext(token)
    const page = await createPage(request, `tc-${RUN}-perm`, 'Permissions')

    const employeeEmail = `tc-sf2-emp-${RUN}@example.com`
    const password = 'Suqna-Staff-2026!tc2'
    createdUserIds.push(await createUserFixture(request, token, { email: employeeEmail, password, organizationId, roles: ['employee'] }))
    const employee = await getAuthToken(request, employeeEmail, password)
    expect((await apiRequest(request, 'GET', '/api/storefront/pages', { token: employee })).status()).toBe(200)
    expect((await save(request, employee, page, { title: 'Nope' })).status()).toBe(403)

    roleId = await createRoleFixture(request, token, { name: `tc-sf2-editor-${RUN}`, tenantId })
    await setRoleAclFeatures(request, token, { roleId, features: ['storefront.view', 'storefront.pages.manage'] })
    const editorEmail = `tc-sf2-ed-${RUN}@example.com`
    createdUserIds.push(await createUserFixture(request, token, { email: editorEmail, password, organizationId, roles: [`tc-sf2-editor-${RUN}`] }))
    const editor = await getAuthToken(request, editorEmail, password)
    expect((await save(request, editor, page, { title: 'Edited by editor' })).status()).toBe(200)
    const fresh = await getPage(request, token, page.id)
    expect((await publish(request, editor, fresh)).status()).toBe(403)
  })
})
