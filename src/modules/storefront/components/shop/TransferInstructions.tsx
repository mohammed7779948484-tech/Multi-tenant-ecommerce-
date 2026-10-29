'use client'

import * as React from 'react'
import { Copy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@/components/ui/button'
import type { CheckoutPaymentOption } from '../../lib/shopCheckout'

/** The store's own transfer instructions with a copy button for the account number. */
export function TransferInstructions({ option }: { option: Pick<CheckoutPaymentOption, 'instructions' | 'accountNumber'> }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="flex flex-col gap-3 text-sm">
      {option.instructions ? <p className="sf-pre-line">{option.instructions}</p> : null}
      {option.accountNumber ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">{t('storefront.shop.checkout.account', 'Account')}</span>
          <span dir="ltr" className="font-medium tabular-nums">
            {option.accountNumber}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(option.accountNumber ?? '').then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }}
          >
            <Copy aria-hidden />
            {copied ? t('storefront.shop.checkout.copied', 'Copied') : t('storefront.shop.checkout.copy', 'Copy')}
          </Button>
        </div>
      ) : null}
      <p className="text-muted-foreground">{t('storefront.shop.checkout.transferNext', 'After placing the order, transfer the total and keep the receipt.')}</p>
    </div>
  )
}
