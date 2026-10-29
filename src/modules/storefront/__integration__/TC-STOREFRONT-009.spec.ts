import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STOREFRONT-009: product purchase panel and persisted cart (shopping-journey
 * spec Phase 3, TEST-J04/TEST-J05). A configurable, personalized product and a
 * simple one in the superadmin's store: add, merge the same line, change
 * quantity and personalization, remove; variant, personalization, quantity and
 * currency refusals; strict bodies; the cookie; and isolation — another
 * browser's line answers 404 exactly like an unknown one. Then the buyer flow
 * once in a phone-sized browser. Every catalog row it creates is removed.
 */

const RUN = `tc9${Date.now().toString(36)}`
const YER = (amount: number) => new Intl.NumberFormat('ar-YE', { style: 'currency', currency: 'YER' }).format(amount)

type Cart = {
  lines: Array<{ id: string; productId: string; variantId: string | null; quantity: number; variantLabel: string | null; personalization: Array<{ code: string; value: string }>; unitPrice: { amount: number } | null; lineTotal: { amount: number } | null; issues: string[] }>
  subtotal: { amount: number; formatted: string } | null
  count: number
}

test.describe('TC-STOREFRONT-009: product page and persisted cart', () => {
  let token = ''
  let orgCookie = ''
  let siteSlug = ''
  let baseURL = ''
  const ids: Record<string, string> = {}
  const created: Array<{ path: string; id: string }> = []

  const catalog = (request: APIRequestContext, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) =>
    apiRequest(request, method, path, { token, data, headers: { Cookie: orgCookie } })

  async function create(request: APIRequestContext, path: string, data: Record<string, unknown>) {
    const res = await catalog(request, 'POST', path, data)
    expect(res.status(), await res.text()).toBe(201)
    const id = (await readJsonSafe<{ id: string }>(res))!.id
    if (path === '/api/catalog/products' || path === '/api/catalog/categories') created.push({ path, id })
    return id
  }

  /** A browser of its own: a separate cookie jar. */
  const buyer = () => playwrightRequest.newContext({ baseURL })
  const cartPath = () => `/api/storefront/shop/${siteSlug}/cart`
  const add = (ctx: APIRequestContext, data: Record<string, unknown>) => ctx.post(`${cartPath()}/lines`, { data })

  test.beforeAll(async ({ request }, info) => {
    baseURL = String(info.project.use.baseURL ?? '')
    token = await getAuthToken(request, 'superadmin')
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { orgId?: string }
    orgCookie = `om_selected_org=${claims.orgId}`
    siteSlug = (await readJsonSafe<{ slug: string }>(await apiRequest(request, 'GET', '/api/storefront/brand', { token })))!.slug
    const kinds = await readJsonSafe<{ items: Array<{ id: string; code: string }> }>(await catalog(request, 'GET', '/api/catalog/price-kinds?pageSize=100'))
    const regular = kinds!.items.find((kind) => kind.code === 'regular') ?? kinds!.items[0]!
    const price = (target: Record<string, string>, amount: number, currencyCode = 'YER') =>
      create(request, '/api/catalog/prices', { ...target, priceKindId: regular.id, currencyCode, unitPriceNet: String(amount), unitPriceGross: String(amount) })

    ids.box = await create(request, '/api/catalog/products', {
      title: `Gift box ${RUN}`,
      handle: `${RUN}-box`,
      sku: `${RUN}-BOX`.toUpperCase(),
      isConfigurable: true,
      optionSchema: {
        name: `Gift box ${RUN}`,
        options: [
          { code: 'size', label: 'الحجم', inputType: 'select', isRequired: true, choices: [{ code: 'small', label: 'صغير' }, { code: 'large', label: 'كبير' }] },
          { code: 'recipient', label: 'اسم المهدى إليه', inputType: 'text', isRequired: true },
          { code: 'note', label: 'رسالة', inputType: 'textarea' },
        ],
      },
    })
    ids.small = await create(request, '/api/catalog/variants', { productId: ids.box, name: 'صغير', sku: `${RUN}-S`.toUpperCase(), optionValues: { size: 'small' }, isDefault: true })
    ids.large = await create(request, '/api/catalog/variants', { productId: ids.box, name: 'كبير', sku: `${RUN}-L`.toUpperCase(), optionValues: { size: 'large' } })
    await price({ variantId: ids.small }, 1000)
    await price({ variantId: ids.large }, 2500)
    ids.simple = await create(request, '/api/catalog/products', { title: `Dates ${RUN}`, handle: `${RUN}-dates`, sku: `${RUN}-D`.toUpperCase() })
    await price({ productId: ids.simple }, 400)
    ids.dollar = await create(request, '/api/catalog/products', { title: `Import ${RUN}`, handle: `${RUN}-import`, sku: `${RUN}-I`.toUpperCase() })
    await price({ productId: ids.dollar }, 5, 'USD')
    ids.off = await create(request, '/api/catalog/products', { title: `Off ${RUN}`, handle: `${RUN}-off`, sku: `${RUN}-O`.toUpperCase(), isActive: false })
    await price({ productId: ids.off }, 100)
  })

  test.afterAll(async ({ request }) => {
    // Try every deletion, then report the ones that failed, so leftover fixtures never go unnoticed.
    const failures: string[] = []
    for (const { path, id } of created.reverse()) {
      try {
        const res = await catalog(request, 'DELETE', `${path}?id=${id}`)
        if (!res.ok()) failures.push(`${path}?id=${id}: ${res.status()}`)
      } catch (err) {
        failures.push(`${path}?id=${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    expect(failures, 'fixture cleanup').toEqual([])
  })

  test('add, merge, re-price, edit and remove lines; prices always from the server', async () => {
    const ctx = await buyer()
    const empty = await ctx.get(cartPath())
    expect(empty.status()).toBe(200)
    expect(((await empty.json()) as Cart).count).toBe(0)

    const first = await add(ctx, { productId: ids.box, variantId: ids.large, quantity: 2, personalization: { recipient: ' أحمد ' } })
    expect(first.status(), await first.text()).toBe(200)
    const cookie = first.headers()['set-cookie'] ?? ''
    expect(cookie).toMatch(/^sf_cart_[0-9a-f]{12}=/)
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
    let cart = (await first.json()) as Cart
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]).toMatchObject({ variantId: ids.large, quantity: 2, variantLabel: 'كبير', personalization: [{ code: 'recipient', value: 'أحمد' }, { code: 'note', value: '' }] })
    expect(cart.subtotal).toMatchObject({ amount: 5000, formatted: YER(5000) })

    // The same line again raises its quantity; another personalization is another line.
    cart = (await (await add(ctx, { productId: ids.box, variantId: ids.large, quantity: 1, personalization: { recipient: 'أحمد' } })).json()) as Cart
    expect(cart.lines.map((line) => line.quantity)).toEqual([3])
    cart = (await (await add(ctx, { productId: ids.box, variantId: ids.large, quantity: 1, personalization: { recipient: 'سارة' } })).json()) as Cart
    expect(cart.lines).toHaveLength(2)
    cart = (await (await add(ctx, { productId: ids.simple, quantity: 1 })).json()) as Cart
    expect(cart.count).toBe(5)
    expect(cart.subtotal!.amount).toBe(4 * 2500 + 400)

    // Editing the second line's personalization to equal the first merges them.
    const [ahmad, sara] = cart.lines
    const merged = await ctx.patch(`${cartPath()}/lines/${sara!.id}`, { data: { personalization: { recipient: 'أحمد' } } })
    expect(merged.status(), await merged.text()).toBe(200)
    cart = (await merged.json()) as Cart
    expect(cart.lines.find((line) => line.id === ahmad!.id)?.quantity).toBe(4)
    expect(cart.lines.some((line) => line.id === sara!.id)).toBe(false)

    const changed = (await (await ctx.patch(`${cartPath()}/lines/${ahmad!.id}`, { data: { quantity: 1 } })).json()) as Cart
    expect(changed.subtotal!.amount).toBe(2500 + 400)
    const removed = (await (await ctx.delete(`${cartPath()}/lines/${ahmad!.id}`)).json()) as Cart
    expect(removed.lines.map((line) => line.productId)).toEqual([ids.simple])

    // The cart survives: a fresh read with the same cookie.
    expect(((await (await ctx.get(cartPath())).json()) as Cart).count).toBe(1)
    await ctx.dispose()
  })

  test('refusals: variant, personalization, inactive or unknown product, quantity, currency, strict bodies', async () => {
    const ctx = await buyer()
    const code = async (res: Awaited<ReturnType<typeof add>>) => [res.status(), ((await res.json()) as { code: string }).code]
    expect(await code(await add(ctx, { productId: ids.box, quantity: 1, personalization: { recipient: 'a' } }))).toEqual([422, 'variantRequired'])
    expect(await code(await add(ctx, { productId: ids.box, variantId: ids.small, quantity: 1 }))).toEqual([422, 'personalizationInvalid'])
    const fields = (await (await add(ctx, { productId: ids.box, variantId: ids.small, quantity: 1, personalization: { recipient: 'a', price: '1' } })).json()) as { fieldErrors: Record<string, string> }
    expect(Object.keys(fields.fieldErrors)).toEqual(['personalization.price'])
    expect(await code(await add(ctx, { productId: ids.box, variantId: ids.simple, quantity: 1, personalization: { recipient: 'a' } }))).toEqual([422, 'variantUnavailable'])
    expect(await code(await add(ctx, { productId: ids.off, quantity: 1 }))).toEqual([404, 'productNotFound'])
    expect(await code(await add(ctx, { productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }))).toEqual([404, 'productNotFound'])
    expect((await add(ctx, { productId: ids.simple, quantity: 100 })).status()).toBe(422)
    expect((await add(ctx, { productId: ids.simple, quantity: 1, unitPrice: 1 })).status()).toBe(422)
    expect((await add(ctx, { productId: ids.simple, quantity: 1, tenantId: '00000000-0000-4000-8000-000000000000' })).status()).toBe(422)
    expect((await add(ctx, { productId: ids.simple, quantity: 60 })).status()).toBe(200)
    expect(await code(await add(ctx, { productId: ids.simple, quantity: 40 }))).toEqual([422, 'quantityLimit'])
    expect(await code(await add(ctx, { productId: ids.dollar, quantity: 1 }))).toEqual([422, 'currencyMismatch'])
    // Same-origin only.
    expect((await ctx.post(`${cartPath()}/lines`, { data: { productId: ids.simple, quantity: 1 }, headers: { origin: 'https://evil.example' } })).status()).toBe(403)
    // A follow-up write without the cookie the previous answer set: cookies are blocked.
    const blocked = await buyer()
    const refused = await blocked.post(`${cartPath()}/lines`, { data: { productId: ids.simple, quantity: 1 }, headers: { 'x-sf-cart-expected': '1' } })
    expect(await code(refused)).toEqual([400, 'cookiesRequired'])
    await blocked.dispose()
    await ctx.dispose()
  })

  test('isolation: another browser\'s line and an unknown line answer the same 404; another store never sees the cart', async () => {
    const alice = await buyer()
    const bob = await buyer()
    const aliceCart = (await (await add(alice, { productId: ids.simple, quantity: 1 })).json()) as Cart
    await add(bob, { productId: ids.simple, quantity: 2 })
    const lineId = aliceCart.lines[0]!.id
    for (const target of [lineId, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const patched = await bob.patch(`${cartPath()}/lines/${target}`, { data: { quantity: 5 } })
      expect(patched.status(), target).toBe(404)
      expect(((await patched.json()) as { code: string }).code).toBe('lineNotFound')
      expect((await bob.delete(`${cartPath()}/lines/${target}`)).status()).toBe(404)
    }
    expect(((await (await alice.get(cartPath())).json()) as Cart).lines[0]!.quantity).toBe(1)
    expect((await alice.get(`/api/storefront/shop/no-such-store-${RUN}/cart`)).status()).toBe(404)
    await alice.dispose()
    await bob.dispose()
  })

  test('buyer flow on a phone: pick, personalize, add, the cart sheet and the cart page in Arabic', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/${siteSlug}/products/${RUN}-box`)
    const button = page.locator('[data-slot=product-buy-box-actions] button[data-state]')
    await expect(button).toContainText('الحجم')
    await page.getByRole('radio', { name: /^كبير/ }).click()
    await expect(page.locator('[data-slot=product-buy-box-price]')).toContainText(YER(2500))
    await expect(button).toContainText('اسم المهدى إليه')
    await page.locator('#sf-field-recipient').fill('أحمد')
    await button.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('كبير · اسم المهدى إليه: أحمد')
    expect(await sheet.evaluate((element) => Boolean(element.closest('.sf-root.sf-shop')))).toBe(true)
    // Checkout arrives with Phase 4: the sheet's button leads there.
    await expect(sheet.getByRole('button', { name: 'إتمام الطلب' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto(`/${siteSlug}/cart`)
    await expect(page.locator('[data-slot=cart-line-item]')).toHaveCount(1)
    await expect(page.locator('.sf-cart-summary')).toContainText(YER(2500))
    await expect(page.locator('html')).not.toContainText('Add to bag')
  })
})
