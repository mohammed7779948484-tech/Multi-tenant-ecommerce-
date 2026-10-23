import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { parseTenantArgs } from './lib/cliArgs'
import { ensureStorefrontSite } from './lib/seeding'

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

const cli: ModuleCli[] = [ensureSites]

export default cli
