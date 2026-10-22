import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesPaymentMethod } from '@open-mercato/core/modules/sales/data/entities'

/**
 * Provider keys that need no external gateway. Methods without a provider key
 * are manual too. Everything else (the seeded `stripe` card method, or any
 * gateway a future package adds) is deactivated.
 */
export const ALLOWED_PAYMENT_PROVIDER_KEYS: ReadonlySet<string> = new Set(['cash-on-delivery', 'wire-transfer'])

export function isAllowedPaymentProvider(providerKey: string | null | undefined): boolean {
  const key = typeof providerKey === 'string' ? providerKey.trim().toLowerCase() : ''
  return key.length === 0 || ALLOWED_PAYMENT_PROVIDER_KEYS.has(key)
}

export type PaymentPolicyScope = { tenantId: string; organizationId: string }

export type PaymentPolicyResult = { deactivated: Array<{ id: string; code: string; providerKey: string | null }> }

/**
 * Deactivates every gateway payment method of one organization and drops its
 * provider settings (the seed ships example keys). The row is kept on
 * purpose: `sales` re-seeds a method only when its code is missing, so a
 * deactivated row stays deactivated across re-runs. Idempotent.
 */
export async function enforcePaymentPolicy(baseEm: EntityManager, scope: PaymentPolicyScope): Promise<PaymentPolicyResult> {
  const em = baseEm.fork()
  const deactivated: PaymentPolicyResult['deactivated'] = []
  await em.transactional(async (tem) => {
    const methods = await tem.find(SalesPaymentMethod, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const now = new Date()
    for (const method of methods) {
      if (isAllowedPaymentProvider(method.providerKey)) continue
      const current = (method.metadata ?? {}) as Record<string, unknown>
      // Already compliant: inactive and carrying no provider settings.
      if (!method.isActive && !('providerSettings' in current)) continue
      const { providerSettings: _dropped, ...metadata } = current
      method.isActive = false
      method.metadata = {
        ...metadata,
        paymentPolicy: { deactivatedAt: now.toISOString(), reason: 'no-external-gateway' },
      }
      method.updatedAt = now
      deactivated.push({ id: method.id, code: method.code, providerKey: method.providerKey ?? null })
    }
  })
  return { deactivated }
}
