"use client"

import * as React from "react"
import { Check, Minus, Plus, Star, Truck } from "lucide-react"
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PriceTag } from "@/components/ecomcn/price-tag"
import {
  VariantSwatches,
  type Variant,
  type VariantOption,
  type VariantSelection,
  type VariantSwatchesProps,
} from "@/components/ecomcn/variant-swatches"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

/*
 * The buy box: name, price, rating, variants, quantity, and an add-to-bag
 * button that carries the live total — "Add to bag — $840".
 *
 *   <ProductBuyBox product={product} onAddToBag={addToBag} delivery={{ minDays: 2, maxDays: 4 }} />
 *
 *   <ProductBuyBox product={product} onAddToBag={addToBag}>          or composed
 *     <ProductBuyBoxHeader />
 *     <ProductBuyBoxPrice />
 *     <ProductBuyBoxVariants sizeGuide={<SizeGuideDialog … />} />
 *     <ProductBuyBoxActions />
 *     <ProductBuyBoxDelivery />
 *   </ProductBuyBox>
 *
 * Adding is optimistic: the button says "Added" the moment it is pressed,
 * and if your `onAddToBag` rejects, it rolls back — the button returns, and a
 * line under it says what went wrong. (The wishlist heart lives on the
 * product card, where it has room; the buy box gives its width to the button.)
 * Delivery is a date range worked out from business days and a cut-off
 * ("Arrives Thu 9 – Mon 13 Oct"), never "ships soon". The selected variant
 * lives in one context, so your own parts — a gallery, a sticky bar — read
 * the same pick through `useProductBuyBox()`.
 */

export interface BuyBoxVariant extends Variant {
  /** This variant's price, when it differs from the product's. */
  price?: number
  compareAt?: number
}

export interface BuyBoxProduct {
  id: string
  name: string
  brand?: string
  price: number
  compareAt?: number
  rating?: number
  reviewCount?: number
  options?: VariantOption[]
  variants?: BuyBoxVariant[]
}

export interface BuyBoxLine {
  product: BuyBoxProduct
  /** Undefined for a product with no options. */
  variant: BuyBoxVariant | undefined
  quantity: number
}

export interface BuyBoxDelivery {
  /** Business days from dispatch to the door, at the soonest and the latest. */
  minDays: number
  maxDays: number
  /** Orders before this hour (0–23, the shopper's clock) dispatch the same day. */
  cutoffHour?: number
  /** Before the dates: "Free delivery", "Express". */
  label?: React.ReactNode
  /** Skip Saturdays and Sundays. Defaults to true. */
  businessDaysOnly?: boolean
}

type AddState = "idle" | "adding" | "added" | "error"

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

const subscribeNothing = () => () => {}

/**
 * The locale to format with. Yours when you pass one. Otherwise the
 * visitor's — but only once hydrated: the server cannot know it, and its HTML
 * ("Sep 21, 2026") must match the first client render, not the browser's
 * "21 Sept 2026". Until then, en-US.
 */
function useFormatLocale(locale?: string) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  return locale ?? (hydrated ? undefined : "en-US")
}

function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void
) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const controlled = value !== undefined
  const set = React.useCallback(
    (next: T) => {
      if (!controlled) setUncontrolled(next)
      onChange?.(next)
    },
    [controlled, onChange]
  )
  return [controlled ? value : uncontrolled, set] as const
}

/* ─── context ──────────────────────────────────────────────────────────── */

export interface ProductBuyBoxContextValue {
  product: BuyBoxProduct
  selection: VariantSelection
  setSelection: (selection: VariantSelection) => void
  /** The variant the picks point at; undefined until every option has one. */
  variant: BuyBoxVariant | undefined
  /** The first option still to pick — "Size" — or undefined. */
  missing: string | undefined
  soldOut: boolean
  quantity: number
  setQuantity: (quantity: number) => void
  /** The most the shopper can add: the variant's stock, capped at `maxQuantity`. */
  maxQuantity: number
  unitPrice: number
  compareAt?: number
  /** Unit price × quantity. */
  total: number
  /** The price in the store's currency and the shopper's locale. */
  formatMoney: (amount: number) => string
  currency: string
  /** The locale formatting uses: yours, or the visitor's once hydrated. */
  locale?: string
  addState: AddState
  /** Adds, optimistically; or asks for the missing option; or notifies for a sold-out one. */
  addToBag: () => void
  /** What the line under the button says, or null. */
  notice: { tone: "hint" | "error"; text: string } | null
  canNotify: boolean
  /** A step outside the options still to do (a required text field, say); blocks adding like a missing option. */
  prerequisite: BuyBoxPrerequisite | null
  delivery?: BuyBoxDelivery
  reviewsHref: string
  loading: boolean
}

const ProductBuyBoxContext = React.createContext<ProductBuyBoxContextValue | null>(null)

export function useProductBuyBox() {
  const context = React.useContext(ProductBuyBoxContext)
  if (!context) {
    throw new Error("useProductBuyBox must be used within <ProductBuyBox>.")
  }
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface BuyBoxPrerequisite {
  /** On the button: "Enter the recipient's name". */
  label: string
  /** Under the button after a press. */
  message: string
  /** Takes the shopper to the field. */
  focus?: () => void
}

export interface ProductBuyBoxProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  product: BuyBoxProduct
  currency?: string
  locale?: string
  /** The picks, by option name: `{ Colour: "Tan", Size: "41" }`. */
  value?: VariantSelection
  defaultValue?: VariantSelection
  onValueChange?: (value: VariantSelection) => void
  quantity?: number
  defaultQuantity?: number
  onQuantityChange?: (quantity: number) => void
  /** The most one line can hold, before stock. Defaults to 10. */
  maxQuantity?: number
  /**
   * Add the line to your bag. The button shows "Added" at once; return a
   * promise, and if it rejects the button rolls back and says so.
   */
  onAddToBag?: (line: BuyBoxLine) => void | Promise<void>
  /** A sold-out pick turns the button into "Notify me", which calls this. */
  onNotify?: (line: BuyBoxLine) => void
  delivery?: BuyBoxDelivery
  /** Where the rating links to. Defaults to "#reviews". */
  reviewsHref?: string
  /** The product name's heading level. A product page's name is its h1. */
  headingLevel?: "h1" | "h2"
  loading?: boolean
  /** Something besides the options that must be done first; null when nothing is. */
  prerequisite?: BuyBoxPrerequisite | null
}

export function ProductBuyBox({
  product,
  currency = "USD",
  locale: localeProp,
  value: valueProp,
  defaultValue = {},
  onValueChange,
  quantity: quantityProp,
  defaultQuantity = 1,
  onQuantityChange,
  maxQuantity: maxQuantityProp = 10,
  onAddToBag,
  onNotify,
  delivery,
  reviewsHref = "#reviews",
  headingLevel = "h1",
  loading = false,
  prerequisite = null,
  className,
  children,
  ...props
}: ProductBuyBoxProps) {
  const t = useT()
  const locale = useFormatLocale(localeProp)
  const root = React.useRef<HTMLDivElement>(null)
  const [selection, setSelectionState] = useControllableState(valueProp, defaultValue, onValueChange)
  const [quantity, setQuantityState] = useControllableState(quantityProp, defaultQuantity, onQuantityChange)
  const [addState, setAddState] = React.useState<AddState>("idle")
  const [notice, setNotice] = React.useState<ProductBuyBoxContextValue["notice"]>(null)
  const resetTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const options = React.useMemo(() => product.options ?? [], [product.options])
  // A one-value option ("One size") counts as picked.
  const resolved = React.useMemo(() => {
    const filled: VariantSelection = {}
    for (const option of options) {
      if (option.values.length === 1) {
        const only = option.values[0]
        filled[option.name] = typeof only === "string" ? only : only.value
      }
    }
    return { ...filled, ...selection }
  }, [options, selection])

  const missing = options.find((o) => resolved[o.name] === undefined)?.name
  const variant = missing
    ? undefined
    : product.variants?.find((v) => options.every((o) => v.options[o.name] === resolved[o.name]))
  const soldOut =
    !missing && options.length > 0 && (product.variants ? !variant || variant.stock === 0 : false)
  const stockCap = variant?.stock && variant.stock > 0 ? variant.stock : Infinity
  const maxQuantity = Math.max(1, Math.min(maxQuantityProp, stockCap))
  const clampedQuantity = Math.min(Math.max(1, quantity), maxQuantity)
  const unitPrice = variant?.price ?? product.price
  const compareAt = variant?.price !== undefined ? variant.compareAt : (variant?.compareAt ?? product.compareAt)

  const formatMoney = React.useMemo(() => {
    const whole = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })
    const cents = new Intl.NumberFormat(locale, { style: "currency", currency })
    return (amount: number) => (Number.isInteger(amount) ? whole : cents).format(amount)
  }, [locale, currency])

  const setSelection = React.useCallback(
    (next: VariantSelection) => {
      setNotice(null)
      setAddState((state) => (state === "error" ? "idle" : state))
      setSelectionState(next)
    },
    [setSelectionState]
  )

  const addToBag = React.useCallback(() => {
    if (addState === "adding") return
    if (missing) {
      setNotice({ tone: "hint", text: t("ecomcn.buyBox.chooseFirst", "Choose a {option} first.", { option: missing }) })
      // Take the shopper to the option they skipped.
      root.current
        ?.querySelector<HTMLElement>(
          `[data-slot="variant-swatches-option"][data-option="${CSS.escape(missing)}"] [role="radio"][tabindex="0"]`
        )
        ?.focus()
      return
    }
    if (prerequisite && !soldOut) {
      setNotice({ tone: "hint", text: prerequisite.message })
      prerequisite.focus?.()
      return
    }
    const line: BuyBoxLine = { product, variant, quantity: clampedQuantity }
    if (soldOut) {
      onNotify?.(line)
      return
    }
    window.clearTimeout(resetTimer.current)
    setNotice(null)
    // Optimistic: "Added" now, settled or rolled back when the promise is.
    setAddState("adding")
    Promise.resolve()
      .then(() => onAddToBag?.(line))
      .then(
        () => {
          setAddState("added")
          resetTimer.current = window.setTimeout(() => setAddState("idle"), 2400)
        },
        () => {
          setAddState("error")
          setNotice({ tone: "error", text: t("ecomcn.buyBox.failed", "That didn't reach your bag. Try again.") })
        }
      )
  }, [addState, missing, prerequisite, product, variant, clampedQuantity, soldOut, onNotify, onAddToBag, t])

  const context = React.useMemo<ProductBuyBoxContextValue>(
    () => ({
      product,
      selection,
      setSelection,
      variant,
      missing,
      soldOut,
      quantity: clampedQuantity,
      setQuantity: (n) => setQuantityState(Math.min(Math.max(1, Math.round(n) || 1), maxQuantity)),
      maxQuantity,
      unitPrice,
      compareAt,
      total: unitPrice * clampedQuantity,
      formatMoney,
      currency,
      locale,
      addState,
      addToBag,
      notice,
      canNotify: Boolean(onNotify),
      prerequisite,
      delivery,
      reviewsHref,
      loading,
    }),
    [product, selection, setSelection, variant, missing, soldOut, clampedQuantity, setQuantityState, maxQuantity, unitPrice, compareAt, formatMoney, currency, locale, addState, addToBag, notice, onNotify, prerequisite, delivery, reviewsHref, loading]
  )

  return (
    <ProductBuyBoxContext.Provider value={context}>
      <MotionConfig reducedMotion="user">
        <div
          ref={root}
          data-slot="product-buy-box"
          aria-busy={loading || undefined}
          className={cn("flex flex-col gap-8", className)}
          {...props}
        >
          {children ?? (
            <>
              <div className="flex flex-col gap-4">
                <ProductBuyBoxHeader headingLevel={headingLevel} />
                <ProductBuyBoxPrice />
              </div>
              <ProductBuyBoxVariants />
              <ProductBuyBoxActions />
              <ProductBuyBoxDelivery />
            </>
          )}
        </div>
      </MotionConfig>
    </ProductBuyBoxContext.Provider>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

/** Brand, name, and the rating — a link down to the reviews. */
export function ProductBuyBoxHeader({
  headingLevel = "h1",
  className,
  ...props
}: { headingLevel?: "h1" | "h2" } & React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { product, reviewsHref, locale, loading } = useProductBuyBox()
  const Heading = headingLevel
  if (loading) {
    return (
      <div aria-hidden className={cn("flex flex-col gap-3", className)}>
        <span className="h-3 w-20 animate-pulse bg-muted" />
        <span className="h-9 w-3/4 animate-pulse bg-muted" />
        <span className="h-3 w-28 animate-pulse bg-muted" />
      </div>
    )
  }
  const score = product.rating
  return (
    <div data-slot="product-buy-box-header" className={cn("flex flex-col gap-3", className)} {...props}>
      {product.brand ? (
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{product.brand}</p>
      ) : null}
      <Heading className="text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">{product.name}</Heading>
      {score !== undefined ? (
        <a
          href={reviewsHref}
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="relative inline-flex">
            <span className="flex gap-0.5 text-border">
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className="size-3.5 fill-current" />
              ))}
            </span>
            <span className="absolute inset-y-0 start-0 flex gap-0.5 overflow-hidden text-foreground" style={{ width: `${(score / 5) * 100}%` }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className="size-3.5 shrink-0 fill-current" />
              ))}
            </span>
          </span>
          <span className="tabular-nums">
            {new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(score)}
            {product.reviewCount !== undefined ? (
              <> ({t("ecomcn.buyBox.reviews", "{count} reviews", { count: new Intl.NumberFormat(locale).format(product.reviewCount) })})</>
            ) : null}
          </span>
          <span className="sr-only">{t("ecomcn.buyBox.ratedOutOf5", ", rated out of 5. Read the reviews")}</span>
        </a>
      ) : null}
    </div>
  )
}

/** The price — the variant's, when it has its own — fading over when it changes. */
export function ProductBuyBoxPrice({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { unitPrice, compareAt, currency, locale, loading } = useProductBuyBox()
  const reduce = useReducedMotion()
  if (loading) return <span aria-hidden className={cn("block h-8 w-24 animate-pulse bg-muted", className)} />
  return (
    <div data-slot="product-buy-box-price" className={cn("relative", className)} {...props}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={`${unitPrice}-${compareAt ?? ""}`}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -6 }}
          transition={reduce ? { duration: 0.15 } : MORPH}
        >
          <PriceTag price={unitPrice} compareAt={compareAt} currency={currency} locale={locale} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/**
 * The product's options, on variant-swatches: stock-aware swatches and size
 * grid, controlled by the buy box. Any other VariantSwatches prop passes
 * through — `sizeGuide`, `messages`, `lowStockThreshold`.
 */
export function ProductBuyBoxVariants(
  props: Omit<VariantSwatchesProps, "options" | "variants" | "value" | "defaultValue" | "onValueChange">
) {
  const { product, selection, setSelection, loading } = useProductBuyBox()
  if (!product.options?.length) return null
  return (
    <VariantSwatches
      options={product.options}
      variants={product.variants}
      value={selection}
      onValueChange={setSelection}
      loading={loading}
      {...props}
    />
  )
}

/** Quantity and add to bag on one line; the notice under them. */
export function ProductBuyBoxActions({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="product-buy-box-actions" className={cn("flex flex-col", className)} {...props}>
      <div className="flex gap-2">
        {children ?? (
          <>
            <ProductBuyBoxQuantity />
            <ProductBuyBoxAddToBag className="min-w-0 flex-1" />
          </>
        )}
      </div>
      <ProductBuyBoxNotice />
    </div>
  )
}

/** − [ 2 ] + as one ruled block. Typing works too; it settles on blur or Enter. */
export function ProductBuyBoxQuantity({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { quantity, setQuantity, maxQuantity, loading, soldOut } = useProductBuyBox()
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = () => {
    if (draft !== null) setQuantity(Number.parseInt(draft, 10))
    setDraft(null)
  }
  const off = loading || soldOut

  return (
    <div
      role="group"
      aria-label={t("ecomcn.quantity.label", "Quantity")}
      data-slot="product-buy-box-quantity"
      className={cn("flex h-12 shrink-0 items-stretch border", className)}
      {...props}
    >
      <Button
        type="button"
        variant="ghost"
        aria-label={t("ecomcn.quantity.fewer", "One fewer")}
        disabled={off || quantity <= 1}
        onClick={() => setQuantity(quantity - 1)}
        className="h-full w-10 rounded-none"
      >
        <Minus aria-hidden />
      </Button>
      <Input
        aria-label={t("ecomcn.quantity.label", "Quantity")}
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={off}
        value={draft ?? String(quantity)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit()
        }}
        className="h-full w-10 rounded-none border-0 px-0 text-center tabular-nums shadow-none focus-visible:ring-2 focus-visible:ring-inset"
      />
      <Button
        type="button"
        variant="ghost"
        aria-label={t("ecomcn.quantity.more", "One more")}
        disabled={off || quantity >= maxQuantity}
        onClick={() => setQuantity(quantity + 1)}
        className="h-full w-10 rounded-none"
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )
}

/**
 * The button carries the total: "Add to bag — $840". It asks for a missing
 * size rather than greying out, becomes "Notify me" when the pick is sold
 * out, and morphs its label between states with Motion.
 */
// className only: the Button is your primitive, and its other props differ
// between Radix and Base UI.
export function ProductBuyBoxAddToBag({ className }: { className?: string }) {
  const t = useT()
  const { total, formatMoney, missing, soldOut, canNotify, prerequisite, addState, addToBag, loading } = useProductBuyBox()
  const reduce = useReducedMotion()

  const label =
    addState === "adding" || addState === "added"
      ? { key: "added", text: t("ecomcn.buyBox.added", "Added to bag"), icon: true }
      : missing
        ? { key: "missing", text: t("ecomcn.buyBox.select", "Select a {option}", { option: missing }), icon: false }
        : soldOut
          ? { key: "sold-out", text: canNotify ? t("ecomcn.buyBox.notify", "Notify me") : t("ecomcn.buyBox.soldOut", "Sold out"), icon: false }
          : prerequisite
            ? { key: "prerequisite", text: prerequisite.label, icon: false }
            : { key: `add-${total}`, text: t("ecomcn.buyBox.add", "Add to bag — {total}", { total: formatMoney(total) }), icon: false }

  return (
    <Button
      type="button"
      size="lg"
      variant={soldOut ? "outline" : "default"}
      data-state={addState}
      // Not disabled while a size is missing — pressing it says which — but
      // a sold-out pick with nobody to notify can only be explained.
      disabled={loading || (soldOut && !canNotify)}
      onClick={addToBag}
      className={cn(
        "relative h-auto min-h-12 overflow-hidden rounded-none py-2 text-xs font-medium tracking-[0.14em] whitespace-normal uppercase shadow-none",
        className
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label.key}
          initial={{ opacity: 0, y: reduce ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -14 }}
          transition={reduce ? { duration: 0.15 } : MORPH}
          // Wraps to a second line before it would ever overflow.
          className="flex min-w-0 items-center justify-center gap-2 text-center leading-snug text-balance tabular-nums"
        >
          {label.icon ? <Check aria-hidden className="size-4" /> : null}
          {label.text}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}

/**
 * The line under the button: which option to pick, or what failed. A status
 * region that is always in the page, so each new line is read out; the line
 * grows open to its height.
 */
export function ProductBuyBoxNotice({ className, ...props }: Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { notice } = useProductBuyBox()
  const reduce = useReducedMotion()
  return (
    <div
      role="status"
      data-slot="product-buy-box-notice"
      className={className}
      {...props}
    >
      <AnimatePresence initial={false}>
        {notice ? (
          <motion.div
            key={notice.text}
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0.15 } : MORPH}
            className="overflow-hidden"
          >
            <p
              className={cn(
                "flex items-baseline gap-2.5 pt-3 text-sm",
                notice.tone === "error" ? "text-[var(--sale,var(--destructive))]" : "text-foreground"
              )}
            >
              <span aria-hidden className="h-px w-4 shrink-0 translate-y-[-0.3em] bg-current" />
              {notice.text}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/* ─── delivery ─────────────────────────────────────────────────────────── */

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

/**
 * When it arrives, as a date range — "Arrives Thu 9 – Mon 13 Oct" — with a
 * countdown to the dispatch cut-off. Worked out on the shopper's clock after
 * hydration (the server cannot know their time zone), with a placeholder of
 * the same height until then.
 */
export function ProductBuyBoxDelivery({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { delivery, locale, soldOut } = useProductBuyBox()
  const minute = React.useSyncExternalStore(subscribeMinute, currentMinute, serverMinute)
  if (!delivery || soldOut) return null

  let text: React.ReactNode = null
  let countdown: string | null = null
  if (minute !== null) {
    const now = new Date(minute * 60_000)
    const businessOnly = delivery.businessDaysOnly ?? true
    const cutoff = delivery.cutoffHour
    // Past the cut-off, or on a day nothing dispatches: it goes out next working day.
    let dispatch = new Date(now)
    const closed = businessOnly && (now.getDay() === 0 || now.getDay() === 6)
    if (closed || (cutoff !== undefined && now.getHours() >= cutoff)) {
      dispatch = addDays(now, 1, businessOnly)
    } else if (cutoff !== undefined) {
      const left = cutoff * 60 - (now.getHours() * 60 + now.getMinutes())
      countdown = `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, "0")}m`
    }
    const first = addDays(dispatch, delivery.minDays, businessOnly)
    const last = addDays(dispatch, delivery.maxDays, businessOnly)
    const format = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" })
    text = delivery.minDays === delivery.maxDays ? format.format(first) : format.formatRange(first, last)
  }

  return (
    <div
      data-slot="product-buy-box-delivery"
      className={cn("flex items-start gap-3 border-t pt-5 text-sm", className)}
      {...props}
    >
      <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      {text === null ? (
        <span aria-hidden className="flex flex-col gap-2 py-0.5">
          <span className="h-3.5 w-48 animate-pulse bg-muted" />
          <span className="h-3 w-36 animate-pulse bg-muted" />
        </span>
      ) : (
        <p className="flex flex-col gap-1">
          <span>
            {delivery.label ? <>{delivery.label} · </> : null}
            {t("ecomcn.buyBox.arrives", "Arrives")} <span className="font-medium tabular-nums">{text}</span>
          </span>
          {countdown ? (
            <span className="text-muted-foreground tabular-nums">
              {t("ecomcn.buyBox.orderWithin", "Order within {countdown} for dispatch today", { countdown })}
            </span>
          ) : null}
        </p>
      )}
    </div>
  )
}
