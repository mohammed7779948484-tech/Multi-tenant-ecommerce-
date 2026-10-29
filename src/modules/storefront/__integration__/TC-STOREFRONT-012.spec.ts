import { expect, test, type APIRequestContext } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { ShopFixtures } from './support/shopFixtures'

/**
 * TC-STOREFRONT-012: cart regressions from the fourth review round.
 * - Differently personalized lines of one product and variant share its stock:
 *   adds and edits count them together, and the cart flags them together.
 * - A product priced only from a quantity tier can be bought at that quantity,
 *   and an add that merges into a line is priced at the merged quantity.
 * - A line whose personalization no longer satisfies the product's fields is
 *   flagged (and so blocks the quote and placement).
 * Catalog rows are removed afterwards; warehouse stock stays in the test database.
 */

const RUN = `tc12${Date.now().toString(36)}`

type Cart = {
  lines: Array<{ id: string; productId: string; quantity: number; unitPrice: { amount: number } | null; maxQuantity: number; issues: string[] }>
}

test.describe('TC-STOREFRONT-012: shared stock, quantity-tier prices and personalization in the cart', () => {
  let fx: ShopFixtures
  const ids: Record<string, string> = {}

  const lines = (slug = fx.session.siteSlug) => `/api/storefront/shop/${slug}/cart/lines`
  const cartOf = async (ctx: APIRequestContext) => (await (await ctx.get(`/api/storefront/shop/${fx.session.siteSlug}/cart`)).json()) as Cart
  const code = async (res: Awaited<ReturnType<APIRequestContext['post']>>) => [res.status(), ((await res.json()) as { code?: string }).code ?? null]

  test.beforeAll(async ({}, info) => {
    fx = await ShopFixtures.open(String(info.project.use.baseURL ?? ''))
    // A personalized product with 4 units in stock.
    ids.gift = await fx.create('/api/catalog/products', {
      title: `Gift ${RUN}`,
      handle: `${RUN}-gift`,
      sku: `${RUN}-GIFT`.toUpperCase(),
      optionSchema: { name: `Gift ${RUN}`, options: [{ code: 'recipient', label: 'الاسم', inputType: 'text', isRequired: true }] },
    })
    ids.giftVariant = await fx.create('/api/catalog/variants', { productId: ids.gift, name: 'gift', sku: `${RUN}-GIFT-V`.toUpperCase(), isDefault: true })
    await fx.price({ productId: ids.gift }, 500)
    await fx.stock(RUN, ids.gift, ids.giftVariant, 4)
    // Sold by the case only: the one price starts at 5 units.
    ids.bulk = (await fx.product(RUN, 'bulk', null)).productId
    await fx.price({ productId: ids.bulk }, 800, { minQuantity: 5 })
    // A card with an optional message, made stricter after it is in a cart.
    ids.card = await fx.create('/api/catalog/products', {
      title: `Card ${RUN}`,
      handle: `${RUN}-card`,
      sku: `${RUN}-CARD`.toUpperCase(),
      optionSchema: { name: `Card ${RUN}`, options: [{ code: 'message', label: 'رسالة', inputType: 'text' }] },
    })
    ids.cardVariant = await fx.create('/api/catalog/variants', { productId: ids.card, name: 'card', sku: `${RUN}-CARD-V`.toUpperCase(), isDefault: true })
    await fx.price({ productId: ids.card }, 300)
  })

  test.afterAll(async () => {
    expect(await fx.cleanup(), 'fixture cleanup').toEqual([])
  })

  test('differently personalized lines of one item share its stock', async () => {
    const ctx = await fx.buyer()
    const gift = (recipient: string, quantity: number) => ({ productId: ids.gift, variantId: ids.giftVariant, quantity, personalization: { recipient } })
    expect((await ctx.post(lines(), { data: gift('أحمد', 3) })).status()).toBe(200)
    // 3 + 2 is more than the 4 in stock, though each line alone fits.
    expect(await code(await ctx.post(lines(), { data: gift('سارة', 2) }))).toEqual([422, 'unavailable'])
    let cart = (await (await ctx.post(lines(), { data: gift('سارة', 1) })).json()) as Cart
    expect(cart.lines.map((line) => line.quantity).sort()).toEqual([1, 3])
    // What stock leaves for each line once the other is counted.
    expect(cart.lines.find((line) => line.quantity === 3)!.maxQuantity).toBe(3)
    expect(cart.lines.find((line) => line.quantity === 1)!.maxQuantity).toBe(1)
    // Raising one line past what the other leaves is refused.
    const sara = cart.lines.find((line) => line.quantity === 1)!
    expect(await code(await ctx.patch(`${lines()}/${sara.id}`, { data: { quantity: 2 } }))).toEqual([422, 'unavailable'])
    // Stock taken elsewhere (here: a line raised behind the cart's back) flags both lines.
    await withClient((client) => client.query('update storefront_cart_lines set quantity = 3 where id = $1', [sara.id]))
    cart = await cartOf(ctx)
    expect(cart.lines.map((line) => line.issues)).toEqual([['outOfStock'], ['outOfStock']])
    await ctx.dispose()
  })

  test('a product priced from a quantity tier is bought at that quantity; merges are priced merged', async () => {
    const ctx = await fx.buyer()
    expect(await code(await ctx.post(lines(), { data: { productId: ids.bulk, quantity: 2 } }))).toEqual([422, 'noPrice'])
    let cart = (await (await ctx.post(lines(), { data: { productId: ids.bulk, quantity: 5 } })).json()) as Cart
    expect(cart.lines[0]).toMatchObject({ quantity: 5, unitPrice: { amount: 800 }, issues: [] })
    const merged = await ctx.post(lines(), { data: { productId: ids.bulk, quantity: 1 } })
    expect(merged.status(), await merged.text()).toBe(200)
    cart = (await merged.json()) as Cart
    expect(cart.lines[0]).toMatchObject({ quantity: 6, unitPrice: { amount: 800 } })
    expect(await code(await ctx.patch(`${lines()}/${cart.lines[0]!.id}`, { data: { quantity: 3 } }))).toEqual([422, 'noPrice'])
    await ctx.dispose()
  })

  test('a line whose personalization no longer fits the product is flagged', async () => {
    const ctx = await fx.buyer()
    expect((await ctx.post(lines(), { data: { productId: ids.card, variantId: ids.cardVariant, quantity: 1, personalization: { message: 'كل عام وأنت بخير' } } })).status()).toBe(200)
    expect((await cartOf(ctx)).lines[0]!.issues).toEqual([])
    // The merchant adds a required field after the line was added.
    const res = await fx.call('PUT', '/api/catalog/products', {
      id: ids.card,
      optionSchema: {
        name: `Card ${RUN}`,
        options: [
          { code: 'message', label: 'رسالة', inputType: 'text' },
          { code: 'recipient', label: 'الاسم', inputType: 'text', isRequired: true },
        ],
      },
    })
    expect(res.ok(), await res.text()).toBe(true)
    const cart = await cartOf(ctx)
    expect(cart.lines[0]!.issues).toEqual(['personalization'])
    // Filling it in clears the flag.
    const fixed = (await (await ctx.patch(`${lines()}/${cart.lines[0]!.id}`, { data: { personalization: { message: 'كل عام وأنت بخير', recipient: 'ليلى' } } })).json()) as Cart
    expect(fixed.lines[0]!.issues).toEqual([])
    await ctx.dispose()
  })
})
