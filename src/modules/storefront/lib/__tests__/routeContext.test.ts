import { describe, expect, it, jest } from '@jest/globals'

// The route helpers' runtime dependencies are not needed for the pure context builder.
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({}) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => null }))

import { buildStaffCommandContext, type StaffSiteContext } from '../routeContext'

const HOME_TENANT = '11111111-1111-4111-8111-111111111111'
const SELECTED_TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('buildStaffCommandContext', () => {
  it('gives commands the tenant the route resolved, not the raw session tenant', () => {
    // A super-admin whose session belongs to HOME_TENANT, working in SELECTED_TENANT
    // through the tenant switcher: the route loaded the site from SELECTED_TENANT.
    const context = {
      container: {},
      auth: { sub: 'user-1', tenantId: HOME_TENANT, orgId: null, isSuperAdmin: true },
      em: {},
      site: {},
      tenantId: SELECTED_TENANT,
      organizationId: ORG,
      translate: (key: string) => key,
    } as unknown as StaffSiteContext
    const ctx = buildStaffCommandContext(context, new Request('http://localhost/api/storefront/brand'))
    expect(ctx.auth?.tenantId).toBe(SELECTED_TENANT)
    expect(ctx.auth?.orgId).toBe(ORG)
    expect(ctx.auth?.sub).toBe('user-1')
    expect(ctx.organizationScope).toEqual({ selectedId: ORG, filterIds: [ORG], allowedIds: null, tenantId: SELECTED_TENANT })
  })
})
