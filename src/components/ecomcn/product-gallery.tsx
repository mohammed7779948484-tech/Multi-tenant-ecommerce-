"use client"

import * as React from "react"
import { ImageOff, Maximize2, X } from "lucide-react"
import { MotionConfig, animate, motion, useReducedMotion, type AnimationPlaybackControls } from "motion/react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

/*
 * The product's photos: a main image with a counter, and a rail of thumbnails
 * beside it on a desktop and under it on a phone.
 *
 *   <ProductGallery images={images} label="Vester Chelsea Boot" />
 *
 *   <ProductGallery images={images}>                                   or composed
 *     <ProductGalleryMain />
 *     <ProductGalleryThumbs />
 *   </ProductGallery>
 *
 * Swipe on a phone; on a desktop the mouse zooms where it points, and the
 * thumbnails, arrows and arrow keys move between photos. Pressing the photo
 * opens it full screen — the screen grows out of the photo and folds back
 * into it — which is also the zoom for touch and the keyboard. The active
 * thumbnail carries a solid frame that slides to the next one; the rest drop
 * to 60%. The first photo loads at once, the second is fetched early, and
 * the rest wait until they are next.
 *
 * Images are data, rendered as <img> by default. Pass `renderImage` to use
 * your framework's image component instead; the gallery still decides which
 * one has priority and which load lazily.
 */

export interface GalleryImage {
  src: string
  alt: string
  srcSet?: string
  /** A larger file for the zoom and the full-screen view. Defaults to `src`. */
  zoomSrc?: string
  /** A smaller file for the thumbnail. Defaults to `src`. */
  thumbSrc?: string
}

export interface GalleryImageRenderProps {
  index: number
  /** The first photo: render with your framework's priority / preload. */
  priority: boolean
  loading: "eager" | "lazy"
  sizes: string
  className: string
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

/** Scrolls, without drawing a scrollbar. */
const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

/** A mouse zooms; a finger swipes. Embla drags only for touch and pen. */
const touchOnly = (_api: unknown, event: MouseEvent | TouchEvent) =>
  !("pointerType" in event) || (event as PointerEvent).pointerType !== "mouse"

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

export interface ProductGalleryContextValue {
  images: GalleryImage[]
  /** The photo on show. */
  index: number
  setIndex: (index: number) => void
  /** "Vester Chelsea Boot" — names the gallery and its full-screen view. */
  label: string
  /** Width over height of the main frame. */
  aspectRatio: number
  sizes: string
  zoom: boolean
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  loading: boolean
  renderImage: (image: GalleryImage, props: GalleryImageRenderProps) => React.ReactNode
  /** The furthest photo shown so far: the next one after it loads early. */
  reached: number
}

/** Internal: the morph's anchor and the primitive's lifetime. */
interface GalleryInternals {
  frame: React.RefObject<HTMLDivElement | null>
  mounted: boolean
  closing: boolean
  finishClose: () => void
}

const ProductGalleryContext = React.createContext<ProductGalleryContextValue | null>(null)
const InternalsContext = React.createContext<GalleryInternals | null>(null)

export function useProductGallery() {
  const context = React.useContext(ProductGalleryContext)
  if (!context) {
    throw new Error("useProductGallery must be used within <ProductGallery>.")
  }
  return context
}

function useInternals() {
  const context = React.useContext(InternalsContext)
  if (!context) throw new Error("Product gallery parts must be used within <ProductGallery>.")
  return context
}

function defaultRenderImage(image: GalleryImage, props: GalleryImageRenderProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- framework-free on purpose
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={props.sizes}
      alt={image.alt}
      loading={props.loading}
      fetchPriority={props.priority ? "high" : props.index === 1 ? "low" : "auto"}
      decoding="async"
      draggable={false}
      className={props.className}
    />
  )
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface ProductGalleryProps extends React.HTMLAttributes<HTMLDivElement> {
  images: GalleryImage[]
  /** Names the gallery for screen readers: the product's name. */
  label?: string
  index?: number
  defaultIndex?: number
  onIndexChange?: (index: number) => void
  /** Width over height of the main frame. Defaults to 4 / 5. */
  aspectRatio?: number
  /** The main photo's `sizes`. Defaults to half the screen from md up. */
  sizes?: string
  /** Hover zoom with a mouse. Defaults to true. */
  zoom?: boolean
  /** Render each photo with your own component — next/image, say. */
  renderImage?: (image: GalleryImage, props: GalleryImageRenderProps) => React.ReactNode
  loading?: boolean
}

export function ProductGallery({
  images,
  label = "Product images",
  index: indexProp,
  defaultIndex = 0,
  onIndexChange,
  aspectRatio = 4 / 5,
  sizes = "(min-width: 768px) 50vw, 100vw",
  zoom = true,
  renderImage = defaultRenderImage,
  loading = false,
  className,
  children,
  ...props
}: ProductGalleryProps) {
  const [rawIndex, setIndexState] = useControllableState(indexProp, defaultIndex, onIndexChange)
  const last = Math.max(0, images.length - 1)
  const index = Math.min(Math.max(0, rawIndex), last)

  // The furthest photo reached; the one after it is fetched early.
  const [reached, setReached] = React.useState(index)
  if (index > reached) setReached(index)

  // A new set of photos — another colour — starts again from the first.
  // In an effect: a controlled parent's onIndexChange must not run mid-render.
  const firstSrc = images[0]?.src
  const shownSet = React.useRef(firstSrc)
  React.useEffect(() => {
    if (shownSet.current === firstSrc) return
    shownSet.current = firstSrc
    setIndexState(0)
  }, [firstSrc, setIndexState])

  // Full screen: `expanded` is what the shopper asked for; `mounted` keeps the
  // dialog on screen while it folds back into the photo.
  const [expanded, setExpandedState] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  if (expanded && !mounted) setMounted(true)
  const closing = mounted && !expanded
  const frame = React.useRef<HTMLDivElement>(null)
  const indexRef = React.useRef(0)
  // The dialog opens from the photo, not from a trigger, so the primitive has
  // nothing to hand focus back to: return it to the photo now on show.
  const finishClose = React.useCallback(() => {
    setMounted(false)
    window.requestAnimationFrame(() => {
      frame.current
        ?.querySelectorAll<HTMLElement>('[data-slot="carousel-item"] button')
        [indexRef.current]?.focus({ preventScroll: true })
    })
  }, [])

  const setIndex = React.useCallback(
    (next: number) => setIndexState(Math.min(Math.max(0, next), last)),
    [setIndexState, last]
  )
  React.useEffect(() => {
    indexRef.current = index
  }, [index])

  const context = React.useMemo<ProductGalleryContextValue>(
    () => ({
      images,
      index,
      setIndex,
      label,
      aspectRatio,
      sizes,
      zoom,
      expanded,
      setExpanded: setExpandedState,
      loading,
      renderImage,
      reached,
    }),
    [images, index, setIndex, label, aspectRatio, sizes, zoom, expanded, loading, renderImage, reached]
  )
  const internals = React.useMemo<GalleryInternals>(
    () => ({ frame, mounted, closing, finishClose }),
    [mounted, closing, finishClose]
  )

  return (
    <ProductGalleryContext.Provider value={context}>
      <InternalsContext.Provider value={internals}>
        <MotionConfig reducedMotion="user">
          <div
            role="region"
            aria-label={label}
            aria-busy={loading || undefined}
            data-slot="product-gallery"
            className={cn(
              children ? "flex flex-col gap-3" : "grid gap-3 md:grid-cols-[4.5rem_minmax(0,1fr)] md:gap-4",
              className
            )}
            {...props}
          >
            {children ?? (
              <>
                <ProductGalleryMain className="md:col-start-2 md:row-start-1" />
                <ProductGalleryThumbs className="md:col-start-1 md:row-start-1" />
              </>
            )}
          </div>
          {mounted ? <ProductGalleryLightbox /> : null}
        </MotionConfig>
      </InternalsContext.Provider>
    </ProductGalleryContext.Provider>
  )
}

/* ─── main ─────────────────────────────────────────────────────────────── */

/**
 * The main photo, on your shadcn Carousel: swipe on touch, the arrows over
 * its edges, the arrow keys once it has focus. A mouse over it zooms where it
 * points. Pressing it opens the photo full screen.
 */
export function ProductGalleryMain({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { images, index, setIndex, label, aspectRatio, loading, setExpanded } = useProductGallery()
  const { frame } = useInternals()
  const [api, setApi] = React.useState<CarouselApi>()

  // The carousel follows the index — a thumbnail, the full-screen view, a
  // controlled prop — and the index follows the carousel — a swipe, a key.
  React.useEffect(() => {
    if (!api) return
    const onSelect = () => setIndex(api.selectedScrollSnap())
    api.on("select", onSelect)
    return () => {
      api.off("select", onSelect)
    }
  }, [api, setIndex])
  React.useEffect(() => {
    if (api && api.selectedScrollSnap() !== index) api.scrollTo(index)
  }, [api, index])

  if (loading) {
    return (
      <div
        aria-hidden
        className={cn("w-full animate-pulse bg-muted", className)}
        style={{ aspectRatio }}
      />
    )
  }

  if (!images.length) {
    return (
      <div
        data-slot="product-gallery-empty"
        className={cn("grid w-full place-items-center bg-secondary text-muted-foreground", className)}
        style={{ aspectRatio }}
      >
        <span className="flex flex-col items-center gap-2 text-sm">
          <ImageOff aria-hidden className="size-5" />
          No photos yet
        </span>
      </div>
    )
  }

  const image = images[index]

  return (
    <div ref={frame} data-slot="product-gallery-main" className={cn("group/gallery relative min-w-0", className)} {...props}>
      <Carousel
        setApi={setApi}
        opts={{ startIndex: index, watchDrag: touchOnly }}
        aria-label={label}
        className="bg-secondary"
      >
        <CarouselContent className="ms-0">
          {images.map((img, i) => (
            <CarouselItem key={`${img.src}-${i}`} aria-label={t("ecomcn.gallery.position", "{index} of {count}", { index: i + 1, count: images.length })} className="ps-0">
              <GallerySlide image={img} index={i} onOpen={() => setExpanded(true)} />
            </CarouselItem>
          ))}
        </CarouselContent>
        {images.length > 1 ? (
          <>
            <CarouselPrevious className="start-3 size-9 rounded-none border-0 bg-background/90 opacity-0 shadow-none transition-opacity group-hover/gallery:opacity-100 focus-visible:opacity-100 disabled:opacity-0 [@media(hover:none)]:hidden" />
            <CarouselNext className="end-3 size-9 rounded-none border-0 bg-background/90 opacity-0 shadow-none transition-opacity group-hover/gallery:opacity-100 focus-visible:opacity-100 disabled:opacity-0 [@media(hover:none)]:hidden" />
          </>
        ) : null}
      </Carousel>

      {images.length > 1 ? (
        <span
          aria-hidden
          data-slot="product-gallery-counter"
          className="pointer-events-none absolute bottom-3 start-3 bg-background/90 px-2 py-1 text-[11px] tracking-[0.14em] tabular-nums"
        >
          {index + 1} / {images.length}
        </span>
      ) : null}
      <span aria-hidden className="pointer-events-none absolute top-3 end-3 grid size-9 place-items-center bg-background/90">
        <Maximize2 className="size-4" />
      </span>
      {/* Read out on every change: which photo, and what it shows. */}
      <span className="sr-only" aria-live="polite">
        {t("ecomcn.gallery.image", "Image {index} of {count}: {alt}", { index: index + 1, count: images.length, alt: image?.alt ?? "" })}
      </span>
    </div>
  )
}

/**
 * One photo: a button that opens the full-screen view, and — with a mouse —
 * a zoom that follows the pointer. The larger file fades in over the photo
 * once it has loaded.
 */
function GallerySlide({ image, index, onOpen }: { image: GalleryImage; index: number; onOpen: () => void }) {
  const t = useT()
  const { aspectRatio, sizes, zoom, renderImage, reached, images } = useProductGallery()
  const reduce = useReducedMotion()
  const surface = React.useRef<HTMLDivElement>(null)
  const [zoomed, setZoomed] = React.useState(false)
  const [sharp, setSharp] = React.useState(false)
  const zoomSrc = image.zoomSrc ?? image.src
  const canZoom = zoom && !reduce

  const aim = (event: React.PointerEvent) => {
    const node = surface.current
    if (!node) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * 100
    const y = ((event.clientY - box.top) / box.height) * 100
    node.style.transformOrigin = `${x}% ${y}%`
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("ecomcn.gallery.fullScreen", "View image {index} of {count} full screen: {alt}", { index: index + 1, count: images.length, alt: image.alt })}
      onPointerEnter={(event) => {
        if (!canZoom || event.pointerType !== "mouse") return
        aim(event)
        setZoomed(true)
      }}
      onPointerMove={(event) => {
        if (zoomed) aim(event)
      }}
      onPointerLeave={() => setZoomed(false)}
      className={cn(
        "relative block w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        canZoom ? "cursor-zoom-in" : "cursor-pointer"
      )}
      style={{ aspectRatio }}
    >
      <motion.div
        ref={surface}
        className="absolute inset-0"
        initial={false}
        animate={{ scale: zoomed ? 2 : 1 }}
        transition={MORPH}
      >
        {renderImage(image, {
          index,
          priority: index === 0,
          // The first two load with the page; the rest once they are next.
          loading: index <= Math.max(1, reached + 1) ? "eager" : "lazy",
          sizes,
          className: "absolute inset-0 size-full object-cover",
        })}
        {zoomed && zoomSrc !== image.src ? (
          // eslint-disable-next-line @next/next/no-img-element -- the zoom's larger file
          <img
            src={zoomSrc}
            alt=""
            aria-hidden
            draggable={false}
            onLoad={() => setSharp(true)}
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-300",
              sharp ? "opacity-100" : "opacity-0"
            )}
          />
        ) : null}
      </motion.div>
    </button>
  )
}

/* ─── thumbnails ───────────────────────────────────────────────────────── */

/**
 * The thumbnails: a column beside the photo from md up, a row under it on a
 * phone, scrolling without a scrollbar. The active one has a solid frame
 * that slides to the next; the rest sit at 60%, not greyed out.
 */
export function ProductGalleryThumbs({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { images, index, setIndex, label, aspectRatio, loading } = useProductGallery()
  const reduce = useReducedMotion()
  const scope = React.useId()
  const rail = React.useRef<HTMLDivElement>(null)

  // Keep the active thumbnail in view — by scrolling the rail itself, never
  // the page, as scrollIntoView would.
  React.useEffect(() => {
    const node = rail.current
    const active = node?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!node || !active) return
    const vertical = node.scrollHeight > node.clientHeight && node.scrollWidth <= node.clientWidth
    if (vertical) {
      const top = active.offsetTop - node.offsetTop
      if (top < node.scrollTop || top + active.offsetHeight > node.scrollTop + node.clientHeight) {
        node.scrollTo({ top: top - node.clientHeight / 2 + active.offsetHeight / 2, behavior: reduce ? "auto" : "smooth" })
      }
    } else {
      const left = active.offsetLeft - node.offsetLeft
      if (left < node.scrollLeft || left + active.offsetWidth > node.scrollLeft + node.clientWidth) {
        node.scrollTo({ left: left - node.clientWidth / 2 + active.offsetWidth / 2, behavior: reduce ? "auto" : "smooth" })
      }
    }
  }, [index, reduce])

  if (loading) {
    return (
      <div aria-hidden className={cn("flex gap-2 md:flex-col", className)}>
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="w-16 shrink-0 animate-pulse bg-muted md:w-full" style={{ aspectRatio }} />
        ))}
      </div>
    )
  }
  if (images.length < 2) return null

  return (
    <div
      ref={rail}
      role="group"
      aria-label={t("ecomcn.gallery.choose", "{label}: choose an image", { label })}
      data-slot="product-gallery-thumbs"
      className={cn(
        "flex gap-2 overflow-x-auto overscroll-x-contain p-0.5 md:max-h-[min(80dvh,44rem)] md:flex-col md:overflow-x-visible md:overflow-y-auto md:overscroll-y-contain",
        NO_SCROLLBAR,
        className
      )}
      {...props}
    >
      {images.map((image, i) => {
        const active = i === index
        return (
          <button
            key={`${image.src}-${i}`}
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={t("ecomcn.gallery.image", "Image {index} of {count}: {alt}", { index: i + 1, count: images.length, alt: image.alt })}
            onClick={() => setIndex(i)}
            className={cn(
              "relative w-16 shrink-0 bg-secondary outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring md:w-full",
              active ? "opacity-100" : "opacity-60 hover:opacity-100"
            )}
            style={{ aspectRatio }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- framework-free on purpose */}
            <img
              src={image.thumbSrc ?? image.src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 size-full object-cover"
            />
            {active ? (
              <motion.span
                aria-hidden
                layoutId={reduce ? undefined : `${scope}-active`}
                initial={reduce ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={reduce ? { duration: 0.15 } : MORPH}
                className="absolute inset-0 border-2 border-foreground"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* ─── full screen ──────────────────────────────────────────────────────── */

/**
 * The full-screen view, on your shadcn Dialog. It grows out of the main
 * photo — the photo's box opening to the screen, the image fading in once it
 * has — and folds back into it on close. Swipe, the arrows or the arrow keys
 * move between photos, and the main photo follows.
 */
function ProductGalleryLightbox() {
  const t = useT()
  const { images, index, setIndex, label, expanded, setExpanded } = useProductGallery()
  const [api, setApi] = React.useState<CarouselApi>()

  React.useEffect(() => {
    if (!api) return
    const onSelect = () => setIndex(api.selectedScrollSnap())
    api.on("select", onSelect)
    return () => {
      api.off("select", onSelect)
    }
  }, [api, setIndex])
  React.useEffect(() => {
    if (api && api.selectedScrollSnap() !== index) api.scrollTo(index)
  }, [api, index])

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Escape pressed twice, or the overlay clicked mid-close: already going.
        if (!next && expanded) setExpanded(false)
      }}
    >
      <DialogContent
        showCloseButton={false}
        // The primitive positions and traps focus; its surface, padding and
        // keyframes are off, and Motion plays the open and the close.
        className="top-0 start-0 h-dvh w-screen max-w-none translate-x-0 rtl:-translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-transparent p-0 shadow-none ring-0 animate-none! transition-none! sm:max-w-none"
      >
        <LightboxPanel>
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <DialogDescription className="sr-only">
            Full-screen photos. Use the arrow keys or swipe to move between them.
          </DialogDescription>
          <Carousel
            setApi={setApi}
            opts={{ startIndex: index }}
            aria-label={label}
            className="flex size-full flex-col"
          >
            <div className="flex h-15 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
              <span className="text-[11px] tracking-[0.14em] tabular-nums">
                {index + 1} / {images.length}
              </span>
              <DialogClose
                className="grid size-9 place-items-center outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only">{t("ecomcn.gallery.close", "Close")}</span>
              </DialogClose>
            </div>
            <div className="relative min-h-0 flex-1">
              <CarouselContent className="ms-0 h-[calc(100dvh-3.75rem)]">
                {images.map((image, i) => (
                  <CarouselItem
                    key={`${image.src}-${i}`}
                    aria-label={t("ecomcn.gallery.position", "{index} of {count}", { index: i + 1, count: images.length })}
                    className="h-full ps-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- framework-free on purpose */}
                    <img
                      src={image.zoomSrc ?? image.src}
                      alt={image.alt}
                      loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
                      decoding="async"
                      draggable={false}
                      // Fills the slide and fits inside it: the whole photo, never cropped.
                      className="size-full object-contain"
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
              {images.length > 1 ? (
                <>
                  <CarouselPrevious className="start-3 size-10 rounded-none border-0 bg-background/90 shadow-none disabled:opacity-0 sm:start-6" />
                  <CarouselNext className="end-3 size-10 rounded-none border-0 bg-background/90 shadow-none disabled:opacity-0 sm:end-6" />
                </>
              ) : null}
            </div>
          </Carousel>
        </LightboxPanel>
      </DialogContent>
    </Dialog>
  )
}

/** The rectangle `anchor` occupies inside the viewport, as a clip-path inset. */
function insetOf(anchor: HTMLElement | null) {
  const box = anchor?.getBoundingClientRect()
  if (!box || box.width === 0) return null
  const w = window.innerWidth
  const h = window.innerHeight
  return `inset(${box.top}px ${w - box.right}px ${h - box.bottom}px ${box.left}px)`
}

/**
 * The visible surface, and the morph: clipped to the main photo's box, it
 * opens to the full screen; its contents fade in once it has. Closing runs
 * it back into the photo. In a layout effect inside the portal, so the first
 * frame is already clipped — it never flashes full screen.
 */
function LightboxPanel({ children }: { children: React.ReactNode }) {
  const { frame, closing, finishClose } = useInternals()
  const reduce = useReducedMotion()
  const surface = React.useRef<HTMLDivElement>(null)
  const contents = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const panel = surface.current
    const inner = contents.current
    if (!panel || !inner) return
    const overlay = panel
      .closest<HTMLElement>('[data-slot="dialog-content"]')
      ?.parentElement?.querySelector<HTMLElement>(':scope > [data-slot="dialog-overlay"]')
    const running: AnimationPlaybackControls[] = []
    let cancelled = false
    const from = reduce ? null : insetOf(frame.current)

    if (!closing) {
      if (from) {
        panel.style.clipPath = from
        inner.style.opacity = "0"
        running.push(
          animate(panel, { clipPath: [from, "inset(0px 0px 0px 0px)"] }, MORPH),
          animate(inner, { opacity: 1 }, { duration: 0.25, delay: 0.2, ease: "easeOut" })
        )
      } else {
        panel.style.opacity = "0"
        running.push(animate(panel, { opacity: 1 }, { duration: 0.15 }))
      }
      return () => {
        cancelled = true
        running.forEach((a) => a.stop())
      }
    }

    running.push(animate(inner, { opacity: 0 }, { duration: 0.12, ease: "easeIn" }))
    if (from) {
      running.push(animate(panel, { clipPath: from }, { ...MORPH, duration: 0.38, delay: 0.06 }))
    } else {
      running.push(animate(panel, { opacity: 0 }, { duration: 0.15 }))
    }
    if (overlay) running.push(animate(overlay, { opacity: 0 }, { duration: 0.3, delay: 0.1 }))

    // Should a frame never come (a background tab), close anyway.
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
    <div ref={surface} data-slot="product-gallery-lightbox" className="size-full bg-background text-foreground">
      <div ref={contents} className="size-full">
        {children}
      </div>
    </div>
  )
}
