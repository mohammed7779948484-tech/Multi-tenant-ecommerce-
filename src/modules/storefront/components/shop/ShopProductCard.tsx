import * as React from 'react'
import {
  ProductCard,
  ProductCardBody,
  ProductCardMedia,
  ProductCardPrice,
  ProductCardTitle,
  type ProductCardProduct,
} from '@/components/ecomcn/product-card'
import type { MediaResolver } from '../../lib/mediaUrls'
import type { ProductCard as ProductCardData } from '../../lib/sectionDataTypes'
import { SHOP_NUMBER_LOCALE } from '../../lib/shopFormat'

/**
 * The store's product card: the ecomcn `ProductCard` fed with catalog data.
 * Used by the merchant's ProductGrid sections, collection pages and search.
 * Prices arrive already formatted (ar-YE) from the server; the stock badge is
 * text, never colour alone.
 */

export type StockLabels = { soldOut: string; lowStock: string }

/** Card model for the ecomcn block. The image is rendered here, through the store's media route. */
export function toCardProduct(card: ProductCardData, media: MediaResolver, stockLabels?: StockLabels): ProductCardProduct {
  const badge = card.stock === 'out_of_stock' ? stockLabels?.soldOut : card.stock === 'low_stock' ? stockLabels?.lowStock : undefined
  return {
    id: card.id,
    name: card.title,
    href: card.href,
    brand: card.subtitle ?? undefined,
    price: card.price?.amount,
    priceText: card.price?.formatted,
    badge,
    image: card.image ? (
      // Served by the store's media route (scope and visibility re-checked there).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="size-full object-cover"
        src={media.src(card.image.attachmentId, 640)}
        srcSet={media.srcSet(card.image.attachmentId)}
        sizes="(min-width: 64rem) 25vw, 50vw"
        alt={card.image.alt}
        loading="lazy"
        decoding="async"
      />
    ) : undefined,
  }
}

export function ShopProductCard({ product, showPrice = true }: { product: ProductCardProduct; showPrice?: boolean }) {
  return (
    <ProductCard product={product} locale={SHOP_NUMBER_LOCALE} showColors={false} className="sf-product-card">
      <ProductCardMedia className="rounded-md" />
      <ProductCardBody>
        <ProductCardTitle className="text-base font-semibold" />
        {product.brand ? <p className="sf-product-subtitle mt-0.5 text-sm">{product.brand}</p> : null}
        {showPrice ? <ProductCardPrice /> : null}
      </ProductCardBody>
    </ProductCard>
  )
}
