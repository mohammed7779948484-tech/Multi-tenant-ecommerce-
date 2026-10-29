'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, Upload } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { OrderView } from '../../lib/shopOrders'
import { SHOP_NUMBER_LOCALE } from '../../lib/shopFormat'

/**
 * The bank-transfer proof on the tracking page (shopping-journey spec J-004,
 * REQ-010): the transfer reference, an optional sender name and a photo or PDF
 * of the receipt, sent once. After that the page says the proof was received.
 */

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
type FieldName = 'reference' | 'senderName' | 'receipt'
type Answer = { submittedAt?: string; error?: string; fieldErrors?: Record<string, string> }

/** When the proof arrived, in Yemen time (the same on the server and in the browser). */
function formatReceived(iso: string): string {
  return new Intl.DateTimeFormat(SHOP_NUMBER_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Aden' }).format(new Date(iso))
}

export function TransferProofForm({ proof, action }: { proof: OrderView['proof']; action: string | null }) {
  const t = useT()
  const router = useRouter()
  const [submittedAt, setSubmittedAt] = React.useState(proof.submittedAt)
  const [errors, setErrors] = React.useState<Partial<Record<FieldName, string>>>({})
  const [failure, setFailure] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  if (submittedAt || proof.state === 'submitted') {
    return (
      <Alert>
        <CircleCheck aria-hidden />
        <AlertTitle>{t('storefront.shop.proof.received', 'Transfer proof received')}</AlertTitle>
        <AlertDescription>
          {t('storefront.shop.proof.receivedBody', 'The store will check your transfer and confirm the payment. Received {date}.', {
            date: formatReceived(submittedAt ?? proof.submittedAt ?? new Date().toISOString()),
          })}
        </AlertDescription>
      </Alert>
    )
  }
  if (proof.state !== 'open' || !action) return null

  const focusFirst = (found: Partial<Record<FieldName, string>>) => {
    const name = (['reference', 'senderName', 'receipt'] as const).find((field) => found[field])
    if (name) formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending) return
    const form = new FormData(event.currentTarget)
    const found: Partial<Record<FieldName, string>> = {}
    if (!String(form.get('reference') ?? '').trim()) found.reference = t('storefront.shop.proof.errors.reference', 'Enter the transfer reference.')
    // The chosen file, from the input itself.
    const receipt = fileRef.current?.files?.[0] ?? null
    form.delete('receipt')
    if (receipt) form.set('receipt', receipt)
    if (!receipt || !receipt.size) found.receipt = t('storefront.shop.proof.errors.receipt', 'Choose a photo or PDF of the receipt.')
    else if (receipt.size > MAX_BYTES) found.receipt = t('storefront.shop.proof.errors.tooLarge', 'The receipt must be 5 MB or smaller.')
    setErrors(found)
    setFailure(null)
    if (Object.keys(found).length) {
      focusFirst(found)
      return
    }
    setSending(true)
    let answer: { ok: boolean; status: number; body: Answer | null }
    try {
      const res = await apiCall<Answer>(action, { method: 'POST', body: form, credentials: 'same-origin', headers: { 'x-om-unauthorized-redirect': '0' } })
      answer = { ok: res.ok, status: res.status, body: res.result ?? null }
    } catch {
      answer = { ok: false, status: 0, body: { error: t('storefront.shop.errors.network', 'Could not reach the store. Check your connection and try again.') } }
    }
    setSending(false)
    if (answer.ok && answer.body?.submittedAt) {
      setSubmittedAt(answer.body.submittedAt)
      router.refresh()
      return
    }
    if (answer.status === 409) {
      // Already received (another tab, a double tap): show it as received.
      router.refresh()
    }
    const server: Partial<Record<FieldName, string>> = {}
    for (const [field, message] of Object.entries(answer.body?.fieldErrors ?? {})) if (field === 'reference' || field === 'senderName' || field === 'receipt') server[field] = message
    setErrors(server)
    setFailure(answer.body?.error ?? t('storefront.shop.errors.failed', 'Something went wrong. Try again.'))
    focusFirst(server)
  }

  const describe = (name: FieldName) => (errors[name] ? `sf-proof-${name}-error` : undefined)

  return (
    <form ref={formRef} onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5" aria-busy={sending || undefined}>
      <FieldSet>
        <FieldLegend>{t('storefront.shop.proof.title', 'Already transferred? Send the proof')}</FieldLegend>
        <FieldDescription>{t('storefront.shop.proof.hint', 'The store checks the transfer, then confirms your payment.')}</FieldDescription>
        <FieldGroup>
          <Field data-invalid={errors.reference ? true : undefined}>
            <FieldLabel htmlFor="sf-proof-reference">{t('storefront.shop.proof.reference', 'Transfer reference number')}</FieldLabel>
            <Input id="sf-proof-reference" name="reference" maxLength={100} required autoComplete="off" dir="auto" aria-invalid={errors.reference ? true : undefined} aria-describedby={describe('reference')} />
            <FieldError id="sf-proof-reference-error">{errors.reference}</FieldError>
          </Field>
          <Field data-invalid={errors.senderName ? true : undefined}>
            <FieldLabel htmlFor="sf-proof-sender">
              {t('storefront.shop.proof.sender', 'Name of the sender')} <span className="font-normal text-muted-foreground">{t('ecomcn.address.optional', '(optional)')}</span>
            </FieldLabel>
            <Input id="sf-proof-sender" name="senderName" maxLength={120} autoComplete="name" dir="auto" aria-invalid={errors.senderName ? true : undefined} aria-describedby={describe('senderName')} />
            <FieldError id="sf-proof-senderName-error">{errors.senderName}</FieldError>
          </Field>
          <Field data-invalid={errors.receipt ? true : undefined}>
            <FieldLabel htmlFor="sf-proof-receipt">{t('storefront.shop.proof.receipt', 'Photo or PDF of the receipt')}</FieldLabel>
            {/* The native picker's own text follows the browser's language: it stays for keyboard and screen readers, and the store shows its own button and file name. */}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                id="sf-proof-receipt"
                name="receipt"
                type="file"
                accept={ACCEPT}
                required
                className="peer sr-only"
                onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? null)}
                aria-invalid={errors.receipt ? true : undefined}
                aria-describedby={`sf-proof-receipt-hint${errors.receipt ? ' sf-proof-receipt-error' : ''}`}
              />
              <Button asChild variant="outline" className="cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                <label htmlFor="sf-proof-receipt">
                  <Upload aria-hidden />
                  {t('storefront.shop.proof.choose', 'Choose a file')}
                </label>
              </Button>
              <span className="min-w-0 truncate text-sm text-muted-foreground" dir="auto">
                {fileName ?? t('storefront.shop.proof.noFile', 'No file chosen yet')}
              </span>
            </div>
            <FieldDescription id="sf-proof-receipt-hint">{t('storefront.shop.proof.receiptHint', 'JPEG, PNG, WebP or PDF, up to 5 MB.')}</FieldDescription>
            <FieldError id="sf-proof-receipt-error">{errors.receipt}</FieldError>
          </Field>
        </FieldGroup>
      </FieldSet>
      {failure ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="lg" disabled={sending} className="self-start">
        {sending ? t('storefront.shop.proof.sending', 'Sending…') : t('storefront.shop.proof.submit', 'Send the proof')}
      </Button>
    </form>
  )
}
