"use client"

import * as React from "react"
import { Check, Link2, Printer } from "lucide-react"
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { cn } from "@/lib/utils"

/*
 * The page after Pay: the receipt people screenshot, print and come back to.
 *
 *   <OrderConfirmation order={order} permalink={`https://shop.example/orders/${order.number}?t=${token}`} />
 *
 *   <OrderConfirmation order={order}>                         or composed
 *     <OrderConfirmationHeader />
 *     <OrderConfirmationFacts />
 *     <OrderConfirmationItems />
 *   </OrderConfirmation>
 *
 * The thank-you is set large in your serif on a grained band — the one
 * moment in the funnel that earns a flourish — with a check that draws
 * itself (Motion; none under reduced motion). Everything a shopper looks
 * for sits above the fold: the order number, the date, when it arrives,
 * what was paid. It prints as a plain receipt — no band, no buttons, black
 * on white, the permalink written out — and `permalink` is a link that
 * shows this order again from any device: give it a token, never session
 * state. Calendar dates (arrival) are shown in UTC so they never slip a
 * day; the placed time is the visitor's own once hydrated. A date range is
 * two formatted days joined with a dash, not `formatRange`: its spacing
 * differs between Node's ICU and the browser's, and the server's HTML has
 * to match the first client render exactly.
 */

export interface ConfirmationLine {
  id: string
  name: string
  /** "Tan · EU 42". */
  variant?: string
  quantity: number
  unitPrice: number
  /** Already rendered, so the block never assumes next/image. */
  image?: React.ReactNode
}

export interface OrderConfirmationData {
  /** What the shopper quotes to support: "ATL-77760". */
  number: string
  /** ISO timestamp the order was placed. */
  placedAt: string
  /** Where the confirmation email went. */
  email?: string
  lines: ConfirmationLine[]
  /** `fees`: payment-method fees, such as a cash-on-delivery charge. */
  totals: { subtotal: number; discount?: number; shipping: number; fees?: number; tax?: number; total: number }
  /** The address as display lines — `formatAddressLines` from address-form gives these. */
  shipTo?: string[]
  delivery?: {
    /** "Express". */
    label: string
    /** Calendar dates, "2026-10-21": the window it should arrive in. */
    from?: string
    to?: string
  }
  /** "Visa ending 4242", "Pay in 3". */
  payment?: string
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

const subscribeNothing = () => () => {}

/** True once hydrated: the server can't know the visitor's locale or time zone. */
function useHydrated() {
  return React.useSyncExternalStore(subscribeNothing, () => true, () => false)
}

/** Film grain as an inline SVG: no image request, and it prints as nothing. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")"

/* ─── context ──────────────────────────────────────────────────────────── */

export interface OrderConfirmationContextValue {
  order: OrderConfirmationData
  formatMoney: (amount: number) => string
  /** "Wed, Oct 21" — a calendar date, in UTC so it never slips a day. */
  formatDay: (isoDate: string) => string
  /** "Wed, Oct 21 – Fri, Oct 23", or one day when they match. */
  formatWindow: (from: string, to?: string) => string
  /** When it was placed: the visitor's date and time once hydrated, UTC before. */
  formatPlaced: (isoTimestamp: string) => string
  permalink?: string
  title: React.ReactNode
  actions?: React.ReactNode
  totalLabel: string
  /** Quantities in the same numerals as the money. */
  formatCount: (count: number) => string
}

const OrderConfirmationContext = React.createContext<OrderConfirmationContextValue | null>(null)

export function useOrderConfirmation() {
  const context = React.useContext(OrderConfirmationContext)
  if (!context) {
    throw new Error("useOrderConfirmation must be used within <OrderConfirmation>.")
  }
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface OrderConfirmationProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  order?: OrderConfirmationData
  currency?: string
  /** `undefined` follows the visitor's locale, once hydrated. */
  locale?: string
  /** "Thank you for your order", by default — "Thank you, Ada." reads warmer. */
  title?: React.ReactNode
  /** A link that shows this order again from any device. Adds "Copy link", and prints. */
  permalink?: string
  /** Formats an amount; defaults to `Intl.NumberFormat` in `currency` (a store may format its prices on its own terms). */
  formatMoney?: (amount: number) => string
  /** The term for the total: "Paid" by default; "Total" when payment is still due. */
  totalLabel?: string
  /** What next: "Continue shopping", "Track your order". Hidden in print. */
  actions?: React.ReactNode
  /** The order is still loading — from the permalink, say. */
  loading?: boolean
  children?: React.ReactNode
}

export function OrderConfirmation({
  order,
  currency = "USD",
  locale: localeProp,
  title: titleProp,
  permalink,
  formatMoney: formatMoneyProp,
  totalLabel: totalLabelProp,
  actions,
  loading = false,
  className,
  children,
  ...props
}: OrderConfirmationProps) {
  const t = useT()
  const title = titleProp ?? t("ecomcn.confirmation.title", "Thank you for your order")
  const totalLabel = totalLabelProp ?? t("ecomcn.confirmation.paid", "Paid")
  const hydrated = useHydrated()
  const locale = localeProp ?? (hydrated ? undefined : "en-US")
  const timeZone = hydrated ? undefined : "UTC"

  const money = React.useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency }), [locale, currency])
  const day = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
    [locale]
  )
  const counts = React.useMemo(() => new Intl.NumberFormat(locale), [locale])
  const placed = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }),
    [locale, timeZone]
  )

  const context = React.useMemo<OrderConfirmationContextValue | null>(
    () =>
      order
        ? {
            order,
            formatMoney: formatMoneyProp ?? ((amount) => money.format(amount)),
            formatDay: (iso) => day.format(new Date(`${iso}T00:00:00Z`)),
            formatWindow: (from, to) =>
              !to || to === from
                ? day.format(new Date(`${from}T00:00:00Z`))
                : `${day.format(new Date(`${from}T00:00:00Z`))} – ${day.format(new Date(`${to}T00:00:00Z`))}`,
            formatPlaced: (iso) => placed.format(new Date(iso)),
            formatCount: (count) => counts.format(count),
            permalink,
            title,
            totalLabel,
            actions,
          }
        : null,
    [order, money, formatMoneyProp, day, placed, counts, permalink, title, totalLabel, actions]
  )

  return (
    <MotionConfig reducedMotion="user">
      <article
        data-slot="order-confirmation"
        aria-busy={loading || undefined}
        className={cn("flex flex-col gap-10 print:gap-6 print:bg-white print:text-black", className)}
        {...props}
      >
        {loading || !context ? (
          <OrderConfirmationSkeleton />
        ) : (
          <OrderConfirmationContext.Provider value={context}>
            {children ?? (
              <>
                <OrderConfirmationHeader />
                <OrderConfirmationFacts />
                <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-14 print:grid-cols-[minmax(0,1fr)_16rem] print:gap-8">
                  <OrderConfirmationItems />
                  <OrderConfirmationDetails />
                </div>
                <OrderConfirmationActions />
              </>
            )}
          </OrderConfirmationContext.Provider>
        )}
      </article>
    </MotionConfig>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

/** The band: a check that draws itself, the order number, and the thank-you. */
export function OrderConfirmationHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  const t = useT()
  const { order, title } = useOrderConfirmation()
  const reduce = useReducedMotion()
  return (
    <header
      data-slot="order-confirmation-header"
      className={cn(
        "relative isolate overflow-hidden border bg-secondary/60 px-6 py-10 sm:px-10 sm:py-14",
        "print:border-0 print:bg-transparent print:p-0",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.12] mix-blend-multiply dark:opacity-[0.08] dark:mix-blend-screen print:hidden"
        style={{ backgroundImage: GRAIN }}
      />
      <p className="flex items-center gap-3 text-xs tracking-[0.18em] text-muted-foreground uppercase print:text-black">
        <span className="grid size-7 place-items-center rounded-full bg-foreground text-background print:hidden">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <motion.path
              d="M5 12.5 10 17 19 7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ ...MORPH, delay: 0.15 }}
            />
          </svg>
        </span>
        <span>
          {t("ecomcn.confirmation.confirmed", "Order confirmed")} · <span className="text-foreground tabular-nums print:text-black">{order.number}</span>
        </span>
      </p>
      <h1 className="mt-5 font-serif text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl print:text-3xl">{title}</h1>
      {order.email ? (
        <p className="mt-4 max-w-prose text-sm text-muted-foreground print:text-black">
          {t("ecomcn.confirmation.emailed", "A confirmation is on its way to")} <span className="text-foreground print:text-black">{order.email}</span>.
        </p>
      ) : null}
    </header>
  )
}

/** The four things people look for, in a ruled row: number, placed, arrives, paid. */
export function OrderConfirmationFacts({ className, ...props }: React.HTMLAttributes<HTMLDListElement>) {
  const t = useT()
  const { order, formatMoney, formatWindow, formatPlaced, totalLabel } = useOrderConfirmation()
  const facts: { term: string; value: React.ReactNode }[] = [
    { term: t("ecomcn.confirmation.number", "Order number"), value: <span className="tabular-nums">{order.number}</span> },
    {
      term: t("ecomcn.confirmation.placed", "Placed"),
      // UTC on the server, the visitor's zone right after hydration; React
      // keeps the server's text for that first pass, then the client's.
      value: (
        <time dateTime={order.placedAt} suppressHydrationWarning>
          {formatPlaced(order.placedAt)}
        </time>
      ),
    },
  ]
  if (order.delivery?.from) {
    facts.push({
      term: t("ecomcn.confirmation.arrives", "Arrives"),
      value: <time dateTime={order.delivery.from}>{formatWindow(order.delivery.from, order.delivery.to)}</time>,
    })
  }
  facts.push({ term: totalLabel, value: <span className="tabular-nums">{formatMoney(order.totals.total)}</span> })

  return (
    <dl
      data-slot="order-confirmation-facts"
      className={cn("grid grid-cols-2 border-y sm:grid-cols-4 print:grid-cols-4", className)}
      {...props}
    >
      {facts.map((fact, i) => (
        <div
          key={fact.term}
          className={cn("flex flex-col gap-1.5 p-4", i % 2 === 1 && "border-s", i >= 2 && "max-sm:border-t sm:border-s")}
        >
          <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase print:text-black">{fact.term}</dt>
          <dd className="text-sm font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** What was bought, as a ledger, and the totals under it. */
export function OrderConfirmationItems({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  const t = useT()
  const { order, formatMoney, totalLabel, formatCount } = useOrderConfirmation()
  const headingId = React.useId()
  const count = order.lines.reduce((n, l) => n + l.quantity, 0)
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: t("ecomcn.confirmation.subtotal", "Subtotal"), value: formatMoney(order.totals.subtotal) },
  ]
  if (order.totals.discount) rows.push({ label: t("ecomcn.confirmation.discount", "Discount"), value: `−${formatMoney(order.totals.discount)}` })
  rows.push({ label: t("ecomcn.confirmation.shipping", "Shipping"), value: order.totals.shipping === 0 ? t("ecomcn.delivery.free", "Free") : formatMoney(order.totals.shipping) })
  if (order.totals.fees) rows.push({ label: t("ecomcn.confirmation.fees", "Fees"), value: formatMoney(order.totals.fees) })
  if (order.totals.tax !== undefined) rows.push({ label: t("ecomcn.confirmation.tax", "Tax"), value: formatMoney(order.totals.tax) })

  return (
    <section data-slot="order-confirmation-items" aria-labelledby={headingId} className={className} {...props}>
      <h2 id={headingId} className="text-xs tracking-[0.14em] text-muted-foreground uppercase print:text-black">
        {t("ecomcn.confirmation.items", "{count} items", { count: formatCount(count) })}
      </h2>
      {order.lines.length === 0 ? (
        <p className="mt-3 border-t py-4 text-sm text-muted-foreground">{t("ecomcn.confirmation.noItems", "No items on this order.")}</p>
      ) : (
        <ul className="mt-3 border-t">
          {order.lines.map((line) => (
            <li key={line.id} className="flex gap-4 border-b py-4 break-inside-avoid">
              {line.image ? (
                <div className="relative size-16 shrink-0 overflow-hidden bg-secondary print:size-12">{line.image}</div>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                <span className="font-medium">{line.name}</span>
                {line.variant ? <span className="text-muted-foreground print:text-black">{line.variant}</span> : null}
                <span className="text-muted-foreground tabular-nums print:text-black">
                  {formatCount(line.quantity)} × {formatMoney(line.unitPrice)}
                </span>
              </div>
              <span className="text-sm tabular-nums">{formatMoney(line.quantity * line.unitPrice)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground print:text-black">{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-foreground pt-3">
          <dt className="text-xs tracking-[0.14em] uppercase">{totalLabel}</dt>
          <dd className="text-xl font-medium tabular-nums">{formatMoney(order.totals.total)}</dd>
        </div>
      </dl>
    </section>
  )
}

/** Where it's going, how, and how it was paid for. */
export function OrderConfirmationDetails({ className, ...props }: React.HTMLAttributes<HTMLDListElement>) {
  const t = useT()
  const { order, formatWindow } = useOrderConfirmation()
  const blocks: { term: string; lines: React.ReactNode[] }[] = []
  if (order.shipTo?.length) blocks.push({ term: t("ecomcn.confirmation.shipTo", "Ship to"), lines: order.shipTo })
  if (order.delivery) {
    blocks.push({
      term: t("ecomcn.delivery.legend", "Delivery"),
      lines: [
        order.delivery.label,
        ...(order.delivery.from ? [`${t("ecomcn.delivery.arrives", "Arrives")} ${formatWindow(order.delivery.from, order.delivery.to)}`] : []),
      ],
    })
  }
  if (order.payment) blocks.push({ term: t("ecomcn.payment.legend", "Payment"), lines: [order.payment] })
  if (blocks.length === 0) return null

  return (
    <dl data-slot="order-confirmation-details" className={cn("flex flex-col gap-6 text-sm", className)} {...props}>
      {blocks.map((block) => (
        <div key={block.term} className="border-t pt-3 break-inside-avoid">
          <dt className="mb-1.5 text-xs tracking-[0.14em] text-muted-foreground uppercase print:text-black">{block.term}</dt>
          {block.lines.map((line, i) => (
            <dd key={i} className="leading-relaxed">
              {line}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  )
}

/**
 * Your next actions, then print and copy-link. Hidden in print, where the
 * permalink is written out instead.
 */
export function OrderConfirmationActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { actions, permalink } = useOrderConfirmation()
  const reduce = useReducedMotion()
  const [copied, setCopied] = React.useState<"idle" | "copied" | "selected">("idle")
  const timer = React.useRef(0)
  const linkRef = React.useRef<HTMLAnchorElement>(null)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    if (!permalink) return
    let outcome: "copied" | "selected" = "copied"
    try {
      await navigator.clipboard.writeText(permalink)
    } catch {
      // The browser refused the clipboard (an insecure context, a denied
      // permission): select the link on the page instead, one keystroke from copied.
      const link = linkRef.current
      if (link) window.getSelection()?.selectAllChildren(link)
      outcome = "selected"
    }
    setCopied(outcome)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied("idle"), outcome === "copied" ? 2000 : 4000)
  }

  return (
    <div data-slot="order-confirmation-actions" className={cn("flex flex-col gap-4", className)} {...props}>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {actions}
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden />
          {t("ecomcn.confirmation.print", "Print receipt")}
        </Button>
        {permalink ? (
          <Button type="button" variant="outline" onClick={copy} aria-live="polite">
            {copied === "copied" ? <Check aria-hidden /> : <Link2 aria-hidden />}
            <span className="relative inline-grid">
              {/* Both labels hold the width; the one on show crossfades with a lift. */}
              <span aria-hidden className="invisible col-start-1 row-start-1">
                {t("ecomcn.confirmation.copyLink", "Copy order link")}
              </span>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={copied}
                  className="col-start-1 row-start-1"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={reduce ? { duration: 0.15 } : MORPH}
                >
                  {copied === "copied" ? t("ecomcn.confirmation.copied", "Link copied") : copied === "selected" ? t("ecomcn.confirmation.selected", "Link selected") : t("ecomcn.confirmation.copyLink", "Copy order link")}
                </motion.span>
              </AnimatePresence>
            </span>
          </Button>
        ) : null}
      </div>
      {permalink ? (
        <p className="text-xs break-all text-muted-foreground print:text-black">
          <span className="print:hidden">{t("ecomcn.confirmation.comeBack", "Come back to this order any time:")} </span>
          <span className="hidden print:inline">{t("ecomcn.confirmation.online", "This order online:")} </span>
          <a ref={linkRef} href={permalink} className="underline underline-offset-4">
            {permalink}
          </a>
        </p>
      ) : null}
    </div>
  )
}

/** The receipt's shape while the order loads. */
function OrderConfirmationSkeleton() {
  const t = useT()
  return (
    <div data-slot="order-confirmation-skeleton" className="flex flex-col gap-10">
      <span className="sr-only" role="status">
        {t("ecomcn.confirmation.loading", "Loading your order")}
      </span>
      <div aria-hidden className="flex flex-col gap-5 border px-6 py-10 sm:px-10 sm:py-14">
        <Skeleton className="h-3 w-48 rounded-none" />
        <Skeleton className="h-10 w-3/4 max-w-md rounded-none" />
        <Skeleton className="h-3.5 w-64 rounded-none" />
      </div>
      <div aria-hidden className="grid grid-cols-2 gap-4 border-y py-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20 rounded-none" />
            <Skeleton className="h-4 w-28 rounded-none" />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="size-16 rounded-none" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-40 rounded-none" />
              <Skeleton className="h-3 w-24 rounded-none" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
