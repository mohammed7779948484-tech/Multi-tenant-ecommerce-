"use client"

import * as React from "react"
import { Check, Heart, Plus, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { PriceTag } from "@/components/ecomcn/price-tag"
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

export interface ProductCardColor {
  name: string
  /** Any CSS colour, or a swatch image URL via `background`. */
  hex: string
  /** Shown in the media frame while this colour is selected. */
  image?: React.ReactNode
}

export interface ProductCardProduct {
  id: string
  name: string
  href: string
  brand?: string
  /** Omitted when the product has no price (shown without one). */
  price?: number
  compareAt?: number
  /** Already-formatted price text, shown instead of formatting `price` in the browser. */
  priceText?: string
  /** Already-rendered image element, so this block never assumes next/image. */
  image?: React.ReactNode
  badge?: string
  colors?: ProductCardColor[]
  rating?: number
  reviewCount?: number
}

/* ─── context ──────────────────────────────────────────────────────────────
 * Compound component: <ProductCard> holds the selected colour and the
 * quick-add state, and every part reads them through useProductCard(). That
 * is what lets a swatch change the image without either knowing the other.
 */

type QuickAddState = "idle" | "pending" | "added"

export interface ProductCardContextValue {
  product: ProductCardProduct
  currency: string
  locale?: string
  density: "comfortable" | "compact"
  colorIndex: number
  setColorIndex: (index: number) => void
  /** The selected colour, if the product has any. */
  color?: ProductCardColor
  /** The selected colour's image, falling back to the product image. */
  image: React.ReactNode
  /** Undefined when the card was given no `onQuickAdd`. */
  quickAdd?: () => void
  quickAddState: QuickAddState
  /** False when the product's colours are not worth showing — `showColors`. */
  showColors: boolean
  /** On the shopper's wishlist — optimistically, while a change is in flight. */
  wishlisted: boolean
  /** Undefined when the card was given no `onWishlistChange`. */
  toggleWishlist?: () => void
}

const ProductCardContext = React.createContext<ProductCardContextValue | null>(null)

export function useProductCard() {
  const context = React.useContext(ProductCardContext)
  if (!context) {
    throw new Error("useProductCard must be used within <ProductCard>.")
  }
  return context
}

/** Controlled when `value` is passed, uncontrolled from `defaultValue` otherwise. */
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

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface ProductCardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> {
  product: ProductCardProduct
  currency?: string
  locale?: string
  density?: "comfortable" | "compact"
  /** Return a promise to keep the button in its pending state until settled. */
  onQuickAdd?: (product: ProductCardProduct, colorIndex: number) => void | Promise<void>
  /** Controlled selected colour. */
  colorIndex?: number
  defaultColorIndex?: number
  onColorChange?: (color: ProductCardColor, index: number) => void
  /**
   * Show the colour swatches. Turn off for products that do not come in
   * colours worth choosing between — a book, a print, one-colour stock.
   */
  showColors?: boolean
  /** Controlled wishlist state. */
  wishlisted?: boolean
  defaultWishlisted?: boolean
  /**
   * Shows the heart. Optimistic: it fills at once; reject to roll it back.
   */
  onWishlistChange?: (wishlisted: boolean, product: ProductCardProduct) => void | Promise<void>
  /**
   * Compose your own card from ProductCardMedia, ProductCardBody and their
   * parts. Leave empty for the default layout.
   */
  children?: React.ReactNode
}

export function ProductCard({
  product,
  currency = "USD",
  locale: localeProp,
  density = "comfortable",
  onQuickAdd,
  colorIndex: colorIndexProp,
  defaultColorIndex = 0,
  onColorChange,
  showColors = true,
  wishlisted: wishlistedProp,
  defaultWishlisted = false,
  onWishlistChange,
  className,
  children,
  ...props
}: ProductCardProps) {
  const locale = useFormatLocale(localeProp)
  const colors = product.colors
  const handleColorChange = React.useCallback(
    (index: number) => {
      const color = colors?.[index]
      if (color) onColorChange?.(color, index)
    },
    [colors, onColorChange]
  )
  const [colorIndex, setColorIndex] = useControllableState(
    colorIndexProp,
    defaultColorIndex,
    handleColorChange
  )

  const [quickAddState, setQuickAddState] = React.useState<QuickAddState>("idle")
  const resetTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const quickAdd = React.useMemo(() => {
    if (!onQuickAdd) return undefined
    return async () => {
      if (quickAddState === "pending") return
      setQuickAddState("pending")
      try {
        await onQuickAdd(product, colorIndex)
        setQuickAddState("added")
        window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => setQuickAddState("idle"), 2000)
      } catch {
        setQuickAddState("idle")
      }
    }
  }, [onQuickAdd, quickAddState, product, colorIndex])

  // The heart's optimistic value while the shopper's change is in flight.
  const [savedState, setSaved] = useControllableState(wishlistedProp, defaultWishlisted)
  const [pendingSave, setPendingSave] = React.useState<boolean | null>(null)
  const wishlisted = pendingSave ?? savedState
  const toggleWishlist = React.useMemo(() => {
    if (!onWishlistChange) return undefined
    return () => {
      if (pendingSave !== null) return
      const next = !savedState
      setPendingSave(next)
      Promise.resolve()
        .then(() => onWishlistChange(next, product))
        .then(
          () => {
            setSaved(next)
            setPendingSave(null)
          },
          // Rejected: the heart returns to what is true.
          () => setPendingSave(null)
        )
    }
  }, [onWishlistChange, pendingSave, savedState, setSaved, product])

  const color = product.colors?.[colorIndex]
  const context = React.useMemo<ProductCardContextValue>(
    () => ({
      product,
      currency,
      locale,
      density,
      colorIndex,
      setColorIndex,
      color,
      image: color?.image ?? product.image,
      quickAdd,
      quickAddState,
      showColors,
      wishlisted,
      toggleWishlist,
    }),
    [product, currency, locale, density, colorIndex, setColorIndex, color, quickAdd, quickAddState, showColors, wishlisted, toggleWishlist]
  )

  return (
    <ProductCardContext.Provider value={context}>
      <article
        data-slot="product-card"
        className={cn("group relative flex flex-col", className)}
        {...props}
      >
        {children ?? (
          <>
            <ProductCardMedia />
            <ProductCardBody />
          </>
        )}
      </article>
    </ProductCardContext.Provider>
  )
}

/* ─── media ────────────────────────────────────────────────────────────── */

/**
 * The 4:5 frame. Defaults to the image, the badge with the wishlist heart
 * under it, and quick-add; pass children to recompose.
 */
export function ProductCardMedia({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  useProductCard()
  return (
    <div
      data-slot="product-card-media"
      className={cn("relative aspect-[4/5] overflow-hidden bg-secondary", className)}
      {...props}
    >
      {children ?? (
        <>
          <ProductCardImage />
          <ProductCardCorner>
            <ProductCardBadge />
            <ProductCardWishlist />
          </ProductCardCorner>
          <ProductCardQuickAdd />
        </>
      )}
    </div>
  )
}

/** Fills the media frame with the selected colour's image. */
export function ProductCardImage({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { image } = useProductCard()
  return (
    <div data-slot="product-card-image" className={cn("absolute inset-0", className)} {...props}>
      {image}
    </div>
  )
}

/**
 * The top-left corner: a column for the badge and the heart, so the heart
 * sits under the badge whatever the badge says — and at the top when there
 * is none. Above the card's link overlay.
 */
export function ProductCardCorner({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="product-card-corner"
      className={cn(
        "absolute top-0 start-0 z-10 flex flex-col items-start gap-2 [&>[data-slot=product-card-badge]]:static",
        className
      )}
      {...props}
    />
  )
}

export function ProductCardBadge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  const { product } = useProductCard()
  if (!product.badge) return null
  return (
    <span
      data-slot="product-card-badge"
      className={cn(
        "absolute top-0 start-0 bg-foreground px-2.5 py-1.5 text-[11px] tracking-[0.16em] text-background uppercase",
        className
      )}
      {...props}
    >
      {product.badge}
    </span>
  )
}

/**
 * The heart, on your shadcn Toggle. Shown when the card has
 * `onWishlistChange`; fills at once and rolls back if the handler rejects.
 */
export function ProductCardWishlist({ className }: { className?: string }) {
  const t = useT()
  const { product, wishlisted, toggleWishlist } = useProductCard()
  if (!toggleWishlist) return null
  return (
    <Toggle
      data-slot="product-card-wishlist"
      pressed={wishlisted}
      onPressedChange={() => toggleWishlist()}
      aria-label={
        wishlisted
          ? t("ecomcn.productCard.wishlistSaved", "Saved {name} to your wishlist", { name: product.name })
          : t("ecomcn.productCard.wishlistSave", "Save {name} to your wishlist", { name: product.name })
      }
      className={cn(
        "relative z-10 ms-2 size-8 min-w-8 rounded-none first:mt-2 bg-background/90 p-0 text-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-background/90 data-[state=on]:text-foreground",
        className
      )}
    >
      <Heart aria-hidden className={cn("size-4 transition-colors", wishlisted && "fill-current")} />
    </Toggle>
  )
}

export function ProductCardQuickAdd({ className }: { className?: string }) {
  const t = useT()
  const { quickAdd, quickAddState } = useProductCard()
  if (!quickAdd) return null

  return (
    // focus-visible keeps this reachable without a pointer; the card link
    // sits behind it via the ::after overlay on the title anchor.
    <Button
      type="button"
      data-slot="product-card-quick-add"
      onClick={quickAdd}
      disabled={quickAddState === "pending"}
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 h-11 translate-y-full rounded-none text-[12px] tracking-[0.14em] transition-transform duration-200 motion-reduce:transition-none",
        "group-hover:translate-y-0 focus-visible:translate-y-0",
        quickAddState === "added" &&
          "translate-y-0 bg-[var(--success)] hover:bg-[var(--success)]",
        className
      )}
    >
      {quickAddState === "added" ? (
        <>
          <Check className="me-1.5 size-3.5" aria-hidden /> {t("ecomcn.productCard.inBag", "IN BAG")}
        </>
      ) : (
        <>
          <Plus className="me-1.5 size-3.5" aria-hidden />
          {quickAddState === "pending" ? t("ecomcn.productCard.adding", "ADDING…") : t("ecomcn.productCard.quickAdd", "QUICK ADD")}
        </>
      )}
    </Button>
  )
}

/* ─── body ─────────────────────────────────────────────────────────────── */

/** The text column. Defaults to brand, title, price and meta; pass children to recompose. */
export function ProductCardBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { density } = useProductCard()
  return (
    <div
      data-slot="product-card-body"
      className={cn("flex flex-1 flex-col", density === "compact" ? "pt-2.5" : "pt-3.5", className)}
      {...props}
    >
      {children ?? (
        <>
          <ProductCardBrand />
          <ProductCardTitle />
          <ProductCardPrice />
          <ProductCardMeta />
        </>
      )}
    </div>
  )
}

export function ProductCardBrand({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { product } = useProductCard()
  if (!product.brand) return null
  return (
    <p
      data-slot="product-card-brand"
      className={cn("text-[11px] tracking-[0.18em] text-muted-foreground uppercase", className)}
      {...props}
    >
      {product.brand}
    </p>
  )
}

export function ProductCardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { product } = useProductCard()
  return (
    <h3 data-slot="product-card-title" className={cn("mt-1 text-xl leading-tight", className)} {...props}>
      {/* One link target for the whole card via the ::after overlay — no
          nested anchors. Anything interactive on top needs `relative z-10`. */}
      <a href={product.href} className="after:absolute after:inset-0">
        {product.name}
      </a>
    </h3>
  )
}

export function ProductCardPrice({ className }: { className?: string }) {
  const { product, currency, locale } = useProductCard()
  if (product.price === undefined) return null
  return (
    <PriceTag
      price={product.price}
      text={product.priceText ? { price: product.priceText } : undefined}
      compareAt={product.compareAt}
      currency={currency}
      locale={locale}
      size="sm"
      className={cn("mt-1.5", className)}
    />
  )
}

/** Swatches and rating on one line. Hidden in the compact density. */
export function ProductCardMeta({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { product, density, showColors } = useProductCard()
  if (density === "compact") return null
  const colors = showColors && product.colors?.length
  if (!children && !colors && product.rating === undefined) return null
  return (
    <div
      data-slot="product-card-meta"
      className={cn("mt-3 flex items-center justify-between gap-3", className)}
      {...props}
    >
      {children ?? (
        <>
          <ProductCardSwatches />
          <ProductCardRating />
        </>
      )}
    </div>
  )
}

export function ProductCardSwatches({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { product, colorIndex, setColorIndex, showColors } = useProductCard()
  if (!showColors || !product.colors?.length) return <span />
  return (
    <div
      role="group"
      aria-label={t("ecomcn.productCard.colour", "Colour")}
      data-slot="product-card-swatches"
      className={cn("relative z-10 flex gap-1.5", className)}
      {...props}
    >
      {product.colors.map((color, i) => (
        <button
          key={color.name}
          type="button"
          aria-label={color.name}
          aria-pressed={i === colorIndex}
          onClick={() => setColorIndex(i)}
          className={cn(
            "size-4 border transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            i === colorIndex
              ? "border-foreground ring-1 ring-foreground ring-offset-2 ring-offset-background"
              : "border-foreground/20 hover:border-foreground/50"
          )}
          style={{ background: color.hex }}
        />
      ))}
    </div>
  )
}

export function ProductCardRating({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  const t = useT()
  const { product, locale } = useProductCard()
  if (product.rating === undefined) return null
  return (
    <span
      data-slot="product-card-rating"
      className={cn("flex items-center gap-1 text-xs text-muted-foreground tabular-nums", className)}
      {...props}
    >
      <Star className="size-3 fill-current" aria-hidden />
      <span className="sr-only">{t("ecomcn.productCard.rated", "Rated")}</span>
      {new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        product.rating
      )}
      {product.reviewCount ? (
        <span className="opacity-60">
          ({new Intl.NumberFormat(locale).format(product.reviewCount)}
          <span className="sr-only"> {t("ecomcn.productCard.reviews", "reviews")}</span>)
        </span>
      ) : null}
    </span>
  )
}
