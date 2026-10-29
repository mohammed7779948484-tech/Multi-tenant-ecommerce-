"use client"

import * as React from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { FilterPanel, type FilterPanelProps } from "@/components/ecomcn/filter-panel"
import {
  countActiveFilters,
  isSameFilters,
  type FilterState,
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

export interface FilterSheetProps
  extends Pick<FilterPanelProps, "facets" | "currency" | "locale" | "loading"> {
  /** The applied filters — usually straight from `useFilterParams`. */
  value: FilterState
  /** Called once with the staged filters when the sheet applies — never per tap. */
  onValueChange: (next: FilterState) => void
  /** Result count for the *staged* filters, shown on the apply button. */
  getResultCount?: (staged: FilterState) => number | undefined
  /**
   * Fires on every staged change. When counting needs a request, fetch here
   * and pass the answer back as `resultCount`.
   */
  onStagedChange?: (staged: FilterState) => void
  /** Wins over `getResultCount`. `undefined` renders a plain "Show results". */
  resultCount?: number
  /** What Escape, the close button and the overlay do with staged changes. */
  dismissBehavior?: "apply" | "discard"
  side?: "left" | "right" | "bottom"
  title?: string
  /** Trigger label. */
  label?: string
  /** Applied to the trigger button. */
  className?: string
  contentClassName?: string
  noun?: { one: string; other: string }
  /** Wins over `noun`: the whole count phrase, for languages with more plural forms than one/other. */
  formatCount?: (count: number) => string
  /**
   * A custom panel layout built from FilterPanel parts. They render inside a
   * FilterPanel that holds the *staged* value, so the same layout you use on
   * desktop stages here without any changes.
   */
  children?: React.ReactNode
}

export function FilterSheet({
  facets,
  value,
  onValueChange,
  getResultCount,
  onStagedChange,
  resultCount,
  dismissBehavior = "apply",
  side = "left",
  title: titleProp,
  label: labelProp,
  currency,
  locale: localeProp,
  loading,
  className,
  contentClassName,
  noun = { one: "result", other: "results" },
  formatCount,
  children,
}: FilterSheetProps) {
  const t = useT()
  const title = titleProp ?? t("ecomcn.filters.title", "Filters")
  const label = labelProp ?? title
  const locale = useFormatLocale(localeProp)
  const [open, setOpen] = React.useState(false)
  // Changes made inside the sheet are staged here, not pushed to the URL:
  // applying live would re-fetch the listing behind the sheet on every tap.
  const [staged, setStaged] = React.useState<FilterState>(value)

  const applied = countActiveFilters(value, facets)
  const stagedCount = countActiveFilters(staged, facets)
  const dirty = !isSameFilters(staged, value, facets)
  const count = resultCount ?? (open ? getResultCount?.(staged) : undefined)

  const stage = (next: FilterState) => {
    setStaged(next)
    onStagedChange?.(next)
  }

  const plural = new Intl.PluralRules(locale)
  const results =
    count === undefined
      ? null
      : formatCount
        ? formatCount(count)
        : `${new Intl.NumberFormat(locale).format(count)} ${
          plural.select(count) === "one" ? noun.one : noun.other
        }`

  // Only a real change reaches onValueChange, so closing an untouched sheet
  // never adds a history entry or fires a request.
  const commit = () => {
    if (dirty) onValueChange(staged)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) stage(value)
    else if (dismissBehavior === "apply") commit()
    setOpen(next)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {/* A real SheetTrigger, not a button that sets `open`: the dialog
          primitive only knows where to return focus if it owns the trigger.
          Styled with buttonVariants rather than asChild so it works on both
          the Radix and Base UI flavours of shadcn/ui. */}
      <SheetTrigger
        className={cn(buttonVariants({ variant: "outline" }), "gap-2", className)}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        {label}
        {applied > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-sm bg-foreground px-1 text-[11px] leading-none text-background tabular-nums">
            {applied}
            <span className="sr-only"> {t("ecomcn.filters.appliedSuffix", "applied")}</span>
          </span>
        )}
      </SheetTrigger>

      <SheetContent
        side={side}
        closeLabel={t("ecomcn.filters.close", "Close")}
        className={cn(
          "flex flex-col gap-0 p-0",
          side === "bottom" ? "max-h-[88dvh]" : "w-full sm:max-w-sm",
          contentClassName
        )}
      >
        <SheetHeader className="border-b px-5 py-4 text-start">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {dismissBehavior === "apply"
              ? t("ecomcn.filters.applyOnClose", "Changes apply when you close this panel.")
              : t("ecomcn.filters.applyOnShow", "Changes apply when you press Show.")}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          <FilterPanel
            hideHeader
            title={title}
            facets={facets}
            value={staged}
            onValueChange={stage}
            currency={currency}
            locale={locale}
            loading={loading}
          >
            {children}
          </FilterPanel>
        </div>

        {/* Outside the scroller, so the footer rule runs edge to edge and the
            primary action never scrolls away. */}
        <SheetFooter className="mt-0 flex-row gap-2 border-t px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={stagedCount === 0}
            onClick={() => stage({})}
          >
            {t("ecomcn.filters.clear", "Clear")}
          </Button>
          <Button
            type="button"
            className="flex-[2] tabular-nums"
            onClick={() => {
              commit()
              setOpen(false)
            }}
          >
            {results ? t("ecomcn.filters.showCount", "Show {results}", { results }) : t("ecomcn.filters.showResults", "Show results")}
          </Button>
          <span className="sr-only" aria-live="polite">
            {dirty && results ? results : ""}
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
