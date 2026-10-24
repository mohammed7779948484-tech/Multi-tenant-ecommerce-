import type { z } from 'zod'
import {
  callToActionPropsSchema,
  contactInfoPropsSchema,
  faqPropsSchema,
  featuresPropsSchema,
  footerPropsSchema,
  galleryPropsSchema,
  heroPropsSchema,
  imagePropsSchema,
  imageTextPropsSchema,
  richTextPropsSchema,
  testimonialsPropsSchema,
} from './schemas'

/**
 * The storefront block catalog: the only components a page spec may describe.
 *
 * Each entry has the shape json-render's `defineCatalog(schema, { components })`
 * expects (`props` = Zod schema, `description` = what the block is for), so the
 * Phase 2 editor and the AI follow-up can adapt this catalog without a second
 * source of truth. This file stays server-safe: no React import.
 */
export const STOREFRONT_BLOCKS = {
  Hero: {
    props: heroPropsSchema,
    description: 'Large introductory banner with a heading, optional subheading, one call-to-action link and an optional image beside the text.',
  },
  RichText: {
    props: richTextPropsSchema,
    description: 'Formatted text: paragraphs, lists, bold, italic and links. No HTML.',
  },
  Features: {
    props: featuresPropsSchema,
    description: 'Up to six short selling points, each with a title and a sentence.',
  },
  Image: {
    props: imagePropsSchema,
    description: 'One image with alt text, an optional caption and an optional link; contained or full width.',
  },
  ImageText: {
    props: imageTextPropsSchema,
    description: 'An image next to a heading, a short text and an optional call-to-action link; the image sits at the start or the end.',
  },
  Gallery: {
    props: galleryPropsSchema,
    description: 'A grid of 2 to 12 images, each with alt text, under an optional heading.',
  },
  Testimonials: {
    props: testimonialsPropsSchema,
    description: 'Up to six customer quotes, each with the author and an optional role.',
  },
  Faq: {
    props: faqPropsSchema,
    description: 'Up to twelve questions with answers that open and close without scripts.',
  },
  ContactInfo: {
    props: contactInfoPropsSchema,
    description: 'How to reach the store: address, phone, email and opening hours (at least one).',
  },
  CallToAction: {
    props: callToActionPropsSchema,
    description: 'A short banner with a heading, an optional sentence and one button link.',
  },
  Footer: {
    props: footerPropsSchema,
    description: 'Closing section with a short text and up to eight links.',
  },
} as const satisfies Record<string, { props: z.ZodTypeAny; description: string }>

export type StorefrontBlockType = keyof typeof STOREFRONT_BLOCKS
export const STOREFRONT_BLOCK_TYPES = Object.keys(STOREFRONT_BLOCKS) as StorefrontBlockType[]

export type StorefrontBlockProps<T extends StorefrontBlockType> = z.infer<(typeof STOREFRONT_BLOCKS)[T]['props']>

export function isStorefrontBlockType(value: string): value is StorefrontBlockType {
  return Object.prototype.hasOwnProperty.call(STOREFRONT_BLOCKS, value)
}
