/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals'
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { CartView } from '../../../lib/shopCart'

type Call = { ok: boolean; status: number; result: unknown }
const pending: Array<{ url: string; method: string; resolve: (call: Call) => void }> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init: { method?: string } = {}) =>
    new Promise<Call>((resolve) => {
      pending.push({ url, method: init.method ?? 'GET', resolve })
    }),
}))

import { ShopCartProvider, StoreCartSheet, useShopCart } from '../ShopCart'

const cart = (count: number): CartView => ({ lines: [], subtotal: null, currencyCode: 'YER', count, updatedAt: null })

function Probe() {
  const { cart: current, failed, add, setOpen } = useShopCart()
  return (
    <div>
      <span data-testid="count">{current.count}</span>
      <span data-testid="failed">{String(failed)}</span>
      <button type="button" onClick={() => void add({ productId: 'p1', quantity: 2 }).catch(() => undefined)}>
        add
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
