"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ProductCard,
  type ProductCardProduct,
  type ProductCardProps,
} from "@/components/ecomcn/product-card"
import { useT } from "@open-mercato/shared/lib/i18n/context"

import { cn } from "@/lib/utils"

export interface ProductGridProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  products: ProductCardProduct[]
  loading?: boolean
  /** How many skeletons to render while `loading`. Match your page size. */
  skeletonCount?: number
  density?: "comfortable" | "compact"
  currency?: string
  locale?: string
  onQuickAdd?: ProductCardProps["onQuickAdd"]
  /** Rendered instead of the grid when `products` is empty and not loading. */
  empty?: React.ReactNode
  onResetFilters?: () => void
  /**
   * Render each product yourself — typically a ProductCard composed from its
   * parts. Return one element per product: it becomes a direct grid child.
   */
  renderCard?: (product: ProductCardProduct, index: number) => React.ReactNode
  /** More results are on their way: append skeletons after the current products. */
  loadingMore?: boolean
  /** How many skeletons to append while `loadingMore`. Match your page size. */
  loadingMoreCount?: number
}

// Skeleton boxes must match the real card exactly or the grid jumps: same
// aspect ratio, same four text bars.
function CardSkeleton() {
  return (
    <div aria-hidden data-slot="product-grid-skeleton">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <Skeleton className="mt-3.5 h-3 w-16 rounded-none" />
      <Skeleton className="mt-2 h-5 w-3/4 rounded-none" />
      <Skeleton className="mt-2 h-3 w-14 rounded-none" />
    </div>
  )
}

export function ProductGrid({
  products,
  loading,
  skeletonCount = 6,
  density = "comfortable",
  currency,
  locale,
  onQuickAdd,
  empty,
  onResetFilters,
  renderCard,
  loadingMore,
  loadingMoreCount = 3,
  className,
  ...props
}: ProductGridProps) {
  const t = useT()
  // Column gap tighter than row gap: products group by row, like a printed page.
  // Compact adds a column from `sm` up, so a density switch always does something.
  const grid = cn(
    "grid grid-cols-2 gap-x-5 gap-y-9 lg:grid-cols-3",
    density === "compact" && "gap-y-7 sm:grid-cols-3 lg:grid-cols-4",
    className
  )

  if (loading) {
    return (
      <div className={grid} aria-busy="true" data-slot="product-grid" {...props}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
        <span className="sr-only">{t("ecomcn.productGrid.loading", "Loading products")}</span>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      empty ?? (
        <div className="flex flex-col items-start gap-5 border py-14 ps-8 pe-6 sm:ps-14">
          <h3 className="text-3xl">{t("ecomcn.productGrid.emptyTitle", "Nothing under these filters.")}</h3>
          {onResetFilters ? (
            <Button onClick={onResetFilters} className="h-10 text-[13px]">
              {t("ecomcn.productGrid.reset", "Reset filters")}
            </Button>
          ) : null}
        </div>
      )
    )
  }

  return (
    <div className={grid} aria-busy={loadingMore || undefined} data-slot="product-grid" {...props}>
      {products.map((product, index) =>
        renderCard ? (
          <React.Fragment key={product.id}>{renderCard(product, index)}</React.Fragment>
        ) : (
          <ProductCard
            key={product.id}
            product={product}
            density={density}
            currency={currency}
            locale={locale}
            onQuickAdd={onQuickAdd}
          />
        )
      )}
      {loadingMore
        ? Array.from({ length: loadingMoreCount }).map((_, i) => <CardSkeleton key={`more-${i}`} />)
        : null}
    </div>
  )
}
