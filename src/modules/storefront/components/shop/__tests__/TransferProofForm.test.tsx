/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals'
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

const apiCall = jest.fn<(url: string, init?: { body?: unknown }) => Promise<{ ok: boolean; status: number; result: unknown }>>()
const refresh = jest.fn()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (url: string, init?: { body?: unknown }) => apiCall(url, init) }))

import { TransferProofForm } from '../TransferProofForm'

const open = { state: 'open' as const, submittedAt: null }
const renderForm = (proof: React.ComponentProps<typeof TransferProofForm>['proof'] = open) =>
  render(
    <I18nProvider locale="en" dict={{}}>
      <TransferProofForm proof={proof} action="/api/storefront/shop/s/orders/O-1/proof?k=token" />
    </I18nProvider>,
  )

function fill(reference: string, file?: File) {
  fireEvent.change(screen.getByLabelText('Transfer reference number'), { target: { value: reference } })
  if (file) fireEvent.change(screen.getByLabelText(/Photo or PDF of the receipt/), { target: { files: [file] } })
}

describe('the transfer proof form', () => {
  it('names the missing fields before sending anything', async () => {
    renderForm()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send the proof' })))
    expect(screen.getByText('Enter the transfer reference.')).toBeTruthy()
    expect(screen.getByText('Choose a photo or PDF of the receipt.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Transfer reference number'))
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('refuses a receipt over 5 MB in the browser and shows the chosen file name', async () => {
    renderForm()
    fill('TRX-1', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))
    expect(screen.getByText('big.jpg')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send the proof' })))
    expect(screen.getByText('The receipt must be 5 MB or smaller.')).toBeTruthy()
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('says so when the network fails, and the button works again', async () => {
    renderForm()
    fill('TRX-1', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'r.jpg', { type: 'image/jpeg' }))
    apiCall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send the proof' })))
    expect(screen.getByText('Could not reach the store. Check your connection and try again.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send the proof' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows server field errors next to their field', async () => {
    renderForm()
    fill('TRX-1', new File([new Uint8Array([1, 2, 3])], 'r.png', { type: 'image/png' }))
    apiCall.mockResolvedValueOnce({ ok: false, status: 422, result: { error: 'Invalid', code: 'receiptType', fieldErrors: { receipt: 'Send a JPEG, PNG or WebP photo, or a PDF.' } } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send the proof' })))
    expect(screen.getByText('Send a JPEG, PNG or WebP photo, or a PDF.')).toBeTruthy()
  })

  it('switches to the received notice after sending, and shows it for a recorded proof', async () => {
    const view = renderForm()
    fill('TRX-1', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'r.jpg', { type: 'image/jpeg' }))
    apiCall.mockResolvedValueOnce({ ok: true, status: 201, result: { submittedAt: '2026-10-29T08:00:00.000Z' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send the proof' })))
    expect(screen.getByText('Transfer proof received')).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
    expect(apiCall.mock.calls.at(-1)![1]!.body).toBeInstanceOf(FormData)
    view.unmount()
    renderForm({ state: 'submitted', submittedAt: '2026-10-29T08:00:00.000Z' })
    expect(screen.getByText('Transfer proof received')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send the proof' })).toBeNull()
  })
})
