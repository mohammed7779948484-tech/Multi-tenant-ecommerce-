import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { SalesPaymentMethod } from '@open-mercato/core/modules/sales/data/entities'

/**
 * Provider keys that need no external gateway. Methods without a provider key
 * are manual too. Everything else (the seeded `stripe` card method, or any
 * gateway a future package adds) is deactivated.
 */
export const ALLOWED_PAYMENT_PROVIDER_KEYS: ReadonlySet<string> = new Set(['cash-on-delivery', 'wire-transfer'])

/** The installed `sales` command that owns payment-method writes (audit log, undo, events). */
export const PAYMENT_METHOD_UPDATE_COMMAND = 'sales.payment-methods.update'

export function isAllowedPaymentProvider(providerKey: string | null | undefined): boolean {
  const key = typeof providerKey === 'string' ? providerKey.trim().toLowerCase() : ''
  return key.length === 0 || ALLOWED_PAYMENT_PROVIDER_KEYS.has(key)
}

export type PaymentPolicyScope = { tenantId: string; organizationId: string }

export type PaymentPolicyResult = { deactivated: Array<{ id: string; code: string; providerKey: string | null }> }

/** Trusted server-side context (tenant setup, operator CLI): no end-user actor, pinned to one organization. */
export function buildPolicyCommandContext(container: AwilixContainer, scope: PaymentPolicyScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: { selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: null, tenantId: scope.tenantId },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

/**
 * Deactivates every gateway payment method of one organization and drops its
 * provider settings (the seed ships example keys). The row is kept on
 * purpose: `sales` re-seeds a method only when its code is missing, so a
 * deactivated row stays deactivated across re-runs. Idempotent.
 *
 * Writes go through the `sales.payment-methods.update` command, so each change
 * is audited, undoable and emits the same events as an edit in the admin.
 * `providerSettings: {}` is passed explicitly: the command keeps the stored
 * settings when the field is omitted.
 */
export async function enforcePaymentPolicy(
  deps: { em: EntityManager; container: AwilixContainer },
  scope: PaymentPolicyScope,
): Promise<PaymentPolicyResult> {
  const methods = await deps.em.fork().find(SalesPaymentMethod, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const commandBus = deps.container.resolve('commandBus') as CommandBus
  const ctx = buildPolicyCommandContext(deps.container, scope)
  const deactivated: PaymentPolicyResult['deactivated'] = []
  const now = new Date().toISOString()
  for (const method of methods) {
    if (isAllowedPaymentProvider(method.providerKey)) continue
    const current = (method.metadata ?? {}) as Record<string, unknown>
    // Already compliant: inactive and carrying no provider settings.
    if (!method.isActive && !('providerSettings' in current)) continue
    const { providerSettings: _dropped, ...metadata } = current
    await commandBus.execute(PAYMENT_METHOD_UPDATE_COMMAND, {
      input: {
        id: method.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isActive: false,
        metadata: { ...metadata, paymentPolicy: { deactivatedAt: now, reason: 'no-external-gateway' } },
        providerSettings: {},
      },
      ctx,
    })
    deactivated.push({ id: method.id, code: method.code, providerKey: method.providerKey ?? null })
  }
  return { deactivated }
}
