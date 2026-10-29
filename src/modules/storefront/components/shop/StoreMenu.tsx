'use client'

import * as React from 'react'
import { MenuIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { ShopNavLink } from '../../lib/shopNav'

export type StoreMenuProps = {
  storeName: string
  /** Home first, then the store's published pages. */
  links: ShopNavLink[]
  labels: { open: string; close: string; description: string; nav: string }
}

/**
 * The store's menu: a shadcn sheet that slides in from the reading start (the
 * right edge in Arabic). The sheet is configured for RTL (`components.json`
 * `rtl: true`), so `side="left"` means the start edge, not the physical left.
 */
export function StoreMenu({ storeName, links, labels }: StoreMenuProps) {
  const pathname = usePathname()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="sf-menu-trigger" aria-label={labels.open}>
          <MenuIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" closeLabel={labels.close} className="gap-0">
        <SheetHeader className="pe-12">
          <SheetTitle className="text-lg">{storeName}</SheetTitle>
          <SheetDescription className="sr-only">{labels.description}</SheetDescription>
        </SheetHeader>
        <Separator />
        <nav aria-label={labels.nav} className="overflow-y-auto p-2">
          <ul className="flex flex-col gap-1" role="list">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className="sf-menu-link block rounded-md px-3 py-2.5 text-base font-medium hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
