"use client"

import * as React from "react"
import { Check, Minus, Plus, X } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  describeActiveFilters,
  formatRangeBound,
  getRange,
  getToggle,
  getValues,
  removeFilter,
  setRange,
  toggleFilterValue,
  type ActiveFilter,
  type FilterFacet,
  type FilterState,
  type ListFacet,
  type RangeFacet,
  type SwatchFacet,
  type ToggleFacet,
} from "@/lib/filter-params"
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

/* ─── context ──────────────────────────────────────────────────────────────
 * Compound component: <FilterPanel> owns the state and renders its own
 * provider, so nothing has to be mounted above it. Every part reads that
 * state through useFilterPanel(), which throws outside a panel instead of
 * failing silently with undefined values.
 */

export interface FilterPanelContextValue {
  facets: FilterFacet[]
  value: FilterState
  setValue: (next: FilterState) => void
  /** The facet with this id, if the panel has one. */
  getFacet: (id: string) => FilterFacet | undefined
  /** Human labels for everything that is on, in facet order. */
  active: ActiveFilter[]
  currency: string
  locale?: string
  loading?: boolean
  title: string
  titleId: string
  /** Focus lands here when the control that had it disappears. */
  rootRef: React.RefObject<HTMLElement | null>
}

const FilterPanelContext = React.createContext<FilterPanelContextValue | null>(null)

export function useFilterPanel() {
  const context = React.useContext(FilterPanelContext)
  if (!context) {
    throw new Error("useFilterPanel must be used within <FilterPanel>.")
  }
  return context
}

const NO_FILTERS: FilterState = {}

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

export interface FilterPanelProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "defaultValue" | "onChange"> {
  facets: FilterFacet[]
  /** Usually straight from `useFilterParams`, so the state lives in the URL. */
  value?: FilterState
  defaultValue?: FilterState
  onValueChange?: (next: FilterState) => void
  /** ISO 4217 code for `format: "currency"` range facets. */
  currency?: string
  locale?: string
  /** Counts are stale while results load, so they render as placeholders. */
  loading?: boolean
  /** Default layout only: drop the title row, e.g. inside a sheet that has one. */
  hideHeader?: boolean
  title?: string
  /**
   * Compose your own layout from FilterPanelHeader, FilterPanelChips and
   * FilterPanelFacet — reorder, omit, or put your own content between them.
   * Leave empty for the default: header, chips, then every facet in order.
   */
  children?: React.ReactNode
}

export function FilterPanel({
  facets,
  value: valueProp,
  defaultValue = NO_FILTERS,
  onValueChange,
  currency = "USD",
  locale: localeProp,
  loading,
  hideHeader,
  title: titleProp,
  className,
  children,
  ...props
}: FilterPanelProps) {
  const t = useT()
  const title = titleProp ?? t("ecomcn.filters.title", "Filters")
  const locale = useFormatLocale(localeProp)
  const [value, setValue] = useControllableState(valueProp, defaultValue, onValueChange)
  const titleId = React.useId()
  const rootRef = React.useRef<HTMLElement>(null)

  const context = React.useMemo<FilterPanelContextValue>(
    () => ({
      facets,
      value,
      setValue,
      getFacet: (id) => facets.find((facet) => facet.id === id),
      active: describeActiveFilters(value, facets, {
        currency,
        locale,
        rangeLabels: {
          from: (min) => t("ecomcn.filters.rangeFrom", "{min} and up", { min }),
          upTo: (max) => t("ecomcn.filters.rangeUpTo", "Up to {max}", { max }),
        },
      }),
      currency,
      locale,
      loading,
      title,
      titleId,
      rootRef,
    }),
    [facets, value, setValue, currency, locale, loading, title, titleId, t]
  )

  return (
    <FilterPanelContext.Provider value={context}>
      <section
        ref={rootRef}
        tabIndex={-1}
        aria-label={title}
        aria-busy={loading || undefined}
        data-slot="filter-panel"
        className={cn("text-sm outline-none", className)}
        {...props}
      >
        {children ?? (
          <>
            {hideHeader ? null : <FilterPanelHeader />}
            <FilterPanelChips />
            {facets.length === 0 ? (
              <p className="border-t py-4 text-muted-foreground">
                {t("ecomcn.filters.none", "No filters for this collection.")}
              </p>
            ) : (
              facets.map((facet) => <FilterPanelFacet key={facet.id} id={facet.id} />)
            )}
          </>
        )}
      </section>
    </FilterPanelContext.Provider>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

export function FilterPanelHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const t = useT()
  const { active, setValue, title, titleId, rootRef } = useFilterPanel()

  return (
    <div
      data-slot="filter-panel-header"
      className={cn("flex items-baseline justify-between gap-4 pb-3", className)}
      {...props}
    >
      <h2 id={titleId} className="text-xs font-medium tracking-[0.14em] uppercase">
        {title}
        {active.length > 0 && (
          <span className="ms-1.5 text-muted-foreground tabular-nums">{active.length}</span>
        )}
      </h2>
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => {
            // This button is about to disappear; hand focus to the panel first.
            rootRef.current?.focus()
            setValue({})
          }}
          className="text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
        >
          {t("ecomcn.filters.clearAll", "Clear all")}
        </button>
      )}
    </div>
  )
}

export function FilterPanelChips({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  const t = useT()
  const { active, value, setValue, rootRef } = useFilterPanel()

  // Removing a chip deletes the button that had focus. Put focus on the chip
  // that slid into its place — or the panel itself — instead of <body>.
  const chips = React.useRef<(HTMLButtonElement | null)[]>([])
  const refocus = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (refocus.current === null) return
    const index = Math.min(refocus.current, active.length - 1)
    refocus.current = null
    ;(chips.current[index] ?? rootRef.current)?.focus()
  }, [active.length, rootRef])

  if (active.length === 0) return null

  return (
    <ul
      aria-label={t("ecomcn.filters.applied", "Applied filters")}
      data-slot="filter-panel-chips"
      className={cn("flex flex-wrap gap-1.5 pb-4", className)}
      {...props}
    >
      {active.map((filter, index) => (
        <li key={`${filter.facetId}:${filter.value ?? ""}`}>
          <button
            ref={(node) => {
              chips.current[index] = node
            }}
            type="button"
            onClick={() => {
              refocus.current = index
              setValue(removeFilter(value, filter.facetId, filter.value))
            }}
            className="group inline-flex h-7 items-center gap-1.5 rounded-sm border bg-secondary/60 pe-1.5 ps-2 text-xs transition-colors outline-none hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="sr-only">{t("ecomcn.filters.remove", "Remove {facet}:", { facet: filter.facetLabel })}</span>
            {filter.label}
            <X
              className="size-3 text-muted-foreground group-hover:text-foreground"
              aria-hidden
            />
          </button>
        </li>
      ))}
    </ul>
  )
}

export interface FilterPanelFacetProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The facet's id — the same string that keys it in the URL. */
  id: string
  /** Collapsible facets start open unless this is false. */
  defaultOpen?: boolean
}

export function FilterPanelFacet({ id, defaultOpen = true, className, ...props }: FilterPanelFacetProps) {
  const { getFacet } = useFilterPanel()
  const facet = getFacet(id)

  // An id with no facet renders nothing, so a server that drops an empty
  // facet from the list doesn't break a hand-written layout.
  if (!facet) return null
  if (facet.type === "toggle") {
    return <ToggleRow facet={facet} className={className} {...props} />
  }
  return (
    <FacetSection
      facet={facet}
      defaultOpen={defaultOpen}
      className={className}
      {...props}
    />
  )
}

/* ─── internals ────────────────────────────────────────────────────────── */

function FacetSection({
  facet,
  defaultOpen,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  facet: ListFacet | SwatchFacet | RangeFacet
  defaultOpen: boolean
}) {
  const { value } = useFilterPanel()
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()

  if (facet.type !== "range" && facet.options.length === 0) return null

  const selected =
    facet.type === "range"
      ? getRange(value, facet.id)
        ? 1
        : 0
      : getValues(value, facet.id).length

  return (
    // Groups are separated by a top rule, not boxed: the panel reads as one
    // ruled column, the way a printed index does.
    <div
      data-slot="filter-panel-facet"
      data-facet={facet.id}
      className={cn("border-t py-4", className)}
      {...props}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 rounded-sm text-start font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span>
            {facet.label}
            {selected > 0 && (
              <span className="ms-1.5 font-normal text-muted-foreground tabular-nums">
                ({selected})
              </span>
            )}
          </span>
          {open ? (
            <Minus className="size-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <Plus className="size-3.5 text-muted-foreground" aria-hidden />
          )}
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open} className="pt-3">
        {facet.type === "list" && <ListOptions facet={facet} />}
        {facet.type === "swatch" && <SwatchOptions facet={facet} />}
        {facet.type === "range" && <RangeControl facet={facet} />}
      </div>
    </div>
  )
}

function Count({ count }: { count?: number }) {
  const { loading, locale } = useFilterPanel()
  if (loading) {
    return (
      <span aria-hidden className="h-3 w-6 shrink-0 animate-pulse rounded-sm bg-muted" />
    )
  }
  if (count === undefined) return null
  // Tabular figures, right-aligned: a column of counts that doesn't line up
  // is the first thing that makes a filter panel look unfinished.
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {new Intl.NumberFormat(locale).format(count)}
    </span>
  )
}

function ListOptions({ facet }: { facet: ListFacet }) {
  const t = useT()
  const { value, setValue } = useFilterPanel()
  const [expanded, setExpanded] = React.useState(false)
  const selected = getValues(value, facet.id)
  const limit = facet.limit ?? 6

  // Selected options stay visible when the list collapses, or a shopper
  // loses sight of a filter that is still applied.
  const collapsed = facet.options.filter(
    (option, index) => index < limit || selected.includes(option.value)
  )
  const hidden = facet.options.length - collapsed.length
  const visible = expanded ? facet.options : collapsed

  return (
    <>
      <ul className="space-y-0.5">
        {visible.map((option) => {
          const checked = selected.includes(option.value)
          const disabled = option.disabled ?? (option.count === 0 && !checked)
          return (
            <li key={option.value}>
              <label
                className={cn(
                  "flex min-h-8 cursor-pointer items-center gap-3 py-1",
                  disabled && "cursor-not-allowed text-muted-foreground"
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() =>
                    setValue(toggleFilterValue(value, facet.id, option.value))
                  }
                />
                <span className="flex-1 leading-tight">{option.label}</span>
                <Count count={option.count} />
              </label>
            </li>
          )
        })}
      </ul>
      {(hidden > 0 || expanded) && facet.options.length > limit && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-xs underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? t("ecomcn.filters.showFewer", "Show fewer") : t("ecomcn.filters.showMore", "Show {count} more", { count: hidden })}
        </button>
      )}
    </>
  )
}

function SwatchOptions({ facet }: { facet: SwatchFacet }) {
  const { value, setValue } = useFilterPanel()
  const selected = getValues(value, facet.id)

  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {facet.options.map((option) => {
        const checked = selected.includes(option.value)
        const disabled = option.disabled ?? (option.count === 0 && !checked)
        return (
          <li key={option.value}>
            {/* The name is always printed and the selected state carries a
                check and a heavier border — colour is never the only signal. */}
            <button
              type="button"
              aria-pressed={checked}
              disabled={disabled}
              onClick={() => setValue(toggleFilterValue(value, facet.id, option.value))}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-start transition-colors outline-none hover:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45",
                checked && "border-foreground bg-secondary"
              )}
            >
              <span
                aria-hidden
                className="grid size-4 shrink-0 place-items-center rounded-full ring-1 ring-foreground/20 ring-inset"
                style={{ background: option.swatch }}
              >
                {checked && (
                  <Check className="size-3 text-white mix-blend-difference" strokeWidth={3} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate" title={option.label}>
                {option.label}
              </span>
              <Count count={option.count} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function useAffix(facet: RangeFacet, currency?: string, locale?: string) {
  return React.useMemo(() => {
    if (facet.format !== "currency") {
      return facet.unit ? { text: facet.unit, suffix: true } : null
    }
    const parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(1)
    const symbol = parts.findIndex((p) => p.type === "currency")
    const number = parts.findIndex((p) => p.type === "integer")
    return symbol === -1 ? null : { text: parts[symbol].value, suffix: symbol > number }
  }, [facet.format, facet.unit, currency, locale])
}

function RangeControl({ facet }: { facet: RangeFacet }) {
  const t = useT()
  const { value, setValue, currency, locale } = useFilterPanel()
  const id = React.useId()
  const committed = getRange(value, facet.id)
  const lo = committed?.min ?? facet.min
  const hi = committed?.max ?? facet.max
  const key = `${lo}:${hi}`

  // A draft remembers which committed value it started from. When the URL
  // catches up (instantly, or after a router round-trip) the key changes and
  // the stale draft is simply ignored — no effect needed to reset it, and no
  // flash back to the old value while a server fetch is in flight.
  const [draft, setDraft] = React.useState<{ values: [number, number]; key: string } | null>(null)
  const [text, setText] = React.useState<{ min?: string; max?: string; key: string } | null>(null)
  const pending = React.useRef<[number, number] | null>(null)

  const [shownLo, shownHi] = draft?.key === key ? draft.values : [lo, hi]
  const typed = text?.key === key ? text : null
  const affix = useAffix(facet, currency, locale)
  const format = (n: number) => formatRangeBound(facet, n, { currency, locale })

  const commit = (values: [number, number]) => {
    const clamp = (n: number) => Math.min(facet.max, Math.max(facet.min, n))
    const [a, b] = values.map(clamp)
    const next: [number, number] = a <= b ? [a, b] : [b, a]
    setDraft({ values: next, key })
    if (next[0] !== lo || next[1] !== hi) {
      setValue(setRange(value, facet, { min: next[0], max: next[1] }))
    }
  }

  // Commit when the thumb is released, not on every pixel of the drag: each
  // commit is a history entry and, on most stores, a request.
  const commitPending = () => {
    const values = pending.current
    pending.current = null
    if (values) commit(values)
  }

  const commitTyped = () => {
    if (!typed) return
    // Untouched field: keep what it showed. Emptied field: lift that bound.
    // Garbage: ignore the edit rather than guess.
    const parse = (raw: string | undefined, shown: number, edge: number) => {
      if (raw === undefined) return shown
      if (raw.trim() === "") return edge
      const n = Number(raw.replace(/[^\d.-]/g, ""))
      return Number.isFinite(n) ? n : shown
    }
    setText(null)
    commit([parse(typed.min, shownLo, facet.min), parse(typed.max, shownHi, facet.max)])
  }

  const field = (bound: "min" | "max") => (
    <label className="relative flex-1">
      <span className="sr-only">
        {bound === "min"
          ? t("ecomcn.filters.minimum", "Minimum {label}", { label: facet.label })
          : t("ecomcn.filters.maximum", "Maximum {label}", { label: facet.label })}
      </span>
      {affix && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground",
            affix.suffix ? "end-2.5" : "start-2.5"
          )}
        >
          {affix.text}
        </span>
      )}
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={typed?.[bound] ?? String(bound === "min" ? shownLo : shownHi)}
        onChange={(event) =>
          setText({ ...(typed ?? { key }), [bound]: event.target.value })
        }
        onBlur={commitTyped}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitTyped()
        }}
        className={cn("h-9 tabular-nums", affix && (affix.suffix ? "pe-7" : "ps-6"))}
      />
    </label>
  )

  return (
    <div>
      {/* Not a live region: the thumbs already announce their own values,
          and a readout that speaks on every pixel of a drag is noise. */}
      <p id={`${id}-readout`} className="mb-3 tabular-nums">
        {shownLo <= facet.min && shownHi >= facet.max
          ? t("ecomcn.filters.any", "Any {label}", { label: facet.label })
          : `${format(shownLo)} – ${format(shownHi)}`}
      </p>
      <div
        role="group"
        aria-label={t("ecomcn.filters.range", "{label} range", { label: facet.label })}
        aria-describedby={`${id}-readout`}
        className="px-1 py-2"
        onPointerDown={() => {
          const end = () => {
            window.removeEventListener("pointerup", end)
            window.removeEventListener("pointercancel", end)
            commitPending()
          }
          window.addEventListener("pointerup", end)
          window.addEventListener("pointercancel", end)
        }}
        onKeyUp={commitPending}
      >
        <Slider
          min={facet.min}
          max={facet.max}
          step={facet.step ?? 1}
          value={[shownLo, shownHi]}
          onValueChange={(next: number | readonly number[]) => {
            const values: [number, number] =
              typeof next === "number" ? [next, next] : [next[0], next[1]]
            pending.current = values
            setDraft({ values, key })
          }}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        {field("min")}
        <span aria-hidden className="text-muted-foreground">
          –
        </span>
        {field("max")}
      </div>
    </div>
  )
}

function ToggleRow({
  facet,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { facet: ToggleFacet }) {
  const { value, setValue } = useFilterPanel()
  return (
    <div
      data-slot="filter-panel-facet"
      data-facet={facet.id}
      className={cn("border-t py-4", className)}
      {...props}
    >
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="font-medium">{facet.label}</span>
        <span className="flex items-center gap-3">
          <Count count={facet.count} />
          <Switch
            checked={getToggle(value, facet.id)}
            onCheckedChange={(on: boolean) => setValue({ ...value, [facet.id]: on || undefined })}
          />
        </span>
      </label>
    </div>
  )
}
