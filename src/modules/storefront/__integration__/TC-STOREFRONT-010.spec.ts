import { expect, test } from '@playwright/test'
import { ShopFixtures } from './support/shopFixtures'

/**
 * TC-STOREFRONT-010: cart and browse regressions from the PR review of the
 * shopping journey. Concurrent adds to one line all count; PATCH and DELETE
 * renew the cart cookie; quantity tiers price a line; an edit that merges lines
 * is checked against tracked stock (WMS); a collection page drops a `category`
 * filter it cannot show; a second store (another organization) never sees the
 * first store's cart, lines or products. Catalog rows and the second store are
 * removed afterwards.
 */

const RUN = `tc10${Date.now().toString(36)}`

type Cart = {
  lines: Array<{ id: string; productId: string; quantity: number; unitPrice: { amount: number } | null; lineTotal: { amount: number } | null; maxQuantity: number; issues: string[] }>
  count: number
}

test.describe('TC-STOREFRONT-010: cart concurrency, cookie, quantity tiers, stock and store isolation', () => {
  let fx: ShopFixtures
  const ids: Record<string, string> = {}
  let storeB: Awaited<ReturnType<ShopFixtures['secondStore']>>

  const cartPath = (slug = fx.session.siteSlug) => `/api/storefront/shop/${slug}/cart`

  test.beforeAll(async ({}, info) => {
    fx = await ShopFixtures.open(String(info.project.use.baseURL ?? ''))
    ids.dates = (await fx.product(RUN, 'dates', 400)).productId
    // Quantity tiers: 1000 a unit, 800 from 5 units.
    ids.honey = (await fx.product(RUN, 'honey', 1000)).productId
    await fx.price({ productId: ids.honey }, 800, { minQuantity: 5 })
    // Tracked stock: 3 units in the warehouse.
    const tracked = await fx.product(RUN, 'tracked', 300, { withVariant: true })
    ids.tracked = tracked.productId
    await fx.stock(RUN, tracked.productId, tracked.variantId!, 3)
    // A personalized product, so two lines of it can be merged by an edit.
    ids.gift = await fx.create('/api/catalog/products', {
      title: `Gift ${RUN}`,
      handle: `${RUN}-gift`,
      sku: `${RUN}-GIFT`.toUpperCase(),
      optionSchema: { name: `Gift ${RUN}`, options: [{ code: 'recipient', label: 'الاسم', inputType: 'text', isRequired: true }] },
    })
    ids.giftVariant = await fx.create('/api/catalog/variants', { productId: ids.gift, name: 'gift', sku: `${RUN}-GIFT-V`.toUpperCase(), isDefault: true })
    await fx.price({ productId: ids.gift }, 500)
    await fx.stock(`${RUN}g`, ids.gift, ids.giftVariant, 4)
    storeB = await fx.secondStore(RUN)
    ids.storeBProduct = (await fx.product(RUN, 'b-only', 700, { orgCookie: storeB.orgCookie, title: `B only ${RUN}` })).productId
  })

  test.afterAll(async () => {
    expect(await fx.cleanup(), 'fixture cleanup').toEqual([])
  })

  test('concurrent adds of the same line all count', async () => {
    const ctx = await fx.buyer()
    expect((await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.dates, quantity: 1 } })).status()).toBe(200)
    const answers = await Promise.all(Array.from({ length: 6 }, () => ctx.post(`${cartPath()}/lines`, { data: { productId: ids.dates, quantity: 1 } })))
    expect(answers.map((res) => res.status())).toEqual([200, 200, 200, 200, 200, 200])
    const cart = (await (await ctx.get(cartPath())).json()) as Cart
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.quantity).toBe(7)
    await ctx.dispose()
  })

  test('PATCH and DELETE renew the cart cookie with the cart', async () => {
    const ctx = await fx.buyer()
    const added = await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.dates, quantity: 1 } })
    const line = ((await added.json()) as Cart).lines[0]!
    const patched = await ctx.patch(`${cartPath()}/lines/${line.id}`, { data: { quantity: 2 } })
    expect(patched.status()).toBe(200)
    expect(patched.headers()['set-cookie'] ?? '').toMatch(/^sf_cart_[0-9a-f]{12}=[A-Za-z0-9_-]{43};.*Max-Age=2592000/i)
    const removed = await ctx.delete(`${cartPath()}/lines/${line.id}`)
    expect(removed.status()).toBe(200)
    expect(removed.headers()['set-cookie'] ?? '').toMatch(/Max-Age=2592000/i)
    await ctx.dispose()
  })

  test('a line is priced at its quantity (catalog quantity tiers)', async () => {
    const ctx = await fx.buyer()
    let cart = (await (await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.honey, quantity: 2 } })).json()) as Cart
    expect(cart.lines[0]).toMatchObject({ quantity: 2, unitPrice: { amount: 1000 }, lineTotal: { amount: 2000 } })
    cart = (await (await ctx.patch(`${cartPath()}/lines/${cart.lines[0]!.id}`, { data: { quantity: 5 } })).json()) as Cart
    expect(cart.lines[0]).toMatchObject({ quantity: 5, unitPrice: { amount: 800 }, lineTotal: { amount: 4000 } })
    await ctx.dispose()
  })

  test('tracked stock caps adds, quantity changes and merges of edited lines', async () => {
    const ctx = await fx.buyer()
    const code = async (res: Awaited<ReturnType<typeof ctx.post>>) => [res.status(), ((await res.json()) as { code?: string }).code ?? null]
    let cart = (await (await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.tracked, quantity: 2 } })).json()) as Cart
    expect(cart.lines[0]!.maxQuantity).toBe(3)
    expect(await code(await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.tracked, quantity: 2 } }))).toEqual([422, 'unavailable'])
    expect(await code(await ctx.patch(`${cartPath()}/lines/${cart.lines[0]!.id}`, { data: { quantity: 4 } }))).toEqual([422, 'unavailable'])

    // Two gift lines (3 + 1 of 4 in stock), then an edit making them equal: 4 fits, so they merge.
    await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.gift, variantId: ids.giftVariant, quantity: 3, personalization: { recipient: 'أحمد' } } })
    cart = (await (await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.gift, variantId: ids.giftVariant, quantity: 1, personalization: { recipient: 'سارة' } } })).json()) as Cart
    const sara = cart.lines.find((line) => line.productId === ids.gift && line.quantity === 1)!
    const merged = (await (await ctx.patch(`${cartPath()}/lines/${sara.id}`, { data: { personalization: { recipient: 'أحمد' } } })).json()) as Cart
    expect(merged.lines.filter((line) => line.productId === ids.gift).map((line) => line.quantity)).toEqual([4])
    // A third line of 1, edited to equal the merged one: 5 is more than the 4 in stock.
    cart = (await (await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.gift, variantId: ids.giftVariant, quantity: 1, personalization: { recipient: 'ليلى' } } })).json()) as Cart
    expect(cart.lines.filter((line) => line.productId === ids.gift)).toHaveLength(2)
    const layla = cart.lines.find((line) => line.productId === ids.gift && line.quantity === 1)!
    expect(await code(await ctx.patch(`${cartPath()}/lines/${layla.id}`, { data: { personalization: { recipient: 'أحمد' } } }))).toEqual([422, 'unavailable'])
    await ctx.dispose()
  })

  test('another store never sees this store\'s cart, lines or products', async () => {
    const ctx = await fx.buyer()
    const mine = (await (await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.dates, quantity: 1 } })).json()) as Cart
    // Same browser, store B: an empty cart; store A's product and line answer like unknown ones.
    expect(((await (await ctx.get(cartPath(storeB.siteSlug))).json()) as Cart).count).toBe(0)
    const foreignAdd = await ctx.post(`${cartPath(storeB.siteSlug)}/lines`, { data: { productId: ids.dates, quantity: 1 } })
    expect([foreignAdd.status(), ((await foreignAdd.json()) as { code: string }).code]).toEqual([404, 'productNotFound'])
    expect((await ctx.patch(`${cartPath(storeB.siteSlug)}/lines/${mine.lines[0]!.id}`, { data: { quantity: 3 } })).status()).toBe(404)
    expect((await ctx.delete(`${cartPath(storeB.siteSlug)}/lines/${mine.lines[0]!.id}`)).status()).toBe(404)
    // Store B's own product works there and never in store A.
    const own = await ctx.post(`${cartPath(storeB.siteSlug)}/lines`, { data: { productId: ids.storeBProduct, quantity: 1 } })
    expect(own.status(), await own.text()).toBe(200)
    expect((await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.storeBProduct, quantity: 1 } })).status()).toBe(404)
    expect(((await (await ctx.get(cartPath())).json()) as Cart).lines.map((line) => line.quantity)).toEqual([1])
    // Search and product pages stay in their own store.
    const searchA = await ctx.get(`/${fx.session.siteSlug}/search?q=${encodeURIComponent(`B only ${RUN}`)}`)
    // The page names the query; it must not link to store B's product.
    expect(await searchA.text()).not.toContain(`/products/${RUN}-b-only`)
    expect((await ctx.get(`/${fx.session.siteSlug}/products/${RUN}-b-only`)).status()).toBe(404)
    expect((await ctx.get(`/${storeB.siteSlug}/products/${RUN}-dates`)).status()).toBe(404)
    await ctx.dispose()
  })

  test('a collection page drops a category filter it has no control for', async () => {
    const categoryId = await fx.create('/api/catalog/categories', { name: `Shelf ${RUN}`, slug: `${RUN}-shelf`, isActive: true })
    const ctx = await fx.buyer()
    const res = await ctx.get(`/${fx.session.siteSlug}/collections/${RUN}-shelf?category=other&sort=newest`, { maxRedirects: 0 })
    expect([301, 307, 308]).toContain(res.status())
    expect(res.headers().location).toBe(`/${fx.session.siteSlug}/collections/${RUN}-shelf?sort=newest`)
    expect(categoryId).toBeTruthy()
    await ctx.dispose()
  })
})
