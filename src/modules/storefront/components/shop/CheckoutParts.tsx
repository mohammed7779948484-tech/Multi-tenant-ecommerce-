'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { Address } from '@/components/ecomcn/address-form'
import { DeliveryOptions, type DeliveryOption } from '@/components/ecomcn/delivery-options'
import { Separator } from '@/components/ui/separator'
import { toLatinDigits } from '@/lib/digits'
import type { CheckoutQuote, CheckoutShippingOption } from '../../lib/shopCheckout'
import { formatShopNumber, SHOP_NUMBER_LOCALE } from '../../lib/shopFormat'
import { normalizeYemeniMobile, yemenGovernorates } from '../../lib/yemen'
import { useShopCart } from './ShopCart'

/** Parts of the checkout page (shopping-journey spec J-003): delivery choices, the review and the order summary. */

const GOVERNORATES = yemenGovernorates()

/**
 * The store's delivery methods for the buyer's district, on the ecomcn block,
 * with arrival dates and prices in Arabic (the store's locale, not the
 * browser's).
 */
export function CheckoutDeliveryOptions(props: {
  methods: CheckoutShippingOption[]
  value: string | null
  onValueChange: (id: string) => void
  loading: boolean
  legend: string
}) {
  const options: DeliveryOption[] = props.methods.map((method) => ({
    id: method.id,
    label: method.name,
    price: method.amount ?? 0,
    priceLabel: method.formatted ?? undefined,
    minDays: method.transitDays ?? undefined,
    maxDays: method.transitDays ?? undefined,
    businessDaysOnly: false,
    description: method.description ?? undefined,
  }))
  return (
    <DeliveryOptions
      options={options}
      value={props.value}
      onValueChange={props.onValueChange}
      loading={props.loading}
      currency={props.methods[0]?.currencyCode || undefined}
      locale={SHOP_NUMBER_LOCALE}
      legend={props.legend}
      hideLegend
    />
  )
}

/** What the buyer is about to confirm: contact, address, delivery and payment. */
export function ReviewDetails(props: { address: Address; note: string; gps: { latitude: number; longitude: number } | null; shipping: string | null; payment: string | null }) {
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
export function OrderSummary({ quote, loading, cartHref }: { quote: CheckoutQuote | null; loading: boolean; cartHref: string }) {
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
