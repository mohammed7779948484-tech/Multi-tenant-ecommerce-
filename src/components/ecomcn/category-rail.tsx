"use client"

import * as React from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

/*
 * A row of categories to start from: numbered tiles with a photo, a name
 * and how many items are in each, snapping as it scrolls.
 *
 *   <CategoryRail items={[{ id: "bags", label: "Bags", href: "/c/bags", count: 24, image: <img … /> }]} />
 *
 * Tiles sit 1px apart over a track in your border colour, so the rail
 * reads as one ruled object rather than floating cards. It is your shadcn
 * Carousel: drag, swipe, or the arrow keys once it has focus, and the
 * previous / next buttons are the Carousel's own — hidden, not just
 * disabled, when everything already fits. Tabbing to a tile that is out of
 * view brings it in. The arrows fade in and out (Motion; instant under
 * reduced motion).
 */

export interface CategoryRailItem {
  id: string
  label: string
  href: string
  /** Items in the category, shown as "24 items". */
  count?: number
  /** Already rendered, so the block never assumes next/image. Fills a 4:5 box. */
  image?: React.ReactNode
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

const subscribeNothing = () => () => {}

type CarouselProps = React.ComponentProps<typeof Carousel>

export interface CategoryRailProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  items: CategoryRailItem[]
  /** "Shop by category", by default. Pass null for no header. */
  title?: React.ReactNode
  /** Shows "01", "02" on each tile. Defaults to true. */
  numbered?: boolean
  /** "24 items" by default. */
  formatCount?: (count: number) => string
  /** `undefined` follows the visitor's locale, once hydrated. */
  locale?: string
  /** Embla options, passed to the Carousel. */
  opts?: CarouselProps["opts"]
  loading?: boolean
}

export function CategoryRail({
  items,
  title: titleProp,
  numbered = true,
  formatCount,
  locale: localeProp,
  opts,
  loading = false,
  className,
  ...props
}: CategoryRailProps) {
  const t = useT()
  const title = titleProp === undefined ? t("ecomcn.categoryRail.title", "Shop by category") : titleProp
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  const locale = localeProp ?? (hydrated ? undefined : "en-US")
  const reduce = useReducedMotion()
  const headingId = React.useId()
  const [api, setApi] = React.useState<CarouselApi>()
  const [overflowing, setOverflowing] = React.useState(false)

  React.useEffect(() => {
    if (!api) return
    const measure = () => setOverflowing(api.canScrollPrev() || api.canScrollNext())
    measure()
    api.on("reInit", measure).on("resize", measure).on("select", measure)
    return () => {
      api.off("reInit", measure).off("resize", measure).off("select", measure)
    }
  }, [api])

  const number = React.useMemo(() => new Intl.NumberFormat(locale), [locale])
  const countText = (count: number) =>
    formatCount ? formatCount(count) : t("ecomcn.categoryRail.items", "{count} items", { count: number.format(count) })

  // A tile reached by Tab may be off to the side: bring it in, and undo the
  // browser's own attempt to scroll the clipped viewport.
  const reveal = (index: number) => (event: React.FocusEvent<HTMLElement>) => {
    const viewport = event.currentTarget.closest<HTMLElement>("[data-slot=carousel-content]")
    if (viewport) viewport.scrollLeft = 0
    if (api && !api.slidesInView().includes(index)) api.scrollTo(index)
  }

  const tiles = loading ? Array.from({ length: 5 }, () => null) : items

  return (
    <MotionConfig reducedMotion="user">
      <section
        data-slot="category-rail"
        aria-labelledby={title !== null ? headingId : undefined}
        aria-busy={loading || undefined}
        className={cn("flex flex-col gap-5", className)}
        {...props}
      >
        <Carousel setApi={setApi} opts={{ align: "start", containScroll: "trimSnaps", ...opts }} className="flex flex-col gap-5">
          {title !== null ? (
            <div data-slot="category-rail-header" className="flex items-end justify-between gap-4 border-b pb-4">
              <h2 id={headingId} className="text-2xl">
                {title}
              </h2>
              <motion.div
                className="flex gap-2"
                initial={{ opacity: 0, visibility: "hidden" }}
                // Nothing to scroll: faded, then gone for the pointer, the keyboard and screen readers.
                animate={overflowing ? { opacity: 1, visibility: "visible" } : { opacity: 0, transitionEnd: { visibility: "hidden" } }}
                transition={reduce ? { duration: 0 } : MORPH}
              >
                <CarouselPrevious className="static size-9 translate-x-0 rtl:-translate-x-0 translate-y-0 rounded-none shadow-none" />
                <CarouselNext className="static size-9 translate-x-0 rtl:-translate-x-0 translate-y-0 rounded-none shadow-none" />
              </motion.div>
            </div>
          ) : null}

          <div className="border">
            {loading ? (
              <span className="sr-only" role="status">
                {t("ecomcn.categoryRail.loading", "Loading categories")}
              </span>
            ) : null}
            {/* The track shows through the 1px padding between tiles: one ruled object. */}
            <CarouselContent className="-ms-px bg-border">
              {tiles.map((item, i) => (
                <CarouselItem
                  key={item?.id ?? i}
                  className="basis-[46%] ps-px sm:basis-1/3 md:basis-1/4 lg:basis-1/5"
                  onFocus={reveal(i)}
                  aria-label={item ? item.label : undefined}
                  aria-hidden={item ? undefined : true}
                >
                  {item ? (
                    <a
                      href={item.href}
                      data-slot="category-rail-tile"
                      className="group flex h-full flex-col bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span className="relative block aspect-[4/5] overflow-hidden bg-secondary">
                        {item.image ? (
                          <span className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.04] [&>img]:size-full [&>img]:object-cover">
                            {item.image}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-baseline gap-3 px-4 pt-3 pb-4">
                        {numbered ? (
                          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        ) : null}
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium underline-offset-4 group-hover:underline">{item.label}</span>
                          {item.count !== undefined ? (
                            <span className="text-[13px] text-muted-foreground tabular-nums">{countText(item.count)}</span>
                          ) : null}
                        </span>
                      </span>
                    </a>
                  ) : (
                    <span className="flex h-full flex-col bg-background">
                      <Skeleton className="aspect-[4/5] w-full rounded-none" />
                      <span className="flex flex-col gap-2 px-4 pt-3 pb-4">
                        <Skeleton className="h-3.5 w-20 rounded-none" />
                        <Skeleton className="h-3 w-14 rounded-none" />
                      </span>
                    </span>
                  )}
                </CarouselItem>
              ))}
            </CarouselContent>
          </div>
        </Carousel>
      </section>
    </MotionConfig>
  )
}
