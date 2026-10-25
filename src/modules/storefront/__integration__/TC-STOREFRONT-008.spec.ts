import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-008: browse and search (shopping-journey spec Phase 2, TEST-J03).
 * Search by text (every word, any order), category tree, price range, in-stock,
 * every sort, page clamp, empty results, the collections index and a collection
 * page's own filters. Only active products of the store are listed. Runs in the
 * env-configured superadmin's store; every catalog row it creates is removed.
 */

const RUN = `tc8${Date.now().toString(36)}`

/** Product titles in page order, as the product cards render them. */
function titles(html: string): string[] {
  return [...html.matchAll(/data-slot="product-card-title"[^>]*><a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1]!.replace(` ${RUN}`, ''))
}

test.describe('TC-STOREFRONT-008: browse and search', () => {
  let token = ''
  let orgCookie = ''
  let siteSlug = ''
  const ids: Record<string, string> = {}
  const created: Array<{ path: string; id: string }> = []

  const catalog = (request: APIRequestContext, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) =>
    apiRequest(request, method, path, { token, data, headers: { Cookie: orgCookie } })

  async function create(request: APIRequestContext, path: string, data: Record<string, unknown>) {
    const res = await catalog(request, 'POST', path, data)
    expect(res.status(), await res.text()).toBe(201)
    const id = (await readJsonSafe<{ id: string }>(res))!.id
    if (path !== '/api/catalog/prices') created.push({ path, id })
    return id
  }

  const get = async (request: APIRequestContext, path: string) => {
    const res = await request.get(`/${siteSlug}${path}`)
    expect(res.status(), path).toBe(200)
    return res.text()
  }

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { orgId?: string }
    orgCookie = `om_selected_org=${claims.orgId}`
    siteSlug = (await readJsonSafe<{ slug: string }>(await apiRequest(request, 'GET', '/api/storefront/brand', { token })))!.slug
    ids.root = await create(request, '/api/catalog/categories', { name: `Root ${RUN}`, slug: `${RUN}-root` })
    ids.child = await create(request, '/api/catalog/categories', { name: `Child ${RUN}`, parentId: ids.root })
    ids.other = await create(request, '/api/catalog/categories', { name: `Other ${RUN}`, slug: `${RUN}-other` })
    const kinds = await readJsonSafe<{ items: Array<{ id: string; code: string }> }>(await catalog(request, 'GET', '/api/catalog/price-kinds?pageSize=100'))
    const regular = kinds!.items.find((kind) => kind.code === 'regular') ?? kinds!.items[0]!
    // Created in this order, so "newest" is the reverse.
    const products: Array<[string, string, number | null, boolean]> = [
      ['Alpha', ids.child!, 100, true],
      ['Bravo', ids.root!, 300, true],
      ['Charlie', ids.other!, 200, true],
      ['Delta', ids.root!, 50, false],
      ['Echo', ids.other!, null, true],
    ]
    for (const [name, categoryId, amount, isActive] of products) {
      ids[name] = await create(request, '/api/catalog/products', { title: `${name} ${RUN}`, handle: `${RUN}-${name.toLowerCase()}`, sku: `${RUN}-${name}`.toUpperCase(), categoryIds: [categoryId], isActive })
      if (amount !== null) {
        await create(request, '/api/catalog/prices', { productId: ids[name], priceKindId: regular.id, currencyCode: 'YER', unitPriceNet: String(amount), unitPriceGross: String(amount) })
      }
    }
  })

  test.afterAll(async ({ request }) => {
    for (const { path, id } of created.reverse()) await catalog(request, 'DELETE', `${path}?id=${id}`).catch(() => null)
  })

  test('text search lists active products only, newest first, with every word in any order', async ({ request }) => {
    const html = await get(request, `/search?q=${RUN}`)
    expect(titles(html)).toEqual(['Echo', 'Charlie', 'Bravo', 'Alpha'])
    expect(html).toContain(new Intl.NumberFormat('ar-YE', { style: 'currency', currency: 'YER' }).format(300))
    expect(titles(await get(request, `/search?q=${encodeURIComponent(`${RUN} alpha`)}`))).toEqual(['Alpha'])
    expect(titles(await get(request, `/search?q=${encodeURIComponent(`ALPHA ${RUN}`)}`))).toEqual(['Alpha'])
    // Result lists are not indexed.
    expect(html).toMatch(/<meta name="robots" content="noindex/)
  })

  test('every sort: price both ways with unpriced products last, and name', async ({ request }) => {
    expect(titles(await get(request, `/search?q=${RUN}&sort=price_asc`))).toEqual(['Alpha', 'Charlie', 'Bravo', 'Echo'])
    expect(titles(await get(request, `/search?q=${RUN}&sort=price_desc`))).toEqual(['Bravo', 'Charlie', 'Alpha', 'Echo'])
    expect(titles(await get(request, `/search?q=${RUN}&sort=name`))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Echo'])
  })

  test('category filter covers the tree; price range and in-stock narrow it', async ({ request }) => {
    expect(titles(await get(request, `/search?q=${RUN}&category=${RUN}-root&sort=name`))).toEqual(['Alpha', 'Bravo'])
    expect(titles(await get(request, `/search?q=${RUN}&category=${RUN}-root&category=${RUN}-other&sort=name`))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Echo'])
    expect(titles(await get(request, `/search?q=${RUN}&price=150-250`))).toEqual(['Charlie'])
    expect(titles(await get(request, `/search?q=${RUN}&price=150-`))).toEqual(['Charlie', 'Bravo'])
    // Untracked stock counts as available.
    expect(titles(await get(request, `/search?q=${RUN}&in_stock=1&sort=name`))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Echo'])
    expect(titles(await get(request, `/search?q=${RUN}&category=no-such-category`))).toEqual([])
  })

  test('invalid parameters clamp instead of failing; no results say so', async ({ request }) => {
    expect(titles(await get(request, `/search?q=${RUN}&page=99&sort=bogus&price=abc`))).toEqual(['Echo', 'Charlie', 'Bravo', 'Alpha'])
    const empty = await get(request, `/search?q=${RUN}-nothing`)
    expect(titles(empty)).toEqual([])
    expect(empty).toContain('لا نتائج')
  })

  test('collections index and a collection page with its own filters and the merchant order', async ({ request }) => {
    const index = await get(request, '/collections')
    expect(index).toContain(`Root ${RUN}`)
    expect(index).toContain(`href="/${siteSlug}/collections/${RUN}-root"`)
    expect(index).not.toContain(`Child ${RUN}`)
    const root = await get(request, `/collections/${RUN}-root`)
    expect(titles(root).sort()).toEqual(['Alpha', 'Bravo'])
    // The sub-category appears in the rail.
    expect(root).toContain(`Child ${RUN}`)
    expect(titles(await get(request, `/collections/${RUN}-root?price=250-`))).toEqual(['Bravo'])
    expect(titles(await get(request, `/collections/${RUN}-root?sort=price_desc`))).toEqual(['Bravo', 'Alpha'])
  })

  test('the header links to search; the shell footer and menu link to every category', async ({ request }) => {
    const html = await get(request, '/collections')
    expect(html).toContain(`href="/${siteSlug}/search"`)
    expect(html).toContain(`href="/${siteSlug}/collections"`)
  })
})
