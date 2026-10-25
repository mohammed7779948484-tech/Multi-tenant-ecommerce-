import * as React from "react"

import {
  isSameFilters,
  parseFilterParams,
  serializeFilterParams,
  type FilterFacet,
  type FilterState,
} from "@/lib/filter-params"

/** Fired after our own pushState — the History API raises no event for it. */
const LOCATION_EVENT = "ecomcn:locationchange"
const RESET_PAGE = ["page"]

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange)
  window.addEventListener(LOCATION_EVENT, onChange)
  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(LOCATION_EVENT, onChange)
  }
}

const readSearch = () => window.location.search

export interface UseFilterParamsOptions {
  /**
   * Your router's current params — Next's `useSearchParams()`, React
   * Router's `searchParams`. Omit it and the hook reads `window.location`.
   */
  searchParams?: URLSearchParams | string | null
  /**
   * How to write the next URL. Defaults to the History API, which is enough
   * when results are fetched on the client. Pass your router's push when the
   * server renders the results, so each change triggers a fetch.
   */
  navigate?: (href: string, options: { replace: boolean }) => void
  /** "push" makes Back undo the last filter, which is what shoppers expect. */
  history?: "push" | "replace"
  /** Dropped on every change — page 4 of the old result set means nothing now. */
  resetParams?: string[]
  /** The query string the server rendered with, so hydration matches. */
  initialSearch?: string
}

/**
 * `useState`, but the state lives in the URL. Deep links, refresh, share and
 * the Back button all work because there is no second copy to fall out of sync.
 *
 * Keep `facets` referentially stable (module scope or `useMemo`).
 */
export function useFilterParams(
  facets: FilterFacet[],
  {
    searchParams,
    navigate,
    history = "push",
    resetParams = RESET_PAGE,
    initialSearch = "",
  }: UseFilterParamsOptions = {}
) {
  const locationSearch = React.useSyncExternalStore(
    subscribe,
    readSearch,
    () => initialSearch
  )
  const controlled = searchParams !== undefined && searchParams !== null
  const search = controlled ? searchParams.toString() : locationSearch

  const filters = React.useMemo(
    () => parseFilterParams(search, facets),
    [search, facets]
  )

  const setFilters = React.useCallback(
    (next: FilterState | ((previous: FilterState) => FilterState)) => {
      // Read the live URL, not the render-time snapshot, so two updates in
      // one event compose instead of the second overwriting the first.
      const current = controlled ? search : window.location.search
      const previous = parseFilterParams(current, facets)
      const value = typeof next === "function" ? next(previous) : next

      // An unchanged state must not add a history entry, or Back stops working.
      if (isSameFilters(value, previous, facets)) return

      const params = serializeFilterParams(value, facets, current)
      for (const key of resetParams) params.delete(key)
      const query = params.toString()
      const href = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`

      if (navigate) {
        navigate(href, { replace: history === "replace" })
        return
      }
      if (history === "replace") {
        window.history.replaceState(window.history.state, "", href)
      } else {
        window.history.pushState(null, "", href)
      }
      window.dispatchEvent(new Event(LOCATION_EVENT))
    },
    [controlled, search, facets, navigate, history, resetParams]
  )

  return [filters, setFilters] as const
}
