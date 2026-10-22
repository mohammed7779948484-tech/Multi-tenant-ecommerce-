import type { z } from 'zod'
import { STOREFRONT_BLOCKS, type StorefrontBlockType } from '../../lib/blocks/catalog'
import type { RichTextDocument } from '../../lib/blocks/schemas'
import { parseRichTextMarkup, serializeRichTextMarkup } from './richTextMarkup'

/**
 * Editor-field map (spec P2-Q14): which inspector field edits each block prop.
 * Kept in parity with the block schemas by TEST-015 — a prop without an
 * editor field, or a field without a prop, fails the test.
 */

export type Label = readonly [key: string, fallback: string]

export type EditorTextField = { id: string; kind: 'text' | 'textarea'; label: Label; required?: boolean; maxLength: number }
export type EditorSelectField = { id: string; kind: 'select'; label: Label; options: ReadonlyArray<{ value: string; label: Label }> }
export type EditorLinkField = { id: string; kind: 'link'; label: Label }
export type EditorListField = {
  id: string
  kind: 'list'
  label: Label
  itemLabel: Label
  addLabel: Label
  min: number
  max: number
  item: readonly EditorTextField[]
}
export type EditorRichTextField = { id: string; kind: 'richtext'; label: Label }
export type EditorField = EditorTextField | EditorSelectField | EditorLinkField | EditorListField | EditorRichTextField

export type BlockEditor = { label: Label; fields: readonly EditorField[] }

/** Sub-fields of a `link` editor field; the CTA schema is `{ label, href }`. */
export const LINK_FIELDS: readonly EditorTextField[] = [
  { id: 'label', kind: 'text', label: ['storefront.builder.fields.linkLabel', 'Link text'], maxLength: 40 },
  { id: 'href', kind: 'text', label: ['storefront.builder.fields.linkHref', 'Link address'], maxLength: 500 },
]

export const BLOCK_EDITORS: Record<StorefrontBlockType, BlockEditor> = {
  Hero: {
    label: ['storefront.builder.blocks.Hero', 'Hero'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], required: true, maxLength: 120 },
      { id: 'subheading', kind: 'textarea', label: ['storefront.builder.fields.subheading', 'Subheading'], maxLength: 200 },
      { id: 'cta', kind: 'link', label: ['storefront.builder.fields.cta', 'Call to action'] },
      {
        id: 'align',
        kind: 'select',
        label: ['storefront.builder.fields.align', 'Alignment'],
        options: [
          { value: 'center', label: ['storefront.builder.align.center', 'Centred'] },
          { value: 'start', label: ['storefront.builder.align.start', 'Start'] },
        ],
      },
    ],
  },
  RichText: {
    label: ['storefront.builder.blocks.RichText', 'Rich text'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      { id: 'content', kind: 'richtext', label: ['storefront.builder.fields.content', 'Text'] },
    ],
  },
  Features: {
    label: ['storefront.builder.blocks.Features', 'Features'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      {
        id: 'items',
        kind: 'list',
        label: ['storefront.builder.fields.features', 'Selling points'],
        itemLabel: ['storefront.builder.fields.feature', 'Selling point {n}'],
        addLabel: ['storefront.builder.actions.addFeature', 'Add selling point'],
        min: 1,
        max: 6,
        item: [
          { id: 'title', kind: 'text', label: ['storefront.builder.fields.featureTitle', 'Title'], required: true, maxLength: 60 },
          { id: 'body', kind: 'textarea', label: ['storefront.builder.fields.featureBody', 'Sentence'], required: true, maxLength: 200 },
        ],
      },
    ],
  },
  Footer: {
    label: ['storefront.builder.blocks.Footer', 'Footer'],
    fields: [
      { id: 'text', kind: 'textarea', label: ['storefront.builder.fields.footerText', 'Text'], maxLength: 200 },
      {
        id: 'links',
        kind: 'list',
        label: ['storefront.builder.fields.links', 'Links'],
        itemLabel: ['storefront.builder.fields.link', 'Link {n}'],
        addLabel: ['storefront.builder.actions.addLink', 'Add link'],
        min: 0,
        max: 8,
        item: LINK_FIELDS,
      },
    ],
  },
}

export type ListItemValue = Record<string, string>
export type BlockFormValues = Record<string, string | ListItemValue | ListItemValue[]>

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

function itemValue(fields: readonly EditorTextField[], raw: unknown): ListItemValue {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(fields.map((field) => [field.id, asString(source[field.id])]))
}

/** Stored props → inspector form values (strings everywhere; rich text as markup). */
export function blockPropsToFormValues(type: StorefrontBlockType, props: Record<string, unknown>): BlockFormValues {
  const values: BlockFormValues = {}
  for (const field of BLOCK_EDITORS[type].fields) {
    const raw = props[field.id]
    switch (field.kind) {
      case 'text':
      case 'textarea':
        values[field.id] = asString(raw)
        break
      case 'select':
        values[field.id] = asString(raw) || field.options[0].value
        break
      case 'link':
        values[field.id] = itemValue(LINK_FIELDS, raw)
        break
      case 'list':
        values[field.id] = Array.isArray(raw) ? raw.map((item) => itemValue(field.item, item)) : []
        break
      case 'richtext': {
        const parsed = STOREFRONT_BLOCKS.RichText.props.shape.content.safeParse(raw)
        values[field.id] = parsed.success ? serializeRichTextMarkup(parsed.data as RichTextDocument) : ''
        break
      }
    }
  }
  return values
}

/** Where inside a list or link field an error sits (item index and/or sub-field id). */
export type FieldErrorLocation = { index?: number; subField?: string }

export type BlockFormResult =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, string>; locations?: Record<string, FieldErrorLocation> }

function trimItem(fields: readonly EditorTextField[], raw: unknown): Record<string, string> | null {
  const item = itemValue(fields, raw)
  const trimmed = Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value.trim()]))
  return Object.values(trimmed).some(Boolean) ? trimmed : null
}

/**
 * Inspector form values → block props, validated by the block's own schema.
 * Empty optional text is omitted (not stored as `''`); blank list rows and an
 * empty link are dropped. Error messages are translation keys keyed by field id.
 */
export function formValuesToBlockProps(type: StorefrontBlockType, values: Record<string, unknown>): BlockFormResult {
  const props: Record<string, unknown> = {}
  const fieldErrors: Record<string, string> = {}
  for (const field of BLOCK_EDITORS[type].fields) {
    const raw = values[field.id]
    switch (field.kind) {
      case 'text':
      case 'textarea': {
        const text = asString(raw).trim()
        // A required field keeps '' so the schema reports "required" on it.
        if (text || field.required) props[field.id] = text
        break
      }
      case 'select':
        if (asString(raw)) props[field.id] = asString(raw)
        break
      case 'link': {
        const link = trimItem(LINK_FIELDS, raw)
        if (link) props[field.id] = link
        break
      }
      case 'list': {
        const items = (Array.isArray(raw) ? raw : [])
          .map((item) => trimItem(field.item, item))
          .filter((item): item is Record<string, string> => item !== null)
        if (items.length < field.min) fieldErrors[field.id] = 'storefront.validation.listTooShort'
        props[field.id] = items
        break
      }
      case 'richtext': {
        const parsed = parseRichTextMarkup(asString(raw))
        if (parsed.ok) props[field.id] = parsed.doc
        else fieldErrors[field.id] = parsed.issues[0]?.message ?? 'storefront.validation.invalidValue'
        break
      }
    }
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors }

  const schema = STOREFRONT_BLOCKS[type].props as z.ZodTypeAny
  const checked = schema.safeParse(props)
  if (!checked.success) {
    const locations: Record<string, FieldErrorLocation> = {}
    for (const issue of checked.error.issues) {
      const id = String(issue.path[0] ?? '')
      if (id && !fieldErrors[id]) {
        const rest = issue.path.slice(1)
        const index = typeof rest[0] === 'number' ? rest[0] : undefined
        const sub = rest.find((segment) => typeof segment === 'string')
        if (index !== undefined || sub !== undefined) locations[id] = { index, subField: typeof sub === 'string' ? sub : undefined }
      }
      // Schema messages are translation keys; zod's own defaults are not, so they get a generic key.
      const message = issue.message.startsWith('storefront.') ? issue.message : 'storefront.validation.invalidValue'
      if (id && !fieldErrors[id]) fieldErrors[id] = message
    }
    return { ok: false, fieldErrors, locations }
  }
  return { ok: true, props: checked.data as Record<string, unknown> }
}

/** Valid starter props for a section added from the picker. */
export function defaultBlockProps(type: StorefrontBlockType, translate: (key: string, fallback: string) => string): Record<string, unknown> {
  switch (type) {
    case 'Hero':
      return { heading: translate('storefront.builder.defaults.heroHeading', 'Your headline'), align: 'center' }
    case 'RichText':
      return {
        content: {
          type: 'doc',
          blocks: [{ type: 'paragraph', children: [{ type: 'text', text: translate('storefront.builder.defaults.richText', 'Tell your customers something about this page.') }] }],
        },
      }
    case 'Features':
      return {
        items: [
          {
            title: translate('storefront.builder.defaults.featureTitle', 'A selling point'),
            body: translate('storefront.builder.defaults.featureBody', 'One sentence about why it matters.'),
          },
        ],
      }
    case 'Footer':
      return { links: [] }
  }
}
