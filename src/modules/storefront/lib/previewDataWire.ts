import type { ProductCard, SectionData } from './sectionDataTypes'

/**
 * The response shape of `POST /api/storefront/preview-data`, kept backward
 * compatible: `price` stays the formatted text it was before the shop work, and
 * the structured price travels in the additive `priceDetail` field. The builder
 * reads `priceDetail` back into the section view model. Client-safe and pure.
 */

export type PreviewProductWire = Omit<ProductCard, 'price' | 'stock'> & {
  /** Formatted price text (the original contract). */
  price: string | null
  /** Amount, currency and formatted text (additive). */
  priceDetail?: ProductCard['price']
}

export type PreviewSectionWire = { products?: PreviewProductWire[]; categories?: SectionData['categories'] }

export function toPreviewWire(data: SectionData): PreviewSectionWire {
  const wire: PreviewSectionWire = {}
  if (data.products) {
    wire.products = data.products.map(({ price, stock: _stock, ...card }) => ({ ...card, price: price?.formatted ?? null, priceDetail: price ?? null }))
  }
  if (data.categories) wire.categories = data.categories
  return wire
}

export function fromPreviewWire(wire: PreviewSectionWire): SectionData {
  const data: SectionData = {}
  if (wire.products) {
    data.products = wire.products.map(({ price, priceDetail, ...card }) => ({
      ...card,
      // A response without `priceDetail` still shows its text.
      price: priceDetail ?? (price ? { amount: Number.NaN, currencyCode: '', formatted: price } : null),
    }))
  }
  if (wire.categories) data.categories = wire.categories
  return data
}
