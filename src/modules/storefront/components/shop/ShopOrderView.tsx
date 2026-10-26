'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  OrderConfirmation,
  OrderConfirmationActions,
  OrderConfirmationDetails,
  OrderConfirmationFacts,
  OrderConfirmationHeader,
  OrderConfirmationItems,
  type OrderConfirmationData,
} from '@/components/ecomcn/order-confirmation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OrderView } from '../../lib/shopOrders'
import { formatShopPrice, SHOP_NUMBER_LOCALE } from '../../lib/shopFormat'
import { TransferInstructions } from './TransferInstructions'

/**
 * The order's confirmation and tracking page (shopping-journey spec REQ-009),
 * on the ecomcn order-confirmation block: number, date, total, lines with
 * personalization, address, delivery and payment, plus the order and payment
 * status in Arabic. Known sales status values have Arabic labels; a status the
 * merchant added shows its own value. Bank-transfer orders repeat the store's
 * transfer instructions. Every amount was formatted by the server.
 */

const ORDER_STATUS: Record<string, [string, string]> = {
  draft: ['storefront.shop.order.status.draft', 'Draft'],
  pending_approval: ['storefront.shop.order.status.pending_approval', 'Received, awaiting confirmation'],
  approved: ['storefront.shop.order.status.approved', 'Approved'],
  confirmed: ['storefront.shop.order.status.confirmed', 'Confirmed'],
  in_fulfillment: ['storefront.shop.order.status.in_fulfillment', 'Being prepared'],
  fulfilled: ['storefront.shop.order.status.fulfilled', 'Delivered'],
  on_hold: ['storefront.shop.order.status.on_hold', 'On hold'],
  rejected: ['storefront.shop.order.status.rejected', 'Rejected'],
  canceled: ['storefront.shop.order.status.canceled', 'Cancelled'],
}

const PAYMENT_STATUS: Record<string, [string, string]> = {
  pending: ['storefront.shop.order.payment.pending', 'Not paid yet'],
  authorized: ['storefront.shop.order.payment.authorized', 'Authorized'],
  captured: ['storefront.shop.order.payment.captured', 'Paid'],
  received: ['storefront.shop.order.payment.received', 'Paid'],
  refunded: ['storefront.shop.order.payment.refunded', 'Refunded'],
  failed: ['storefront.shop.order.payment.failed', 'Payment failed'],
  canceled: ['storefront.shop.order.payment.canceled', 'Cancelled'],
}

export function ShopOrderView({ order, permalink, justPlaced, shopHref }: { order: OrderView; permalink: string | null; justPlaced: boolean; shopHref: string }) {
  const t = useT()
  const label = (map: Record<string, [string, string]>, value: string | null) => (value ? (map[value] ? t(...map[value]) : value) : null)
  const status = label(ORDER_STATUS, order.status)
  const payment = label(PAYMENT_STATUS, order.paymentStatus)
  const paid = order.paymentStatus === 'received' || order.paymentStatus === 'captured'
  // Absolute only on the client: the server cannot know the host the buyer used.
  const [absoluteLink, setAbsoluteLink] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    if (permalink) setAbsoluteLink(new URL(permalink, window.location.origin).toString())
  }, [permalink])

  const data: OrderConfirmationData = {
    number: order.orderNumber,
    placedAt: order.placedAt ?? new Date(0).toISOString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      name: line.name,
      variant: [line.variant, line.personalization].filter(Boolean).join(' · ') || undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice.amount,
    })),
    totals: {
      subtotal: order.totals.subtotal.amount,
      discount: order.totals.discount.amount || undefined,
      shipping: order.totals.shipping.amount,
      fees: order.totals.fees.amount || undefined,
      tax: order.totals.tax.amount || undefined,
      total: order.totals.grandTotal.amount,
    },
    shipTo: [
      order.contact.name,
      [order.address.district, order.address.governorate].filter(Boolean).join('، '),
      order.address.area,
      order.address.landmark,
      order.address.note,
    ].filter((line): line is string => Boolean(line)),
    delivery: order.shippingMethod ? { label: order.shippingMethod } : undefined,
    payment: order.payment.name ?? undefined,
  }

  return (
    <div className="flex flex-col gap-8">
      <OrderConfirmation
        order={data}
        currency={order.currencyCode}
        locale={SHOP_NUMBER_LOCALE}
        formatMoney={(amount) => formatShopPrice(amount, order.currencyCode) ?? String(amount)}
        title={justPlaced ? t('storefront.shop.order.thanks', 'Thank you, your order is placed') : t('storefront.shop.order.title', 'Order {number}', { number: order.orderNumber })}
        totalLabel={paid ? t('ecomcn.confirmation.paid', 'Paid') : t('storefront.shop.checkout.total', 'Total')}
        permalink={absoluteLink}
        actions={
          <Button asChild variant="outline">
            <a href={shopHref}>{t('storefront.shop.cart.continue', 'Continue shopping')}</a>
          </Button>
        }
      >
        <OrderConfirmationHeader />
        <div className="flex flex-wrap items-center gap-3" aria-label={t('storefront.shop.order.statusLabel', 'Order status')}>
          {status ? <Badge variant="secondary">{status}</Badge> : null}
          {payment ? <Badge variant="outline">{payment}</Badge> : null}
          {order.contact.phone ? (
            <span dir="ltr" className="text-sm text-muted-foreground tabular-nums">
              {order.contact.phone}
            </span>
          ) : null}
        </div>
        <OrderConfirmationFacts />
        {order.payment.kind === 'transfer' && !paid && (order.payment.instructions || order.payment.accountNumber) ? (
          <section className="flex flex-col gap-3 border p-4" aria-labelledby="sf-order-transfer">
            <h2 id="sf-order-transfer" className="font-medium">
              {t('storefront.shop.order.transferTitle', 'How to pay by bank transfer')}
            </h2>
            <TransferInstructions option={{ instructions: order.payment.instructions, accountNumber: order.payment.accountNumber }} />
          </section>
        ) : null}
        <div className="sf-order-layout">
          <OrderConfirmationItems />
          <OrderConfirmationDetails />
        </div>
        <OrderConfirmationActions />
      </OrderConfirmation>
    </div>
  )
}
