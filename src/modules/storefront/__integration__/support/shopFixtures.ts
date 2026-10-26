import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { DEFAULT_THEME_TOKENS } from '../../lib/theme'

/**
 * Shared, self-contained fixtures for the shop integration tests: the
 * superadmin's session and store, catalog rows created through the catalog API
 * (and removed afterwards), a second store in another organization of the same
 * tenant, and tracked stock through the WMS API. Catalog rows and second stores
 * are recorded and removed by `cleanup()`, which reports what it could not
 * remove. Warehouse stock stays in the throwaway test database: the WMS keeps
 * its movement ledger and refuses to delete a warehouse that held stock.
 */

type Created = { path: string; id: string; orgCookie: string }

export type ShopSession = {
  token: string
  tenantId: string
  userId: string
  orgId: string
  orgCookie: string
  siteSlug: string
  baseURL: string
}

export async function openShopSession(request: APIRequestContext, baseURL: string): Promise<ShopSession> {
  const token = await getAuthToken(request, 'superadmin')
  const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { orgId: string; tenantId: string; sub: string }
  const siteSlug = (await readJsonSafe<{ slug: string }>(await apiRequest(request, 'GET', '/api/storefront/brand', { token })))!.slug
  return { token, tenantId: claims.tenantId, userId: claims.sub, orgId: claims.orgId, orgCookie: `om_selected_org=${claims.orgId}`, siteSlug, baseURL }
}

export class ShopFixtures {
  private readonly created: Created[] = []
  private readonly stores: Array<{ organizationId: string; siteId: string }> = []
  private priceKindId: string | null = null

  private constructor(
    readonly session: ShopSession,
    private readonly request: APIRequestContext,
  ) {}

  /** Opens its own request context (a `beforeAll` fixture context cannot be reused by tests or `afterAll`). */
  static async open(baseURL: string): Promise<ShopFixtures> {
    const request = await playwrightRequest.newContext({ baseURL })
    return new ShopFixtures(await openShopSession(request, baseURL), request)
  }

  call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown, orgCookie = this.session.orgCookie) {
    return apiRequest(this.request, method, path, { token: this.session.token, data, headers: { Cookie: orgCookie } })
  }

  /** Creates a row through a staff API (201) and records it for removal when `removable`. */
  async create(path: string, data: Record<string, unknown>, options: { orgCookie?: string; removable?: boolean } = {}) {
    const orgCookie = options.orgCookie ?? this.session.orgCookie
    const res = await this.call('POST', path, data, orgCookie)
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201)
    const id = (await readJsonSafe<{ id: string }>(res))!.id
    if (options.removable ?? (path === '/api/catalog/products' || path === '/api/catalog/categories')) this.created.push({ path, id, orgCookie })
    return id
  }

  async price(target: { productId?: string; variantId?: string }, amount: number, options: { currencyCode?: string; minQuantity?: number; orgCookie?: string } = {}) {
    if (!this.priceKindId) {
      const kinds = await readJsonSafe<{ items: Array<{ id: string; code: string }> }>(await this.call('GET', '/api/catalog/price-kinds?pageSize=100'))
      this.priceKindId = (kinds!.items.find((kind) => kind.code === 'regular') ?? kinds!.items[0]!).id
    }
    return this.create(
      '/api/catalog/prices',
      {
        ...target,
        priceKindId: this.priceKindId,
        currencyCode: options.currencyCode ?? 'YER',
        unitPriceNet: String(amount),
        unitPriceGross: String(amount),
        ...(options.minQuantity ? { minQuantity: options.minQuantity } : {}),
      },
      { orgCookie: options.orgCookie },
    )
  }

  /** A simple product with one price (and its default variant when `withVariant`). */
  async product(run: string, key: string, amount: number | null, options: { withVariant?: boolean; orgCookie?: string; title?: string } = {}) {
    const productId = await this.create(
      '/api/catalog/products',
      { title: options.title ?? `${key} ${run}`, handle: `${run}-${key}`, sku: `${run}-${key}`.toUpperCase() },
      { orgCookie: options.orgCookie },
    )
    let variantId: string | null = null
    if (options.withVariant) {
      variantId = await this.create('/api/catalog/variants', { productId, name: key, sku: `${run}-${key}-V`.toUpperCase(), isDefault: true }, { orgCookie: options.orgCookie })
    }
    if (amount !== null) await this.price({ productId }, amount, { orgCookie: options.orgCookie })
    return { productId, variantId }
  }

  /**
   * A second store: a new organization of the same tenant with its own site and
   * theme (the rows `ensureStorefrontSite` would create), removed by `cleanup()`.
   */
  async secondStore(run: string): Promise<{ organizationId: string; orgCookie: string; siteSlug: string; siteId: string }> {
    const organizationId = await createOrganizationInDb({ name: `Store B ${run}`, tenantId: this.session.tenantId })
    const siteSlug = `store-b-${run}`.toLowerCase().slice(0, 40)
    const siteId = randomUUID()
    await withClient(async (client) => {
      await client.query(
        `insert into storefront_sites (id, tenant_id, organization_id, slug, name, default_locale, first_published_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'en', now(), now(), now())`,
        [siteId, this.session.tenantId, organizationId, siteSlug, `Store B ${run}`],
      )
      await client.query(
        `insert into storefront_themes (id, tenant_id, organization_id, site_id, tokens, created_at, updated_at)
         values (gen_random_uuid(), $1, $2, $3, $4::jsonb, now(), now())`,
        [this.session.tenantId, organizationId, siteId, JSON.stringify(DEFAULT_THEME_TOKENS)],
      )
    })
    this.stores.push({ organizationId, siteId })
    return { organizationId, orgCookie: `om_selected_org=${organizationId}`, siteSlug, siteId }
  }

  /** Tracked stock: an inventory profile for the variant and `quantity` units received into a new warehouse. */
  async stock(run: string, productId: string, variantId: string, quantity: number) {
    const warehouseId = await this.create('/api/wms/warehouses', { name: `WH ${run}`, code: `WH-${run}`.toUpperCase().slice(0, 40), isActive: true }, { removable: false })
    const locationId = await this.create('/api/wms/locations', { warehouseId, code: `BIN-${run}`.toUpperCase().slice(0, 40), type: 'bin', isActive: true }, { removable: false })
    await this.create('/api/wms/inventory-profiles', { tenantId: this.session.tenantId, organizationId: this.session.orgId, catalogProductId: productId, catalogVariantId: variantId, defaultUom: 'pcs', defaultStrategy: 'fifo' }, { removable: false })
    const scope = { tenantId: this.session.tenantId, organizationId: this.session.orgId }
    const received = await this.call('POST', '/api/wms/inventory/receive', {
      ...scope,
      warehouseId,
      locationId,
      catalogVariantId: variantId,
      quantity,
      referenceType: 'manual',
      referenceId: randomUUID(),
      performedBy: this.session.userId,
    })
    expect(received.ok(), `receive: ${await received.text()}`).toBe(true)
  }

  /** A browser of its own: a separate cookie jar. */
  buyer() {
    return playwrightRequest.newContext({ baseURL: this.session.baseURL })
  }

  /** Removes every recorded row (newest first) and the second stores; returns what failed. */
  async cleanup(): Promise<string[]> {
    const failures: string[] = []
    for (const { path, id, orgCookie } of this.created.reverse()) {
      try {
        const res = await this.call('DELETE', `${path}?id=${id}`, undefined, orgCookie)
        if (!res.ok()) failures.push(`${path}?id=${id}: ${res.status()}`)
      } catch (err) {
        failures.push(`${path}?id=${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    for (const store of this.stores) {
      try {
        await withClient(async (client) => {
          await client.query('delete from storefront_cart_lines where cart_id in (select id from storefront_carts where site_id = $1)', [store.siteId])
          await client.query('delete from storefront_carts where site_id = $1', [store.siteId])
          await client.query('delete from storefront_themes where site_id = $1', [store.siteId])
          await client.query('delete from storefront_sites where id = $1', [store.siteId])
        })
        await deleteOrganizationInDb(store.organizationId)
      } catch (err) {
        failures.push(`store ${store.siteId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    await this.request.dispose()
    return failures
  }
}
