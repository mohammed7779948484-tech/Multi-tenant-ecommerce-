import type { ImageRef } from './blocks/schemas'

/** View model of store data shown by commerce sections. Pure types: shared by the server loader, the public page and the builder preview. */

export type ProductCard = {
  id: string
  title: string
  subtitle: string | null
  href: string
  image: ImageRef | null
  /** Resolved by the platform pricing engine; `formatted` is Arabic (ar-YE). */
  price: { amount: number; currencyCode: string; formatted: string } | null
  /** Search and collection pages only: shown as a badge when the product cannot be bought or runs low. */
  stock?: 'out_of_stock' | 'low_stock' | null
}

export type CategoryCard = {
  id: string
  name: string
  description: string | null
  href: string
  image: ImageRef | null
}

export type SectionData = { products?: ProductCard[]; categories?: CategoryCard[] }
