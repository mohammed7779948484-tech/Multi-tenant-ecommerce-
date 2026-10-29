import { expect, test, type APIRequestContext } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ShopFixtures } from './support/shopFixtures'

/**
 * TC-STOREFRONT-013: bank-transfer proof and the whole guest journey
 * (shopping-journey spec Phase 5: TEST-J09, TEST-J10, TEST-J11).
 * - The proof API: token required, fields and receipt validated by content,
 *   5 MB cap, one proof per order (also for two submits at once), refused for
 *   cash on delivery; the merchant gets a note with a link to the receipt and
 *   the receipt as a private attachment of the order; buyer text cannot
 *   inject links into the note.
 * - The full journey in a browser on two differently themed stores, at 390 and
 *   1280 px: product, cart, checkout by bank transfer, tracking page, proof form.
 * - Another store's slug never reaches this store's order, proof or receipt.
 */

const RUN = `tc13${Date.now().toString(36)}`
const ADEN = 'YE24'
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

type Quote = { quoteHash: string; grandTotal: { amount: number } }
type OrderView = { orderNumber: string; payment: { kind: string }; proof: { state: string; submittedAt: string | null } }

test.describe('TC-STOREFRONT-013: transfer proof and the full guest journey', () => {
  let fx: ShopFixtures
  const ids: Record<string, string> = {}
  let district = ''
  let transferRestore: { id: string; settings: unknown } | null = null
  let storeB: Awaited<ReturnType<ShopFixtures['secondStore']>>

  const shop = (path: string, slug = fx.session.siteSlug) => `/api/storefront/shop/${slug}${path}`
  const destination = () => ({ governorate: ADEN, district, area: 'المعلا، الشارع الرئيسي' })

  /** A buyer with an order placed by `paymentMethodId`; returns the buyer, the order number and its link token. */
  async function placedOrder(paymentMethodId: string) {
    const ctx = await fx.buyer()
    expect((await ctx.post(shop('/cart/lines'), { data: { productId: ids.coffee, quantity: 1 } })).status()).toBe(200)
    const q = (await (await ctx.post(shop('/checkout/quote'), { data: { destination: destination(), shippingMethodId: ids.zones, paymentMethodId } })).json()) as Quote
    const placed = await ctx.post(shop('/checkout/place'), {
      data: { contact: { name: 'فاطمة', phone: '771234567' }, destination: destination(), shippingMethodId: ids.zones, paymentMethodId, quoteHash: q.quoteHash },
    })
    expect(placed.status(), await placed.text()).toBe(201)
    const { orderNumber, trackingUrl } = (await placed.json()) as { orderNumber: string; trackingUrl: string }
    return { ctx, orderNumber, token: new URL(trackingUrl, 'http://x').searchParams.get('k')! }
  }

  const proof = (ctx: APIRequestContext, orderNumber: string, query: string, fields: { reference?: string; senderName?: string; receipt?: { name: string; mimeType: string; buffer: Buffer } }, slug?: string) =>
    ctx.post(`${shop(`/orders/${encodeURIComponent(orderNumber)}/proof`, slug)}${query}`, {
      multipart: {
        ...(fields.reference !== undefined ? { reference: fields.reference } : {}),
        ...(fields.senderName !== undefined ? { senderName: fields.senderName } : {}),
        ...(fields.receipt ? { receipt: fields.receipt } : {}),
      },
    })
  const png = { name: 'receipt.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG }

  test.beforeAll(async ({}, info) => {
    fx = await ShopFixtures.open(String(info.project.use.baseURL ?? ''))
    ids.coffee = (await fx.product(RUN, 'coffee', 4000, { title: `قهوة يمنية ${RUN}` })).productId
    district = ((await (await fx.call('GET', shop(`/checkout/options?governorate=${ADEN}`))).json()) as { districts: Array<{ code: string }> }).districts[0]!.code
    ids.zones = await fx.create(
      '/api/sales/shipping-methods',
      { tenantId: fx.session.tenantId, organizationId: fx.session.orgId, code: `${RUN}-zones`, name: `توصيل ${RUN}`, providerKey: 'suqna-yemen-zones', currencyCode: 'YER', estimatedTransitDays: 2, isActive: true, providerSettings: { currencyCode: 'YER', rates: [{ governorate: ADEN, amount: 1000 }] } },
      { removable: false },
    )
    const methods = await readJsonSafe<{ items: Array<{ id: string; providerKey: string | null; isActive: boolean; providerSettings?: unknown }> }>(await fx.call('GET', '/api/sales/payment-methods?pageSize=100'))
    const transfer = methods!.items.find((method) => method.providerKey === 'wire-transfer' && method.isActive)!
    transferRestore = { id: transfer.id, settings: transfer.providerSettings ?? null }
    const res = await fx.call('PUT', '/api/sales/payment-methods', { id: transfer.id, providerSettings: { instructions: `حوّل إلى بنك التضامن ${RUN}`, accountNumber: '4001234567', dueDays: 3 } })
    expect(res.ok(), await res.text()).toBe(true)
    ids.transfer = transfer.id
    ids.cod = methods!.items.find((method) => method.providerKey === 'cash-on-delivery' && method.isActive)!.id
    storeB = await fx.secondStore(RUN, { preset: 'midnight' })
  })

  test.afterAll(async () => {
    const failures: string[] = []
    const del = await fx.call('DELETE', `/api/sales/shipping-methods?id=${ids.zones}`)
    if (!del.ok()) failures.push(`shipping method: ${del.status()}`)
    if (transferRestore) {
      const res = await fx.call('PUT', '/api/sales/payment-methods', { id: transferRestore.id, providerSettings: transferRestore.settings ?? {} })
      if (!res.ok()) failures.push(`transfer restore: ${res.status()}`)
    }
    failures.push(...(await fx.cleanup()))
    expect(failures, 'fixture cleanup').toEqual([])
  })

  test('TEST-J09: the proof needs the token, a reference and a real receipt; it lands on the order once', async () => {
    const { ctx, orderNumber, token } = await placedOrder(ids.transfer)
    const orderPath = shop(`/orders/${encodeURIComponent(orderNumber)}`)
    expect(((await (await ctx.get(orderPath)).json()) as OrderView).proof).toEqual({ state: 'open', submittedAt: null })

    // No token: the same 404 as an unknown order. Another store's slug with the right token: 404 too (TEST-J11).
    const stranger = await fx.buyer()
    expect((await proof(stranger, orderNumber, '', { reference: 'TRX-1', receipt: png })).status()).toBe(404)
    expect((await proof(stranger, orderNumber, `?k=${token}`, { reference: 'TRX-1', receipt: png }, storeB.siteSlug)).status()).toBe(404)
    await stranger.dispose()

    // Missing fields; a "PNG" that is text; a receipt over 5 MB.
    const missing = await proof(ctx, orderNumber, '', { reference: ' ' })
    expect(missing.status()).toBe(422)
    expect(Object.keys(((await missing.json()) as { fieldErrors: Record<string, string> }).fieldErrors).sort()).toEqual(['receipt', 'reference'])
    const fake = await proof(ctx, orderNumber, '', { reference: 'TRX-1', receipt: { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('not an image at all') } })
    expect([fake.status(), ((await fake.json()) as { code: string }).code]).toEqual([422, 'receiptType'])
    const big = await proof(ctx, orderNumber, '', { reference: 'TRX-1', receipt: { name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([ONE_PIXEL_PNG, Buffer.alloc(5 * 1024 * 1024)]) } })
    expect([big.status(), ((await big.json()) as { code: string }).code]).toEqual([413, 'receiptTooLarge'])
    // Refusals keep the proof open.
    expect(((await (await ctx.get(orderPath)).json()) as OrderView).proof.state).toBe('open')

    // Two submits at once (a double tap): one proof.
    const reference = `[اضغط هنا](https://evil.example) ٧٧١٢٣`
    const [a, b] = await Promise.all([proof(ctx, orderNumber, '', { reference, senderName: 'محمد علي', receipt: png }), proof(ctx, orderNumber, '', { reference, senderName: 'محمد علي', receipt: png })])
    expect([a.status(), b.status()].sort()).toEqual([201, 409])
    const view = (await (await ctx.get(orderPath)).json()) as OrderView
    expect(view.proof.state).toBe('submitted')
    expect(view.proof.submittedAt).toBeTruthy()
    expect((await proof(ctx, orderNumber, '', { reference: 'TRX-2', receipt: png })).status()).toBe(409)

    // The merchant: one private receipt on the order, and a note that links it and shows the buyer text as typed.
    const orders = await readJsonSafe<{ items: Array<{ id: string; orderNumber?: string; order_number?: string }> }>(await fx.call('GET', `/api/sales/orders?search=${encodeURIComponent(orderNumber)}&pageSize=5`))
    const orderId = orders!.items.find((item) => (item.orderNumber ?? item.order_number) === orderNumber)!.id
    const files = await readJsonSafe<{ items: Array<{ id: string; mimeType?: string; fileName?: string }> }>(await fx.call('GET', `/api/attachments?entityId=sales:sales_order&recordId=${orderId}`))
    expect(files!.items).toHaveLength(1)
    const fileId = files!.items[0]!.id
    const notes = await readJsonSafe<{ items: Array<{ body: string }> }>(await fx.call('GET', `/api/sales/notes?contextType=order&contextId=${orderId}`))
    const note = notes!.items.map((item) => item.body).find((body) => body.includes(`/api/attachments/file/${fileId}`))
    expect(note, 'proof note').toBeTruthy()
    expect(note).toContain('محمد علي')
    expect(note).toContain('77123')
    // The buyer's link markup is escaped: it reads as text, it links nowhere.
    expect(note).not.toContain('](https://evil.example)')
    const download = await fx.call('GET', `/api/attachments/file/${fileId}`)
    expect(download.status()).toBe(200)
    expect(download.headers()['content-type']).toContain('image/png')
    // The receipt is private: a buyer cannot fetch it.
    expect([401, 403, 404]).toContain((await ctx.get(`/api/attachments/file/${fileId}`)).status())
    await ctx.dispose()
  })

  test('TEST-J09: a cash-on-delivery order takes no transfer proof', async () => {
    const { ctx, orderNumber } = await placedOrder(ids.cod)
    expect(((await (await ctx.get(shop(`/orders/${encodeURIComponent(orderNumber)}`))).json()) as OrderView).proof.state).toBe('none')
    const res = await proof(ctx, orderNumber, '', { reference: 'TRX-9', receipt: png })
    expect([res.status(), ((await res.json()) as { code: string }).code]).toEqual([422, 'proofNotTransfer'])
    await ctx.dispose()
  })

  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    test(`TEST-J10: the whole journey on a ${viewport.name} (${viewport.width} px), bank transfer to proof`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/${fx.session.siteSlug}/search?q=${encodeURIComponent(`قهوة يمنية ${RUN}`)}`)
      // The store root carries the language and direction (the platform's own <html> is shared with the dashboards).
      await expect(page.locator('.sf-root').first()).toHaveAttribute('lang', 'ar')
      await expect(page.locator('.sf-root').first()).toHaveAttribute('dir', 'rtl')
      await page.getByRole('link', { name: new RegExp(`قهوة يمنية ${RUN}`) }).first().click()
      await expect(page).toHaveURL(new RegExp(`/${fx.session.siteSlug}/products/${RUN}-coffee$`))
      await page.locator('[data-slot=product-buy-box-actions] button[data-state]').click()
      await page.getByRole('dialog').getByRole('button', { name: 'إتمام الطلب' }).click()
      await expect(page).toHaveURL(new RegExp(`/${fx.session.siteSlug}/checkout$`))
      await page.getByLabel('الاسم الكامل').fill('سلمى ناصر')
      await page.getByLabel('رقم الجوال').fill('771234567')
      await page.getByLabel('المحافظة').fill('عدن')
      await page.getByRole('option', { name: 'عدن' }).click()
      await page.getByLabel('المديرية').click()
      await page.getByRole('option').first().click()
      await page.getByLabel('الحي والشارع').fill('خور مكسر')
      await page.getByRole('button', { name: 'متابعة' }).click()
      // Arrival dates in Arabic, whatever the browser's language.
      await expect(page.locator('[data-slot=delivery-option] .text-foreground.tabular-nums').first()).toHaveText(/\p{Script=Arabic}/u)
      await page.getByRole('button', { name: 'متابعة' }).click()
      await page.getByRole('radio', { name: /تحويل|Bank|Wire/i }).first().click()
      await expect(page.getByText(`حوّل إلى بنك التضامن ${RUN}`)).toBeVisible()
      await page.getByRole('button', { name: /^تأكيد الطلب/ }).click()
      await expect(page).toHaveURL(new RegExp(`/${fx.session.siteSlug}/orders/[^?]+\\?k=[A-Za-z0-9_-]{43}&placed=1$`))

      // The tracking page: transfer instructions, then the proof form.
      await expect(page.getByText(`حوّل إلى بنك التضامن ${RUN}`)).toBeVisible()
      await page.getByLabel('رقم عملية التحويل').fill('TRX-٤٥٦')
      await page.getByLabel(/اسم المُحوِّل/).fill('سلمى ناصر')
      await page.getByLabel('صورة الإيصال أو ملف PDF').setInputFiles(png)
      await page.getByRole('button', { name: 'إرسال الإثبات' }).click()
      await expect(page.getByText('تم استلام إثبات التحويل')).toBeVisible()
      // Reloading keeps it: the proof is recorded, and the form is gone.
      await page.reload()
      await expect(page.getByText('تم استلام إثبات التحويل')).toBeVisible()
      await expect(page.getByRole('button', { name: 'إرسال الإثبات' })).toHaveCount(0)
      expect(await page.locator('.sf-root').first().getAttribute('dir')).toBe('rtl')
      await expect(page.locator('main')).not.toContainText(/Send the proof|Transfer proof received|Thank you for your order/)
      // No horizontal scroll at this width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    })
  }

  test('TEST-J10: a differently themed store keeps its own theme through checkout and proof (390 px)', async ({ page }) => {
    test.setTimeout(90_000)
    const scope = { tenantId: fx.session.tenantId, organizationId: storeB.organizationId }
    await fx.create('/api/sales/shipping-methods', { ...scope, code: `${RUN}-b-zones`, name: `توصيل ب ${RUN}`, providerKey: 'suqna-yemen-zones', currencyCode: 'YER', isActive: true, providerSettings: { currencyCode: 'YER', rates: [], defaultAmount: 2000 } }, { orgCookie: storeB.orgCookie, removable: false })
    await fx.create('/api/sales/payment-methods', { ...scope, code: `${RUN}-b-transfer`, name: 'تحويل بنكي', providerKey: 'wire-transfer', isActive: true, providerSettings: { instructions: `حساب المتجر ب ${RUN}`, accountNumber: '5009876543' } }, { orgCookie: storeB.orgCookie, removable: false })
    await fx.product(RUN, 'b-honey', 6000, { orgCookie: storeB.orgCookie, title: `عسل ${RUN}` })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/${storeB.siteSlug}/products/${RUN}-b-honey`)
    await page.locator('[data-slot=product-buy-box-actions] button[data-state]').click()
    await page.getByRole('dialog').getByRole('button', { name: 'إتمام الطلب' }).click()
    const background = await page.locator('.sf-root').first().evaluate((element) => getComputedStyle(element).getPropertyValue('--background').trim())
    expect(background.toLowerCase()).toContain('0f1420')
    await page.getByLabel('الاسم الكامل').fill('خالد سعيد')
    await page.getByLabel('رقم الجوال').fill('0733123456')
    await page.getByLabel('المحافظة').fill('تعز')
    await page.getByRole('option', { name: 'تعز' }).click()
    await page.getByLabel('المديرية').click()
    await page.getByRole('option').first().click()
    await page.getByLabel('الحي والشارع').fill('شارع جمال')
    await page.getByRole('button', { name: 'متابعة' }).click()
    await page.getByRole('button', { name: 'متابعة' }).click()
    await page.getByRole('button', { name: /^تأكيد الطلب/ }).click()
    await expect(page).toHaveURL(new RegExp(`/${storeB.siteSlug}/orders/[^?]+\\?k=`))
    const form = page.locator('form', { has: page.getByRole('button', { name: 'إرسال الإثبات' }) })
    await expect(form).toBeVisible()
    // The proof form sits inside the store's themed root, in its colours.
    expect(await form.evaluate((element) => Boolean(element.closest('.sf-root')))).toBe(true)
    await page.getByLabel('رقم عملية التحويل').fill('B-778')
    await page.getByLabel('صورة الإيصال أو ملف PDF').setInputFiles(png)
    await page.getByRole('button', { name: 'إرسال الإثبات' }).click()
    await expect(page.getByText('تم استلام إثبات التحويل')).toBeVisible()

    // TEST-J11: store A's slug never opens store B's order or takes its proof, even with its token.
    const orderNumber = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
    const k = new URL(page.url()).searchParams.get('k')!
    const ctx = await fx.buyer()
    expect((await ctx.get(shop(`/orders/${encodeURIComponent(orderNumber)}?k=${k}`))).status()).toBe(404)
    expect((await proof(ctx, orderNumber, `?k=${k}`, { reference: 'X', receipt: png })).status()).toBe(404)
    expect((await ctx.get(`/${fx.session.siteSlug}/orders/${encodeURIComponent(orderNumber)}?k=${k}`)).status()).toBe(404)
    await ctx.dispose()
  })
})
