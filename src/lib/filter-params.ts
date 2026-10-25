export interface FilterOption {
  value: string
  label: string
  /** Results if this option were selected. `0` disables it unless it is already on. */
  count?: number
  /** Any CSS colour or `url(...)` — renders the option as a swatch. */
  swatch?: string
  disabled?: boolean
}

interface FacetBase {
  /** Doubles as the URL key, so keep it short and stable. */
  id: string
  label: string
}

export interface ListFacet extends FacetBase {
  type: "list"
  options: FilterOption[]
  /** Options shown before "Show more". Selected options always stay visible. */
  limit?: number
}

export interface SwatchFacet extends FacetBase {
  type: "swatch"
  options: FilterOption[]
}

export interface RangeFacet extends FacetBase {
  type: "range"
  min: number
  max: number
  step?: number
  /** `currency` formats bounds with the panel's `currency` and `locale`. */
  format?: "currency" | "number"
  /** Suffix for `format: "number"`, e.g. "cm" or "★". */
  unit?: string
}

export interface ToggleFacet extends FacetBase {
  type: "toggle"
  count?: number
}

export type FilterFacet = ListFacet | SwatchFacet | RangeFacet | ToggleFacet

export interface FilterRange {
  min?: number
  max?: number
}

export type FilterValue = string[] | FilterRange | boolean

/** Keyed by facet id. A missing key means "no constraint". */
export type FilterState = Record<string, FilterValue | undefined>

/** Anything a router hands you: a query string, URLSearchParams, or Next's `searchParams` object. */
export type SearchInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>

export interface ActiveFilter {
  facetId: string
  facetLabel: string
  /** Set for list and swatch facets — the option being removed. */
  value?: string
  label: string
}

export function toSearchParams(input: SearchInput | null | undefined) {
  if (!input) return new URLSearchParams()
  if (typeof input === "string" || input instanceof URLSearchParams) {
    return new URLSearchParams(input)
  }
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined) continue
    for (const value of Array.isArray(raw) ? raw : [raw]) params.append(key, value)
  }
  return params
}

// `-?` on both sides, so negative bounds still parse: `-10--2` is -10 to -2.
const RANGE = /^(-?\d+(?:\.\d+)?)?-(-?\d+(?:\.\d+)?)?$/

function normaliseRange(facet: RangeFacet, range: FilterRange | undefined) {
  if (!range) return undefined
  let min = Number.isFinite(range.min) ? range.min : undefined
  let max = Number.isFinite(range.max) ? range.max : undefined
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min]
  // A bound at the edge of the scale is no constraint at all — drop it so the
  // URL stays clean and the chip does not read "$0 – $500".
  if (min !== undefined && min <= facet.min) min = undefined
  if (max !== undefined && max >= facet.max) max = undefined
  if (min === undefined && max === undefined) return undefined
  return { min, max }
}

export function parseFilterParams(
  input: SearchInput | null | undefined,
  facets: FilterFacet[]
): FilterState {
  const params = toSearchParams(input)
  const state: FilterState = {}

  for (const facet of facets) {
    if (facet.type === "list" || facet.type === "swatch") {
      const values = [...new Set(params.getAll(facet.id).filter(Boolean))]
      if (values.length) state[facet.id] = values
    } else if (facet.type === "range") {
      const match = RANGE.exec(params.get(facet.id) ?? "")
      if (!match) continue
      const range = normaliseRange(facet, {
        min: match[1] === undefined ? undefined : Number(match[1]),
        max: match[2] === undefined ? undefined : Number(match[2]),
      })
      if (range) state[facet.id] = range
    } else {
      const raw = params.get(facet.id)
      if (raw === "1" || raw === "true") state[facet.id] = true
    }
  }

  return state
}

/**
 * Writes `state` over `base`, keeping every non-facet param. Facet keys are
 * written in facet order, so equal states always produce equal URLs.
 */
export function serializeFilterParams(
  state: FilterState,
  facets: FilterFacet[],
  base?: SearchInput | null
) {
  const params = toSearchParams(base)
  for (const facet of facets) params.delete(facet.id)

  for (const facet of facets) {
    const value = state[facet.id]
    if (facet.type === "list" || facet.type === "swatch") {
      for (const option of getValues(state, facet.id)) params.append(facet.id, option)
    } else if (facet.type === "range") {
      const range = normaliseRange(facet, getRange(state, facet.id))
      if (range) params.set(facet.id, `${range.min ?? ""}-${range.max ?? ""}`)
    } else if (value === true) {
      params.set(facet.id, "1")
    }
  }

  return params
}

export function isSameFilters(a: FilterState, b: FilterState, facets: FilterFacet[]) {
  return (
    serializeFilterParams(a, facets).toString() ===
    serializeFilterParams(b, facets).toString()
  )
}

export function getValues(state: FilterState, id: string): string[] {
  const value = state[id]
  return Array.isArray(value) ? value : []
}

export function getRange(state: FilterState, id: string): FilterRange | undefined {
  const value = state[id]
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined
}

export function getToggle(state: FilterState, id: string) {
  return state[id] === true
}

export function toggleFilterValue(state: FilterState, id: string, value: string): FilterState {
  const current = getValues(state, id)
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value]
  return { ...state, [id]: next.length ? next : undefined }
}

/** Sets a range, dropping bounds that sit on the edge of the scale. */
export function setRange(state: FilterState, facet: RangeFacet, range: FilterRange): FilterState {
  return { ...state, [facet.id]: normaliseRange(facet, range) }
}

/** Removes one option, or the whole facet when `value` is omitted. */
export function removeFilter(state: FilterState, id: string, value?: string): FilterState {
  if (value === undefined) return { ...state, [id]: undefined }
  const next = getValues(state, id).filter((v) => v !== value)
  return { ...state, [id]: next.length ? next : undefined }
}

export function countActiveFilters(state: FilterState, facets: FilterFacet[]) {
  return describeActiveFilters(state, facets).length
}

export function formatRangeBound(
  facet: RangeFacet,
  value: number,
  { currency = "USD", locale }: { currency?: string; locale?: string } = {}
) {
  if (facet.format === "currency") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value)
  }
  const n = new Intl.NumberFormat(locale).format(value)
  return facet.unit ? `${n}${facet.unit.length > 1 ? " " : ""}${facet.unit}` : n
}

/**
 * Human labels for everything that is on — the chips above the panel, and
 * the words an empty state needs to say *which* filters emptied the grid.
 */
export interface RangeLabels {
  /** "{min} and up" */
  from: (min: string) => string
  /** "Up to {max}" */
  upTo: (max: string) => string
}

const ENGLISH_RANGE_LABELS: RangeLabels = {
  from: (min) => `${min} and up`,
  upTo: (max) => `Up to ${max}`,
}

export function describeActiveFilters(
  state: FilterState,
  facets: FilterFacet[],
  format: { currency?: string; locale?: string; rangeLabels?: RangeLabels } = {}
): ActiveFilter[] {
  const rangeLabels = format.rangeLabels ?? ENGLISH_RANGE_LABELS
  const active: ActiveFilter[] = []

  for (const facet of facets) {
    if (facet.type === "list" || facet.type === "swatch") {
      for (const value of getValues(state, facet.id)) {
        const option = facet.options.find((o) => o.value === value)
        active.push({
          facetId: facet.id,
          facetLabel: facet.label,
          value,
          label: option?.label ?? value,
        })
      }
    } else if (facet.type === "range") {
      const range = normaliseRange(facet, getRange(state, facet.id))
      if (!range) continue
      const lo = range.min === undefined ? null : formatRangeBound(facet, range.min, format)
      const hi = range.max === undefined ? null : formatRangeBound(facet, range.max, format)
      active.push({
        facetId: facet.id,
        facetLabel: facet.label,
        label: lo && hi ? `${lo} – ${hi}` : lo ? rangeLabels.from(lo) : rangeLabels.upTo(hi ?? ""),
      })
    } else if (getToggle(state, facet.id)) {
      active.push({ facetId: facet.id, facetLabel: facet.label, label: facet.label })
    }
  }

  return active
}
