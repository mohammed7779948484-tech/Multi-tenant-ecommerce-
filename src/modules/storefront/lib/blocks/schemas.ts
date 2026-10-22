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

/**
 * A link target is either a store-relative path (`/about`, resolved against the
 * store's base path by the renderer) or an absolute `https:` URL. Everything
 * else — `javascript:`, `data:`, `http:`, protocol-relative `//host`,
 * credentials in the URL, control characters, backslashes — is rejected.
 */
export function isSafeHref(value: string): boolean {
  if (!value || value.length > 500 || CONTROL_OR_BACKSLASH.test(value)) return false
  if (value.startsWith('/')) return !value.startsWith('//')
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

export const heroPropsSchema = z
  .object({
    heading: textSchema(120),
    subheading: textSchema(DEFAULT_TEXT_MAX).optional(),
    cta: z.object({ label: textSchema(40), href: safeHrefSchema }).strict().optional(),
    align: z.enum(['start', 'center']).default('center'),
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
