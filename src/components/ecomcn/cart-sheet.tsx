"use client"

import * as React from "react"
import { ShoppingBag, X } from "lucide-react"
import { AnimatePresence, MotionConfig, animate, motion, useReducedMotion, type AnimationPlaybackControls } from "motion/react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { CartLineItem, type CartLine } from "@/components/ecomcn/cart-line-item"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

/*
 * The mini cart: a bag button that opens a sheet of the bag's lines, with
 * the subtotal and checkout held at the bottom.
 *
 *   <CartSheet lines={lines} onQuantityChange={update} onRemove={remove} onCheckout={checkout} />
 *
 *   <CartSheet lines={lines} onRemove={remove}>                          or composed
 *     <CartSheetTrigger className="…" />
 *     <CartSheetContent>
 *       <CartSheetLines />
 *       <YourUpsell />
 *       <CartSheetFooter />
 *     </CartSheetContent>
 *   </CartSheet>
 *
 * On your shadcn Sheet: it traps focus and hands it back to the bag button
 * on close. Its slide keyframes are off — the sheet grows out of the bag
 * button as a circle and folds back into it (Motion; a fade under reduced
 * motion), staying open until it has. Header, body and footer are ruled
 * bands, and the body is the only part that scrolls. Lines are keyed by id,
 * so a cart update never remounts one mid-undo; the subtotal follows what
 * the shopper sees — a quantity just pressed, a line waiting to be removed —
 * before your cart catches up.
 */

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

/** Scrolls, without drawing a scrollbar. Edge fades say there is more. */
const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

const subscribeNothing = () => () => {}

/** Your locale, or the visitor's once hydrated — so server and client HTML agree. */
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

export interface CartSheetContextValue {
  lines: CartLine[]
  /** Items in the bag, as the shopper sees them. */
  count: number
  /** The subtotal, as the shopper sees it. */
  subtotal: number
  formatMoney: (amount: number) => string
  currency: string
  locale?: string
  open: boolean
  setOpen: (open: boolean) => void
  freeShippingThreshold?: number
  title: React.ReactNode
  note: React.ReactNode
  checkoutLabel: React.ReactNode
  onCheckout?: () => void
  viewBagHref?: string
  empty: React.ReactNode
  loading: boolean
  /** The bag button's accessible name for a count; languages differ in plural forms. */
  countLabel?: (count: number) => string
}

/** Internal: line handlers, previews and the morph's bookkeeping. */
interface Internals {
  onQuantityChange?: (id: string, quantity: number) => void | Promise<void>
  onRemove?: (id: string) => void | Promise<void>
  onSaveForLater?: (id: string) => void | Promise<void>
  preview: (id: string, quantity: number) => void
  originRef: React.RefObject<HTMLElement | null>
  closing: boolean
  finishClose: () => void
}

const CartSheetContext = React.createContext<CartSheetContextValue | null>(null)
const InternalsContext = React.createContext<Internals | null>(null)

export function useCartSheet() {
  const context = React.useContext(CartSheetContext)
  if (!context) {
    throw new Error("useCartSheet must be used within <CartSheet>.")
  }
  return context
}

function useInternals() {
  const context = React.useContext(InternalsContext)
  if (!context) throw new Error("Cart sheet parts must be used within <CartSheet>.")
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface CartSheetProps {
  lines: CartLine[]
  currency?: string
  locale?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Debounced in each line: one call once the shopper settles. Reject to put it back. */
  onQuantityChange?: (id: string, quantity: number) => void | Promise<void>
  /** After the line's undo window. Reject to put it back. */
  onRemove?: (id: string) => void | Promise<void>
  /** Shows "Save for later" on each line; runs after the undo window. */
  onSaveForLater?: (id: string) => void | Promise<void>
  /** Shows how far the bag is from free delivery. */
  freeShippingThreshold?: number
  title?: React.ReactNode
  /** Under the subtotal. */
  note?: React.ReactNode
  checkoutLabel?: React.ReactNode
  onCheckout?: () => void
  /** Adds a "View bag" link under checkout. */
  viewBagHref?: string
  /** What an empty bag says — a "Continue shopping" link, say. */
  empty?: React.ReactNode
  loading?: boolean
  countLabel?: (count: number) => string
  /** Trigger and content parts. Omit for the default layout. */
  children?: React.ReactNode
}

export function CartSheet({
  lines,
  currency = "USD",
  locale: localeProp,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onQuantityChange,
  onRemove,
  onSaveForLater,
  freeShippingThreshold,
  title: titleProp,
  note: noteProp,
  checkoutLabel: checkoutLabelProp,
  onCheckout,
  viewBagHref,
  empty,
  countLabel,
  loading = false,
  children,
}: CartSheetProps) {
  const t = useT()
  const title = titleProp ?? t("ecomcn.cart.title", "Your bag")
  const note = noteProp === undefined ? t("ecomcn.cart.note", "Shipping and taxes are worked out at checkout.") : noteProp
  const checkoutLabel = checkoutLabelProp ?? t("ecomcn.cart.checkout", "Checkout")
  const locale = useFormatLocale(localeProp)
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange)

  // The primitive stays open until the fold has played; `open` is what the
  // shopper asked for.
  const [mounted, setMounted] = React.useState(open)
  if (open && !mounted) setMounted(true)
  const closing = mounted && !open
  const originRef = React.useRef<HTMLElement | null>(null)
  const finishClose = React.useCallback(() => setMounted(false), [])

  // What each line shows, ahead of your cart: a new quantity, or 0 while
  // its removal waits out the undo window.
  const [previews, setPreviews] = React.useState<Record<string, number>>({})
  const preview = React.useCallback((id: string, quantity: number) => {
    setPreviews((current) => (current[id] === quantity ? current : { ...current, [id]: quantity }))
  }, [])

  const formatMoney = React.useMemo(() => {
    const cents = new Intl.NumberFormat(locale, { style: "currency", currency })
    return (amount: number) => cents.format(amount)
  }, [locale, currency])

  const shown = (line: CartLine) => previews[line.id] ?? line.quantity
  const count = lines.reduce((n, line) => n + shown(line), 0)
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * shown(line), 0)

  const context = React.useMemo<CartSheetContextValue>(
    () => ({
      lines,
      count,
      subtotal,
      formatMoney,
      currency,
      locale,
      open,
      setOpen,
      freeShippingThreshold,
      title,
      note,
      checkoutLabel,
      onCheckout,
      viewBagHref,
      empty: empty ?? <p className="text-sm text-muted-foreground">{t("ecomcn.cart.nothingYet", "Nothing in it yet.")}</p>,
      loading,
      countLabel,
    }),
    [lines, count, subtotal, formatMoney, currency, locale, open, setOpen, freeShippingThreshold, title, note, checkoutLabel, onCheckout, viewBagHref, empty, loading, countLabel, t]
  )
  const internals = React.useMemo<Internals>(
    () => ({ onQuantityChange, onRemove, onSaveForLater, preview, originRef, closing, finishClose }),
    [onQuantityChange, onRemove, onSaveForLater, preview, closing, finishClose]
  )

  return (
    <CartSheetContext.Provider value={context}>
      <InternalsContext.Provider value={internals}>
        <MotionConfig reducedMotion="user">
          <Sheet
            open={mounted}
            onOpenChange={(next) => {
              // Escape twice, or the overlay mid-fold: already closing.
              if (next !== open) setOpen(next)
            }}
          >
            {children ?? (
              <>
                <CartSheetTrigger />
                <CartSheetContent />
              </>
            )}
          </Sheet>
        </MotionConfig>
      </InternalsContext.Provider>
    </CartSheetContext.Provider>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

/**
 * The bag button: an icon and the count, which turns over when it changes.
 * Style it with `className`; it is your Sheet's trigger, so focus comes
 * back to it when the sheet closes.
 */
export function CartSheetTrigger({ className, children }: { className?: string; children?: React.ReactNode }) {
  const t = useT()
  const { count, countLabel } = useCartSheet()
  const { originRef } = useInternals()
  const reduce = useReducedMotion()
  return (
    <SheetTrigger
      aria-label={countLabel ? countLabel(count) : t("ecomcn.cart.trigger", "Bag, {count} items", { count })}
      className={cn(
        "inline-flex h-9 items-center gap-2 border px-3 text-sm transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {/* The morph's origin. A span, not a ref on the trigger: refs reach
          each base's primitive differently. */}
      <span
        ref={(node) => {
          originRef.current = node
        }}
        className="inline-flex items-center gap-2"
      >
        {children ?? (
          <>
            <ShoppingBag aria-hidden className="size-4" />
            <span className="relative inline-grid overflow-hidden tabular-nums">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={count}
                  initial={{ y: reduce ? 0 : "100%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: reduce ? 0 : "-100%", opacity: 0 }}
                  transition={reduce ? { duration: 0.15 } : MORPH}
                >
                  {count}
                </motion.span>
              </AnimatePresence>
            </span>
          </>
        )}
      </span>
    </SheetTrigger>
  )
}

/** Whether a scroller has more above or below. */
function useOverflow() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ start: false, end: false })
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => {
      const next = {
        start: node.scrollTop > 1,
        end: node.scrollTop + node.clientHeight < node.scrollHeight - 1,
      }
      setEdges((current) => (current.start === next.start && current.end === next.end ? current : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    node.addEventListener("scroll", update, { passive: true })
    return () => {
      observer.disconnect()
      node.removeEventListener("scroll", update)
    }
  }, [])
  return [ref, edges] as const
}

/**
 * The sheet: a header band with the title and count, the lines — the only
 * scroller — and the footer band with the subtotal and checkout.
 */
export function CartSheetContent({ className, children }: { className?: string; children?: React.ReactNode }) {
  const t = useT()
  const { title, count } = useCartSheet()
  return (
    <SheetContent
      side="right"
      showCloseButton={false}
      // The primitive positions the panel and traps focus; its surface and
      // keyframes are off, and Motion plays the open and the close.
      className="w-full gap-0 border-0 bg-transparent p-0 shadow-none animate-none! transition-none! sm:max-w-md"
    >
      <SheetPanel>
        <div data-slot="cart-sheet-header" className="flex h-15 shrink-0 items-center justify-between gap-4 border-b px-5">
          <SheetTitle className="text-xl font-normal">
            {title}
            <span className="ms-2 text-sm text-muted-foreground tabular-nums">{count}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("ecomcn.cart.description", "The items in your bag, with the subtotal and checkout.")}
          </SheetDescription>
          <SheetClose className="grid size-9 place-items-center outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">
            <X aria-hidden className="size-4" />
            <span className="sr-only">{t("ecomcn.cart.close", "Close")}</span>
          </SheetClose>
        </div>
        <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
          {children ?? (
            <>
              <CartSheetLines />
              <CartSheetFooter />
            </>
          )}
        </div>
      </SheetPanel>
    </SheetContent>
  )
}

/** The lines: the only part of the sheet that scrolls, with soft edges instead of a scrollbar. */
export function CartSheetLines({ className }: { className?: string }) {
  const t = useT()
  const { lines, currency, locale, empty, loading } = useCartSheet()
  const { onQuantityChange, onRemove, onSaveForLater, preview } = useInternals()
  const [scroller, edges] = useOverflow()

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        data-slot="cart-sheet-lines"
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5", NO_SCROLLBAR, className)}
      >
        {loading ? (
          <ul>
            {Array.from({ length: 2 }, (_, i) => (
              <CartLineItem key={i} line={{ id: String(i), name: "", unitPrice: 0, quantity: 1 }} density="compact" loading />
            ))}
          </ul>
        ) : lines.length ? (
          <ul>
            {lines.map((line) => (
              <CartLineItem
                // Keyed by id: a cart update never remounts a line mid-undo.
                key={line.id}
                line={line}
                currency={currency}
                locale={locale}
                density="compact"
                onQuantityChange={onQuantityChange ? (q) => onQuantityChange(line.id, q) : undefined}
                onRemove={onRemove ? () => onRemove(line.id) : undefined}
                onSaveForLater={onSaveForLater ? () => onSaveForLater(line.id) : undefined}
                onPreviewQuantityChange={(q) => preview(line.id, q)}
              />
            ))}
          </ul>
        ) : (
          <div data-slot="cart-sheet-empty" className="py-10">
            <p className="text-2xl">{t("ecomcn.cart.empty", "Your bag is empty.")}</p>
            <div className="mt-3">{empty}</div>
          </div>
        )}
      </div>
      <EdgeFade side="top" visible={edges.start} />
      <EdgeFade side="bottom" visible={edges.end} />
    </div>
  )
}

function EdgeFade({ side, visible }: { side: "top" | "bottom"; visible: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 h-8 from-background to-transparent transition-opacity duration-200",
        side === "top" ? "top-0 bg-gradient-to-b" : "bottom-0 bg-gradient-to-t",
        visible ? "opacity-100" : "opacity-0"
      )}
    />
  )
}

/**
 * The footer band: how far from free delivery, the subtotal, a note, and
 * checkout. It never scrolls away.
 */
export function CartSheetFooter({ className }: { className?: string }) {
  const t = useT()
  const { lines, subtotal, formatMoney, freeShippingThreshold, note, checkoutLabel, onCheckout, viewBagHref, setOpen, loading } =
    useCartSheet()
  const reduce = useReducedMotion()
  if (!lines.length && !loading) return null
  const left = freeShippingThreshold !== undefined ? Math.max(0, freeShippingThreshold - subtotal) : undefined
  const share = freeShippingThreshold ? Math.min(1, subtotal / freeShippingThreshold) : 0

  return (
    <div data-slot="cart-sheet-footer" className={cn("shrink-0 border-t px-5 pt-4 pb-5", className)}>
      {left !== undefined ? (
        <div className="mb-4">
          <p className="text-sm" aria-live="polite">
            {left > 0 ? (
              <>
                {t("ecomcn.cart.fromFreeDelivery", "{amount} from free delivery", { amount: formatMoney(left) })}
              </>
            ) : (
              t("ecomcn.cart.freeDelivery", "Free delivery on this order")
            )}
          </p>
          <div aria-hidden className="mt-2 h-1 bg-secondary">
            <motion.div
              className="h-full origin-start bg-foreground"
              initial={false}
              animate={{ scaleX: share }}
              transition={reduce ? { duration: 0 } : MORPH}
            />
          </div>
        </div>
      ) : null}
      <p className="flex items-baseline justify-between gap-4">
        <span className="text-xs font-medium tracking-[0.14em] uppercase">{t("ecomcn.cart.subtotal", "Subtotal")}</span>
        <span className="text-xl tabular-nums" aria-live="polite">
          {loading ? "—" : formatMoney(subtotal)}
        </span>
      </p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      {/* No checkout action, no button: a store that cannot check out yet shows none. */}
      {onCheckout ? (
      <Button
        type="button"
        size="lg"
        disabled={loading || subtotal === 0}
        onClick={() => {
          onCheckout?.()
          setOpen(false)
        }}
        className="mt-4 h-12 w-full rounded-none text-xs font-medium tracking-[0.14em] uppercase shadow-none"
      >
        {checkoutLabel}
      </Button>
      ) : null}
      {viewBagHref ? (
        <a
          href={viewBagHref}
          onClick={() => setOpen(false)}
          className="mt-3 block text-center text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
        >
          {t("ecomcn.cart.viewBag", "View bag")}
        </a>
      ) : null}
    </div>
  )
}

/**
 * The visible surface, and the morph: a circle growing from the bag button
 * to cover the panel, the contents fading in once it has; closing runs it
 * back into the button. A layout effect inside the portal, so the first
 * frame is already clipped.
 */
function SheetPanel({ children }: { children: React.ReactNode }) {
  const { originRef, closing, finishClose } = useInternals()
  const reduce = useReducedMotion()
  const surface = React.useRef<HTMLDivElement>(null)
  const contents = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const panel = surface.current
    const inner = contents.current
    if (!panel || !inner) return
    const overlay = panel
      .closest<HTMLElement>('[data-slot="sheet-content"]')
      ?.parentElement?.querySelector<HTMLElement>(':scope > [data-slot="sheet-overlay"]')
    const running: AnimationPlaybackControls[] = []
    let cancelled = false

    // The bag button's centre, in the panel's own coordinates — it may lie
    // outside the panel, which a circle's centre is allowed to.
    const circle = () => {
      const box = panel.getBoundingClientRect()
      const r = originRef.current?.getBoundingClientRect()
      const x = r ? r.left + r.width / 2 - box.left : box.width
      const y = r ? r.top + r.height / 2 - box.top : 0
      const far = Math.ceil(Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y)))
      return { at: `${x}px ${y}px`, far }
    }

    if (!closing) {
      if (reduce) {
        panel.style.opacity = "0"
        running.push(animate(panel, { opacity: [0, 1] }, { duration: 0.15 }))
      } else {
        const { at, far } = circle()
        panel.style.clipPath = `circle(0px at ${at})`
        inner.style.opacity = "0"
        running.push(
          animate(panel, { clipPath: [`circle(0px at ${at})`, `circle(${far}px at ${at})`] }, MORPH),
          animate(inner, { opacity: 1 }, { duration: 0.25, delay: 0.15, ease: "easeOut" })
        )
      }
      return () => {
        cancelled = true
        running.forEach((a) => a.stop())
      }
    }

    if (reduce) {
      running.push(animate(panel, { opacity: 0 }, { duration: 0.15 }))
    } else {
      const { at } = circle()
      running.push(
        animate(inner, { opacity: 0 }, { duration: 0.12, ease: "easeIn" }),
        animate(panel, { clipPath: `circle(0px at ${at})` }, { ...MORPH, duration: 0.38, delay: 0.06 })
      )
    }
    if (overlay) running.push(animate(overlay, { opacity: 0 }, { duration: 0.3, delay: 0.1 }))

    const fallback = window.setTimeout(() => !cancelled && finishClose(), 800)
    Promise.all(running.map((a) => a.finished)).then(() => {
      window.clearTimeout(fallback)
      if (!cancelled) finishClose()
    })
    return () => {
      cancelled = true
      window.clearTimeout(fallback)
      running.forEach((a) => a.stop())
    }
    // Runs on open and on close; `reduce` is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing])

  return (
    <div ref={surface} data-slot="cart-sheet-panel" className="flex h-dvh w-full flex-col bg-background text-foreground">
      <div ref={contents} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
