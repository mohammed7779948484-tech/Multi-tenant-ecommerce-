'use client'

import * as React from 'react'
import { ShoppingBag } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CartSheet, CartSheetContent, CartSheetTrigger } from '@/components/ecomcn/cart-sheet'
import { Button } from '@/components/ui/button'
import type { CartLine } from '@/components/ecomcn/cart-line-item'
import type { CartLineView, CartView } from '../../lib/shopCart'
import { formatShopNumber, SHOP_NUMBER_LOCALE, shopCountLabel } from '../../lib/shopFormat'

/**
 * The buyer's cart on the client (shopping-journey spec REQ-006): one provider
 * per store page, the header bag button with its count, and the cart sheet.
 * Every change goes to the server, which answers with the whole cart priced
 * now; the client never computes a price it keeps.
 */

const EMPTY: CartView = { lines: [], subtotal: null, currencyCode: null, count: 0, updatedAt: null }

/** A refusal from the cart API, in Arabic, with field errors keyed like `personalization.recipient`. */
export class ShopCartError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly fieldErrors: Record<string, string>,
  ) {
    super(message)
  }
}

export type AddLineInput = { productId: string; variantId?: string | null; quantity: number; personalization?: Record<string, string> }

type ShopCartContextValue = {
  cart: CartView
  /** False until the first read answered. */
  ready: boolean
  /** Set when the cart could not be read; the count is hidden and the sheet offers a retry. */
  failed: boolean
  /** Reads the cart again (the retry after a failed read). */
  reload: () => Promise<void>
  open: boolean
  setOpen: (open: boolean) => void
  add: (input: AddLineInput) => Promise<void>
  update: (lineId: string, input: { quantity?: number; personalization?: Record<string, string> }) => Promise<void>
  remove: (lineId: string) => Promise<void>
}

const ShopCartContext = React.createContext<ShopCartContextValue | null>(null)

export function useShopCart(): ShopCartContextValue {
  const context = React.useContext(ShopCartContext)
  if (!context) throw new Error('[internal] useShopCart must be used within <ShopCartProvider>')
  return context
}

export function ShopCartProvider({ siteSlug, children }: { siteSlug: string; children: React.ReactNode }) {
  const t = useT()
  const base = `/api/storefront/shop/${encodeURIComponent(siteSlug)}/cart`
  const [cart, setCart] = React.useState<CartView>(EMPTY)
  const [ready, setReady] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  // Once an answer set the cart cookie, a later write without it means cookies are blocked.
  const cookieSet = React.useRef(false)
  // Answers can arrive out of order (a slow first read after a quick add): only a newer request's answer is shown.
  const issued = React.useRef(0)
  const shown = React.useRef(0)

  const request = React.useCallback(
    async (path: string, init: RequestInit = {}) => {
      const sequence = ++issued.current
      const headers: Record<string, string> = { 'x-om-unauthorized-redirect': '0', 'content-type': 'application/json' }
      if (cookieSet.current) headers['x-sf-cart-expected'] = '1'
      const call = await apiCall<CartView & { error?: string; code?: string; fieldErrors?: Record<string, string> }>(`${base}${path}`, {
        ...init,
        headers,
        credentials: 'same-origin',
      })
      const body = call.result
      if (!call.ok || !body || !Array.isArray(body.lines)) {
        throw new ShopCartError(body?.error ?? t('storefront.shop.errors.failed', 'Something went wrong. Try again.'), body?.code ?? null, body?.fieldErrors ?? {})
      }
      if (init.method && init.method !== 'GET') cookieSet.current = true
      if (sequence > shown.current) {
        shown.current = sequence
        setCart(body)
        setFailed(false)
      }
      return body
    },
    [base, t],
  )

  const reload = React.useCallback(async () => {
    const sequence = issued.current + 1
    try {
      await request('')
    } catch {
      // A failed read only matters when nothing newer answered meanwhile.
      if (shown.current < sequence) setFailed(true)
    } finally {
      setReady(true)
    }
  }, [request])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const value = React.useMemo<ShopCartContextValue>(
    () => ({
      cart,
      ready,
      failed,
      reload,
      open,
      setOpen,
      add: async (input) => {
        await request('/lines', { method: 'POST', body: JSON.stringify(input) })
        setOpen(true)
      },
      update: async (lineId, input) => {
        await request(`/lines/${encodeURIComponent(lineId)}`, { method: 'PATCH', body: JSON.stringify(input) })
      },
      remove: async (lineId) => {
        await request(`/lines/${encodeURIComponent(lineId)}`, { method: 'DELETE' })
      },
    }),
    [cart, ready, failed, reload, open, request],
  )
  return <ShopCartContext.Provider value={value}>{children}</ShopCartContext.Provider>
}

export const ISSUE_KEYS: Record<CartLineView['issues'][number], [string, string]> = {
  unavailable: ['storefront.shop.cart.issueUnavailable', 'No longer available'],
  noPrice: ['storefront.shop.cart.issueNoPrice', 'Not for sale right now'],
  outOfStock: ['storefront.shop.cart.issueOutOfStock', 'Not enough in stock'],
  currency: ['storefront.shop.cart.issueCurrency', 'Priced in another currency'],
}

/** A cart line for the ecomcn blocks: options, personalization and problems as one line of text. */
export function toCartLine(line: CartLineView, t: ReturnType<typeof useT>): CartLine {
  const details = [
    line.variantLabel,
    ...line.personalization.filter((field) => field.value).map((field) => `${field.label}: ${field.value}`),
    ...line.issues.map((issue) => t(...ISSUE_KEYS[issue])),
  ].filter(Boolean)
  return {
    id: line.id,
    name: line.title ?? t('storefront.shop.cart.goneProduct', 'A product that is no longer sold'),
    href: line.href ?? undefined,
    variant: details.length ? details.join(' · ') : undefined,
    // eslint-disable-next-line @next/next/no-img-element -- served by the store's media route
    image: line.image ? <img src={line.image} alt={line.title ?? ''} className="size-full object-cover" /> : undefined,
    // Lines that cannot be bought do not count towards the subtotal.
    unitPrice: line.issues.length ? 0 : (line.unitPrice?.amount ?? 0),
    quantity: line.quantity,
    maxQuantity: line.maxQuantity,
  }
}

/** The header bag button with the cart sheet (opens from the end edge: left in Arabic). */
export function StoreCartSheet({ cartHref, shopHref }: { cartHref: string; shopHref: string }) {
  const t = useT()
  const { cart, ready, failed, reload, open, setOpen, update, remove } = useShopCart()
  const lines = React.useMemo(() => cart.lines.map((line) => toCartLine(line, t)), [cart.lines, t])
  return (
    <CartSheet
      lines={lines}
      currency={cart.currencyCode ?? 'YER'}
      locale={SHOP_NUMBER_LOCALE}
      open={open}
      onOpenChange={setOpen}
      onQuantityChange={(id, quantity) => update(id, { quantity })}
      onRemove={(id) => remove(id)}
      viewBagHref={cartHref}
      countLabel={(count) => t('storefront.shop.cart.button', 'Cart: {items}', { items: shopCountLabel(t, 'items', count) })}
      title={t('storefront.shop.cart.title', 'Your cart')}
      note={t('storefront.shop.cart.note', 'Delivery is priced at checkout for your address.')}
      loading={!ready}
      error={
        failed ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm">{t('storefront.shop.cart.loadFailed', 'Your cart could not be loaded.')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
              {t('storefront.shop.cart.retry', 'Try again')}
            </Button>
          </div>
        ) : null
      }
      empty={
        <a href={shopHref} className="text-sm underline underline-offset-4">
          {t('storefront.shop.cart.continue', 'Continue shopping')}
        </a>
      }
    >
      <CartSheetTrigger className="sf-cart-trigger rounded-md">
        <ShoppingBag aria-hidden className="size-4" />
        {failed ? null : <span className="tabular-nums">{formatShopNumber(cart.count)}</span>}
      </CartSheetTrigger>
      <CartSheetContent />
    </CartSheet>
  )
}
