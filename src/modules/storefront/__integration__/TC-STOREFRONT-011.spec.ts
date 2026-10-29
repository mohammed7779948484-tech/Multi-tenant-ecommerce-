import { expect, test, type APIRequestContext } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ShopFixtures } from './support/shopFixtures'

/**
 * TC-STOREFRONT-011: guest checkout, order placement and tracking
 * (shopping-journey spec Phase 4, TEST-J06/J07/J08). A Yemen-zones delivery
 * method and the store's cash-on-delivery and bank-transfer methods; options
 * for a destination; a quote that equals the sales order's totals; placement
 * through `sales.orders.create`; one order for a double submit; 409 with a new
 * quote after a price change; the tracking page and API with the order token
 * only; and another store, which sees none of it. Then the buyer flow once in
 * a phone-sized browser. Fixture rows are removed afterwards.
 */

const RUN = `tc11${Date.now().toString(36)}`
const ADEN = 'YE24'
const TAIZ = 'YE15'
const YER = (amount: number) => new Intl.NumberFormat('ar-YE', { style: 'currency', currency: 'YER' }).format(amount)

type Quote = { quoteHash: string; subtotal: { amount: number }; shipping: { amount: number }; fees: { amount: number }; grandTotal: { amount: number; formatted: string }; blocked: boolean }
type Options = {
  governorates: Array<{ code: string }>
  districts: Array<{ code: string; name: string }>
  shippingMethods: Array<{ id: string; amount: number | null }>
  paymentMethods: Array<{ id: string; kind: string; instructions: string | null }>
}

test.describe('TC-STOREFRONT-011: checkout, order placement and tracking', () => {
  let fx: ShopFixtures
  const ids: Record<string, string> = {}
  let adenDistrict = ''
  let taizDistrict = ''
  let transferRestore: { id: string; metadata: unknown } | null = null
  let storeB: Awaited<ReturnType<ShopFixtures['secondStore']>>

  const shop = (path: string, slug = fx.session.siteSlug) => `/api/storefront/shop/${slug}${path}`
  const destination = (district = adenDistrict, governorate = ADEN) => ({ governorate, district, area: 'حي كريتر، شارع الملكة أروى', landmark: 'بجوار مسجد العيدروس', note: 'اتصل قبل الوصول' })
  const options = async (ctx: APIRequestContext, governorate = ADEN, district = adenDistrict) =>
    (await (await ctx.get(shop(`/checkout/options?governorate=${governorate}&district=${district}`))).json()) as Options
  const quote = async (ctx: APIRequestContext, body: Record<string, unknown>) => ctx.post(shop('/checkout/quote'), { data: body })
  const place = (ctx: APIRequestContext, body: Record<string, unknown>) => ctx.post(shop('/checkout/place'), { data: body })

  /** A buyer with `quantity` dates in the cart. */
  async function buyerWithCart(quantity = 2) {
    const ctx = await fx.buyer()
    expect((await ctx.post(shop('/cart/lines'), { data: { productId: ids.dates, quantity } })).status()).toBe(200)
    return ctx
  }

  test.beforeAll(async ({}, info) => {
    fx = await ShopFixtures.open(String(info.project.use.baseURL ?? ''))
    ids.dates = (await fx.product(RUN, 'dates', 1200)).productId
    ids.honey = (await fx.product(RUN, 'honey', 3000)).productId
    const regions = (await (await fx.call('GET', shop(`/checkout/options?governorate=${ADEN}`))).json()) as Options
    adenDistrict = regions.districts[0]!.code
    taizDistrict = ((await (await fx.call('GET', shop(`/checkout/options?governorate=${TAIZ}`))).json()) as Options).districts[0]!.code
    // Delivery: Aden 2,000 (one district 1,500); no default, so Ta'iz is not served.
    ids.zones = await fx.create(
      '/api/sales/shipping-methods',
      {
        tenantId: fx.session.tenantId,
        organizationId: fx.session.orgId,
        code: `${RUN}-zones`,
        name: `توصيل ${RUN}`,
        providerKey: 'suqna-yemen-zones',
        currencyCode: 'YER',
        estimatedTransitDays: 2,
        isActive: true,
        providerSettings: { currencyCode: 'YER', rates: [{ governorate: ADEN, amount: 2000 }, { governorate: ADEN, district: adenDistrict, amount: 1500 }] },
      },
      { removable: false },
    )
    // Bank transfer: real instructions for this test, restored afterwards.
    const methods = await readJsonSafe<{ items: Array<{ id: string; providerKey: string | null; isActive: boolean; metadata?: unknown; providerSettings?: unknown }> }>(
      await fx.call('GET', '/api/sales/payment-methods?pageSize=100'),
    )
    const transfer = methods!.items.find((method) => method.providerKey === 'wire-transfer' && method.isActive)
    if (transfer) {
      transferRestore = { id: transfer.id, metadata: transfer.providerSettings ?? null }
      const res = await fx.call('PUT', '/api/sales/payment-methods', { id: transfer.id, providerSettings: { instructions: `حوّل إلى بنك الكريمي ${RUN}`, accountNumber: '3001234567', dueDays: 3 } })
      expect(res.ok(), await res.text()).toBe(true)
      ids.transfer = transfer.id
    }
    ids.cod = methods!.items.find((method) => method.providerKey === 'cash-on-delivery' && method.isActive)!.id
    storeB = await fx.secondStore(RUN, { preset: 'midnight' })
  })

  test.afterAll(async () => {
    const failures: string[] = []
    const del = await fx.call('DELETE', `/api/sales/shipping-methods?id=${ids.zones}`)
    if (!del.ok()) failures.push(`shipping method: ${del.status()}`)
    if (transferRestore) {
      const res = await fx.call('PUT', '/api/sales/payment-methods', { id: transferRestore.id, providerSettings: transferRestore.metadata ?? {} })
      if (!res.ok()) failures.push(`transfer restore: ${res.status()}`)
    }
    failures.push(...(await fx.cleanup()))
    expect(failures, 'fixture cleanup').toEqual([])
  })

  test('options: governorates, districts, delivery priced for the district, COD and the configured transfer', async () => {
    const ctx = await buyerWithCart()
    const aden = await options(ctx)
    expect(aden.governorates).toHaveLength(22)
    expect(aden.districts.length).toBeGreaterThan(0)
    expect(aden.shippingMethods.find((method) => method.id === ids.zones)?.amount).toBe(1500)
    const kinds = aden.paymentMethods.map((method) => method.kind)
    expect(kinds).toContain('cod')
    if (ids.transfer) expect(aden.paymentMethods.find((method) => method.id === ids.transfer)?.instructions).toContain(RUN)
    // Another district of Aden: the governorate rate. Ta'iz: not served (no default).
    const other = (await options(ctx, ADEN, aden.districts[1]!.code)).shippingMethods.find((method) => method.id === ids.zones)
    expect(other?.amount).toBe(2000)
    expect((await options(ctx, TAIZ, taizDistrict)).shippingMethods.some((method) => method.id === ids.zones)).toBe(false)
    expect((await ctx.get(shop('/checkout/options?governorate=YE99'))).status()).toBe(422)
    expect((await ctx.get(shop(`/checkout/options?governorate=${TAIZ}&district=${adenDistrict}`))).status()).toBe(422)
    await ctx.dispose()
  })

  test('quote: lines, delivery and the COD fee from the sales calculation; refusals', async () => {
    const ctx = await buyerWithCart(2)
    const res = await quote(ctx, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod })
    expect(res.status(), await res.text()).toBe(200)
    const q = (await res.json()) as Quote
    expect(q.subtotal.amount).toBe(2400)
    expect(q.shipping.amount).toBe(1500)
    expect(q.grandTotal.amount).toBeCloseTo(q.subtotal.amount + q.shipping.amount + q.fees.amount, 2)
    expect(q.quoteHash).toMatch(/^[0-9a-f]{32}$/)
    const code = async (r: Awaited<ReturnType<typeof quote>>) => [r.status(), ((await r.json()) as { code: string }).code]
    expect(await code(await quote(ctx, { destination: destination(taizDistrict, TAIZ), shippingMethodId: ids.zones, paymentMethodId: ids.cod }))).toEqual([422, 'destinationNotServed'])
    expect(await code(await quote(ctx, { destination: destination(taizDistrict), shippingMethodId: ids.zones, paymentMethodId: ids.cod }))).toEqual([422, 'destinationInvalid'])
    expect(await code(await quote(ctx, { destination: destination(), shippingMethodId: '00000000-0000-4000-8000-000000000000', paymentMethodId: ids.cod }))).toEqual([422, 'shippingUnavailable'])
    expect((await quote(ctx, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod, grandTotal: 1 })).status()).toBe(422)
    const empty = await fx.buyer()
    expect(await code(await quote(empty, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod }))).toEqual([422, 'cartEmpty'])
    await empty.dispose()
    await ctx.dispose()
  })

  test('place: one sales order with the quoted totals; a double submit gives the same order; tracking needs the token', async () => {
    const ctx = await buyerWithCart(2)
    const q = (await (await quote(ctx, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod })).json()) as Quote
    const body = { contact: { name: 'سارة أحمد', phone: '٠٧٧١٢٣٤٥٦٧' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod, quoteHash: q.quoteHash }
    const [first, second] = await Promise.all([place(ctx, body), place(ctx, body)])
    const statuses = [first.status(), second.status()].sort()
    expect(statuses, `${await first.text()} ${await second.text()}`).toEqual([200, 201])
    const a = (await first.json()) as { orderNumber: string; trackingUrl: string }
    const b = (await second.json()) as { orderNumber: string; trackingUrl: string }
    expect(a.orderNumber).toBe(b.orderNumber)
    expect(a.trackingUrl).toBe(b.trackingUrl)
    const placed = first.status() === 201 ? first : second
    expect(placed.headers()['set-cookie'] ?? '').toMatch(/^sf_ord_[0-9a-f]{12}_[0-9a-f]{10}=[A-Za-z0-9_-]{43};.*HttpOnly/i)
    // The cart is now an order: empty, and the next add starts a new cart.
    expect(((await (await ctx.get(shop('/cart'))).json()) as { count: number }).count).toBe(0)
    expect((await ctx.post(shop('/cart/lines'), { data: { productId: ids.honey, quantity: 1 } })).status()).toBe(200)

    // Tracking: the cookie works; the link token works anywhere; nothing else does.
    const orderPath = shop(`/orders/${encodeURIComponent(a.orderNumber)}`)
    const view = (await (await ctx.get(orderPath)).json()) as { status: string; paymentStatus: string; totals: { grandTotal: { amount: number } }; contact: { phone: string }; lines: Array<{ quantity: number }> }
    expect(view).toMatchObject({ status: 'pending_approval', paymentStatus: 'pending', contact: { phone: '+967771234567' } })
    expect(view.totals.grandTotal.amount).toBeCloseTo(q.grandTotal.amount, 2)
    expect(view.lines.map((line) => line.quantity)).toEqual([2])
    const token = new URL(a.trackingUrl, 'http://x').searchParams.get('k')!
    const stranger = await fx.buyer()
    expect((await stranger.get(orderPath)).status()).toBe(404)
    expect((await stranger.get(`${orderPath}?k=${token}`)).status()).toBe(200)
    expect((await stranger.get(`${orderPath}?k=${'A'.repeat(43)}`)).status()).toBe(404)
    expect((await stranger.get(shop(`/orders/NO-SUCH-${RUN}?k=${token}`))).status()).toBe(404)
    // Another store answers the same 404 with the right token.
    expect((await stranger.get(shop(`/orders/${encodeURIComponent(a.orderNumber)}?k=${token}`, storeB.siteSlug))).status()).toBe(404)
    // The page renders for the token holder only.
    expect((await stranger.get(`/${fx.session.siteSlug}/orders/${encodeURIComponent(a.orderNumber)}?k=${token}`)).status()).toBe(200)
    expect((await stranger.get(`/${fx.session.siteSlug}/orders/${encodeURIComponent(a.orderNumber)}`)).status()).toBe(404)
    await stranger.dispose()

    // The merchant sees the order in sales with the same total.
    const orders = await readJsonSafe<{ items: Array<{ orderNumber?: string; order_number?: string; grandTotalGrossAmount?: string | number; grand_total_gross_amount?: string | number }> }>(
      await fx.call('GET', `/api/sales/orders?search=${encodeURIComponent(a.orderNumber)}&pageSize=5`),
    )
    const row = orders?.items.find((item) => (item.orderNumber ?? item.order_number) === a.orderNumber)
    expect(row, 'order in the sales admin').toBeTruthy()
    expect(Number(row!.grandTotalGrossAmount ?? row!.grand_total_gross_amount)).toBeCloseTo(q.grandTotal.amount, 2)
    await ctx.dispose()
  })

  test('a submit that created the order but did not record it is finished by the next submit, never placed twice', async () => {
    const ctx = await buyerWithCart(1)
    const q = (await (await quote(ctx, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod })).json()) as Quote
    const body = { contact: { name: 'منى', phone: '771234567' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod, quoteHash: q.quoteHash }
    const first = await place(ctx, body)
    expect(first.status(), await first.text()).toBe(201)
    const placed = (await first.json()) as { orderNumber: string; trackingUrl: string }
    const cartId = await withClient(async (client) => {
      const row = await client.query<{ cart_id: string }>('select cart_id from storefront_order_access where order_number = $1', [placed.orderNumber])
      return row.rows[0]!.cart_id
    })
    // What an interrupted submit leaves after `sales.orders.create`: the order exists, its access row and the
    // cart's closing do not. `savedId` says whether the order id reached the cart; `status` is the cart's state.
    const interruptedAfterCreate = (state: { status: 'placing' | 'active'; claimAgeMinutes: number; savedId: boolean }) =>
      withClient(async (client) => {
        await client.query('delete from storefront_order_access where cart_id = $1', [cartId])
        await client.query(
          `update storefront_carts set status = $2, updated_at = now() - make_interval(mins => $3),
             converted_order_id = case when $4 then converted_order_id else null end where id = $1`,
          [cartId, state.status, state.claimAgeMinutes, state.savedId],
        )
      })
    // The order's external reference is plain and names its cart.
    const ordersOfCart = () =>
      withClient(async (client) => Number((await client.query<{ n: string }>('select count(*) as n from sales_orders where external_reference = $1', [`storefront-cart:${cartId}`])).rows[0]!.n))
    expect(await ordersOfCart()).toBe(1)

    // Each finishes the same order at once: a fresh or stale claim with the id saved, a stale claim whose id
    // write failed, and a cart given back although its order was created.
    for (const state of [
      { status: 'placing', claimAgeMinutes: 0, savedId: true },
      { status: 'placing', claimAgeMinutes: 10, savedId: true },
      { status: 'placing', claimAgeMinutes: 10, savedId: false },
      { status: 'active', claimAgeMinutes: 0, savedId: false },
    ] as const) {
      await interruptedAfterCreate(state)
      const again = await place(ctx, body)
      expect(again.status(), `${JSON.stringify(state)}: ${await again.text()}`).toBe(200)
      expect(((await again.json()) as { orderNumber: string }).orderNumber).toBe(placed.orderNumber)
      expect(await ordersOfCart(), JSON.stringify(state)).toBe(1)
    }
    // The recorded access is the buyer's: the original tracking link opens the order.
    expect((await ctx.get(shop(`/orders/${encodeURIComponent(placed.orderNumber)}?k=${new URL(placed.trackingUrl, 'http://x').searchParams.get('k')}`))).status()).toBe(200)
    await ctx.dispose()
  })

  test('a price change after the quote answers 409 with the new quote and places nothing', async () => {
    const productId = (await fx.product(RUN, 'saffron', 500)).productId
    const ctx = await fx.buyer()
    await ctx.post(shop('/cart/lines'), { data: { productId, quantity: 1 } })
    const before = (await (await quote(ctx, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod })).json()) as Quote
    await fx.price({ productId }, 400, { minQuantity: 1 })
    const prices = await readJsonSafe<{ items: Array<{ id: string; unitPriceGross?: string | number; unit_price_gross?: string | number }> }>(await fx.call('GET', `/api/catalog/prices?productId=${productId}&pageSize=10`))
    const old = prices!.items.find((row) => Number(row.unitPriceGross ?? row.unit_price_gross) === 500)
    if (old) await fx.call('DELETE', `/api/catalog/prices?id=${old.id}`)
    const refused = await place(ctx, { contact: { name: 'علي', phone: '771234567' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod, quoteHash: before.quoteHash })
    expect(refused.status(), await refused.text()).toBe(409)
    const body = (await refused.json()) as { code: string; quote: Quote }
    expect(body.code).toBe('quoteChanged')
    expect(body.quote.subtotal.amount).toBe(400)
    expect(body.quote.quoteHash).not.toBe(before.quoteHash)
    // The cart is untouched; confirming the new quote places the order.
    const placed = await place(ctx, { contact: { name: 'علي', phone: '771234567' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod, quoteHash: body.quote.quoteHash })
    expect(placed.status(), await placed.text()).toBe(201)
    await ctx.dispose()
  })

  test('bank transfer: the order shows the store\'s instructions; contact and destination are validated', async () => {
    test.skip(!ids.transfer, 'the store has no active bank-transfer method')
    const ctx = await buyerWithCart(1)
    const q = (await (await quote(ctx, { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.transfer })).json()) as Quote
    const invalid = await place(ctx, { contact: { name: 'ع', phone: '12345' }, destination: { ...destination(), area: '' }, shippingMethodId: ids.zones, paymentMethodId: ids.transfer, quoteHash: q.quoteHash })
    expect(invalid.status()).toBe(422)
    expect(Object.keys(((await invalid.json()) as { fieldErrors: Record<string, string> }).fieldErrors).sort()).toEqual(['contact.name', 'destination.area'])
    const badPhone = await place(ctx, { contact: { name: 'علي', phone: '12345' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.transfer, quoteHash: q.quoteHash })
    expect(((await badPhone.json()) as { fieldErrors: Record<string, string> }).fieldErrors).toHaveProperty(['contact.phone'])
    const placed = (await (await place(ctx, { contact: { name: 'علي', phone: '+967 733 123 456' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.transfer, quoteHash: q.quoteHash })).json()) as { orderNumber: string }
    const view = (await (await ctx.get(shop(`/orders/${encodeURIComponent(placed.orderNumber)}`))).json()) as { payment: { kind: string; instructions: string; accountNumber: string } }
    expect(view.payment).toMatchObject({ kind: 'transfer', accountNumber: '3001234567' })
    expect(view.payment.instructions).toContain(RUN)
    await ctx.dispose()
  })

  test('another store offers none of this store\'s methods and cannot place with them', async () => {
    const ctx = await fx.buyer()
    const productId = (await fx.product(RUN, 'b-tea', 900, { orgCookie: storeB.orgCookie })).productId
    expect((await ctx.post(shop('/cart/lines', storeB.siteSlug), { data: { productId, quantity: 1 } })).status()).toBe(200)
    const opts = (await (await ctx.get(shop(`/checkout/options?governorate=${ADEN}&district=${adenDistrict}`, storeB.siteSlug))).json()) as Options
    expect(opts.shippingMethods.some((method) => method.id === ids.zones)).toBe(false)
    expect(opts.paymentMethods.some((method) => method.id === ids.cod)).toBe(false)
    const res = await ctx.post(shop('/checkout/quote', storeB.siteSlug), { data: { destination: destination(), shippingMethodId: ids.zones, paymentMethodId: ids.cod } })
    expect([res.status(), ((await res.json()) as { code: string }).code]).toEqual([422, 'shippingUnavailable'])
    await ctx.dispose()
  })

  test('buyer flow on a phone: cart, Arabic checkout, confirm, tracking page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/${fx.session.siteSlug}/products/${RUN}-dates`)
    await page.locator('[data-slot=product-buy-box-actions] button[data-state]').click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'إتمام الطلب' }).click()
    await expect(page).toHaveURL(new RegExp(`/${fx.session.siteSlug}/checkout$`))
    await expect(page.locator('h1')).toHaveText('إتمام الطلب')
    await page.getByLabel('الاسم الكامل').fill('سارة أحمد')
    await page.getByLabel('رقم الجوال').fill('771234567')
    // The governorate list, then a district of Aden.
    await page.getByLabel('المحافظة').fill('عدن')
    await page.getByRole('option', { name: 'عدن' }).click()
    await page.getByLabel('المديرية').click()
    await page.getByRole('option').first().click()
    await page.getByLabel('الحي والشارع').fill('كريتر')
    await page.getByRole('button', { name: 'متابعة' }).click()
    await expect(page.locator('[data-slot=delivery-option]').first()).toBeVisible()
    await page.getByRole('button', { name: 'متابعة' }).click()
    const confirm = page.getByRole('button', { name: /^تأكيد الطلب/ })
    await expect(confirm).toBeEnabled()
    expect(await page.locator('.sf-root').first().getAttribute('dir')).toBe('rtl')
    await confirm.click()
    await expect(page).toHaveURL(new RegExp(`/${fx.session.siteSlug}/orders/[^?]+\\?k=[A-Za-z0-9_-]{43}&placed=1$`))
    await expect(page.locator('[data-slot=order-confirmation-header]')).toContainText('تم استلام الطلب')
    await expect(page.getByText('تم الاستلام، بانتظار التأكيد')).toBeVisible()
    await expect(page.locator('html')).not.toContainText('Thank you for your order')
  })

  test('a second, differently themed store places its own COD order; checkout wears its theme at 1280 px', async ({ page }) => {
    // Store B: its own delivery method and cash on delivery (a new organization has none seeded).
    const scope = { tenantId: fx.session.tenantId, organizationId: storeB.organizationId }
    await fx.create('/api/sales/shipping-methods', { ...scope, code: `${RUN}-b-zones`, name: `توصيل ب ${RUN}`, providerKey: 'suqna-yemen-zones', currencyCode: 'YER', isActive: true, providerSettings: { currencyCode: 'YER', rates: [], defaultAmount: 3000 } }, { orgCookie: storeB.orgCookie, removable: false })
    await fx.create('/api/sales/payment-methods', { ...scope, code: `${RUN}-b-cod`, name: 'الدفع عند الاستلام', providerKey: 'cash-on-delivery', isActive: true, providerSettings: { feeFlat: 0, feePercent: 0 } }, { orgCookie: storeB.orgCookie, removable: false })
    await fx.product(RUN, 'b-coffee', 2500, { orgCookie: storeB.orgCookie, title: `قهوة ${RUN}` })

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/${storeB.siteSlug}/products/${RUN}-b-coffee`)
    await page.locator('[data-slot=product-buy-box-actions] button[data-state]').click()
    await page.getByRole('dialog').getByRole('button', { name: 'إتمام الطلب' }).click()
    await expect(page).toHaveURL(new RegExp(`/${storeB.siteSlug}/checkout$`))
    // The midnight palette, not store A's: the stepper and buttons use the store's own tokens.
    const background = await page.locator('.sf-root').first().evaluate((element) => getComputedStyle(element).getPropertyValue('--background').trim())
    expect(background.toLowerCase()).toContain('0f1420')
    await expect(page.locator('.sf-checkout-summary')).toBeVisible()
    await page.getByLabel('الاسم الكامل').fill('علي محمد')
    await page.getByLabel('رقم الجوال').fill('0733123456')
    await page.getByLabel('المحافظة').fill('تعز')
    const governorate = page.getByRole('option', { name: 'تعز' })
    await expect(governorate).toBeVisible()
    // The list is portalled inside the themed store root.
    expect(await governorate.evaluate((element) => Boolean(element.closest('.sf-root')))).toBe(true)
    await governorate.click()
    await page.getByLabel('المديرية').click()
    await page.getByRole('option').first().click()
    await page.getByLabel('الحي والشارع').fill('شارع جمال')
    await page.getByRole('button', { name: 'متابعة' }).click()
    await page.getByRole('button', { name: 'متابعة' }).click()
    // Delivery from store B's default rate and the total, formatted in Arabic by the server.
    await expect(page.locator('.sf-checkout-summary')).toContainText(YER(3000))
    await expect(page.locator('.sf-checkout-summary')).toContainText(YER(5500))
    await page.getByRole('button', { name: /^تأكيد الطلب/ }).click()
    await expect(page).toHaveURL(new RegExp(`/${storeB.siteSlug}/orders/[^?]+\\?k=`))
    // (This test organization has no sales status dictionaries, so no status badge; the confirmation shows.)
    await expect(page.locator('[data-slot=order-confirmation-header]')).toContainText('تم استلام الطلب')
    await expect(page.locator('[data-slot=order-confirmation-items]')).toContainText(YER(5500))
    // Store A never lists store B's order: its number answers 404 there.
    const orderNumber = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
    const ctx = await fx.buyer()
    expect((await ctx.get(`/api/storefront/shop/${fx.session.siteSlug}/orders/${encodeURIComponent(orderNumber)}?${new URL(page.url()).searchParams}`)).status()).toBe(404)
    await ctx.dispose()
  })
})
