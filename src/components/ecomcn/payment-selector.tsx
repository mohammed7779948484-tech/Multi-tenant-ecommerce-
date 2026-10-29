"use client"

import * as React from "react"
import { CircleAlert } from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { cn } from "@/lib/utils"

/*
 * How the shopper pays: one ruled list of methods — card, wallet, pay in
 * instalments, bank — where the chosen one opens onto your payment
 * provider's own fields.
 *
 *   <PaymentSelector
 *     methods={methods}
 *     value={method}
 *     onValueChange={setMethod}
 *     renderPanel={(m) => (m.id === "card" ? <PaymentElement /> : null)}
 *     total={777.6}
 *   />
 *
 * It never renders a card-number, expiry or CVC field. Each method's panel
 * is a slot — `renderPanel` — for Stripe's Payment Element, Adyen's Drop-in,
 * PayPal's buttons or a redirect notice. A panel stays mounted once opened
 * (`keepMounted`), hidden rather than destroyed, so a provider's iframe keeps
 * the half-typed card when the shopper looks at another method and comes
 * back. Panels sit outside the radio group, so the arrow keys move between
 * methods without ever reaching into a provider's fields — and laid out
 * under their own method, joined to it as one object. The heavy rule slides
 * to the chosen method and its panel grows to its measured height (Motion;
 * a fade under reduced motion).
 */

export interface PaymentMethod {
  id: string
  label: string
  /** "Visa, Mastercard, Amex". */
  description?: React.ReactNode
  /** Your brand marks, at the row's end. ecomcn ships none: they are trademarks. */
  icon?: React.ReactNode
  kind: "card" | "wallet" | "bnpl" | "bank" | "other"
  /** Pay in N: shows "3 payments of $259.20" from `total`. */
  instalments?: number
  /** False when it can't be used here — Apple Pay outside Safari, say. */
  available?: boolean
  /** Why, in words: "Needs Safari on an Apple device". */
  unavailableReason?: string
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const
const FADE = { duration: 0.15 } as const

const subscribeNothing = () => () => {}

/** Your locale, or the visitor's once hydrated — so server and client HTML agree. */
function useFormatLocale(locale?: string) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  return locale ?? (hydrated ? undefined : "en-US")
}

/* ─── context ──────────────────────────────────────────────────────────── */

export interface PaymentSelectorContextValue {
  methods: PaymentMethod[]
  /** The chosen method's id, or null before the shopper chooses. */
  value: string | null
  select: (id: string) => void
  selected: PaymentMethod | undefined
  /** Methods opened so far — their panels stay mounted while `keepMounted`. */
  opened: ReadonlySet<string>
  keepMounted: boolean
  renderPanel?: (method: PaymentMethod) => React.ReactNode
  /** A provider failure, shown in the chosen method's panel. */
  error: React.ReactNode
  /** "3 payments of $259.20", or null when the method or `total` doesn't say. */
  instalmentText: (method: PaymentMethod) => string | null
  formatMoney: (amount: number) => string
  /** Where a method sits in the list — rows and panels are placed by it. */
  indexOf: (id: string) => number
  panelId: (id: string) => string
  /** For the sliding rule's shared layout id. */
  scope: string
  disabled: boolean
}

const PaymentSelectorContext = React.createContext<PaymentSelectorContextValue | null>(null)

export function usePaymentSelector() {
  const context = React.useContext(PaymentSelectorContext)
  if (!context) {
    throw new Error("usePaymentSelector must be used within <PaymentSelector>.")
  }
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface PaymentSelectorProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "onChange" | "defaultValue" | "name" | "children"> {
  methods: PaymentMethod[]
  value: string | null
  onValueChange: (id: string) => void
  /** The provider slot. Return null for a method with nothing to show. */
  renderPanel?: (method: PaymentMethod) => React.ReactNode
  /** The order total, for instalment lines. */
  total?: number
  currency?: string
  /** `undefined` follows the visitor's locale, once hydrated. */
  locale?: string
  /** A provider failure — "Your card was declined" — shown in the open panel. */
  error?: React.ReactNode
  /** Keep a panel mounted once opened, so a provider's iframe keeps its state. Defaults to true. */
  keepMounted?: boolean
  /** "Payment", by default. */
  legend?: React.ReactNode
  /** Keeps the legend for screen readers when your page already has a heading. */
  hideLegend?: boolean
  /** The radio group's name, for a plain form post. */
  name?: string
  /** The methods aren't known yet. */
  loading?: boolean
  disabled?: boolean
  children?: React.ReactNode
}

export function PaymentSelector({
  methods,
  value,
  onValueChange,
  renderPanel,
  total,
  currency = "USD",
  locale: localeProp,
  error = null,
  keepMounted = true,
  legend: legendProp,
  hideLegend = false,
  name,
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}: PaymentSelectorProps) {
  const t = useT()
  const legend = legendProp ?? t("ecomcn.payment.legend", "Payment")
  const locale = useFormatLocale(localeProp)
  const uid = React.useId()
  const legendId = `${uid}-legend`

  // Every method opened so far; adjusted during render, so a panel mounts
  // in the same commit as its selection.
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(() => new Set(value ? [value] : []))
  if (value && !opened.has(value)) setOpened(new Set([...opened, value]))

  const money = React.useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency }), [locale, currency])
  const formatMoney = React.useCallback((amount: number) => money.format(amount), [money])
  const instalmentText = React.useCallback(
    (method: PaymentMethod) => {
      const n = method.instalments
      if (!n || n < 2 || total === undefined) return null
      return t("ecomcn.payment.instalments", "{count} payments of {amount}", { count: n, amount: money.format(Math.round((total / n) * 100) / 100) })
    },
    [money, total, t]
  )

  const ids = methods.map((m) => m.id).join("\n")
  const indexOf = React.useCallback((id: string) => ids.split("\n").indexOf(id), [ids])
  const panelId = React.useCallback((id: string) => `${uid}-panel-${id}`, [uid])

  const context = React.useMemo<PaymentSelectorContextValue>(
    () => ({
      methods,
      value,
      select: onValueChange,
      selected: methods.find((m) => m.id === value),
      opened,
      keepMounted,
      renderPanel,
      error,
      instalmentText,
      formatMoney,
      indexOf,
      panelId,
      scope: uid,
      disabled,
    }),
    [methods, value, onValueChange, opened, keepMounted, renderPanel, error, instalmentText, formatMoney, indexOf, panelId, uid, disabled]
  )

  const rows = methods.length * 2
  return (
    <PaymentSelectorContext.Provider value={context}>
      <MotionConfig reducedMotion="user">
        <fieldset
          data-slot="payment-selector"
          aria-busy={loading || undefined}
          className={cn("min-w-0", className)}
          {...props}
        >
          <legend id={legendId} className={cn("mb-3 text-base font-medium", hideLegend && "sr-only")}>
            {legend}
          </legend>
          {loading ? (
            <PaymentSelectorSkeleton />
          ) : methods.length === 0 ? (
            <p data-slot="payment-selector-empty" className="border px-4 py-5 text-sm text-muted-foreground">
              No payment method can be used for this order.
            </p>
          ) : (
            // Methods and panels share one grid: the radio group spans it as
            // a subgrid holding the method rows (odd rows), and each panel is
            // placed in the row under its method (even rows) — outside the
            // group in the DOM, so arrow keys never reach a provider's field.
            // Both are pinned to column 1: left to auto-placement, a panel
            // would find column 1 taken by the group and open a second one.
            <div data-slot="payment-selector-list" className="grid grid-cols-1 border" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
              <RadioGroup
                value={value ?? ""}
                onValueChange={(next: unknown) => onValueChange(String(next))}
                name={name}
                disabled={disabled}
                aria-labelledby={legendId}
                className="grid gap-0"
                style={{ gridColumn: 1, gridRow: `1 / span ${rows}`, gridTemplateRows: "subgrid" }}
              >
                {children ?? methods.map((method) => <PaymentSelectorMethod key={method.id} method={method} />)}
              </RadioGroup>
              {methods.map((method) => (
                <PaymentSelectorPanel key={method.id} method={method} />
              ))}
            </div>
          )}
        </fieldset>
      </MotionConfig>
    </PaymentSelectorContext.Provider>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

export interface PaymentSelectorMethodProps extends React.HTMLAttributes<HTMLLabelElement> {
  method: PaymentMethod
}

/** One method: the radio, its name, what it takes or costs, and your mark. */
export function PaymentSelectorMethod({ method, className, children, ...props }: PaymentSelectorMethodProps) {
  const t = useT()
  const { value, indexOf, panelId, instalmentText, scope, disabled } = usePaymentSelector()
  const reduce = useReducedMotion()
  const selected = value === method.id
  const unavailable = method.available === false
  const instalments = unavailable ? null : instalmentText(method)
  const noteId = `${panelId(method.id)}-note`
  const hasNote = unavailable || instalments || method.description

  return (
    <label
      data-slot="payment-selector-method"
      data-state={selected ? "checked" : "unchecked"}
      data-unavailable={unavailable || undefined}
      style={{ gridRow: indexOf(method.id) * 2 + 1 }}
      className={cn(
        "relative flex min-h-14 cursor-pointer items-center gap-4 border-t px-4 py-3.5 transition-colors first:border-t-0",
        selected ? "bg-secondary/50" : "hover:bg-secondary/30",
        (unavailable || disabled) && "cursor-not-allowed hover:bg-transparent",
        className
      )}
      {...props}
    >
      {selected ? (
        <motion.span
          aria-hidden
          layoutId={reduce ? undefined : `${scope}-rule`}
          transition={MORPH}
          className="absolute inset-y-0 -start-px w-0.5 bg-foreground"
        />
      ) : null}
      <RadioGroupItem
        value={method.id}
        disabled={unavailable || disabled}
        aria-controls={panelId(method.id)}
        aria-describedby={hasNote ? noteId : undefined}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm font-medium", unavailable && "text-muted-foreground line-through decoration-1")}>
          {method.label}
        </span>
        {hasNote ? (
          <span id={noteId} className="flex flex-col text-[13px] leading-snug text-muted-foreground">
            {unavailable ? (method.unavailableReason ?? t("ecomcn.payment.unavailable", "Not available for this order")) : null}
            {!unavailable && instalments ? <span className="text-foreground tabular-nums">{instalments}</span> : null}
            {!unavailable && method.description ? <span>{method.description}</span> : null}
          </span>
        ) : null}
      </span>
      {method.icon ? (
        <span aria-hidden className={cn("flex shrink-0 items-center gap-1.5 text-muted-foreground", unavailable && "opacity-50")}>
          {method.icon}
        </span>
      ) : null}
      {children}
    </label>
  )
}

/**
 * The provider slot under one method. Mounted from the first time its
 * method is chosen; while another is chosen it folds to nothing and is
 * hidden, never unmounted (unless `keepMounted` is off).
 */
function PaymentSelectorPanel({ method }: { method: PaymentMethod }) {
  const { value, opened, keepMounted, renderPanel, error, indexOf, panelId } = usePaymentSelector()
  const reduce = useReducedMotion()
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  const open = value === method.id
  if (!open && !(keepMounted && opened.has(method.id))) return null

  const body = renderPanel?.(method) ?? null
  const showError = open && error
  if (body === null && !showError) return null

  const shown = reduce
    ? { opacity: 1, height: "auto", visibility: "visible" as const }
    : { opacity: 1, height: "auto", visibility: "visible" as const, transitionEnd: { overflow: "visible" } }
  const folded = { opacity: 0, height: 0, overflow: "hidden", transitionEnd: { visibility: "hidden" as const } }

  return (
    <motion.div
      id={panelId(method.id)}
      data-slot="payment-selector-panel"
      data-method={method.id}
      data-state={open ? "open" : "closed"}
      aria-hidden={open ? undefined : true}
      style={{ gridColumn: 1, gridRow: indexOf(method.id) * 2 + 2 }}
      // Opened after load: grow in. Open in the first render: already there.
      initial={hydrated ? { opacity: 0, height: 0, overflow: "hidden" } : false}
      animate={open ? shown : folded}
      transition={reduce ? FADE : MORPH}
      className="relative min-w-0 bg-secondary/50"
    >
      <span aria-hidden className="absolute inset-y-0 -start-px w-0.5 bg-foreground" />
      <div className="px-4 pt-1 pb-5 sm:ps-12">
        {showError ? (
          <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
        {body}
      </div>
    </motion.div>
  )
}

/** Three ruled rows in the list's shape, while the methods load. */
function PaymentSelectorSkeleton() {
  const t = useT()
  return (
    <div data-slot="payment-selector-skeleton" className="border">
      <span className="sr-only" role="status">
        {t("ecomcn.payment.loading", "Loading payment methods")}
      </span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden className="flex min-h-14 items-center gap-4 border-t px-4 py-3.5 first:border-t-0">
          <Skeleton className="size-4 rounded-full" />
          <span className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-32 rounded-none" />
            <Skeleton className="h-3 w-48 rounded-none" />
          </span>
          <Skeleton className="h-5 w-10 rounded-none" />
        </div>
      ))}
    </div>
  )
}
