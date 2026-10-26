"use client"

import * as React from "react"
import { Minus, Plus } from "lucide-react"
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

/*
 * One line in a bag: thumbnail, name and variant, a quantity stepper, the
 * line total, and save-for-later / remove.
 *
 *   <CartLineItem line={line} onQuantityChange={(q) => cart.update(line.id, q)} onRemove={() => cart.remove(line.id)} />
 *
 *   <CartLineItem line={line} onRemove={remove}>                        or composed
 *     <CartLineItemMedia />
 *     <CartLineItemInfo />
 *     <CartLineItemTotal />
 *   </CartLineItem>
 *
 * Removing never asks "are you sure?": the row folds into a "Removed —
 * Undo" bar and your `onRemove` runs only once the undo window has passed
 * (or the line leaves the page). Quantity changes show at once and reach
 * your `onQuantityChange` once, after the shopper stops pressing — not once
 * per press. Either handler can reject: the line puts itself back and says
 * so. The row folds and unfolds to its measured height with Motion.
 */

export interface CartLine {
  id: string
  name: string
  href?: string
  brand?: string
  /** "Tan · EU 41". */
  variant?: string
  /** Already rendered, so the block never assumes next/image. */
  image?: React.ReactNode
  unitPrice: number
  /** Was-price per unit; struck through when higher than `unitPrice`. */
  compareAt?: number
  quantity: number
  /** Stock left, or a per-order cap. */
  maxQuantity?: number
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

const subscribeNothing = () => () => {}

/** Your locale, or the visitor's once hydrated — so server and client HTML agree. */
function useFormatLocale(locale?: string) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  return locale ?? (hydrated ? undefined : "en-US")
}

/** Follows its content's height, so a row folds rather than jumps. */
function useMeasuredHeight() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState<number | "auto">("auto")
  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight)
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, height] as const
}

/* ─── context ──────────────────────────────────────────────────────────── */

type Leaving = "removed" | "saved"

export interface CartLineItemContextValue {
  line: CartLine
  /** The quantity on show: what the shopper last chose, before your handler has it. */
  quantity: number
  setQuantity: (quantity: number) => void
  /** One more or one fewer, from the quantity last asked for — fast presses all count. */
  step: (delta: number) => void
  /** The cap on the stepper: `maxQuantity`, or 99. */
  maxQuantity: number
  /** Unit price × the quantity on show. */
  total: number
  formatMoney: (amount: number) => string
  /** Folds the row into its undo bar; `onRemove` runs once the window has passed. */
  remove: () => void
  /** Undefined when the line was given no `onSaveForLater`. */
  saveForLater?: () => void
  /** Set while the row is folded, waiting out the undo window. */
  leaving: Leaving | null
  undo: () => void
  /** What the line last failed to do, or null. */
  error: string | null
  density: "comfortable" | "compact"
  loading: boolean
}

const CartLineItemContext = React.createContext<CartLineItemContextValue | null>(null)

export function useCartLineItem() {
  const context = React.useContext(CartLineItemContext)
  if (!context) {
    throw new Error("useCartLineItem must be used within <CartLineItem>.")
  }
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface CartLineItemProps extends Omit<React.HTMLAttributes<HTMLLIElement>, "children"> {
  line: CartLine
  currency?: string
  locale?: string
  /** Called once the shopper settles on a quantity. Reject to put it back. */
  onQuantityChange?: (quantity: number) => void | Promise<void>
  /** How long to wait after the last press. Defaults to 500ms. */
  debounceMs?: number
  /** Called when the undo window passes. Reject to put the line back. */
  onRemove?: () => void | Promise<void>
  /** Shows "Save for later"; runs, like remove, after the undo window. */
  onSaveForLater?: () => void | Promise<void>
  /** How long "Undo" stays. Defaults to 5 seconds. */
  undoMs?: number
  /**
   * The quantity on show whenever it changes — 0 while the line waits to be
   * removed — so a subtotal elsewhere can follow before your cart does.
   */
  onPreviewQuantityChange?: (quantity: number) => void
  /** `compact` for a mini cart: a smaller image, tighter type. */
  density?: "comfortable" | "compact"
  loading?: boolean
  children?: React.ReactNode
}

export function CartLineItem({
  line,
  currency = "USD",
  locale: localeProp,
  onQuantityChange,
  debounceMs = 500,
  onRemove,
  onSaveForLater,
  undoMs = 5000,
  onPreviewQuantityChange,
  density = "comfortable",
  loading = false,
  className,
  children,
  ...props
}: CartLineItemProps) {
  const t = useT()
  const locale = useFormatLocale(localeProp)
  const reduce = useReducedMotion()
  const [inner, height] = useMeasuredHeight()
  const maxQuantity = Math.max(1, line.maxQuantity ?? 99)

  // The quantity on show. It follows the prop until the shopper presses,
  // then leads it until the cart has caught up.
  const [draft, setDraft] = React.useState<number | null>(null)
  const [seen, setSeen] = React.useState(line.quantity)
  if (seen !== line.quantity) {
    // Your cart has caught up with the stepper: let the prop lead again.
    setSeen(line.quantity)
    if (draft === line.quantity) setDraft(null)
  }
  const quantity = draft ?? line.quantity
  const draftRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const [error, setError] = React.useState<string | null>(null)
  const [leaving, setLeaving] = React.useState<Leaving | null>(null)

  // Handlers in refs: the timers fire with the latest ones, and the flush on
  // unmount does not need them as effect dependencies.
  const handlers = React.useRef({ onQuantityChange, onRemove, onSaveForLater })
  React.useEffect(() => {
    handlers.current = { onQuantityChange, onRemove, onSaveForLater }
  })
  const quantityTimer = React.useRef<number | undefined>(undefined)
  const leaveTimer = React.useRef<number | undefined>(undefined)
  const pending = React.useRef<{ quantity: number | null; leaving: Leaving | null }>({ quantity: null, leaving: null })
  const row = React.useRef<HTMLLIElement>(null)

  const commitQuantity = React.useCallback((next: number) => {
    pending.current.quantity = null
    Promise.resolve()
      .then(() => handlers.current.onQuantityChange?.(next))
      // On success the stepper keeps showing the new quantity until your
      // line catches up; on failure it returns to what the cart holds.
      .catch(() => {
        setDraft(null)
        setError(t("ecomcn.cartLine.quantityFailed", "Couldn't change the quantity. Try again."))
      })
  }, [t])

  const commitLeave = React.useCallback((kind: Leaving) => {
    pending.current.leaving = null
    const run = kind === "saved" ? handlers.current.onSaveForLater : handlers.current.onRemove
    Promise.resolve()
      .then(() => run?.())
      .catch(() => {
        setLeaving(null)
        setError(kind === "saved" ? t("ecomcn.cartLine.saveFailed", "Couldn't save it for later. Try again.") : t("ecomcn.cartLine.removeFailed", "Couldn't remove it. Try again."))
      })
  }, [t])

  const setQuantity = React.useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, Math.round(next) || 1), maxQuantity)
      setError(null)
      setDraft(clamped)
      window.clearTimeout(quantityTimer.current)
      pending.current.quantity = clamped
      quantityTimer.current = window.setTimeout(() => commitQuantity(clamped), debounceMs)
    },
    [maxQuantity, debounceMs, commitQuantity]
  )

  // From the quantity last asked for, not the last render: presses quicker
  // than a render would otherwise read the same number and count as one.
  const lineQuantity = line.quantity
  const step = React.useCallback(
    (delta: number) => setQuantity((pending.current.quantity ?? draftRef.current ?? lineQuantity) + delta),
    [setQuantity, lineQuantity]
  )

  const leave = React.useCallback(
    (kind: Leaving) => {
      setError(null)
      setLeaving(kind)
      pending.current.leaving = kind
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = window.setTimeout(() => commitLeave(kind), undoMs)
    },
    [undoMs, commitLeave]
  )

  const undo = React.useCallback(() => {
    window.clearTimeout(leaveTimer.current)
    pending.current.leaving = null
    setLeaving(null)
  }, [])

  // Leaving the page — a closed mini cart, a route change — flushes what is
  // waiting: the quantity the shopper chose, the removal they did not undo.
  React.useEffect(
    () => () => {
      window.clearTimeout(quantityTimer.current)
      window.clearTimeout(leaveTimer.current)
      const { quantity: q, leaving: l } = pending.current
      if (l) {
        const run = l === "saved" ? handlers.current.onSaveForLater : handlers.current.onRemove
        void Promise.resolve().then(() => run?.()).catch(() => {})
      } else if (q !== null) {
        void Promise.resolve().then(() => handlers.current.onQuantityChange?.(q)).catch(() => {})
      }
    },
    []
  )

  // Focus follows the fold: to Undo when the row goes, back to Remove when
  // it returns. Found by query — a ref on your Button primitive would not
  // reach the DOM on React 18.
  const [focusAfter, setFocusAfter] = React.useState<"undo" | "remove" | null>(null)
  React.useEffect(() => {
    if (!focusAfter) return
    row.current?.querySelector<HTMLElement>(`[data-action="${focusAfter}"]`)?.focus()
  }, [focusAfter, leaving])

  const preview = leaving ? 0 : quantity
  React.useEffect(() => {
    onPreviewQuantityChange?.(preview)
  }, [preview, onPreviewQuantityChange])

  const formatMoney = React.useMemo(() => {
    const whole = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })
    const cents = new Intl.NumberFormat(locale, { style: "currency", currency })
    return (amount: number) => (Number.isInteger(amount) ? whole : cents).format(amount)
  }, [locale, currency])

  const context = React.useMemo<CartLineItemContextValue>(
    () => ({
      line,
      quantity,
      setQuantity,
      step,
      maxQuantity,
      total: line.unitPrice * quantity,
      formatMoney,
      remove: () => {
        setFocusAfter("undo")
        leave("removed")
      },
      saveForLater: onSaveForLater
        ? () => {
            setFocusAfter("undo")
            leave("saved")
          }
        : undefined,
      leaving,
      undo: () => {
        setFocusAfter("remove")
        undo()
      },
      error,
      density,
      loading,
    }),
    [line, quantity, setQuantity, step, maxQuantity, formatMoney, leave, onSaveForLater, leaving, undo, error, density, loading]
  )

  return (
    <CartLineItemContext.Provider value={context}>
      <MotionConfig reducedMotion="user">
        <li
          ref={row}
          data-slot="cart-line-item"
          data-state={leaving ?? "active"}
          aria-busy={loading || undefined}
          className={cn("list-none border-b", className)}
          {...props}
        >
          <motion.div
            initial={false}
            animate={{ height }}
            transition={reduce ? { duration: 0 } : MORPH}
            className="overflow-hidden"
          >
            <div ref={inner}>
              <AnimatePresence initial={false} mode="popLayout">
                {leaving ? (
                  <motion.div
                    key="undo"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <CartLineItemUndo />
                  </motion.div>
                ) : (
                  <motion.div
                    key="line"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "grid gap-x-4",
                      density === "compact"
                        ? "grid-cols-[4rem_minmax(0,1fr)] py-4"
                        : "grid-cols-[5rem_minmax(0,1fr)] py-5 sm:grid-cols-[6rem_minmax(0,1fr)]"
                    )}
                  >
                    {children ?? (
                      <>
                        <CartLineItemMedia />
                        <div className="flex min-w-0 flex-col gap-3">
                          <div className="flex items-start justify-between gap-4">
                            <CartLineItemInfo />
                            <CartLineItemTotal />
                          </div>
                          <CartLineItemActions />
                        </div>
                      </>
                    )}
                    {error ? (
                      <p role="alert" className="col-span-full pt-3 text-sm text-[var(--sale,var(--destructive))]">
                        {error}
                      </p>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
          {/* Always in the page, so the change is read out. */}
          <span className="sr-only" aria-live="polite">
            {leaving
              ? leaving === "saved"
                ? t("ecomcn.cartLine.savedAnnounce", "Saved for later: {name}. Undo is available for a few seconds.", { name: line.name })
                : t("ecomcn.cartLine.removedAnnounce", "Removed: {name}. Undo is available for a few seconds.", { name: line.name })
              : ""}
          </span>
        </li>
      </MotionConfig>
    </CartLineItemContext.Provider>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

/** The thumbnail, linked to the product when the line has an `href`. */
export function CartLineItemMedia({ className }: { className?: string }) {
  const { line, loading } = useCartLineItem()
  const frame = cn("relative block aspect-[4/5] w-full overflow-hidden bg-secondary", className)
  if (loading) return <span aria-hidden className={cn(frame, "animate-pulse bg-muted")} />
  return line.href ? (
    // The name carries the link for assistive tech; this one is a pointer shortcut.
    <a href={line.href} tabIndex={-1} aria-hidden data-slot="cart-line-item-media" className={frame}>
      {line.image}
    </a>
  ) : (
    <span data-slot="cart-line-item-media" className={frame}>
      {line.image}
    </span>
  )
}

/** Brand, name and variant. */
export function CartLineItemInfo({ className }: { className?: string }) {
  const { line, density, loading } = useCartLineItem()
  if (loading) {
    return (
      <span aria-hidden className={cn("flex flex-col gap-2", className)}>
        <span className="h-3 w-16 animate-pulse bg-muted" />
        <span className="h-4 w-32 animate-pulse bg-muted" />
      </span>
    )
  }
  return (
    <div data-slot="cart-line-item-info" className={cn("min-w-0", className)}>
      {line.brand ? (
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{line.brand}</p>
      ) : null}
      <p className={cn("leading-tight", density === "compact" ? "text-base" : "text-lg")}>
        {line.href ? (
          <a href={line.href} className="outline-none hover:underline focus-visible:underline">
            {line.name}
          </a>
        ) : (
          line.name
        )}
      </p>
      {line.variant ? <p className="mt-1 text-sm text-muted-foreground">{line.variant}</p> : null}
    </div>
  )
}

/**
 * The line total, right-aligned in tabular figures so a column of lines
 * reads as a ledger — with the unit price under it when there is more than
 * one, and the was-price struck through.
 */
export function CartLineItemTotal({ className }: { className?: string }) {
  const t = useT()
  const { line, quantity, total, formatMoney, loading } = useCartLineItem()
  const reduce = useReducedMotion()
  if (loading) return <span aria-hidden className={cn("h-4 w-14 animate-pulse bg-muted", className)} />
  const was = line.compareAt && line.compareAt > line.unitPrice ? line.compareAt * quantity : undefined
  return (
    <div data-slot="cart-line-item-total" className={cn("shrink-0 text-end tabular-nums", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.p
          key={total}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -6 }}
          transition={reduce ? { duration: 0.15 } : MORPH}
          className={cn(was && "text-[var(--sale)]")}
        >
          {formatMoney(total)}
        </motion.p>
      </AnimatePresence>
      {was ? (
        <p className="text-xs text-muted-foreground line-through">
          <span className="sr-only">{t("ecomcn.cartLine.was", "Was")} </span>
          {formatMoney(was)}
        </p>
      ) : null}
      {quantity > 1 ? (
        <p className="text-xs text-muted-foreground">{t("ecomcn.cartLine.each", "{price} each", { price: formatMoney(line.unitPrice) })}</p>
      ) : null}
    </div>
  )
}

/** − [ 2 ] + as one ruled block; typing works too, settling on blur or Enter. */
export function CartLineItemQuantity({ className }: { className?: string }) {
  const t = useT()
  const { line, quantity, setQuantity, step, maxQuantity, loading } = useCartLineItem()
  const [typed, setTyped] = React.useState<string | null>(null)
  const commit = () => {
    if (typed !== null) setQuantity(Number.parseInt(typed, 10))
    setTyped(null)
  }
  return (
    <div
      role="group"
      aria-label={t("ecomcn.cartLine.quantityOf", "Quantity of {name}", { name: line.name })}
      data-slot="cart-line-item-quantity"
      className={cn("flex h-9 w-fit items-stretch border", className)}
    >
      <Button
        type="button"
        variant="ghost"
        aria-label={t("ecomcn.quantity.fewer", "One fewer")}
        disabled={loading || quantity <= 1}
        onClick={() => step(-1)}
        className="h-full w-9 rounded-none p-0"
      >
        <Minus aria-hidden className="size-3.5" />
      </Button>
      <Input
        aria-label={t("ecomcn.quantity.label", "Quantity")}
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={loading}
        value={typed ?? String(quantity)}
        onChange={(event) => setTyped(event.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit()
        }}
        className="h-full w-9 rounded-none border-0 px-0 text-center text-sm tabular-nums shadow-none focus-visible:ring-2 focus-visible:ring-inset"
      />
      <Button
        type="button"
        variant="ghost"
        aria-label={t("ecomcn.quantity.more", "One more")}
        disabled={loading || quantity >= maxQuantity}
        onClick={() => step(1)}
        className="h-full w-9 rounded-none p-0"
      >
        <Plus aria-hidden className="size-3.5" />
      </Button>
    </div>
  )
}

/** The stepper, then save-for-later and remove as quiet text buttons. */
export function CartLineItemActions({ className }: { className?: string }) {
  const t = useT()
  const { line, quantity, maxQuantity, remove, saveForLater, loading } = useCartLineItem()
  const quiet =
    "h-auto rounded-none p-0 text-[13px] font-normal text-muted-foreground underline decoration-border underline-offset-4 hover:bg-transparent hover:text-foreground hover:decoration-foreground"
  return (
    <div data-slot="cart-line-item-actions" className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      <CartLineItemQuantity />
      {saveForLater ? (
        <Button type="button" variant="ghost" disabled={loading} onClick={saveForLater} className={quiet}>
          {t("ecomcn.cartLine.saveForLater", "Save for later")}<span className="sr-only">: {line.name}</span>
        </Button>
      ) : null}
      <Button type="button" variant="ghost" data-action="remove" disabled={loading} onClick={remove} className={quiet}>
        {t("ecomcn.cartLine.remove", "Remove")}<span className="sr-only">: {line.name}</span>
      </Button>
      {quantity >= maxQuantity && line.maxQuantity !== undefined ? (
        <p className="w-full text-xs text-muted-foreground">
          {line.maxQuantity === 1 ? t("ecomcn.cartLine.onlyOne", "Only one left.") : t("ecomcn.variants.lowStock", "Only {count} left.", { count: line.maxQuantity })}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The folded row: what happened, and the way back. Focus moves to Undo, so
 * a keyboard is one key from reversing it; the row's live region reads it out.
 */
function CartLineItemUndo() {
  const t = useT()
  const { line, leaving, undo, density } = useCartLineItem()
  return (
    <div
      data-slot="cart-line-item-undo"
      className={cn("flex items-center justify-between gap-4", density === "compact" ? "py-3" : "py-4")}
    >
      <p className="min-w-0 truncate text-sm text-muted-foreground">
        {leaving === "saved" ? t("ecomcn.cartLine.saved", "Saved for later:") : t("ecomcn.cartLine.removed", "Removed:")}{" "}
        <span className="text-foreground">{line.name}</span>
      </p>
      <Button
        type="button"
        variant="ghost"
        data-action="undo"
        onClick={undo}
        className="h-8 shrink-0 rounded-none px-3 text-xs font-medium tracking-[0.14em] uppercase"
      >
        {t("ecomcn.cartLine.undo", "Undo")}
      </Button>
    </div>
  )
}
