import { describe, expect, it } from '@jest/globals'
import { resolveStoreOrganization } from '../commandScope'

/** The one rule every storefront route and command uses to pick the store's organization. */

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const HOME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('resolveStoreOrganization', () => {
  it('uses the organization picked in the switcher', () => {
    expect(
      resolveStoreOrganization({ scope: { selectedId: OTHER, allowedIds: [HOME, OTHER] }, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: T1 }),
    ).toEqual({ ok: true, organizationId: OTHER })
  })

  it('fails a selection the framework rejected', () => {
    expect(
      resolveStoreOrganization({ scope: { selectedId: null, selectionRejected: true }, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: T1 }),
    ).toEqual({ ok: false, reason: 'selection-rejected' })
  })

  it('fails an explicitly empty scope instead of widening it to the home organization', () => {
    expect(resolveStoreOrganization({ scope: { allowedIds: [] }, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: T1 })).toEqual({
      ok: false,
      reason: 'no-access',
    })
    expect(resolveStoreOrganization({ scope: { filterIds: [] }, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: T1 })).toEqual({
      ok: false,
      reason: 'no-access',
    })
  })

  it('falls back to the home organization for "all organizations" when it is allowed', () => {
    expect(resolveStoreOrganization({ scope: { selectedId: null, allowedIds: null }, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: T1 })).toEqual({
      ok: true,
      organizationId: HOME,
    })
  })

  it('never uses a home organization outside the caller\'s allowed set', () => {
    expect(
      resolveStoreOrganization({ scope: { selectedId: null, allowedIds: [OTHER], filterIds: [OTHER] }, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: T1 }),
    ).toEqual({ ok: false, reason: 'organization-required' })
  })

  it('super-admin with "all organizations": uses the actor\'s own organization in their own tenant', () => {
    expect(
      resolveStoreOrganization({ scope: { selectedId: null, allowedIds: null }, session: { tenantId: T1, orgId: null, actorOrgId: HOME }, effectiveTenantId: T1 }),
    ).toEqual({ ok: true, organizationId: HOME })
  })

  it('super-admin switched into another tenant: never pairs the home organization with that tenant', () => {
    // Tenant override only: `orgId` still names the home organization in T1.
    expect(
      resolveStoreOrganization({ scope: { selectedId: null, allowedIds: null }, session: { tenantId: T2, actorTenantId: T1, orgId: HOME }, effectiveTenantId: T2 }),
    ).toEqual({ ok: false, reason: 'organization-required' })
    // Tenant and "all organizations" overrides.
    expect(
      resolveStoreOrganization({
        scope: { selectedId: null, allowedIds: null },
        session: { tenantId: T2, actorTenantId: T1, orgId: null, actorOrgId: HOME },
        effectiveTenantId: T2,
      }),
    ).toEqual({ ok: false, reason: 'organization-required' })
  })

  it('requires a session organization and an effective tenant', () => {
    expect(resolveStoreOrganization({ scope: null, session: null, effectiveTenantId: T1 })).toEqual({ ok: false, reason: 'organization-required' })
    expect(resolveStoreOrganization({ scope: null, session: { tenantId: T1, orgId: HOME }, effectiveTenantId: null })).toEqual({
      ok: false,
      reason: 'organization-required',
    })
  })
})
