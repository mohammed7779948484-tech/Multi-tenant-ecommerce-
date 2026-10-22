import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  isExplicitlyEmptyOrganizationScope,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'

export type StorefrontCommandScope = { tenantId: string; organizationId: string }

type StoreScopeContext = Pick<CommandRuntimeContext, 'auth' | 'selectedOrganizationId' | 'organizationScope' | 'request'>

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The one organization (store) a storefront request acts on — never the payload.
 *
 * 1. The organization picked in the switcher.
 * 2. For an "all organizations" selection, the caller's home organization, but only
 *    while the effective tenant is still the caller's own and the home organization
 *    is inside the caller's allowed set. The CRUD factory overwrites `auth.orgId`
 *    with the (empty) selection, so the home organization is re-read from the
 *    request's session — the same rule the brand route applies through
 *    `resolveSingleOrganizationIdOrDeny`.
 *
 * Returns null when neither applies (the caller must pick an organization).
 */
export async function resolveStoreOrganizationId(ctx: StoreScopeContext): Promise<string | null> {
  const scope = ctx.organizationScope ?? null
  const selected = normalizeId(ctx.selectedOrganizationId) ?? normalizeId(scope?.selectedId)
  if (selected) return selected
  if (isExplicitlyEmptyOrganizationScope(scope)) return null
  const effectiveTenantId = normalizeId(ctx.auth?.tenantId)
  const sessionAuth = ctx.request ? await getAuthFromRequest(ctx.request) : null
  const actor = sessionAuth ?? ctx.auth
  if (!actor || !effectiveTenantId) return null
  // A super-admin switched into another tenant keeps a home organization from the
  // original tenant; pairing it with the effective tenant would cross tenants.
  if (normalizeId(actor.tenantId) !== effectiveTenantId) return null
  const home = resolveActiveOrganizationId(actor as Parameters<typeof resolveActiveOrganizationId>[0])
  if (!home) return null
  const allowed = Array.isArray(scope?.allowedIds) ? scope.allowedIds : null
  if (allowed && !allowed.includes(home)) return null
  return home
}

/** Trusted scope of a storefront command: the session's tenant and the store's organization, never the payload. */
export async function ensureCommandScope(ctx: CommandRuntimeContext): Promise<StorefrontCommandScope> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = await resolveStoreOrganizationId(ctx)
  if (tenantId && organizationId) return { tenantId, organizationId }
  const { translate } = await resolveTranslations()
  throw badRequest(translate('storefront.errors.organizationRequired', 'Select a single organization to manage its storefront.'))
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
