import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { parseTenantArgs } from './lib/cliArgs'
import { enforcePaymentPolicy } from './lib/policy'

/** `yarn mercato payment_policy enforce [--tenant <uuid>]` — applies the policy to existing organizations. */
const enforce: ModuleCli = {
  command: 'enforce',
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
    for (const organization of organizations) {
      const scope = { tenantId: String(organization.tenant.id), organizationId: String(organization.id) }
      const { deactivated } = await enforcePaymentPolicy({ em, container }, scope)
      const detail = deactivated.length ? deactivated.map((method) => `${method.code} (${method.providerKey})`).join(', ') : 'nothing to change'
      console.log(`- ${scope.organizationId}: ${detail}`)
    }
  },
}

const cli: ModuleCli[] = [enforce]

export default cli
