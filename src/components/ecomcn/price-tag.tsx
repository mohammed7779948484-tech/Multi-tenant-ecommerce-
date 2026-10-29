"use client"

import * as React from "react"

import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

const subscribeNothing = () => () => {}

/**
 * Your locale, or the visitor's once hydrated. The server can't know the
 * visitor's locale, and its HTML must match the first client render — a
 * server in en-IN prints "1,24,000" where an en-US browser prints
 * "124,000" — so until hydration it formats in en-US.
 */
function useFormatLocale(locale?: string) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  return locale ?? (hydrated ? undefined : "en-US")
}

export interface PriceTagProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current price, in major units (e.g. 42.5 for $42.50). */
  price: number
  /** Was-price. Rendered struck through only when it is higher than `price`. */
  compareAt?: number
  /** ISO 4217 code. Never hardcode a symbol — stores are not all in the US. */
  currency?: string
  /** BCP 47 tag. `undefined` follows the visitor's locale, once hydrated. */
  locale?: string
  size?: "sm" | "lg"
  /**
   * Already-formatted prices (e.g. from the server). When given they are shown
   * as-is, so the HTML never depends on the browser's locale data matching the
   * server's at hydration.
   */
  text?: { price: string; compareAt?: string }
}

/**
 * The single most-copied component in any storefront, and the one most often
 * shipped with a hardcoded dollar sign. Everything here goes through Intl.
 */
export const PriceTag = React.forwardRef<HTMLDivElement, PriceTagProps>(
  (
    { price, compareAt, currency = "USD", locale: localeProp, size = "lg", text, className, ...props },
    ref
  ) => {
    const t = useT()
    const locale = useFormatLocale(localeProp)
    const format = React.useMemo(
      () =>
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: Number.isInteger(price) ? 0 : 2,
        }),
      [locale, currency, price]
    )

    const show = (value: number, preset?: string) => preset ?? format.format(value)
    const onSale = typeof compareAt === "number" && compareAt > price
    const percentOff = onSale ? Math.round((1 - price / compareAt) * 100) : 0

    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}
        {...props}
      >
        <span
          className={cn(
            "tabular-nums",
            size === "lg" ? "text-3xl" : "text-lg",
            onSale && "text-[var(--sale)]"
          )}
        >
          {show(price, text?.price)}
        </span>

        {onSale ? (
          <>
            <span
              aria-hidden
              className="text-sm text-muted-foreground line-through tabular-nums"
            >
              {show(compareAt, text?.compareAt)}
            </span>
            <span
              aria-hidden
              className="bg-[var(--sale)] px-1.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-background tabular-nums"
            >
              {t("ecomcn.priceTag.save", "Save {percent}%", { percent: percentOff })}
            </span>
            {/* one clean announcement instead of three fragments */}
            <span className="sr-only">
              {t("ecomcn.priceTag.reduced", "Reduced from {price}, {percent} percent off", { price: show(compareAt, text?.compareAt), percent: percentOff })}
            </span>
          </>
        ) : null}
      </div>
    )
  }
)
PriceTag.displayName = "PriceTag"
