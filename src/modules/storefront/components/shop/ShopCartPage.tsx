'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CartLineItem,
  CartLineItemActions,
  CartLineItemInfo,
  CartLineItemMedia,
  CartLineItemTotal,
} from '@/components/ecomcn/cart-line-item'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { CartLineView } from '../../lib/shopCart'
import { SHOP_NUMBER_LOCALE, shopCountLabel } from '../../lib/shopFormat'
import { ISSUE_KEYS, ShopCartError, toCartLine, useShopCart } from './ShopCart'

/**
 * The cart page (`/{site}/cart`): every line with quantity, remove (with undo),
 * the buyer's personalization and a way to edit it, problems per line, and the
 * subtotal priced by the server. Checkout joins in Phase 4; until then no
 * checkout button is shown.
 */

function EditPersonalization({ line }: { line: CartLineView }) {
  const t = useT()
  const { update } = useShopCart()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [failure, setFailure] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const start = () => {
    setValues(Object.fromEntries(line.personalization.map((field) => [field.code, field.value])))
    setErrors({})
    setFailure(null)
    setOpen(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const personalization = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()))
      await update(line.id, { personalization })
      setOpen(false)
    } catch (err) {
      if (err instanceof ShopCartError) {
        setErrors(err.fieldErrors)
        setFailure(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={start}>
        {t('storefront.shop.cart.editDetails', 'Edit details')}
        <span className="sr-only">: {line.title}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('storefront.shop.cart.closeDialog', 'Close')}>
          <form onSubmit={save} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('storefront.shop.cart.editTitle', 'Your details for {name}', { name: line.title ?? '' })}</DialogTitle>
              <DialogDescription>{t('storefront.shop.cart.editDescription', 'Printed or prepared exactly as you write it.')}</DialogDescription>
            </DialogHeader>
            {line.personalization.map((field) => {
              const id = `sf-edit-${line.id}-${field.code}`
              const error = errors[`personalization.${field.code}`]
              const Control = field.inputType === 'textarea' ? Textarea : Input
              return (
                <div key={field.code} className="flex flex-col gap-1.5">
                  <Label htmlFor={id}>
                    {field.label}
                    {field.required ? <span aria-hidden="true"> *</span> : null}
                  </Label>
                  <Control
                    id={id}
                    required={field.required}
                    value={values[field.code] ?? ''}
                    aria-invalid={error ? true : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [field.code]: event.target.value }))}
                  />
                  {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>
              )
            })}
            {failure ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? t('storefront.shop.cart.saving', 'Saving…') : t('storefront.shop.cart.save', 'Save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ShopCartPage({ shopHref, title }: { shopHref: string; title: string }) {
  const t = useT()
  const { cart, ready, failed, update, remove } = useShopCart()
  const [failure, setFailure] = React.useState<string | null>(null)
  const report = (err: unknown) => {
    setFailure(err instanceof Error ? err.message : t('storefront.shop.errors.failed', 'Something went wrong. Try again.'))
    throw err
  }
  const blocked = cart.lines.some((line) => line.issues.length)

  return (
    <section className="sf-section">
      <div className="sf-container sf-cart">
        <h1 className="sf-section-title">{title}</h1>
        {!ready ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">{t('storefront.shop.cart.loading', 'Loading your cart')}</span>
          </div>
        ) : failed ? (
          <Alert variant="destructive">
            <AlertDescription>{t('storefront.shop.cart.loadFailed', 'Your cart could not be loaded. Refresh the page to try again.')}</AlertDescription>
          </Alert>
        ) : !cart.lines.length ? (
          <div className="flex flex-col items-start gap-4 py-8">
            <p className="text-xl">{t('storefront.shop.cart.empty', 'Your cart is empty.')}</p>
            <Button asChild>
              <a href={shopHref}>{t('storefront.shop.cart.continue', 'Continue shopping')}</a>
            </Button>
          </div>
        ) : (
          <div className="sf-cart-layout">
            <ul className="border-t" role="list">
              {cart.lines.map((line) => (
                <CartLineItem
                  key={line.id}
                  line={toCartLine(line, t)}
                  currency={cart.currencyCode ?? 'YER'}
                  locale={SHOP_NUMBER_LOCALE}
                  onQuantityChange={(quantity) => update(line.id, { quantity }).catch(report)}
                  onRemove={() => remove(line.id).catch(report)}
                >
                  <CartLineItemMedia />
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <CartLineItemInfo />
                      <CartLineItemTotal />
                    </div>
                    {line.issues.length ? (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {line.issues.map((issue) => t(...ISSUE_KEYS[issue])).join(' · ')}
                          {' — '}
                          {t('storefront.shop.cart.removeToContinue', 'remove it to continue.')}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {line.personalization.length && !line.issues.includes('unavailable') ? <EditPersonalization line={line} /> : null}
                    <CartLineItemActions />
                  </div>
                </CartLineItem>
              ))}
            </ul>
            <aside className="sf-cart-summary rounded-md border p-5" aria-label={t('storefront.shop.cart.summary', 'Summary')}>
              <p className="flex items-baseline justify-between gap-4">
                <span>{t('storefront.shop.cart.subtotalOf', 'Subtotal ({items})', { items: shopCountLabel(t, 'items', cart.count) })}</span>
                <span className="text-xl tabular-nums" aria-live="polite">
                  {cart.subtotal?.formatted ?? '—'}
                </span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{t('storefront.shop.cart.note', 'Delivery is priced at checkout for your address.')}</p>
              {blocked ? (
                <p className="mt-3 text-sm text-destructive">{t('storefront.shop.cart.blocked', 'Some items cannot be ordered. Remove them first.')}</p>
              ) : null}
            </aside>
          </div>
        )}
        {failure ? (
          <Alert variant="destructive" className="mt-4" aria-live="polite">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  )
}
