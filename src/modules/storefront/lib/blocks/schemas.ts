import { z } from 'zod'

/**
 * Server-safe block schemas. No React import: these run in API routes, setup
 * hooks, the CLI and the public renderer alike. Every object schema is
 * `.strict()`, so props a block does not declare — `className`, `style`,
 * `dangerouslySetInnerHTML`, `ref`, json-render expressions such as
 * `{ "$state": ... }` — are rejected instead of ignored.
 */

export const DEFAULT_TEXT_MAX = 200

export function textSchema(max: number = DEFAULT_TEXT_MAX) {
  return z.string().trim().min(1, 'storefront.validation.textRequired').max(max, 'storefront.validation.textTooLong')
}

const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)/i

/**
 * A link target is either a store-relative path (`/about`, resolved against the
 * store's base path by the renderer) or an absolute `https:` URL. Everything
 * else — `javascript:`, `data:`, `http:`, protocol-relative `//host`,
 * credentials in the URL, control characters, backslashes — is rejected.
 */
export function isSafeHref(value: string): boolean {
  if (!value || value.length > 500 || CONTROL_OR_BACKSLASH.test(value)) return false
  // A store path stays under the store: no `//host`, and no `.`/`..` segments (plain or
  // percent-encoded) that would climb out of `/{siteSlug}` once the base path is prepended.
  if (value.startsWith('/')) return !value.startsWith('//') && !DOT_SEGMENT.test(value.split(/[?#]/)[0])
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password
  } catch {
    return false
  }
}

export const safeHrefSchema = z
  .string()
  .trim()
  .max(500, 'storefront.validation.textTooLong')
  .refine(isSafeHref, 'storefront.validation.unsafeHref')

/** Inline text keeps its whitespace (spaces between nodes matter); blank text is rejected. */
const inlineTextSchema = z
  .string()
  .max(1000, 'storefront.validation.textTooLong')
  .refine((value) => value.trim().length > 0, 'storefront.validation.textRequired')

const textNodeSchema = z
  .object({
    type: z.literal('text'),
    text: inlineTextSchema,
    marks: z.array(z.enum(['bold', 'italic'])).max(2).optional(),
  })
  .strict()

const linkNodeSchema = z
  .object({
    type: z.literal('link'),
    href: safeHrefSchema,
    children: z.array(textNodeSchema).min(1).max(20),
  })
  .strict()

const inlineSchema = z.discriminatedUnion('type', [textNodeSchema, linkNodeSchema])

const paragraphSchema = z.object({ type: z.literal('paragraph'), children: z.array(inlineSchema).min(1).max(50) }).strict()
const listSchema = z
  .object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(z.array(inlineSchema).min(1).max(50)).min(1).max(30),
  })
  .strict()

export const RICH_TEXT_MAX_CHARS = 5000

type InlineNode = z.infer<typeof inlineSchema>

function inlineLength(nodes: InlineNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.type === 'text') total += node.text.length
    else for (const child of node.children) total += child.text.length
  }
  return total
}

/**
 * Limited rich text as a structured document — paragraphs, ordered/unordered
 * lists, bold/italic marks and links. Rendered as React text nodes; there is no
 * HTML anywhere, so nothing needs sanitising.
 */
export const richTextDocumentSchema = z
  .object({
    type: z.literal('doc'),
    blocks: z.array(z.discriminatedUnion('type', [paragraphSchema, listSchema])).min(1).max(50),
  })
  .strict()
  .superRefine((doc, ctx) => {
    let total = 0
    for (const block of doc.blocks) {
      if (block.type === 'paragraph') total += inlineLength(block.children)
      else for (const item of block.items) total += inlineLength(item)
    }
    if (total > RICH_TEXT_MAX_CHARS) {
      ctx.addIssue({ code: 'custom', message: 'storefront.validation.richTextTooLong' })
    }
  })

export type RichTextDocument = z.infer<typeof richTextDocumentSchema>
export type RichTextInline = InlineNode

/**
 * An image reference: an attachment id (never a URL) plus required alt text.
 * Which attachments a page may reference is checked against the database on
 * save, publish and rollback (`lib/blocks/references.ts`), never here.
 */
export const imageRefSchema = z
  .object({
    attachmentId: z.string().uuid('storefront.validation.imageRequired'),
    alt: textSchema(200),
  })
  .strict()

const ctaSchema = z.object({ label: textSchema(40), href: safeHrefSchema }).strict()

/** Multi-line plain text (line breaks kept, no markup). */
export function plainTextSchema(max: number) {
  return z.string().trim().min(1, 'storefront.validation.textRequired').max(max, 'storefront.validation.textTooLong')
}

export const heroPropsSchema = z
  .object({
    heading: textSchema(120),
    subheading: textSchema(DEFAULT_TEXT_MAX).optional(),
    cta: ctaSchema.optional(),
    align: z.enum(['start', 'center']).default('center'),
    image: imageRefSchema.optional(),
  })
  .strict()

export const imagePropsSchema = z
  .object({
    image: imageRefSchema,
    caption: textSchema(200).optional(),
    href: safeHrefSchema.optional(),
    width: z.enum(['contained', 'full']).default('contained'),
  })
  .strict()

export const imageTextPropsSchema = z
  .object({
    image: imageRefSchema,
    heading: textSchema(120),
    body: plainTextSchema(600).optional(),
    cta: ctaSchema.optional(),
    imagePosition: z.enum(['start', 'end']).default('start'),
  })
  .strict()

export const galleryPropsSchema = z
  .object({
    heading: textSchema(120).optional(),
    images: z.array(imageRefSchema).min(2, 'storefront.validation.galleryTooFew').max(12, 'storefront.validation.listTooLong'),
  })
  .strict()

export const testimonialsPropsSchema = z
  .object({
    heading: textSchema(120).optional(),
    items: z
      .array(z.object({ quote: plainTextSchema(400), author: textSchema(80), role: textSchema(80).optional() }).strict())
      .min(1)
      .max(6, 'storefront.validation.listTooLong'),
  })
  .strict()

export const faqPropsSchema = z
  .object({
    heading: textSchema(120).optional(),
    items: z
      .array(z.object({ question: textSchema(200), answer: plainTextSchema(1000) }).strict())
      .min(1)
      .max(12, 'storefront.validation.listTooLong'),
  })
  .strict()

export const PHONE_PATTERN = /^\+?[0-9 ()-]{5,40}$/

export const contactInfoPropsSchema = z
  .object({
    heading: textSchema(120).optional(),
    address: plainTextSchema(300).optional(),
    phone: z.string().trim().regex(PHONE_PATTERN, 'storefront.validation.phoneInvalid').optional(),
    email: z.string().trim().max(120, 'storefront.validation.textTooLong').email('storefront.validation.emailInvalid').optional(),
    hours: plainTextSchema(300).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.address || value.phone || value.email || value.hours), {
    message: 'storefront.validation.contactEmpty',
    path: ['address'],
  })

export const callToActionPropsSchema = z
  .object({
    heading: textSchema(120),
    body: textSchema(DEFAULT_TEXT_MAX).optional(),
    cta: ctaSchema,
    tone: z.enum(['surface', 'primary']).default('surface'),
  })
  .strict()

export const richTextPropsSchema = z
  .object({
    heading: textSchema(120).optional(),
    content: richTextDocumentSchema,
  })
  .strict()

export const featuresPropsSchema = z
  .object({
    heading: textSchema(120).optional(),
    items: z
      .array(z.object({ title: textSchema(60), body: textSchema(DEFAULT_TEXT_MAX) }).strict())
      .min(1)
      .max(6),
  })
  .strict()

export const footerPropsSchema = z
  .object({
    text: textSchema(DEFAULT_TEXT_MAX).optional(),
    links: z.array(z.object({ label: textSchema(40), href: safeHrefSchema }).strict()).max(8).default([]),
  })
  .strict()

export type HeroProps = z.infer<typeof heroPropsSchema>
export type RichTextProps = z.infer<typeof richTextPropsSchema>
export type FeaturesProps = z.infer<typeof featuresPropsSchema>
export type FooterProps = z.infer<typeof footerPropsSchema>
export type ImageRef = z.infer<typeof imageRefSchema>
export type ImageProps = z.infer<typeof imagePropsSchema>
export type ImageTextProps = z.infer<typeof imageTextPropsSchema>
export type GalleryProps = z.infer<typeof galleryPropsSchema>
export type TestimonialsProps = z.infer<typeof testimonialsPropsSchema>
export type FaqProps = z.infer<typeof faqPropsSchema>
export type ContactInfoProps = z.infer<typeof contactInfoPropsSchema>
export type CallToActionProps = z.infer<typeof callToActionPropsSchema>
