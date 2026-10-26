import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { parseTenantArgs } from './lib/cliArgs'
import { ensureStorefrontSite } from './lib/seeding'
import { ensureDevZoneShippingMethod } from './lib/shopFixtures'
import { StorefrontPage, StorefrontSite } from './data/entities'
import { HOME_PAGE_SLUG_VALUE, RESERVED_PAGE_SLUGS } from './lib/slug'

/**
 * `yarn mercato storefront ensure-sites [--tenant <uuid>]`
 *
 * Idempotently gives every live organization (or every organization of one
 * tenant) its storefront. Used to backfill tenants created before the module
 * existed and to repair a tenant whose signup-time seeding failed.
 */
const ensureSites: ModuleCli = {
  command: 'ensure-sites',
  async run(argv) {
    const args = parseTenantArgs(argv)
    if (!args.ok) {
      console.error(args.error)
      process.exitCode = 1
      return
    }
    const tenantId = args.tenantId
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const organizations = await em.find(
      Organization,
      { deletedAt: null, ...(tenantId ? { tenant: tenantId } : {}) },
      { fields: ['id', 'tenant'], orderBy: { createdAt: 'asc' } },
    )
    if (organizations.length === 0) {
      console.log('No organizations found.')
      return
    }
    let failures = 0
    for (const organization of organizations) {
      const scope = { tenantId: String(organization.tenant.id), organizationId: String(organization.id) }
      try {
        const result = await ensureStorefrontSite(em, scope)
        if (result.status === 'skipped') {
          console.log(`- ${scope.organizationId}: skipped (${result.reason})`)
        } else {
          const repaired = result.repaired.length ? `, repaired ${result.repaired.join(', ')}` : ''
          console.log(`- ${scope.organizationId}: ${result.status} /${result.slug}${repaired}`)
        }
      } catch (err) {
        failures += 1
        console.error(`- ${scope.organizationId}: failed (${err instanceof Error ? err.message : String(err)})`)
      }
    }
    if (failures > 0) process.exitCode = 1
  },
}

/**
 * `yarn mercato storefront reserved-slugs [--tenant <uuid>]`
 *
 * Read-only report: pages whose slug is now reserved for a shop route (for
 * example a page created as `search` before the search page existed). Such a
 * page is shadowed by the shop route; the merchant renames it in the page
 * editor. Changes nothing (shopping-journey spec Phase 2, no migration).
 */
const reservedSlugs: ModuleCli = {
  command: 'reserved-slugs',
  async run(argv) {
    const args = parseTenantArgs(argv)
    if (!args.ok) {
      console.error(args.error)
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const pages = await em.find(
      StorefrontPage,
      { deletedAt: null, slug: { $in: [...RESERVED_PAGE_SLUGS] }, ...(args.tenantId ? { tenantId: args.tenantId } : {}) },
      { fields: ['id', 'slug', 'siteId', 'tenantId', 'organizationId'], orderBy: { createdAt: 'asc' } },
    )
    // `index` is the home page's own fixed slug, never a conflict.
    const conflicts = pages.filter((page) => page.slug !== HOME_PAGE_SLUG_VALUE)
    if (!conflicts.length) {
      console.log('No pages use a reserved slug.')
      return
    }
    const sites = await em.find(StorefrontSite, { id: { $in: [...new Set(conflicts.map((page) => page.siteId))] } }, { fields: ['id', 'slug'] })
    const siteSlugs = new Map(sites.map((site) => [site.id, site.slug]))
    for (const page of conflicts) {
      console.log(`- /${siteSlugs.get(page.siteId) ?? page.siteId}/${page.slug} (page ${page.id}, tenant ${page.tenantId}, organization ${page.organizationId})`)
    }
    console.log(`${conflicts.length} page(s) use a reserved slug; rename them in the page editor.`)
  },
}

/**
 * `yarn mercato storefront shop-fixtures --tenant <uuid>`
 *
 * DEVELOPMENT DATA ONLY: gives every store of the tenant a Yemen-zones delivery
 * method with sample rates (see `lib/shopFixtures.ts`), so checkout works
 * locally. Idempotent; never touches real delivery or payment methods.
 */
const shopFixtures: ModuleCli = {
  command: 'shop-fixtures',
  async run(argv) {
    const args = parseTenantArgs(argv)
    if (!args.ok || !args.tenantId) {
      console.error(args.ok ? '--tenant <uuid> is required' : args.error)
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const sites = await em.find(StorefrontSite, { tenantId: args.tenantId, deletedAt: null }, { fields: ['id', 'slug', 'tenantId', 'organizationId'] })
    if (!sites.length) {
      console.log('No storefronts in this tenant.')
      return
    }
    for (const site of sites) {
      const status = await ensureDevZoneShippingMethod({ em: em.fork(), container }, { tenantId: site.tenantId, organizationId: site.organizationId })
      console.log(`- /${site.slug}: development delivery method ${status}`)
    }
    console.log('Development data only: sample rates, not for selling.')
  },
}

const cli: ModuleCli[] = [ensureSites, reservedSlugs, shopFixtures]

export default cli
