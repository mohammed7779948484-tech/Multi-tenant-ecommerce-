import type { ImageRef } from './blocks/schemas'

/** View model of store data shown by commerce sections. Pure types: shared by the server loader, the public page and the builder preview. */

export type ProductCard = {
  id: string
  title: string
  subtitle: string | null
  href: string
  image: ImageRef | null
  price: string | null
}

export type CategoryCard = {
  id: string
  name: string
  description: string | null
  href: string
  image: ImageRef | null
}

export type SectionData = { products?: ProductCard[]; categories?: CategoryCard[] }
