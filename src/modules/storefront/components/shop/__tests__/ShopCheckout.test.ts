/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals'

const apiCall = jest.fn<(url: string, init?: unknown) => Promise<{ ok: boolean; status: number; result: unknown }>>()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (url: string, init?: unknown) => apiCall(url, init) }))

import { checkoutCall } from '../ShopCheckout'

describe('checkoutCall', () => {
  it('answers a network failure as a failed request so the step can recover', async () => {
    apiCall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(checkoutCall('/api/storefront/shop/s/checkout/place', { method: 'POST' })).resolves.toEqual({ ok: false, status: 0, body: null })
  })

  it('passes a server answer through', async () => {
    apiCall.mockResolvedValueOnce({ ok: false, status: 409, result: { code: 'quoteChanged' } })
    await expect(checkoutCall('/x')).resolves.toEqual({ ok: false, status: 409, body: { code: 'quoteChanged' } })
  })
})
