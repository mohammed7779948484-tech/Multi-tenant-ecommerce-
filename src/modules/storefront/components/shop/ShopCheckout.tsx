'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LocateFixed } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AddressForm, AddressFormErrorSummary, AddressFormFields, type Address, type AddressErrors, type AddressFieldName } from '@/components/ecomcn/address-form'
import { CheckoutStepper } from '@/components/ecomcn/checkout-stepper'
import { DeliveryOptions, type DeliveryOption } from '@/components/ecomcn/delivery-options'
import { PaymentSelector, type PaymentMethod } from '@/components/ecomcn/payment-selector'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toLatinDigits } from '@/lib/digits'
import type { CheckoutPaymentOption, CheckoutQuote, CheckoutShippingOption } from '../../lib/shopCheckout'
import { formatShopNumber } from '../../lib/shopFormat'
import { isInYemen, normalizeYemeniMobile, yemenGovernorates } from '../../lib/yemen'
import { ISSUE_KEYS, useShopCart } from './ShopCart'
import { TransferInstructions } from './TransferInstructions'

/**
 * Guest checkout (shopping-journey spec J-003, REQ-007/REQ-008): three steps —
 * contact and address, delivery, payment and review — built from the ecomcn
 * checkout blocks. The address form takes Yemen's governorates and their
 * districts from the bundled OCHA list. Every amount on the page comes from the
 * server's quote; the buyer confirms the quote they saw (`quoteHash`), and a
 * change since answers 409 with the new quote, shown with a notice.
 */

type StepId = 'address' | 'delivery' | 'payment'
type Options = { shippingMethods: CheckoutShippingOption[]; paymentMethods: CheckoutPaymentOption[] }
type FailureBody = { error?: string; code?: string; fieldErrors?: Record<string, string>; quote?: CheckoutQuote }

const GOVERNORATES = yemenGovernorates()
const REGIONS = GOVERNORATES.map(({ code, name }) => ({ code, name }))
const DISTRICTS = new Map(GOVERNORATES.map((governorate) => [governorate.code, governorate.districts.map(({ code, name }) => ({ code, name }))]))

const EMPTY_ADDRESS: Address = { country: 'YE', givenName: '', familyName: '', line1: '', line2: '', city: '', region: '', phone: '' }

/** Which address field a server field error belongs to. */
const SERVER_FIELDS: Record<string, keyof AddressErrors> = {
  'contact.name': 'givenName',
  'contact.phone': 'phone',
  'destination.governorate': 'region',
  'destination.district': 'city',
  'destination.area': 'line1',
  'destination.landmark': 'line2',
}

async function call<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: (T & FailureBody) | null }> {
  const res = await apiCall<T & FailureBody>(url, {
    ...init,
    headers: { 'x-om-unauthorized-redirect': '0', 'content-type': 'application/json' },
    credentials: 'same-origin',
  })
  return { ok: res.ok, status: res.status, body: res.result ?? null }
}

export function ShopCheckout({ siteSlug, cartHref, shopHref }: { siteSlug: string; cartHref: string; shopHref: string }) {
  const t = useT()
  const router = useRouter()
  const { cart, ready, failed: cartFailed, reload } = useShopCart()
  const api = `/api/storefront/shop/${encodeURIComponent(siteSlug)}`

  const [step, setStep] = React.useState<StepId>('address')
  const [address, setAddress] = React.useState<Address>(EMPTY_ADDRESS)
  const [note, setNote] = React.useState('')
  const [gps, setGps] = React.useState<{ latitude: number; longitude: number } | null>(null)
  const [gpsState, setGpsState] = React.useState<'idle' | 'locating' | 'failed' | 'outside'>('idle')
  const [errors, setErrors] = React.useState<AddressErrors>({})
  const [options, setOptions] = React.useState<Options | null>(null)
  const [optionsLoading, setOptionsLoading] = React.useState(false)
  const [shippingId, setShippingId] = React.useState<string | null>(null)
  const [paymentId, setPaymentId] = React.useState<string | null>(null)
  const [quote, setQuote] = React.useState<CheckoutQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [placing, setPlacing] = React.useState(false)

  const steps = [
    { id: 'address', label: t('storefront.shop.checkout.steps.address', 'Contact and address') },
    { id: 'delivery', label: t('storefront.shop.checkout.steps.delivery', 'Delivery') },
    { id: 'payment', label: t('storefront.shop.checkout.steps.payment', 'Payment and review') },
  ]

  const format = React.useMemo(
    () => ({
      YE: {
        rows: [['givenName'], ['phone'], ['region', 'city'], ['line1'], ['line2']] as AddressFieldName[][],
        required: ['givenName', 'phone', 'region', 'city', 'line1'] as AddressFieldName[],
        labels: {
          givenName: t('storefront.shop.checkout.fields.name', 'Full name'),
          phone: t('storefront.shop.checkout.fields.phone', 'Mobile number'),
          region: t('storefront.shop.checkout.fields.governorate', 'Governorate'),
          city: t('storefront.shop.checkout.fields.district', 'District'),
          line1: t('storefront.shop.checkout.fields.area', 'Area and street'),
          line2: t('storefront.shop.checkout.fields.landmark', 'Nearest landmark'),
        },
        regions: REGIONS,
        cities: (region: string) => DISTRICTS.get(region) ?? [],
      },
    }),
    [t],
  )

  const destination = React.useCallback(
    () => ({ governorate: address.region ?? '', district: address.city, area: address.line1.trim(), landmark: address.line2?.trim() || null, note: note.trim() || null, gps }),
    [address, note, gps],
  )

  const validateAddress = (): AddressErrors => {
    const next: AddressErrors = {}
    if (address.givenName.trim().length < 2) next.givenName = t('storefront.shop.checkout.errors.name', 'Enter your full name.')
    if (!normalizeYemeniMobile(address.phone ?? '', toLatinDigits)) next.phone = t('storefront.shop.checkout.errors.phone', 'Enter a Yemeni mobile number, like 77 123 4567.')
    if (!address.region) next.region = t('storefront.shop.checkout.errors.governorate', 'Choose your governorate.')
    if (!address.city) next.city = t('storefront.shop.checkout.errors.district', 'Choose your district.')
    if (!address.line1.trim()) next.line1 = t('storefront.shop.checkout.errors.area', 'Enter the area and street.')
    return next
  }

  const loadOptions = React.useCallback(async () => {
    setOptionsLoading(true)
    setFailure(null)
    const query = new URLSearchParams({ governorate: address.region ?? '', district: address.city })
    const res = await call<Options>(`${api}/checkout/options?${query}`)
    setOptionsLoading(false)
    if (!res.ok || !res.body) {
      setFailure(res.body?.error ?? t('storefront.shop.errors.failed', 'Something went wrong. Try again.'))
      return null
    }
    setOptions(res.body)
    setShippingId((current) => (res.body!.shippingMethods.some((method) => method.id === current) ? current : (res.body!.shippingMethods[0]?.id ?? null)))
    setPaymentId((current) => (res.body!.paymentMethods.some((method) => method.id === current) ? current : (res.body!.paymentMethods[0]?.id ?? null)))
    return res.body
  }, [api, address.region, address.city, t])

  const loadQuote = React.useCallback(async () => {
    if (!shippingId || !paymentId) return
    setQuoteLoading(true)
    setFailure(null)
    const res = await call<CheckoutQuote>(`${api}/checkout/quote`, {
      method: 'POST',
      body: JSON.stringify({ destination: destination(), shippingMethodId: shippingId, paymentMethodId: paymentId }),
    })
    setQuoteLoading(false)
    if (res.ok && res.body) setQuote(res.body)
    else setFailure(res.body?.error ?? t('storefront.shop.errors.failed', 'Something went wrong. Try again.'))
  }, [api, destination, shippingId, paymentId, t])

  // The quote follows the chosen methods once the buyer is past the address.
  React.useEffect(() => {
    if (step !== 'address') void loadQuote()
  }, [step, shippingId, paymentId, loadQuote])

  const toDelivery = async () => {
    const found = validateAddress()
    setErrors(found)
    if (Object.keys(found).length) return
    if (await loadOptions()) setStep('delivery')
  }

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setGpsState('failed')
      return
    }
    setGpsState('locating')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!isInYemen(coords.latitude, coords.longitude)) {
          setGpsState('outside')
          return
        }
        setGps({ latitude: Math.round(coords.latitude * 1e6) / 1e6, longitude: Math.round(coords.longitude * 1e6) / 1e6 })
        setGpsState('idle')
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  const place = async () => {
    if (!quote || !shippingId || !paymentId || placing) return
    setPlacing(true)
    setFailure(null)
    setNotice(null)
    const res = await call<{ orderNumber: string; trackingUrl: string }>(`${api}/checkout/place`, {
      method: 'POST',
      body: JSON.stringify({
        contact: { name: address.givenName.trim(), phone: address.phone ?? '' },
        destination: destination(),
        shippingMethodId: shippingId,
        paymentMethodId: paymentId,
        quoteHash: quote.quoteHash,
      }),
    })
    if (res.ok && res.body?.trackingUrl) {
      // The cart is now an order: the header count reads it again on the order page.
      router.push(`${res.body.trackingUrl}&placed=1`)
      void reload()
      return
    }
    setPlacing(false)
    if (res.status === 409 && res.body?.quote) {
      setQuote(res.body.quote)
      setNotice(t('storefront.shop.checkout.changed', 'Something in your order changed since you reviewed it. Check the new total and confirm again.'))
      void reload()
      return
    }
    const fieldErrors = res.body?.fieldErrors ?? {}
    const mapped: AddressErrors = {}
    for (const [field, message] of Object.entries(fieldErrors)) if (SERVER_FIELDS[field]) mapped[SERVER_FIELDS[field]] = message
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      setStep('address')
    }
    setFailure(res.body?.error ?? t('storefront.shop.errors.failed', 'Something went wrong. Try again.'))
  }

  if (!ready) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <span className="sr-only">{t('storefront.shop.checkout.loading', 'Loading checkout')}</span>
      </div>
    )
  }
  if (cartFailed) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-col items-start gap-3">
          {t('storefront.shop.cart.loadFailed', 'Your cart could not be loaded.')}
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            {t('storefront.shop.cart.retry', 'Try again')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!cart.lines.length) {
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <p className="text-xl">{t('storefront.shop.checkout.empty', 'Your cart is empty, so there is nothing to check out.')}</p>
        <Button asChild>
          <a href={shopHref}>{t('storefront.shop.cart.continue', 'Continue shopping')}</a>
        </Button>
      </div>
    )
  }
  const blockedLines = cart.lines.filter((line) => line.issues.length)

  const shippingOptions: DeliveryOption[] = (options?.shippingMethods ?? []).map((method) => ({
    id: method.id,
    label: method.name,
    price: method.amount ?? 0,
    priceLabel: method.formatted ?? undefined,
    minDays: method.transitDays ?? undefined,
    maxDays: method.transitDays ?? undefined,
    businessDaysOnly: false,
    description: method.description ?? undefined,
  }))
  const paymentMethods: PaymentMethod[] = (options?.paymentMethods ?? []).map((method) => ({
    id: method.id,
    label: method.name,
    description: method.description ?? undefined,
    kind: method.kind === 'transfer' ? 'bank' : 'other',
  }))
  const chosenPayment = options?.paymentMethods.find((method) => method.id === paymentId) ?? null

  const summary = (
    <OrderSummary quote={quote} loading={quoteLoading} cartHref={cartHref} />
  )

  return (
    <div className="sf-checkout flex flex-col gap-8">
      <CheckoutStepper steps={steps} value={step} onValueChange={(id) => setStep(id as StepId)} />
      {blockedLines.length ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-2">
            {t('storefront.shop.checkout.blocked', 'Some items in your cart cannot be ordered right now. Update your cart to continue.')}
            <ul className="list-disc ps-5">
              {blockedLines.map((line) => (
                <li key={line.id}>
                  {line.title ?? t('storefront.shop.cart.goneProduct', 'A product that is no longer sold')}: {line.issues.map((issue) => t(...ISSUE_KEYS[issue])).join('، ')}
                </li>
              ))}
            </ul>
            <a href={cartHref} className="underline underline-offset-4">
              {t('storefront.shop.checkout.editCart', 'Edit your cart')}
            </a>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="sf-checkout-layout">
        <div className="flex min-w-0 flex-col gap-8">
          <Collapsible className="sf-checkout-summary-mobile border">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span>{t('storefront.shop.checkout.summary', 'Order summary')}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {quote ? quote.grandTotal.formatted : cart.subtotal?.formatted}
                <ChevronDown aria-hidden className="size-4" />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-4 py-4">{summary}</CollapsibleContent>
          </Collapsible>

          {step === 'address' ? (
            <section className="flex flex-col gap-6" aria-labelledby="sf-checkout-address">
              <h2 id="sf-checkout-address" className="text-lg font-medium">
                {steps[0]!.label}
              </h2>
              <AddressForm
                value={address}
                onValueChange={setAddress}
                errors={errors}
                countries={['YE']}
                formats={format}
                legend={steps[0]!.label}
                hideLegend
                section="shipping"
              >
                <AddressFormErrorSummary />
                <AddressFormFields />
              </AddressForm>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sf-checkout-note">
                  {t('storefront.shop.checkout.fields.note', 'Note for the courier')} <span className="font-normal text-muted-foreground">{t('ecomcn.address.optional', '(optional)')}</span>
                </Label>
                <Textarea id="sf-checkout-note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
              </div>
              <div className="flex flex-col items-start gap-2">
                <Button type="button" variant="outline" onClick={locate} disabled={gpsState === 'locating'}>
                  <LocateFixed aria-hidden />
                  {gps ? t('storefront.shop.checkout.gps.update', 'Update my location') : t('storefront.shop.checkout.gps.use', 'Use my current location')}
                </Button>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {gpsState === 'locating'
                    ? t('storefront.shop.checkout.gps.locating', 'Finding your location…')
                    : gpsState === 'failed'
                      ? t('storefront.shop.checkout.gps.failed', 'Your location is not available. You can still complete the address.')
                      : gpsState === 'outside'
                        ? t('storefront.shop.checkout.gps.outside', 'That location is outside Yemen, so it was not added.')
                        : gps
                          ? t('storefront.shop.checkout.gps.saved', 'Location added to help the courier find you.')
                          : t('storefront.shop.checkout.gps.hint', 'Optional: helps the courier find you.')}
                </p>
              </div>
              <Button type="button" size="lg" onClick={() => void toDelivery()} disabled={optionsLoading} className="self-start">
                {t('storefront.shop.checkout.continue', 'Continue')}
              </Button>
            </section>
          ) : null}

          {step === 'delivery' ? (
            <section className="flex flex-col gap-6" aria-labelledby="sf-checkout-delivery">
              <h2 id="sf-checkout-delivery" className="text-lg font-medium">
                {steps[1]!.label}
              </h2>
              {options && !options.shippingMethods.length ? (
                <Alert>
                  <AlertDescription>{t('storefront.shop.checkout.notServed', 'Delivery is not available in this area yet.')}</AlertDescription>
                </Alert>
              ) : (
                <DeliveryOptions options={shippingOptions} value={shippingId} onValueChange={setShippingId} loading={optionsLoading} legend={steps[1]!.label} hideLegend />
              )}
              <div className="flex flex-wrap gap-3">
                <Button type="button" size="lg" onClick={() => setStep('payment')} disabled={!shippingId}>
                  {t('storefront.shop.checkout.continue', 'Continue')}
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => setStep('address')}>
                  {t('storefront.shop.checkout.back', 'Back')}
                </Button>
              </div>
            </section>
          ) : null}

          {step === 'payment' ? (
            <section className="flex flex-col gap-6" aria-labelledby="sf-checkout-payment">
              <h2 id="sf-checkout-payment" className="text-lg font-medium">
                {steps[2]!.label}
              </h2>
              {paymentMethods.length ? (
                <PaymentSelector
                  methods={paymentMethods}
                  value={paymentId}
                  onValueChange={setPaymentId}
                  legend={steps[2]!.label}
                  hideLegend
                  renderPanel={(method) => {
                    const option = options?.paymentMethods.find((row) => row.id === method.id)
                    return option?.kind === 'transfer' ? <TransferInstructions option={option} /> : null
                  }}
                />
              ) : (
                <Alert>
                  <AlertDescription>{t('storefront.shop.checkout.noPayment', 'This store cannot take orders online right now.')}</AlertDescription>
                </Alert>
              )}
              <ReviewDetails address={address} note={note} gps={gps} payment={chosenPayment?.name ?? null} shipping={options?.shippingMethods.find((method) => method.id === shippingId)?.name ?? null} />
              {notice ? (
                <Alert aria-live="polite">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" size="lg" onClick={() => void place()} disabled={!quote || quote.blocked || quoteLoading || placing || !paymentId}>
                  {placing ? t('storefront.shop.checkout.placing', 'Placing your order…') : t('storefront.shop.checkout.place', 'Confirm order')}
                  {quote && !placing ? <span className="tabular-nums"> — {quote.grandTotal.formatted}</span> : null}
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => setStep('delivery')} disabled={placing}>
                  {t('storefront.shop.checkout.back', 'Back')}
                </Button>
              </div>
            </section>
          ) : null}

          {failure ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <aside className="sf-checkout-summary" aria-label={t('storefront.shop.checkout.summary', 'Order summary')}>
          {summary}
        </aside>
      </div>
    </div>
  )

}

/** What the buyer is about to confirm: contact, address, delivery and payment. */
function ReviewDetails(props: { address: Address; note: string; gps: { latitude: number; longitude: number } | null; shipping: string | null; payment: string | null }) {
  const t = useT()
  const governorate = GOVERNORATES.find((row) => row.code === props.address.region)
  const district = governorate?.districts.find((row) => row.code === props.address.city)
  return (
    <dl className="grid gap-4 border p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">{t('storefront.shop.checkout.review.contact', 'Contact')}</dt>
        <dd>{props.address.givenName}</dd>
        <dd dir="ltr" className="text-end tabular-nums sm:text-start">
          {normalizeYemeniMobile(props.address.phone ?? '', toLatinDigits)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('storefront.shop.checkout.review.address', 'Deliver to')}</dt>
        <dd>{[district?.name, governorate?.name].filter(Boolean).join('، ')}</dd>
        <dd>{props.address.line1}</dd>
        {props.address.line2 ? <dd>{props.address.line2}</dd> : null}
        {props.note ? <dd className="text-muted-foreground">{props.note}</dd> : null}
        {props.gps ? <dd className="text-muted-foreground">{t('storefront.shop.checkout.gps.saved', 'Location added to help the courier find you.')}</dd> : null}
      </div>
      <div>
        <dt className="text-muted-foreground">{t('storefront.shop.checkout.steps.delivery', 'Delivery')}</dt>
        <dd>{props.shipping}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('ecomcn.payment.legend', 'Payment')}</dt>
        <dd>{props.payment}</dd>
      </div>
    </dl>
  )
}

/** Lines and totals of the server's quote; before a quote, the cart's lines and subtotal. */
function OrderSummary({ quote, loading, cartHref }: { quote: CheckoutQuote | null; loading: boolean; cartHref: string }) {
  const t = useT()
  const { cart } = useShopCart()
  const lines = quote?.lines ?? cart.lines
  const rows: Array<{ label: string; value: string }> = []
  if (quote) {
    rows.push({ label: t('ecomcn.confirmation.subtotal', 'Subtotal'), value: quote.subtotal.formatted })
    rows.push({ label: t('ecomcn.confirmation.shipping', 'Shipping'), value: quote.shipping.formatted })
    if (quote.fees.amount) rows.push({ label: t('ecomcn.confirmation.fees', 'Fees'), value: quote.fees.formatted })
    if (quote.discount.amount) rows.push({ label: t('ecomcn.confirmation.discount', 'Discount'), value: `−${quote.discount.formatted}` })
    if (quote.tax.amount) rows.push({ label: t('ecomcn.confirmation.tax', 'Tax'), value: quote.tax.formatted })
  }
  return (
    <div className="flex flex-col gap-4" aria-busy={loading || undefined}>
      <ul className="flex flex-col gap-3" role="list">
        {lines.map((line) => (
          <li key={line.id} className="flex gap-3 text-sm">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{line.title ?? t('storefront.shop.cart.goneProduct', 'A product that is no longer sold')}</span>
              {line.variantLabel ? <span className="text-muted-foreground">{line.variantLabel}</span> : null}
              {line.personalization.filter((field) => field.value).map((field) => (
                <span key={field.code} className="text-muted-foreground">
                  {field.label}: {field.value}
                </span>
              ))}
              <span className="text-muted-foreground tabular-nums">× {formatShopNumber(line.quantity)}</span>
            </span>
            <span className="tabular-nums">{line.lineTotal?.formatted ?? '—'}</span>
          </li>
        ))}
      </ul>
      <Separator />
      {quote ? (
        <dl className="flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="tabular-nums">{row.value}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-3 font-medium">
            <dt>{t('storefront.shop.checkout.total', 'Total')}</dt>
            <dd className="text-lg tabular-nums">{quote.grandTotal.formatted}</dd>
          </div>
        </dl>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('ecomcn.confirmation.subtotal', 'Subtotal')}</span>
            <span className="tabular-nums">{cart.subtotal?.formatted ?? '—'}</span>
          </div>
          <p className="text-muted-foreground">{t('storefront.shop.cart.note', 'Delivery is priced at checkout for your address.')}</p>
        </div>
      )}
      <a href={cartHref} className="text-sm underline underline-offset-4">
        {t('storefront.shop.checkout.editCart', 'Edit your cart')}
      </a>
    </div>
  )
}
