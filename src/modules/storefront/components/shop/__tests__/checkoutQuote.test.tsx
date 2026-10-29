/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals'
import * as React from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { CheckoutQuote, CheckoutShippingOption } from '../../../lib/shopCheckout'

type Call = { ok: boolean; status: number; result: unknown }
const pending: Array<{ body: string; resolve: (call: Call) => void }> = []

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (_url: string, init: { body?: string } = {}) =>
    new Promise<Call>((resolve) => {
      pending.push({ body: init.body ?? '', resolve })
    }),
}))

import { useCheckoutQuote, type QuoteSelection } from '../checkoutClient'
import { CheckoutDeliveryOptions } from '../CheckoutParts'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider locale="en" dict={{}}>
    {children}
  </I18nProvider>
)

const destination = { governorate: 'YE24', district: 'YE2401', area: 'الشارع' }
const selection = (shippingMethodId: string): QuoteSelection => ({ destination, shippingMethodId, paymentMethodId: 'cod' })
const quoteFor = (total: number) => ({ grandTotal: { amount: total, formatted: String(total) }, quoteHash: `q${total}` }) as unknown as CheckoutQuote

describe('the checkout shows the quote of the current choice only', () => {
  it('ignores a slow answer for an earlier delivery choice', async () => {
    pending.length = 0
    const { result, rerender } = renderHook(({ choice }: { choice: QuoteSelection }) => useCheckoutQuote('/api/storefront/shop/s', choice), {
      wrapper,
      initialProps: { choice: selection('standard') },
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender({ choice: selection('express') })
    await waitFor(() => expect(pending).toHaveLength(2))
    // Express answers first, then the slow standard answer arrives.
    await act(async () => pending[1]!.resolve({ ok: true, status: 200, result: quoteFor(2000) }))
    await act(async () => pending[0]!.resolve({ ok: true, status: 200, result: quoteFor(1500) }))
    expect(result.current.quote?.grandTotal.amount).toBe(2000)
    expect(result.current.loading).toBe(false)
  })

  it('shows no totals for a choice that has no answer yet, and keeps loading until it has', async () => {
    pending.length = 0
    const { result, rerender } = renderHook(({ choice }: { choice: QuoteSelection }) => useCheckoutQuote('/api/storefront/shop/s', choice), {
      wrapper,
      initialProps: { choice: selection('standard') },
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0]!.resolve({ ok: true, status: 200, result: quoteFor(1500) }))
    expect(result.current.quote?.grandTotal.amount).toBe(1500)
    rerender({ choice: selection('express') })
    expect(result.current.quote).toBeNull()
    await waitFor(() => expect(result.current.loading).toBe(true))
    // The newer request fails: an error, never the earlier choice's totals.
    await act(async () => pending[1]!.resolve({ ok: false, status: 500, result: { error: 'boom' } }))
    expect(result.current.quote).toBeNull()
    expect(result.current.error).toBe('boom')
  })
})

describe('delivery dates are written in the store language', () => {
  it('formats arrival dates in Arabic whatever the browser language', async () => {
    const methods: CheckoutShippingOption[] = [
      { id: 'standard', name: 'توصيل عادي', description: null, transitDays: 2, amount: 1500, formatted: '١٬٥٠٠ ر.ي.', currencyCode: 'YER' },
    ]
    render(
      <I18nProvider locale="en" dict={{}}>
        <CheckoutDeliveryOptions methods={methods} value="standard" onValueChange={() => undefined} loading={false} legend="التوصيل" />
      </I18nProvider>,
    )
    // The arrival date is the block's `text-foreground` figure (the price is formatted by the server).
    const arrives = await waitFor(() => {
      const node = document.querySelector('[data-slot="delivery-option"] .text-foreground.tabular-nums')
      if (!node?.textContent) throw new Error('no arrival date yet')
      return node
    })
    expect(arrives.textContent).toMatch(/\p{Script=Arabic}/u)
    expect(arrives.textContent).not.toMatch(/[A-Za-z]/)
  })
})
