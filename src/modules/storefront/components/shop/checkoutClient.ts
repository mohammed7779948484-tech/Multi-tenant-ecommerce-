'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CheckoutDestination, CheckoutQuote } from '../../lib/shopCheckout'

/**
 * Checkout requests on the client (shopping-journey spec J-003): one request
 * helper that never rejects, and the quote that follows the buyer's choices.
 */

export type FailureBody = { error?: string; code?: string; fieldErrors?: Record<string, string>; quote?: CheckoutQuote }

/** A checkout request; a network failure answers like a failed request (status 0) so every step can recover. */
export async function checkoutCall<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: (T & FailureBody) | null }> {
  try {
    const res = await apiCall<T & FailureBody>(url, {
      ...init,
      headers: { 'x-om-unauthorized-redirect': '0', 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
    return { ok: res.ok, status: res.status, body: res.result ?? null }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

export type QuoteSelection = { destination: CheckoutDestination; shippingMethodId: string; paymentMethodId: string }

/**
 * The server quote for `selection` (`null` while nothing can be quoted). Only
 * the newest request's answer is kept, and a quote is shown only for the exact
 * selection it priced: a slow answer for an earlier delivery or payment choice
 * never shows its totals for the current one.
 */
export function useCheckoutQuote(api: string, selection: QuoteSelection | null) {
  const t = useT()
  const key = selection ? JSON.stringify({ destination: selection.destination, shippingMethodId: selection.shippingMethodId, paymentMethodId: selection.paymentMethodId }) : null
  const latest = React.useRef(0)
  const [priced, setPriced] = React.useState<{ key: string; quote: CheckoutQuote } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const ticket = ++latest.current
    if (!key) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const res = await checkoutCall<CheckoutQuote>(`${api}/checkout/quote`, { method: 'POST', body: key })
    if (ticket !== latest.current) return
    setLoading(false)
    if (res.ok && res.body) setPriced({ key, quote: res.body })
    else setError(res.body?.error ?? t('storefront.shop.errors.failed', 'Something went wrong. Try again.'))
  }, [api, key, t])

  React.useEffect(() => {
    void load()
  }, [load])

  return {
    quote: priced && priced.key === key ? priced.quote : null,
    loading,
    error,
    reload: load,
    /** A quote the server sent with a 409: the new prices for the current selection. */
    replace: React.useCallback((quote: CheckoutQuote) => {
      if (key) setPriced({ key, quote })
    }, [key]),
  }
}
