import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { StorefrontCart, StorefrontOrderAccess } from '../../data/entities'

/**
 * Placement recovery (review round 4): a `sales.orders.create` that fails after
 * its own commit, or an access write that fails after the order exists, must
 * still answer with that one order, never leave the buyer to place a second.
 * The database and the command bus are in-memory fakes.
 */

type Row = Record<string, unknown>
const db: { carts: Row[]; access: Row[]; orders: Row[]; failNextFlush: boolean } = { carts: [], access: [], orders: [], failNextFlush: false }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: Row) => {
    if (entity !== SalesOrder) return null
    return db.orders.find((order) => (where.id ? order.id === where.id : order.externalReference === where.externalReference)) ?? null
  },
  findWithDecryption: async () => [],
}))
jest.mock('@open-mercato/core/modules/sales/lib/statusHelpers', () => ({ resolveStatusEntryIdByValue: async () => 'status-pending-approval' }))
jest.mock('../../commands/cart', () => ({ buildShopCommandContext: () => ({}) }))
jest.mock('../shopCheckout', () => {
  const actual = jest.requireActual<typeof import('../shopCheckout')>('../shopCheckout')
  return {
    ...actual,
    priceCart: async () => ({
      quote: { quoteHash: 'q1', blocked: false, lines: [], currencyCode: 'YER', grandTotal: { amount: 10, formatted: '10' } },
      shipping: { id: 'ship' },
      payment: { id: 'pay' },
      snapshots: { shippingMethodSnapshot: {}, paymentMethodSnapshot: {} },
    }),
  }
})

import { findGovernorate } from '../yemen'
import { placeOrder } from '../shopOrders'

function fakeEm() {
  let pending: Row[] = []
  // Loaded carts are copies: like a real transaction, a change only lands when its flush succeeds.
  let loaded: Array<{ row: Row; copy: Row }> = []
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => typeof value === 'object' && value !== null ? true : row[key] === value)
  const em: Record<string, unknown> = {
    fork: () => em,
    begin: async () => undefined,
    rollback: async () => undefined,
    // The placement lock is free (`pg_try_advisory_xact_lock` answers true).
    execute: async () => [{ locked: true }],
    transactional: async (work: (tem: unknown) => Promise<unknown>) => {
      try {
        return await work(em)
      } finally {
        pending = []
        loaded = []
      }
    },
    findOne: async (entity: unknown, where: Row) => {
      if (entity === StorefrontCart) {
        const row = db.carts.find((cart) => matches(cart, where))
        if (!row) return null
        const copy = { ...row }
        loaded.push({ row, copy })
        return copy
      }
      if (entity === StorefrontOrderAccess) return db.access.find((row) => row.cartId === where.cartId) ?? null
      return null
    },
    findOneOrFail: async (entity: unknown, where: Row) => {
      const row = await (em.findOne as (entity: unknown, where: Row) => Promise<Row | null>)(entity, where)
      if (!row) throw new Error('not found')
      return row
    },
    create: (_entity: unknown, data: Row) => {
      const row = { ...data }
      pending.push(row)
      return row
    },
    flush: async () => {
      if (db.failNextFlush) {
        db.failNextFlush = false
        pending = []
        loaded = []
        throw new Error('access write failed')
      }
      db.access.push(...pending)
      for (const { row, copy } of loaded) Object.assign(row, copy)
      pending = []
    },
    nativeUpdate: async (_entity: unknown, where: Row, data: Row) => {
      const cart = db.carts.find((row) => matches(row, where))
      if (cart) Object.assign(cart, data)
      return cart ? 1 : 0
    },
  }
  return em
}

const site = { id: 'site-1', slug: 'dates', tenantId: 'tenant-1', organizationId: 'org-1' }
const cartToken = 'a'.repeat(43)
const governorate = findGovernorate('YE24')!
const input = {
  contact: { name: 'سالم', phone: '+967771234567' },
  destination: { governorate: governorate.code, district: governorate.districts[0]!.code, area: 'الشارع' },
  shippingMethodId: 'ship',
  paymentMethodId: 'pay',
  quoteHash: 'q1',
}

function deps(create: (input: Row) => Promise<{ orderId: string }>) {
  return {
    em: fakeEm() as never,
    container: { resolve: () => ({ execute: async (_id: string, { input: order }: { input: Row }) => ({ result: await create(order) }) }) } as never,
  }
}

function commitOrder(order: Row) {
  const row = { id: `order-${db.orders.length + 1}`, orderNumber: `ORDER-${db.orders.length + 1}`, externalReference: order.externalReference, grandTotalGrossAmount: 10 }
  db.orders.push(row)
  return row
}

beforeEach(() => {
  db.carts = [{ ...site, id: 'cart-1', tokenHash: createHash('sha256').update(cartToken).digest('hex'), siteId: site.id, status: 'active', convertedOrderId: null, expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date() }]
  db.access = []
  db.orders = []
  db.failNextFlush = false
})

describe('order placement recovers the order it created', () => {
  it('answers with the order when the sales command fails after its own commit', async () => {
    const result = await placeOrder(
      deps(async (order) => {
        commitOrder(order)
        throw new Error('post-commit side effect failed')
      }),
      site,
      cartToken,
      input,
    )
    expect(result).toMatchObject({ orderId: 'order-1', orderNumber: 'ORDER-1', replay: false })
    expect(db.orders).toHaveLength(1)
    expect(db.access).toHaveLength(1)
    expect(db.carts[0]).toMatchObject({ status: 'converted', convertedOrderId: 'order-1' })
  })

  it('answers with the order when its access write fails once, and a retry replays it', async () => {
    const create = async (order: Row) => {
      const row = commitOrder(order)
      db.failNextFlush = true
      return { orderId: row.id as string }
    }
    const first = await placeOrder(deps(create), site, cartToken, input)
    expect(first).toMatchObject({ orderId: 'order-1', replay: false })
    const again = await placeOrder(deps(create), site, cartToken, input)
    expect(again).toMatchObject({ orderId: 'order-1', replay: true })
    expect(db.orders).toHaveLength(1)
    expect(db.access).toHaveLength(1)
  })

  it('gives the cart back when no order was created', async () => {
    await expect(
      placeOrder(
        deps(async () => {
          throw new Error('validation failed')
        }),
        site,
        cartToken,
        input,
      ),
    ).rejects.toThrow('validation failed')
    expect(db.orders).toHaveLength(0)
    expect(db.carts[0]).toMatchObject({ status: 'active', convertedOrderId: null })
  })

  it('finishes an order left behind by an earlier submit instead of placing a second one', async () => {
    commitOrder({ externalReference: 'storefront-cart:cart-1' })
    Object.assign(db.carts[0]!, { status: 'placing' })
    const create = jest.fn(async (order: Row) => ({ orderId: commitOrder(order).id as string }))
    const result = await placeOrder(deps(create), site, cartToken, input)
    expect(result).toMatchObject({ orderId: 'order-1', replay: true })
    expect(create).not.toHaveBeenCalled()
    expect(db.orders).toHaveLength(1)
  })
})
