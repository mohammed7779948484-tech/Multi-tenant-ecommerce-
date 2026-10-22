import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { enforcePaymentPolicy } from './lib/policy'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readFlag(argv: string[], name: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === `--${name}`) return argv[i + 1] ?? null
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
  }
  return null
}

/** `yarn mercato payment_policy enforce [--tenant <uuid>]` — applies the policy to existing organizations. */
const enforce: ModuleCli = {
  command: 'enforce',
  async run(argv) {
    const tenantId = readFlag(argv, 'tenant')
    if (tenantId !== null && !UUID_PATTERN.test(tenantId)) {
      console.error('--tenant must be a UUID')
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const organizations = await em.find(
      Organization,
      { deletedAt: null, ...(tenantId ? { tenant: tenantId } : {}) },
      { fields: ['id', 'tenant'], orderBy: { createdAt: 'asc' } },
    )
    for (const organization of organizations) {
      const scope = { tenantId: String(organization.tenant.id), organizationId: String(organization.id) }
      const { deactivated } = await enforcePaymentPolicy(em, scope)
      const detail = deactivated.length ? deactivated.map((method) => `${method.code} (${method.providerKey})`).join(', ') : 'nothing to change'
      console.log(`- ${scope.organizationId}: ${detail}`)
    }
  },
}

const cli: ModuleCli[] = [enforce]

export default cli
