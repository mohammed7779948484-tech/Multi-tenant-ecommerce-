import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { enforcePaymentPolicy } from './lib/policy'

const logger = createLogger('payment_policy').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  /**
   * Runs after `sales.seedDefaults` (this module `requires` sales), which seeds
   * a Stripe "Credit Card" method for every new tenant. Errors are not
   * swallowed here: they reach the setup orchestrator's log for this module.
   * `yarn mercato payment_policy enforce` applies the policy to existing tenants.
   */
  async seedDefaults({ em, tenantId, organizationId }) {
    const result = await enforcePaymentPolicy(em, { tenantId, organizationId })
    if (result.deactivated.length) {
      logger.info('Deactivated gateway payment methods', {
        tenantId,
        organizationId,
        codes: result.deactivated.map((method) => method.code),
      })
    }
  },
}

export default setup
