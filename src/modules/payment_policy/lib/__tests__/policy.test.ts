import { describe, expect, it } from '@jest/globals'
import { SalesPaymentMethod } from '@open-mercato/core/modules/sales/data/entities'
import { PAYMENT_METHOD_UPDATE_COMMAND, enforcePaymentPolicy, isAllowedPaymentProvider } from '../policy'

type Method = { id: string; code: string; providerKey: string | null; isActive: boolean; metadata: Record<string, unknown> | null }
type Execution = { commandId: string; input: Record<string, unknown>; ctx: Record<string, unknown> }

/** A read-only entity manager: the policy may read methods but must never write them itself. */
function readOnlyEm(methods: Method[]) {
  const em = {
    fork: () => em,
    async find(entity: unknown, where: Record<string, unknown>) {
      expect(entity).toBe(SalesPaymentMethod)
      expect(where).toEqual({ tenantId: 't1', organizationId: 'o1', deletedAt: null })
      // Copies: a direct mutation by the policy would not reach the "database".
      return methods.map((method) => ({ ...method, metadata: method.metadata ? { ...method.metadata } : null }))
    },
  }
  return em
}

/**
 * A command bus that applies `sales.payment-methods.update` the way the installed
 * command does: `metadata` replaces the stored metadata, and the stored
 * `providerSettings` survive unless `providerSettings` is given (an empty object drops them).
 */
function fakeContainer(methods: Method[], executions: Execution[]) {
  const commandBus = {
    async execute(commandId: string, { input, ctx }: { input: Record<string, unknown>; ctx: Record<string, unknown> }) {
      executions.push({ commandId, input, ctx })
      const method = methods.find((candidate) => candidate.id === input.id)!
      const stored = method.metadata?.providerSettings
      const settings = input.providerSettings !== undefined ? (input.providerSettings as Record<string, unknown>) : stored
      const base = { ...((input.metadata as Record<string, unknown>) ?? method.metadata ?? {}) }
      delete base.providerSettings
      method.metadata = settings && Object.keys(settings).length ? { ...base, providerSettings: settings } : base
      if (input.isActive !== undefined) method.isActive = input.isActive as boolean
      return { result: { paymentMethodId: method.id } }
    },
  }
  return { resolve: (name: string) => (name === 'commandBus' ? commandBus : undefined) }
}

const scope = { tenantId: 't1', organizationId: 'o1' }

describe('payment policy', () => {
  it('allows only manual providers', () => {
    expect(isAllowedPaymentProvider('cash-on-delivery')).toBe(true)
    expect(isAllowedPaymentProvider('wire-transfer')).toBe(true)
    expect(isAllowedPaymentProvider(null)).toBe(true)
    expect(isAllowedPaymentProvider('stripe')).toBe(false)
    expect(isAllowedPaymentProvider(' Stripe ')).toBe(false)
    expect(isAllowedPaymentProvider('tpay')).toBe(false)
  })

  it('deactivates gateway methods through the sales command (audit, undo, events) and is idempotent', async () => {
    const methods: Method[] = [
      { id: '1', code: 'card', providerKey: 'stripe', isActive: true, metadata: { providerSettings: { secretKey: 'sk_test_example' }, note: 'kept' } },
      { id: '2', code: 'bank-transfer', providerKey: 'wire-transfer', isActive: true, metadata: null },
      { id: '3', code: 'cod', providerKey: 'cash-on-delivery', isActive: true, metadata: null },
    ]
    const executions: Execution[] = []
    const deps = { em: readOnlyEm(methods), container: fakeContainer(methods, executions) }

    const first = await enforcePaymentPolicy(deps as never, scope)
    expect(first.deactivated).toEqual([{ id: '1', code: 'card', providerKey: 'stripe' }])
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({
      commandId: PAYMENT_METHOD_UPDATE_COMMAND,
      input: { id: '1', tenantId: 't1', organizationId: 'o1', isActive: false, providerSettings: {} },
      ctx: { auth: null, systemActor: true, selectedOrganizationId: 'o1', organizationIds: ['o1'] },
    })
    expect(executions[0]!.input.metadata).toMatchObject({ note: 'kept', paymentPolicy: { reason: 'no-external-gateway' } })
    expect(methods[0]).toMatchObject({ isActive: false, metadata: { note: 'kept' } })
    expect(methods[0]!.metadata).not.toHaveProperty('providerSettings')
    expect(methods[1]!.isActive && methods[2]!.isActive).toBe(true)

    const second = await enforcePaymentPolicy(deps as never, scope)
    expect(second.deactivated).toEqual([])
    expect(executions).toHaveLength(1)
  })

  it('strips example keys from a gateway method that was already deactivated by hand', async () => {
    const methods: Method[] = [
      { id: '1', code: 'card', providerKey: 'stripe', isActive: false, metadata: { providerSettings: { publishableKey: 'pk_test_example' } } },
    ]
    const executions: Execution[] = []
    const result = await enforcePaymentPolicy({ em: readOnlyEm(methods), container: fakeContainer(methods, executions) } as never, scope)
    expect(result.deactivated).toHaveLength(1)
    expect(methods[0]!.metadata).not.toHaveProperty('providerSettings')
  })
})
