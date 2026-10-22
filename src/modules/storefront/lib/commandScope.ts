import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

export type StorefrontCommandScope = { tenantId: string; organizationId: string }

/** The organization scope the framework resolved for a request (selector cookie, user ACL). */
export type StoreScopeSelection = {
  selectedId?: string | null
  filterIds?: readonly string[] | null
  allowedIds?: readonly string[] | null
  selectionRejected?: boolean
} | null | undefined

/** The signed-in session as read from the request (super-admin overrides keep the actor's own ids). */
export type StoreScopeSession = {
  tenantId?: string | null
  orgId?: string | null
  actorTenantId?: unknown
  actorOrgId?: unknown
} | null | undefined

export type StoreOrganizationResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: 'selection-rejected' | 'no-access' | 'organization-required' }

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The one organization (store) a storefront request acts on — never the payload.
 * Every storefront route and command goes through this rule:
 *
 * 1. A selection the framework could not honour fails (`selection-rejected`).
 * 2. An explicitly empty scope (the caller sees no organization) fails (`no-access`).
 * 3. The organization picked in the switcher wins (the framework already checked it
 *    against the caller's allowed set).
 * 4. With "all organizations", the caller's home organization — only when it belongs
 *    to the effective tenant (a super-admin switched into another tenant keeps a home
 *    organization from their own tenant) and is inside the caller's allowed set.
 *
 * Otherwise the caller must pick an organization (`organization-required`).
 */
export function resolveStoreOrganization(input: {
  scope: StoreScopeSelection
  session: StoreScopeSession
  effectiveTenantId: string | null
}): StoreOrganizationResult {
  const { scope, session } = input
  if (scope?.selectionRejected) return { ok: false, reason: 'selection-rejected' }
  const allowed = Array.isArray(scope?.allowedIds) ? scope.allowedIds : null
  const filter = Array.isArray(scope?.filterIds) ? scope.filterIds : null
  if ((allowed && allowed.length === 0) || (filter && filter.length === 0)) return { ok: false, reason: 'no-access' }

  const selected = normalizeId(scope?.selectedId)
  if (selected) return { ok: true, organizationId: selected }

  const effectiveTenantId = normalizeId(input.effectiveTenantId)
  const home = normalizeId(session?.orgId) ?? normalizeId(session?.actorOrgId)
  const homeTenant = normalizeId(session?.actorTenantId) ?? normalizeId(session?.tenantId)
  if (!home || !effectiveTenantId || homeTenant !== effectiveTenantId) return { ok: false, reason: 'organization-required' }
  if (allowed && !allowed.includes(home)) return { ok: false, reason: 'organization-required' }
  if (filter && !filter.includes(home)) return { ok: false, reason: 'organization-required' }
  return { ok: true, organizationId: home }
}

type StoreScopeContext = Pick<CommandRuntimeContext, 'auth' | 'organizationScope' | 'selectedOrganizationId' | 'request'>

/**
 * `resolveStoreOrganization` for a CRUD-factory or command context. The factory
 * replaces `auth.orgId` with the (possibly empty) selection, so the session is
 * read again from the request.
 */
export async function resolveStoreOrganizationForContext(ctx: StoreScopeContext): Promise<StoreOrganizationResult> {
  const session = (ctx.request ? await getAuthFromRequest(ctx.request) : null) ?? ctx.auth
  const scope = (ctx.organizationScope ?? null) as StoreScopeSelection
  return resolveStoreOrganization({
    scope: { ...(scope ?? {}), selectedId: scope?.selectedId ?? ctx.selectedOrganizationId ?? null },
    session: session as StoreScopeSession,
    effectiveTenantId: ctx.auth?.tenantId ?? null,
  })
}

/** The HTTP error for a failed resolution: 422 for a rejected selection, 403 for no access, else 400. */
export async function storeOrganizationError(reason: Extract<StoreOrganizationResult, { ok: false }>['reason']): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  if (reason === 'no-access') return forbidden(translate('storefront.errors.noOrganizationAccess', 'You do not have access to any organization.'))
  if (reason === 'selection-rejected') {
    return new CrudHttpError(422, {
      error: translate('storefront.errors.organizationSelectionInvalid', 'The selected organization is not available. Choose another one.'),
    })
  }
  return badRequest(translate('storefront.errors.organizationRequired', 'Select a single organization to manage its storefront.'))
}

/** Trusted scope of a storefront command: the session's tenant and the store's organization, never the payload. */
export async function ensureCommandScope(ctx: CommandRuntimeContext): Promise<StorefrontCommandScope> {
  const tenantId = ctx.auth?.tenantId ?? null
  const resolved = await resolveStoreOrganizationForContext(ctx)
  if (!resolved.ok) throw await storeOrganizationError(resolved.reason)
  if (!tenantId) throw await storeOrganizationError('organization-required')
  return { tenantId, organizationId: resolved.organizationId }
}

/** 404 with a translated message; cross-tenant ids end here too, so existence never leaks. */
export async function storefrontNotFound(key = 'storefront.errors.notFound', fallback = 'Storefront not found.'): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return notFound(translate(key, fallback))
}

/** 422 with one translated message, optionally keyed to a form field. */
export async function unprocessable(key: string, fallback: string, field?: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  const message = translate(key, fallback)
  return new CrudHttpError(422, field ? { error: message, fieldErrors: { [field]: message } } : { error: message })
}

/** 409 with one translated message (undo refused because the world moved on). */
export async function conflictError(key: string, fallback: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(409, { error: translate(key, fallback) })
}

/**
 * Strict input parsing for storefront commands: a schema failure becomes 422
 * with translated `fieldErrors` keyed by path (unknown keys such as `tenantId`
 * or `publishedSpec` included) instead of the CRUD factory's generic 400.
 */
export async function parseCommandInput<T>(schema: import('zod').ZodType<T>, raw: unknown): Promise<T> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  const { translate } = await resolveTranslations()
  const { zodIssuesToFieldErrors } = await import('./fieldErrors')
  throw new CrudHttpError(422, {
    error: translate('storefront.errors.validation', 'Fix the highlighted fields and save again.'),
    fieldErrors: zodIssuesToFieldErrors(parsed.error.issues, translate),
  })
}
