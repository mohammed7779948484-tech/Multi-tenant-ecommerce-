'use client'

import * as React from 'react'
import { Direction } from 'radix-ui'
import { I18nProvider, type Dict } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { PortalContainerProvider } from '@/components/ui/portal-container'
import { ShopCartProvider } from './ShopCart'

export type ShopProvidersProps = {
  /** Store pages are right-to-left; the builder preview inherits this too. */
  dir: 'rtl' | 'ltr'
  /** Buyer-page dictionary (Arabic). The builder preview passes none and keeps the admin's. */
  i18n?: { locale: Locale; dict: Dict }
  /** Public store pages: the buyer cart of this store. */
  cart?: { siteSlug: string }
  children: React.ReactNode
}

/**
 * Client context for everything inside a store root:
 * - Radix reads the direction from `Direction.Provider` (sheets, and later
 *   selects, toggle groups and carousels);
 * - client components translate with the buyer dictionary;
 * - portalled shadcn components mount in `[data-sf-portal]`, inside the
 *   themed, right-to-left store root, so overlays wear the merchant's theme.
 */
export function ShopProviders({ dir, i18n, cart, children }: ShopProvidersProps) {
  const [portal, setPortal] = React.useState<HTMLDivElement | null>(null)
  const content = (
    <Direction.Provider dir={dir}>
      <PortalContainerProvider container={portal}>
        {children}
        <div data-sf-portal="" ref={setPortal} />
      </PortalContainerProvider>
    </Direction.Provider>
  )
  const withCart = cart ? <ShopCartProvider siteSlug={cart.siteSlug}>{content}</ShopCartProvider> : content
  if (!i18n) return withCart
  return (
    <I18nProvider locale={i18n.locale} dict={i18n.dict}>
      {withCart}
    </I18nProvider>
  )
}
