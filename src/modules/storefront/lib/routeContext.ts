import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveStoreOrganization, storeOrganizationError } from './commandScope'
import { StorefrontSite } from '../data/entities'

export type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
export type StaffAuth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
export type Translate = Awaited<ReturnType<typeof resolveTranslations>>['translate']

export type StaffSiteContext = {
  auth: StaffAuth
  container: RequestContainer
  em: EntityManager
  site: StorefrontSite
  tenantId: string
  organizationId: string
  translate: Translate
}

/**
 * Trusted scope for storefront staff routes: the session's tenant and the single
 * selected organization (never request input), plus that organization's site.
 * Returns a ready response for 401, scope errors (400/403) and a missing site (404).
 */
export async function resolveStaffSite(req: Request): Promise<StaffSiteContext | { response: Response }> {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return { response: NextResponse.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 }) }
  }
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  // The same rule as the CRUD routes and commands (`resolveStoreOrganization`).
  const resolved = resolveStoreOrganization({ scope, session: auth, effectiveTenantId: tenantId })
  if (!resolved.ok || !tenantId) {
    const error = await storeOrganizationError(resolved.ok ? 'organization-required' : resolved.reason)
    return { response: NextResponse.json(error.body, { status: error.status }) }
  }
  const organizationId = resolved.organizationId
  const em = (container.resolve('em') as EntityManager).fork()
  const site = await em.findOne(StorefrontSite, { tenantId, organizationId, deletedAt: null })
  if (!site) {
    return {
      response: NextResponse.json({ error: translate('storefront.errors.notFound', 'Storefront not found.') }, { status: 404 }),
    }
  }
  return { auth, container, em, site, tenantId, organizationId, translate }
}

/** Command context pinned to the resolved organization (what the command bus and audit log record). */
export function buildStaffCommandContext(context: StaffSiteContext, req: Request): CommandRuntimeContext {
  const { container, auth, organizationId, tenantId } = context
  return {
    container,
    auth,
    organizationScope: { selectedId: organizationId, filterIds: [organizationId], allowedIds: null, tenantId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: req,
  }
}
