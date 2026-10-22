import { describe, expect, it } from '@jest/globals'
import { SalesPaymentMethod } from '@open-mercato/core/modules/sales/data/entities'
import { enforcePaymentPolicy, isAllowedPaymentProvider } from '../policy'

type Method = { id: string; code: string; providerKey: string | null; isActive: boolean; metadata: Record<string, unknown> | null; updatedAt?: Date }

type FakeEm = {
  fork: () => FakeEm
  transactional: <T>(fn: (tem: FakeEm) => Promise<T>) => Promise<T>
  find: (entity: unknown, where: Record<string, unknown>) => Promise<Method[]>
}

function fakeEm(methods: Method[]): FakeEm {
  const em: FakeEm = {
    fork: () => em,
    async transactional(fn) {
      return fn(em)
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      expect(entity).toBe(SalesPaymentMethod)
      expect(where).toEqual({ tenantId: 't1', organizationId: 'o1', deletedAt: null })
      return methods
    },
  }
  return em
}

describe('payment policy', () => {
  it('allows only manual providers', () => {
    expect(isAllowedPaymentProvider('cash-on-delivery')).toBe(true)
    expect(isAllowedPaymentProvider('wire-transfer')).toBe(true)
    expect(isAllowedPaymentProvider(null)).toBe(true)
    expect(isAllowedPaymentProvider('stripe')).toBe(false)
    expect(isAllowedPaymentProvider(' Stripe ')).toBe(false)
    expect(isAllowedPaymentProvider('tpay')).toBe(false)
  })

  it('deactivates gateway methods, drops their provider settings and is idempotent', async () => {
    const methods: Method[] = [
      { id: '1', code: 'card', providerKey: 'stripe', isActive: true, metadata: { providerSettings: { secretKey: 'sk_test_example' }, note: 'kept' } },
      { id: '2', code: 'bank-transfer', providerKey: 'wire-transfer', isActive: true, metadata: null },
      { id: '3', code: 'cod', providerKey: 'cash-on-delivery', isActive: true, metadata: null },
    ]
    const em = fakeEm(methods)
    const first = await enforcePaymentPolicy(em as never, { tenantId: 't1', organizationId: 'o1' })
    expect(first.deactivated).toEqual([{ id: '1', code: 'card', providerKey: 'stripe' }])
    expect(methods[0]).toMatchObject({ isActive: false, metadata: { note: 'kept', paymentPolicy: { reason: 'no-external-gateway' } } })
    expect(methods[0]!.metadata).not.toHaveProperty('providerSettings')
    expect(methods[1]!.isActive && methods[2]!.isActive).toBe(true)

    const second = await enforcePaymentPolicy(em as never, { tenantId: 't1', organizationId: 'o1' })
    expect(second.deactivated).toEqual([])
  })

  it('strips example keys from a gateway method that was already deactivated by hand', async () => {
    const methods: Method[] = [
      { id: '1', code: 'card', providerKey: 'stripe', isActive: false, metadata: { providerSettings: { publishableKey: 'pk_test_example' } } },
    ]
    const result = await enforcePaymentPolicy(fakeEm(methods) as never, { tenantId: 't1', organizationId: 'o1' })
    expect(result.deactivated).toHaveLength(1)
    expect(methods[0]!.metadata).not.toHaveProperty('providerSettings')
  })
})
