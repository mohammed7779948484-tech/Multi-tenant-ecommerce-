"use client"

import * as React from "react"
import { ChevronDown, Grid2x2, Grid3x3 } from "lucide-react"

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

export interface SortOption {
  value: string
  label: string
}

export const DEFAULT_SORT_OPTIONS: SortOption[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" },
  { value: "rating", label: "Top rated" },
]

export interface SortToolbarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Results for the current filters. */
  total: number
  /** While true the count dims and nothing is announced. */
  loading?: boolean
  sort?: string
  onSortChange?: (value: string) => void
  sortOptions?: SortOption[]
  density?: "comfortable" | "compact"
  /** Omit to hide the density switch. */
  onDensityChange?: (density: "comfortable" | "compact") => void
  /** Shown below `lg` only — usually a `<FilterSheet />`. */
  filters?: React.ReactNode
  locale?: string
  noun?: { one: string; other: string }
  /** Wins over `noun`: the whole count phrase, for languages with more plural forms than one/other. */
  formatCount?: (count: number) => string
}

export function SortToolbar({
  total,
  loading,
  sort,
  onSortChange,
  sortOptions = DEFAULT_SORT_OPTIONS,
  density = "comfortable",
  onDensityChange,
  filters,
  locale: localeProp,
  noun = { one: "product", other: "products" },
  formatCount,
  className,
  ...props
}: SortToolbarProps) {
  const t = useT()
  const locale = useFormatLocale(localeProp)
  const id = React.useId()
  const label = formatCount
    ? formatCount(total)
    : `${new Intl.NumberFormat(locale).format(total)} ${
        new Intl.PluralRules(locale).select(total) === "one" ? noun.one : noun.other
      }`

  // The visible count changes silently for a screen-reader user, who can't
  // see the grid reflow. Announce it — but only once results settle, only
  // after the first render, and at most once per burst of filter clicks.
  const [announcement, setAnnouncement] = React.useState("")
  const settled = React.useRef(label)
  const wasLoading = React.useRef(loading)

  React.useEffect(() => {
    const finishedLoading = wasLoading.current && !loading
    wasLoading.current = loading
    if (loading) return
    // Nothing new to say: same count, and no fetch just completed.
    if (!finishedLoading && settled.current === label) return
    settled.current = label
    const timer = window.setTimeout(() => {
      // Alternate a zero-width space so an identical count is re-announced.
      setAnnouncement((previous) =>
        previous === label ? `${label}\u200b` : label
      )
    }, 450)
    return () => window.clearTimeout(timer)
  }, [label, loading])

  return (
    // Bounded by hairlines top and bottom: it reads as the masthead rule of
    // the listing, not as a floating control bar.
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 border-y py-3 text-sm",
        className
      )}
      {...props}
    >
      <p
        className={cn(
          "tabular-nums transition-opacity",
          loading && "opacity-40"
        )}
        aria-hidden={loading || undefined}
      >
        {label}
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      <div className="ms-auto flex items-center gap-2">
        {filters ? <div className="lg:hidden">{filters}</div> : null}

        {/* A native select, deliberately: on a phone it opens the OS picker,
            which is better than any popover we could draw, and it needs no
            positioning, portal or scroll lock. */}
        <label htmlFor={`${id}-sort`} className="sr-only sm:not-sr-only sm:text-muted-foreground">
          {t("ecomcn.sort.label", "Sort")}
        </label>
        <div className="relative">
          <select
            id={`${id}-sort`}
            value={sort ?? sortOptions[0]?.value}
            onChange={(event) => onSortChange?.(event.target.value)}
            className="h-9 appearance-none rounded-sm border bg-background py-0 pe-8 ps-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 end-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>

        {onDensityChange && (
          // Compact adds a column from `sm` up. Below that there is no room
          // for one, so the switch hides rather than offering a dead control.
          <div role="group" aria-label={t("ecomcn.sort.density", "Grid density")} className="hidden items-center border sm:flex">
            {(
              [
                ["comfortable", Grid2x2, t("ecomcn.sort.comfortable", "Comfortable grid")],
                ["compact", Grid3x3, t("ecomcn.sort.compact", "Compact grid")],
              ] as const
            ).map(([key, Icon, name]) => (
              <button
                key={key}
                type="button"
                aria-label={name}
                aria-pressed={density === key}
                onClick={() => onDensityChange(key)}
                className={cn(
                  "grid size-9 place-items-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  density === key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
