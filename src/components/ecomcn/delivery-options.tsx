"use client"

import * as React from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { cn } from "@/lib/utils"

/*
 * How it gets there: one ruled list of delivery methods, each with the
 * dates it would arrive and what it costs.
 *
 *   <DeliveryOptions options={options} value={method} onValueChange={setMethod} />
 *
 * Arrival is a date range — "Thu 16 – Mon 20 Oct" — worked out from
 * business days and a dispatch cut-off on the shopper's own clock, after
 * hydration (the server can't know their time zone); until then each row
 * holds a placeholder of the same height. Prices sit right-aligned in
 * tabular figures, and a free method says "Free" in words. The heavy rule
 * slides to the chosen method (Motion; a fade under reduced motion).
 */

export interface DeliveryOption {
  id: string
  /** "Standard", "Express", "Collect in store". */
  label: string
  /** 0 shows "Free". */
  price: number
  /** The price as your server formatted it; shown instead of formatting `price` here. */
  priceLabel?: string
  /** Business days from dispatch to the door, at the soonest and the latest. Leave out to show no arrival dates. */
  minDays?: number
  maxDays?: number
  /** Orders before this hour (0–23, the shopper's clock) dispatch the same day. */
  cutoffHour?: number
  /** Skip Saturdays and Sundays. Defaults to true. */
  businessDaysOnly?: boolean
  /** "Tracked, signed for", or a collection point's address. */
  description?: React.ReactNode
  /** False when it can't reach this address. */
  available?: boolean
  /** Why, in words: "Not available for PO boxes". */
  unavailableReason?: string
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

const subscribeNothing = () => () => {}

/** Your locale, or the visitor's once hydrated — so server and client HTML agree. */
function useFormatLocale(locale?: string) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  return locale ?? (hydrated ? undefined : "en-US")
}

const subscribeMinute = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 30_000)
  return () => window.clearInterval(timer)
}
const currentMinute = () => Math.floor(Date.now() / 60_000)
const serverMinute = () => null

/** `days` business (or calendar) days after `from`. */
function addDays(from: Date, days: number, businessOnly: boolean) {
  const date = new Date(from)
  let left = days
  while (left > 0) {
    date.setDate(date.getDate() + 1)
    const day = date.getDay()
    if (!businessOnly || (day !== 0 && day !== 6)) left -= 1
  }
  return date
}

/** When an option would arrive if ordered at `now`, and how long is left to dispatch today. */
export function deliveryWindow(option: DeliveryOption, now: Date) {
  const businessOnly = option.businessDaysOnly ?? true
  const cutoff = option.cutoffHour
  // Past the cut-off, or on a day nothing dispatches: it goes out next working day.
  let dispatch = new Date(now)
  let minutesLeft: number | null = null
  const closed = businessOnly && (now.getDay() === 0 || now.getDay() === 6)
  if (closed || (cutoff !== undefined && now.getHours() >= cutoff)) {
    dispatch = addDays(now, 1, businessOnly)
  } else if (cutoff !== undefined) {
    minutesLeft = cutoff * 60 - (now.getHours() * 60 + now.getMinutes())
  }
  return {
    first: addDays(dispatch, option.minDays ?? 0, businessOnly),
    last: addDays(dispatch, option.maxDays ?? option.minDays ?? 0, businessOnly),
    minutesLeft,
  }
}

export interface DeliveryOptionsProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "onChange" | "defaultValue" | "name"> {
  options: DeliveryOption[]
  value: string | null
  onValueChange: (id: string) => void
  currency?: string
  /** `undefined` follows the visitor's locale, once hydrated. */
  locale?: string
  /** "Delivery", by default. */
  legend?: React.ReactNode
  /** Keeps the legend for screen readers when your page already has a heading. */
  hideLegend?: boolean
  /** The radio group's name, for a plain form post. */
  name?: string
  /** The options aren't known yet — rates are still being fetched for the address. */
  loading?: boolean
  disabled?: boolean
}

export function DeliveryOptions({
  options,
  value,
  onValueChange,
  currency = "USD",
  locale: localeProp,
  legend: legendProp,
  hideLegend = false,
  name,
  loading = false,
  disabled = false,
  className,
  ...props
}: DeliveryOptionsProps) {
  const t = useT()
  const legend = legendProp ?? t("ecomcn.delivery.legend", "Delivery")
  const locale = useFormatLocale(localeProp)
  const reduce = useReducedMotion()
  const uid = React.useId()
  const minute = React.useSyncExternalStore(subscribeMinute, currentMinute, serverMinute)
  const money = React.useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency }), [locale, currency])
  const dates = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }),
    [locale]
  )

  return (
    <MotionConfig reducedMotion="user">
      <fieldset data-slot="delivery-options" aria-busy={loading || undefined} className={cn("min-w-0", className)} {...props}>
        <legend id={`${uid}-legend`} className={cn("mb-3 text-base font-medium", hideLegend && "sr-only")}>
          {legend}
        </legend>
        {loading ? (
          <div data-slot="delivery-options-skeleton" className="border">
            <span className="sr-only" role="status">
              {t("ecomcn.delivery.loading", "Loading delivery options")}
            </span>
            {[0, 1, 2].map((row) => (
              <div key={row} aria-hidden className="flex min-h-16 items-center gap-4 border-t px-4 py-3.5 first:border-t-0">
                <Skeleton className="size-4 rounded-full" />
                <span className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-28 rounded-none" />
                  <Skeleton className="h-3 w-44 rounded-none" />
                </span>
                <Skeleton className="h-3.5 w-12 rounded-none" />
              </div>
            ))}
          </div>
        ) : options.length === 0 ? (
          <p data-slot="delivery-options-empty" className="border px-4 py-5 text-sm text-muted-foreground">
            {t("ecomcn.delivery.none", "Nothing can be delivered to this address yet. Check the address, or contact us.")}
          </p>
        ) : (
          <RadioGroup
            value={value ?? ""}
            onValueChange={(next: unknown) => onValueChange(String(next))}
            name={name}
            disabled={disabled}
            aria-labelledby={`${uid}-legend`}
            className="gap-0 border"
          >
            {options.map((option) => {
              const selected = value === option.id
              const unavailable = option.available === false
              const dated = option.minDays !== undefined
              const when = minute === null || unavailable || !dated ? null : deliveryWindow(option, new Date(minute * 60_000))
              const arrival = when
                ? option.minDays === option.maxDays
                  ? dates.format(when.first)
                  : dates.formatRange(when.first, when.last)
                : null
              const left = selected && when?.minutesLeft != null ? when.minutesLeft : null
              const noteId = `${uid}-${option.id}-note`
              return (
                <label
                  key={option.id}
                  data-slot="delivery-option"
                  data-state={selected ? "checked" : "unchecked"}
                  data-unavailable={unavailable || undefined}
                  className={cn(
                    "relative flex min-h-16 cursor-pointer items-center gap-4 border-t px-4 py-3.5 transition-colors first:border-t-0",
                    selected ? "bg-secondary/50" : "hover:bg-secondary/30",
                    (unavailable || disabled) && "cursor-not-allowed hover:bg-transparent"
                  )}
                >
                  {selected ? (
                    <motion.span
                      aria-hidden
                      layoutId={reduce ? undefined : `${uid}-rule`}
                      transition={MORPH}
                      className="absolute inset-y-0 -start-px w-0.5 bg-foreground"
                    />
                  ) : null}
                  <RadioGroupItem value={option.id} disabled={unavailable || disabled} aria-describedby={noteId} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn("text-sm font-medium", unavailable && "text-muted-foreground line-through decoration-1")}>
                      {option.label}
                    </span>
                    <span id={noteId} className="flex flex-col text-[13px] leading-snug text-muted-foreground">
                      {unavailable ? (
                        (option.unavailableReason ?? t("ecomcn.delivery.unavailable", "Not available for this address"))
                      ) : arrival ? (
                        <span>
                          {t("ecomcn.delivery.arrives", "Arrives")} <span className="text-foreground tabular-nums">{arrival}</span>
                        </span>
                      ) : !dated ? null : (
                        // The shopper's dates arrive with hydration; hold the line's height till then.
                        <span aria-hidden className="my-1 h-3 w-40 animate-pulse bg-muted" />
                      )}
                      {left !== null ? (
                        <span className="tabular-nums">
                          {t("ecomcn.delivery.cutoff", "Order within {hours}h {minutes}m for dispatch today", { hours: Math.floor(left / 60), minutes: String(left % 60).padStart(2, "0") })}
                        </span>
                      ) : null}
                      {!unavailable && option.description ? <span>{option.description}</span> : null}
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-sm tabular-nums", unavailable && "text-muted-foreground")}>
                    {option.price === 0 ? t("ecomcn.delivery.free", "Free") : (option.priceLabel ?? money.format(option.price))}
                  </span>
                </label>
              )
            })}
          </RadioGroup>
        )}
      </fieldset>
    </MotionConfig>
  )
}
