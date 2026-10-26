"use client"

import * as React from "react"
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react"

import { Direction } from "radix-ui"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

/*
 * The variant picker on a product page: colour swatches, a size grid, and a
 * line that says what is left.
 *
 *   <VariantSwatches options={options} variants={variants} defaultValue={{ Colour: "Tan" }} />
 *
 *   <VariantSwatches options={options} variants={variants}>      or composed
 *     <VariantSwatchesOption name="Colour" />
 *     <VariantSwatchesOption name="Size" action={<SizeGuideDialog … />} />
 *     <VariantSwatchesStatus />
 *   </VariantSwatches>
 *
 * Stock is worked out per option from the variants you pass: with Tan
 * picked, a size Tan has none of reads as sold out, and a size with two
 * pairs left says so. A sold-out option is struck through with a diagonal
 * rule and read out as sold out, but it can still be chosen — a shopper who
 * wants that size can ask to be told when it's back — and the status line
 * says why it can't be bought. The selection mark slides between options
 * with Motion; under reduced motion it fades. Parts share the selection and
 * the variant it points at through context; `useVariantSwatches()` reads it.
 */

export interface VariantValue {
  value: string
  /** Shown text, when it differs from `value`. */
  label?: string
  /** A CSS background — `"#a8764a"`, or `"url(/linen.jpg) center / cover"`. */
  swatch?: string
}

export interface VariantOption {
  /** "Colour", "Size" — also the key in the selection and in each variant. */
  name: string
  values: (string | VariantValue)[]
  /** Defaults to "swatch" when any value has a swatch, "grid" otherwise. */
  display?: "swatch" | "grid"
}

export interface Variant {
  id: string
  /** One value per option: `{ Colour: "Tan", Size: "41" }`. */
  options: Record<string, string>
  /** Units on hand. 0 is sold out; leave it out when you don't track stock. */
  stock?: number
}

/** The shopper's picks, by option name. Options not yet chosen are absent. */
export type VariantSelection = Record<string, string>

export type VariantAvailability =
  | { kind: "available" }
  | { kind: "low"; stock: number }
  | { kind: "sold-out" }
  /** No variant has this combination at all. */
  | { kind: "unavailable" }

export interface VariantSwatchesMessages {
  /** Read out after a sold-out option's name. */
  soldOutLabel: string
  /** Read out after the name of a combination that isn't made. */
  unavailableLabel: string
  /** Under a size in the grid, when few are left: "2 left". */
  stockLeft: (stock: number) => string
  /** The status line, for the chosen variant. */
  lowStock: (stock: number) => string
  /** "41 is sold out in Tan." `others` are the other picks, as labels. */
  soldOut: (value: string, others: string[]) => string
  unavailable: (value: string, others: string[]) => string
}

const MESSAGES: VariantSwatchesMessages = {
  soldOutLabel: "sold out",
  unavailableLabel: "not available",
  stockLeft: (stock) => `${stock} left`,
  lowStock: (stock) => `Only ${stock} left.`,
  soldOut: (value, others) =>
    `${value} is sold out${others.length ? ` in ${others.join(", ")}` : ""}.`,
  unavailable: (value, others) =>
    `${value} isn't made${others.length ? ` in ${others.join(", ")}` : ""}.`,
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

const AVAILABLE: VariantAvailability = { kind: "available" }

/** A value with its label filled in, as the parts see it. */
export interface ResolvedVariantValue {
  value: string
  label: string
  swatch?: string
}

/** An option with its display settled, as the parts see it. */
export interface ResolvedVariantOption {
  name: string
  display: "swatch" | "grid"
  values: ResolvedVariantValue[]
}

function normalize(options: VariantOption[]): ResolvedVariantOption[] {
  return options.map((option) => {
    const values = option.values.map((v) =>
      typeof v === "string" ? { value: v, label: v } : { ...v, label: v.label ?? v.value }
    )
    return {
      name: option.name,
      display: option.display ?? (values.some((v) => v.swatch) ? "swatch" : "grid"),
      values,
    }
  })
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

export interface VariantSwatchesContextValue {
  options: ResolvedVariantOption[]
  /** The selection, with any one-value option ("One size") filled in. */
  value: VariantSelection
  /** Picks a value — a sold-out one too: `purchasable` and the status say so. */
  select: (name: string, value: string) => void
  /** Stock for one option's value, given the shopper's other picks. */
  availability: (name: string, value: string) => VariantAvailability
  /** The variant every option points at, once each has a pick. */
  variant: Variant | undefined
  /** False until every option is picked, while stock loads, and while sold out. */
  purchasable: boolean
  /** What the status line says right now, or null. */
  status: string | null
  messages: VariantSwatchesMessages
  loading: boolean
}

const VariantSwatchesContext = React.createContext<VariantSwatchesContextValue | null>(null)

export function useVariantSwatches() {
  const context = React.useContext(VariantSwatchesContext)
  if (!context) {
    throw new Error("useVariantSwatches must be used within <VariantSwatches>.")
  }
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface VariantSwatchesProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  options: VariantOption[]
  /** Leave out to offer every combination, with no stock shown. */
  variants?: Variant[]
  value?: VariantSelection
  defaultValue?: VariantSelection
  onValueChange?: (value: VariantSelection) => void
  /** The variant the picks now point at — undefined until each option has one. */
  onVariantChange?: (variant: Variant | undefined) => void
  /** At or below this many, stock is shown: "Only 2 left." Defaults to 3. */
  lowStockThreshold?: number
  /** Rendered beside the first size grid's label — a `<SizeGuideDialog>`, say. */
  sizeGuide?: React.ReactNode
  messages?: Partial<VariantSwatchesMessages>
  /** Stock still on its way: placeholders in the shape of the options. */
  loading?: boolean
}

export function VariantSwatches({
  options: optionsProp,
  variants,
  value: valueProp,
  defaultValue = {},
  onValueChange,
  onVariantChange,
  lowStockThreshold = 3,
  sizeGuide,
  messages: messagesProp,
  loading = false,
  className,
  children,
  ...props
}: VariantSwatchesProps) {
  const [picked, setPicked] = useControllableState(valueProp, defaultValue, onValueChange)
  const options = React.useMemo(() => normalize(optionsProp), [optionsProp])
  const t = useT()
  const messages = React.useMemo<VariantSwatchesMessages>(
    () => ({
      soldOutLabel: t("ecomcn.variants.soldOutLabel", MESSAGES.soldOutLabel),
      unavailableLabel: t("ecomcn.variants.unavailableLabel", MESSAGES.unavailableLabel),
      stockLeft: (stock) => t("ecomcn.variants.stockLeft", "{count} left", { count: stock }),
      lowStock: (stock) => t("ecomcn.variants.lowStock", "Only {count} left.", { count: stock }),
      soldOut: (value, others) =>
        others.length
          ? t("ecomcn.variants.soldOutIn", "{value} is sold out in {others}.", { value, others: others.join("، ") })
          : t("ecomcn.variants.soldOut", "{value} is sold out.", { value }),
      unavailable: (value, others) =>
        others.length
          ? t("ecomcn.variants.unavailableIn", "{value} isn't made in {others}.", { value, others: others.join("، ") })
          : t("ecomcn.variants.unavailable", "{value} isn't made.", { value }),
      ...messagesProp,
    }),
    [messagesProp, t]
  )

  const value = React.useMemo(() => {
    const filled: VariantSelection = {}
    for (const option of options) {
      if (option.values.length === 1) filled[option.name] = option.values[0].value
    }
    return { ...filled, ...picked }
  }, [options, picked])

  const availability = React.useCallback(
    (name: string, candidate: string): VariantAvailability => {
      if (!variants) return AVAILABLE
      let exists = false
      let untracked = false
      let stock = 0
      for (const variant of variants) {
        if (variant.options[name] !== candidate) continue
        const fits = options.every(
          (o) =>
            o.name === name ||
            value[o.name] === undefined ||
            variant.options[o.name] === value[o.name]
        )
        if (!fits) continue
        exists = true
        if (variant.stock === undefined) untracked = true
        else stock += Math.max(0, variant.stock)
      }
      if (!exists) return { kind: "unavailable" }
      if (untracked) return AVAILABLE
      if (stock === 0) return { kind: "sold-out" }
      if (stock <= lowStockThreshold) return { kind: "low", stock }
      return AVAILABLE
    },
    [variants, options, value, lowStockThreshold]
  )

  const find = React.useCallback(
    (selection: VariantSelection) =>
      options.every((o) => selection[o.name] !== undefined)
        ? variants?.find((v) => options.every((o) => v.options[o.name] === selection[o.name]))
        : undefined,
    [options, variants]
  )

  const variant = find(value)
  const complete = options.every((o) => value[o.name] !== undefined)
  const purchasable =
    !loading && complete && (!variants || (variant !== undefined && variant.stock !== 0))

  const select = React.useCallback(
    (name: string, next: string) => {
      if (value[name] === next) return
      setPicked({ ...picked, [name]: next })
      onVariantChange?.(find({ ...value, [name]: next }))
    },
    [value, picked, setPicked, onVariantChange, find]
  )

  const status = React.useMemo(() => {
    const labelOf = (name: string, v: string) =>
      options.find((o) => o.name === name)?.values.find((x) => x.value === v)?.label ?? v
    const othersThan = (name: string) =>
      options
        .filter((o) => o.name !== name && value[o.name] !== undefined && o.values.length > 1)
        .map((o) => labelOf(o.name, value[o.name]))

    if (!variants) return null
    if (!complete) {
      // Part-way through: a pick that can't be had whatever comes next.
      for (const option of options) {
        const picked = value[option.name]
        if (picked === undefined || option.values.length < 2) continue
        const state = availability(option.name, picked)
        const label = labelOf(option.name, picked)
        if (state.kind === "sold-out") return messages.soldOut(label, othersThan(option.name))
        if (state.kind === "unavailable") return messages.unavailable(label, othersThan(option.name))
      }
      return null
    }
    // Explained by the last option — the size, usually — "in" the others.
    const last = [...options].reverse().find((o) => o.values.length > 1) ?? options[options.length - 1]
    const label = labelOf(last.name, value[last.name])
    if (!variant) return messages.unavailable(label, othersThan(last.name))
    if (variant.stock === 0) return messages.soldOut(label, othersThan(last.name))
    if (variant.stock !== undefined && variant.stock <= lowStockThreshold) {
      return messages.lowStock(variant.stock)
    }
    return null
  }, [availability, complete, variants, variant, options, value, messages, lowStockThreshold])

  const context = React.useMemo<VariantSwatchesContextValue>(
    () => ({
      options,
      value,
      select,
      availability,
      variant,
      purchasable,
      status,
      messages,
      loading,
    }),
    [options, value, select, availability, variant, purchasable, status, messages, loading]
  )

  // A product with nothing to choose: there is no picker to show.
  if (!children && !options.some((o) => o.values.length > 0)) return null
  const firstGrid = options.find((o) => o.display === "grid" && o.values.length > 1)

  return (
    <VariantSwatchesContext.Provider value={context}>
      <MotionConfig reducedMotion="user">
        <div
          data-slot="variant-swatches"
          aria-busy={loading || undefined}
          className={cn("flex flex-col", className)}
          {...props}
        >
          {children ?? (
            <>
              <div className="flex flex-col gap-7">
                {options.map((option) => (
                  <VariantSwatchesOption
                    key={option.name}
                    name={option.name}
                    action={option === firstGrid ? sizeGuide : undefined}
                  />
                ))}
              </div>
              <VariantSwatchesStatus />
            </>
          )}
        </div>
      </MotionConfig>
    </VariantSwatchesContext.Provider>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

export interface VariantSwatchesOptionProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Which option: matches a `name` in `options`. */
  name: string
  /** Beside the label, on the right — a size guide link. */
  action?: React.ReactNode
  /** Grid columns. Defaults to one row up to six sizes, then even rows. */
  columns?: number
}

/**
 * One option: its label, the value picked (or the one under the pointer or
 * focus), and the swatches or grid. A radio group — Tab enters on the pick,
 * the arrow keys move, Space or Enter chooses. Moving never chooses, so
 * arrowing past a colour doesn't swap the product photo on the way.
 */
export function VariantSwatchesOption({
  name,
  action,
  columns,
  className,
  ...props
}: VariantSwatchesOptionProps) {
  const { options, value, loading } = useVariantSwatches()
  const option = options.find((o) => o.name === name)
  const id = React.useId()
  const [preview, setPreview] = React.useState<string | null>(null)

  if (!option || option.values.length === 0) return null

  const selected = value[name]
  const shown = option.values.find((v) => v.value === (preview ?? selected))?.label

  return (
    <div
      data-slot="variant-swatches-option"
      data-option={name}
      data-display={option.display}
      className={cn("min-w-0", className)}
      {...props}
    >
      <div className="mb-3 flex min-h-5 items-baseline justify-between gap-4">
        <p className="text-xs font-medium tracking-[0.14em] uppercase">
          <span id={`${id}-label`}>{option.name}</span>
          {shown && !loading ? (
            <span
              // A sighted echo of the checked radio — except for a one-value
              // option ("One size"), which has no radio and is read from here.
              aria-hidden={option.values.length > 1 || undefined}
              data-slot="variant-swatches-value"
              className="ms-2 font-normal tracking-normal text-muted-foreground normal-case"
            >
              {shown}
            </span>
          ) : null}
        </p>
        {action}
      </div>

      {loading ? (
        <OptionSkeleton option={option} columns={columns} />
      ) : option.values.length === 1 ? null : (
        <RadioGroup
          option={option}
          labelledBy={`${id}-label`}
          scope={id}
          columns={columns}
          onPreview={setPreview}
        />
      )}
    </div>
  )
}

/** One row up to six; past that, the column count that leaves the fewest gaps. */
function columnsFor(count: number) {
  if (count <= 6) return count
  let best = 6
  for (const c of [6, 5, 4]) {
    if ((c - (count % c)) % c < (best - (count % best)) % best) best = c
  }
  return best
}

function RadioGroup({
  option,
  labelledBy,
  scope,
  columns,
  onPreview,
}: {
  option: ResolvedVariantOption
  labelledBy: string
  scope: string
  columns?: number
  onPreview: (value: string | null) => void
}) {
  const { value, select } = useVariantSwatches()
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = option.values.findIndex((v) => v.value === value[option.name])
  const grid = option.display === "grid"

  // In RTL the next value lies to the left.
  const dir = Direction.useDirection()
  const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight"
  const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft"
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = option.values.length - 1
    const next =
      event.key === forward || event.key === "ArrowDown"
        ? index === last ? 0 : index + 1
        : event.key === back || event.key === "ArrowUp"
          ? index === 0 ? last : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      data-slot={grid ? "variant-swatches-grid" : "variant-swatches-swatches"}
      onPointerLeave={() => onPreview(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPreview(null)
      }}
      className={cn(
        grid
          ? // One ruled block: the cells draw the right and bottom rules.
            "grid border-t border-s"
          : // The hit area is wider than the chip; the chips line up with the label.
            "-ms-1.5 flex flex-wrap"
      )}
      style={
        grid
          ? { gridTemplateColumns: `repeat(${columns ?? columnsFor(option.values.length)}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {option.values.map((v, i) => (
        <OptionButton
          key={v.value}
          buttonRef={(node) => {
            refs.current[i] = node
          }}
          option={option}
          item={v}
          scope={scope}
          checked={i === selectedIndex}
          // Roving focus: Tab lands on the pick, or on the first option.
          tabIndex={i === (selectedIndex === -1 ? 0 : selectedIndex) ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, i)}
          onClick={() => select(option.name, v.value)}
          onPreview={onPreview}
        />
      ))}
    </div>
  )
}

function OptionButton({
  buttonRef,
  option,
  item,
  scope,
  checked,
  tabIndex,
  onKeyDown,
  onClick,
  onPreview,
}: {
  // Not `ref`: on React 18 a function component never receives one.
  buttonRef: React.RefCallback<HTMLButtonElement>
  option: ResolvedVariantOption
  item: ResolvedVariantValue
  scope: string
  checked: boolean
  tabIndex: number
  onKeyDown: (event: React.KeyboardEvent) => void
  onClick: () => void
  onPreview: (value: string | null) => void
}) {
  const { availability, messages } = useVariantSwatches()
  const state = availability(option.name, item.value)
  const out = state.kind === "sold-out" || state.kind === "unavailable"
  const grid = option.display === "grid"

  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      // Never `disabled`: a sold-out size stays in the tab order, is heard as
      // sold out, and can be chosen — for a "notify me" — with the status
      // line saying why it can't be bought.
      tabIndex={tabIndex}
      data-state={checked ? "checked" : "unchecked"}
      data-availability={state.kind}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onPointerEnter={() => onPreview(item.value)}
      onFocus={() => onPreview(item.value)}
      className={cn(
        "relative isolate outline-none focus-visible:outline-2 focus-visible:outline-ring",
        grid
          ? "flex h-12 min-w-11 flex-col items-center justify-center border-e border-b px-2 text-sm tabular-nums transition-colors focus-visible:-outline-offset-2"
          : "grid size-11 place-items-center focus-visible:-outline-offset-2",
        grid && !checked && "hover:bg-secondary",
        grid && out && !checked && "text-muted-foreground",
        grid && checked && "text-background"
      )}
    >
      {checked ? <SelectedMark layoutId={`${scope}-selected`} grid={grid} /> : null}

      {grid ? (
        <>
          <span className="relative z-10">{item.label}</span>
          {state.kind === "low" ? (
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 text-[10.5px] leading-none tracking-wide",
                checked ? "text-background/75" : "text-muted-foreground"
              )}
            >
              {messages.stockLeft(state.stock)}
            </span>
          ) : null}
          {out ? <Strike className={checked ? "text-background/70" : "text-muted-foreground/70"} /> : null}
        </>
      ) : (
        <span
          aria-hidden
          data-slot="variant-swatches-chip"
          className={cn(
            "relative size-8 border border-foreground/25 transition-opacity",
            out && "opacity-60"
          )}
          style={{ background: item.swatch }}
        >
          {out ? <Strike halo /> : null}
        </span>
      )}

      <span className="sr-only">
        {grid ? "" : item.label}
        {out
          ? `, ${state.kind === "sold-out" ? messages.soldOutLabel : messages.unavailableLabel}`
          : state.kind === "low"
            ? `, ${messages.stockLeft(state.stock)}`
            : ""}
      </span>
    </button>
  )
}

/**
 * The pick's mark: ink behind a size, a ruled square around a swatch. One per
 * option, so Motion slides it from the old pick to the new; under reduced
 * motion it fades in where it lands.
 */
function SelectedMark({ layoutId, grid }: { layoutId: string; grid: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      aria-hidden
      data-slot="variant-swatches-mark"
      layoutId={reduce ? undefined : layoutId}
      initial={reduce ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={reduce ? { duration: 0.15 } : MORPH}
      className={cn(
        "absolute",
        grid ? "inset-0 bg-foreground" : "inset-[3px] border border-foreground"
      )}
    />
  )
}

/**
 * The diagonal rule that says "not this one" without relying on colour. On
 * a swatch it has a halo in the page colour, so it reads on black as well
 * as on chalk.
 */
function Strike({ className, halo = false }: { className?: string; halo?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("pointer-events-none absolute inset-0 z-10 size-full", className)}
    >
      {halo ? (
        <line
          x1="0" y1="100" x2="100" y2="0"
          vectorEffect="non-scaling-stroke"
          strokeWidth={3}
          className="stroke-background"
        />
      ) : null}
      <line
        x1="0" y1="100" x2="100" y2="0"
        vectorEffect="non-scaling-stroke"
        strokeWidth={1}
        className={halo ? "stroke-foreground" : "stroke-current"}
      />
    </svg>
  )
}

/** Placeholders in the option's own shape, so nothing jumps when stock lands. */
function OptionSkeleton({ option, columns }: { option: ResolvedVariantOption; columns?: number }) {
  const count = Math.max(option.values.length, 1)
  if (option.display === "swatch") {
    return (
      <div aria-hidden className="-ms-1.5 flex flex-wrap">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="grid size-11 place-items-center">
            <span className="size-8 animate-pulse bg-muted" />
          </span>
        ))}
      </div>
    )
  }
  return (
    <div
      aria-hidden
      className="grid border-t border-s"
      style={{ gridTemplateColumns: `repeat(${columns ?? columnsFor(count)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="grid h-12 place-items-center border-e border-b">
          <span className="h-3 w-5 animate-pulse bg-muted" />
        </span>
      ))}
    </div>
  )
}

/**
 * The line under the picker: "Only 2 left.", or why the picks can't be
 * bought — "41 is sold out in Black." A polite live region, always in the page so every change is
 * read out; the line grows open and shut with Motion.
 */
export function VariantSwatchesStatus({
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { status, loading } = useVariantSwatches()
  const reduce = useReducedMotion()
  const message = loading ? null : status

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="variant-swatches-status"
      className={className}
      {...props}
    >
      <AnimatePresence initial={false}>
        {message ? (
          <motion.div
            key="status"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0.15 } : MORPH}
            className="overflow-hidden"
          >
            <p className="flex items-baseline gap-2.5 pt-4 text-sm text-foreground">
              <span aria-hidden className="h-px w-4 shrink-0 translate-y-[-0.3em] bg-foreground" />
              {message}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
