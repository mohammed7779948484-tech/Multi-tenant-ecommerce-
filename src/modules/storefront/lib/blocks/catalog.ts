import type { z } from 'zod'
import { featuresPropsSchema, footerPropsSchema, heroPropsSchema, richTextPropsSchema } from './schemas'

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
    description: 'Large introductory banner with a heading, optional subheading and one call-to-action link.',
  },
  RichText: {
    props: richTextPropsSchema,
    description: 'Formatted text: paragraphs, lists, bold, italic and links. No HTML.',
  },
  Features: {
    props: featuresPropsSchema,
    description: 'Up to six short selling points, each with a title and a sentence.',
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
