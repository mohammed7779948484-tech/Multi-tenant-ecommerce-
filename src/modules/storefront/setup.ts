import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureStorefrontSite } from './lib/seeding'

const logger = createLogger('storefront').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['storefront.*'],
    admin: ['storefront.*'],
    employee: ['storefront.view'],
  },

  /**
   * Seeds the new organization's storefront (site, default theme, published home
   * page). `setupInitialTenant` calls this after the tenant and organization are
   * committed and propagates any throw, which would fail the merchant's signup.
   * Seeding is therefore defensive: it logs failures instead of rethrowing, and
   * `yarn mercato storefront ensure-sites --tenant <id>` repairs the tenant.
   */
  async onTenantCreated({ em, tenantId, organizationId }) {
    try {
      const result = await ensureStorefrontSite(em, { tenantId, organizationId })
      logger.info('Storefront ensured for new tenant', { tenantId, organizationId, status: result.status })
    } catch (err) {
      logger.error('Storefront seeding failed; run `yarn mercato storefront ensure-sites --tenant <id>`', {
        err,
        tenantId,
        organizationId,
      })
    }
  },
}

export default setup
