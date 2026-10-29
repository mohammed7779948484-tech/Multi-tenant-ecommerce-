/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals'
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { CartView } from '../../../lib/shopCart'

type Call = { ok: boolean; status: number; result: unknown }
const pending: Array<{ url: string; method: string; resolve: (call: Call) => void; reject: (err: unknown) => void }> = []

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init: { method?: string } = {}) =>
    new Promise<Call>((resolve, reject) => {
      pending.push({ url, method: init.method ?? 'GET', resolve, reject })
    }),
}))

import { isNewerCart, ShopCartError, ShopCartProvider, StoreCartSheet, useShopCart } from '../ShopCart'

const cart = (count: number, updatedAt: string | null = null): CartView => ({ lines: [], subtotal: null, currencyCode: 'YER', count, updatedAt })

const errors: unknown[] = []

function Probe() {
  const { cart: current, failed, add, reload, setOpen } = useShopCart()
  return (
    <div>
      <span data-testid="count">{current.count}</span>
      <span data-testid="failed">{String(failed)}</span>
      <button type="button" onClick={() => void add({ productId: 'p1', quantity: 2 }).catch((err: unknown) => errors.push(err))}>
        add
      </button>
      <button type="button" onClick={() => void reload()}>
        reload
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
    </div>
  )
}

function renderCart(children: React.ReactNode) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <ShopCartProvider siteSlug="dates">{children}</ShopCartProvider>
    </I18nProvider>,
  )
}

describe('the client cart shows the newest answer', () => {
  it('ignores a slow first read that answers after an add', async () => {
    pending.length = 0
    renderCart(<Probe />)
    await waitFor(() => expect(pending).toHaveLength(1))
    const firstRead = pending[0]!
    act(() => screen.getByText('add').click())
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[1]!.resolve({ ok: true, status: 200, result: cart(2) }))
    expect(screen.getByTestId('count').textContent).toBe('2')
    // The read started before the add: its empty cart is stale.
    await act(async () => firstRead.resolve({ ok: true, status: 200, result: cart(0) }))
    expect(screen.getByTestId('count').textContent).toBe('2')
  })

  it('a failed read that answers after a successful add does not mark the cart failed', async () => {
    pending.length = 0
    renderCart(<Probe />)
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => screen.getByText('add').click())
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[1]!.resolve({ ok: true, status: 200, result: cart(2) }))
    await act(async () => pending[0]!.resolve({ ok: false, status: 500, result: { error: 'boom' } }))
    expect(screen.getByTestId('failed').textContent).toBe('false')
  })
})

describe('a read sent while a write is pending never hides that write', () => {
  it('keeps the add when a read served before the add committed answers first', async () => {
    pending.length = 0
    renderCart(<Probe />)
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0]!.resolve({ ok: true, status: 200, result: cart(1, '2026-10-29T10:00:00.000Z') }))
    act(() => screen.getByText('add').click())
    await waitFor(() => expect(pending).toHaveLength(2))
    // The sheet opens and reads the cart while the add is still running.
    act(() => screen.getByText('reload').click())
    await waitFor(() => expect(pending).toHaveLength(3))
    // The server answered the read before the add committed: the old cart.
    await act(async () => pending[2]!.resolve({ ok: true, status: 200, result: cart(1, '2026-10-29T10:00:00.000Z') }))
    await act(async () => pending[1]!.resolve({ ok: true, status: 200, result: cart(3, '2026-10-29T10:00:05.000Z') }))
    expect(screen.getByTestId('count').textContent).toBe('3')
  })

  it('orders answers by the cart version, then by request', () => {
    const v1 = '2026-10-29T10:00:00.000Z'
    const v2 = '2026-10-29T10:00:05.000Z'
    expect(isNewerCart({ version: v1, sequence: 9, readDuringWrite: false }, { version: v2, sequence: 2 })).toBe(false)
    expect(isNewerCart({ version: v2, sequence: 1, readDuringWrite: true }, { version: v1, sequence: 2 })).toBe(true)
    expect(isNewerCart({ version: v1, sequence: 3, readDuringWrite: true }, { version: v1, sequence: 2 })).toBe(false)
    expect(isNewerCart({ version: v1, sequence: 3, readDuringWrite: false }, { version: v1, sequence: 2 })).toBe(true)
    // A cart that became an order reads as no cart: the later request wins.
    expect(isNewerCart({ version: null, sequence: 3, readDuringWrite: false }, { version: v1, sequence: 2 })).toBe(true)
  })
})

describe('a network failure is a refusal like any other', () => {
  it('rejects an add with a translated ShopCartError, so the product page can say so', async () => {
    pending.length = 0
    errors.length = 0
    renderCart(<Probe />)
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => screen.getByText('add').click())
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[1]!.reject(new TypeError('Failed to fetch')))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(ShopCartError)
    expect((errors[0] as ShopCartError).code).toBe('network')
    expect((errors[0] as ShopCartError).message).toBe('Could not reach the store. Check your connection and try again.')
  })
})

describe('the cart sheet never shows a failed read as an empty cart', () => {
  it('shows the failure and a retry that reads again', async () => {
    pending.length = 0
    renderCart(
      <>
        <Probe />
        <StoreCartSheet cartHref="/dates/cart" shopHref="/dates" />
      </>,
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0]!.resolve({ ok: false, status: 500, result: { error: 'boom' } }))
    act(() => screen.getByText('open').click())
    expect(await screen.findByText('Your cart could not be loaded.')).toBeTruthy()
    expect(screen.queryByText('Your bag is empty.')).toBeNull()
    act(() => screen.getByRole('button', { name: 'Try again' }).click())
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[1]!.resolve({ ok: true, status: 200, result: cart(0) }))
    expect(screen.queryByText('Your cart could not be loaded.')).toBeNull()
  })
})
