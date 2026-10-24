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
/** One image: an upload (stored as an attachment id) plus alt text. */
export type EditorImageField = { id: string; kind: 'image'; label: Label; required?: boolean }
/** Several images, each with alt text (Gallery). */
export type EditorImageListField = { id: string; kind: 'images'; label: Label; itemLabel: Label; addLabel: Label; min: number; max: number }
/** ProductGrid source: a category, or hand-picked products. */
export type EditorProductSourceField = { id: string; kind: 'productSource'; label: Label }
/** CollectionList categories, in order. */
export type EditorCategoriesField = { id: string; kind: 'categories'; label: Label }
export type EditorNumberField = { id: string; kind: 'number'; label: Label; min: number; max: number }
export type EditorCheckboxField = { id: string; kind: 'checkbox'; label: Label; defaultValue: boolean }
export type EditorField =
  | EditorTextField
  | EditorProductSourceField
  | EditorCategoriesField
  | EditorNumberField
  | EditorCheckboxField
  | EditorSelectField
  | EditorLinkField
  | EditorListField
  | EditorRichTextField
  | EditorImageField
  | EditorImageListField

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
      { id: 'image', kind: 'image', label: ['storefront.builder.fields.heroImage', 'Image beside the text (optional)'] },
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
  Image: {
    label: ['storefront.builder.blocks.Image', 'Image'],
    fields: [
      { id: 'image', kind: 'image', label: ['storefront.builder.fields.image', 'Image'], required: true },
      { id: 'caption', kind: 'text', label: ['storefront.builder.fields.caption', 'Caption'], maxLength: 200 },
      { id: 'href', kind: 'text', label: ['storefront.builder.fields.imageLink', 'Link address (optional)'], maxLength: 500 },
      {
        id: 'width',
        kind: 'select',
        label: ['storefront.builder.fields.width', 'Width'],
        options: [
          { value: 'contained', label: ['storefront.builder.width.contained', 'Page width'] },
          { value: 'full', label: ['storefront.builder.width.full', 'Full width'] },
        ],
      },
    ],
  },
  ImageText: {
    label: ['storefront.builder.blocks.ImageText', 'Image with text'],
    fields: [
      { id: 'image', kind: 'image', label: ['storefront.builder.fields.image', 'Image'], required: true },
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], required: true, maxLength: 120 },
      { id: 'body', kind: 'textarea', label: ['storefront.builder.fields.body', 'Text'], maxLength: 600 },
      { id: 'cta', kind: 'link', label: ['storefront.builder.fields.cta', 'Call to action'] },
      {
        id: 'imagePosition',
        kind: 'select',
        label: ['storefront.builder.fields.imagePosition', 'Image position'],
        options: [
          { value: 'start', label: ['storefront.builder.position.start', 'Image first'] },
          { value: 'end', label: ['storefront.builder.position.end', 'Text first'] },
        ],
      },
    ],
  },
  Gallery: {
    label: ['storefront.builder.blocks.Gallery', 'Gallery'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      {
        id: 'images',
        kind: 'images',
        label: ['storefront.builder.fields.images', 'Images'],
        itemLabel: ['storefront.builder.fields.imageN', 'Image {n}'],
        addLabel: ['storefront.builder.actions.addImage', 'Add image'],
        min: 2,
        max: 12,
      },
    ],
  },
  ProductGrid: {
    label: ['storefront.builder.blocks.ProductGrid', 'Products'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      { id: 'source', kind: 'productSource', label: ['storefront.builder.fields.productSource', 'Products to show'] },
      { id: 'limit', kind: 'number', label: ['storefront.builder.fields.limit', 'How many to show (1–12)'], min: 1, max: 12 },
      { id: 'showPrice', kind: 'checkbox', label: ['storefront.builder.fields.showPrice', 'Show prices'], defaultValue: true },
    ],
  },
  CollectionList: {
    label: ['storefront.builder.blocks.CollectionList', 'Collections'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      { id: 'categoryIds', kind: 'categories', label: ['storefront.builder.fields.categories', 'Categories'] },
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
  Testimonials: {
    label: ['storefront.builder.blocks.Testimonials', 'Testimonials'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      {
        id: 'items',
        kind: 'list',
        label: ['storefront.builder.fields.quotes', 'Quotes'],
        itemLabel: ['storefront.builder.fields.quoteN', 'Quote {n}'],
        addLabel: ['storefront.builder.actions.addQuote', 'Add quote'],
        min: 1,
        max: 6,
        item: [
          { id: 'quote', kind: 'textarea', label: ['storefront.builder.fields.quote', 'Quote'], required: true, maxLength: 400 },
          { id: 'author', kind: 'text', label: ['storefront.builder.fields.author', 'Name'], required: true, maxLength: 80 },
          { id: 'role', kind: 'text', label: ['storefront.builder.fields.role', 'Role or city'], maxLength: 80 },
        ],
      },
    ],
  },
  Faq: {
    label: ['storefront.builder.blocks.Faq', 'Questions and answers'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      {
        id: 'items',
        kind: 'list',
        label: ['storefront.builder.fields.questions', 'Questions'],
        itemLabel: ['storefront.builder.fields.questionN', 'Question {n}'],
        addLabel: ['storefront.builder.actions.addQuestion', 'Add question'],
        min: 1,
        max: 12,
        item: [
          { id: 'question', kind: 'text', label: ['storefront.builder.fields.question', 'Question'], required: true, maxLength: 200 },
          { id: 'answer', kind: 'textarea', label: ['storefront.builder.fields.answer', 'Answer'], required: true, maxLength: 1000 },
        ],
      },
    ],
  },
  ContactInfo: {
    label: ['storefront.builder.blocks.ContactInfo', 'Contact details'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], maxLength: 120 },
      { id: 'address', kind: 'textarea', label: ['storefront.builder.fields.address', 'Address'], maxLength: 300 },
      { id: 'phone', kind: 'text', label: ['storefront.builder.fields.phone', 'Phone'], maxLength: 40 },
      { id: 'email', kind: 'text', label: ['storefront.builder.fields.email', 'Email'], maxLength: 120 },
      { id: 'hours', kind: 'textarea', label: ['storefront.builder.fields.hours', 'Opening hours'], maxLength: 300 },
    ],
  },
  CallToAction: {
    label: ['storefront.builder.blocks.CallToAction', 'Call to action'],
    fields: [
      { id: 'heading', kind: 'text', label: ['storefront.builder.fields.heading', 'Heading'], required: true, maxLength: 120 },
      { id: 'body', kind: 'textarea', label: ['storefront.builder.fields.body', 'Text'], maxLength: 200 },
      { id: 'cta', kind: 'link', label: ['storefront.builder.fields.button', 'Button'] },
      {
        id: 'tone',
        kind: 'select',
        label: ['storefront.builder.fields.tone', 'Style'],
        options: [
          { value: 'surface', label: ['storefront.builder.tone.surface', 'Quiet'] },
          { value: 'primary', label: ['storefront.builder.tone.primary', 'Brand colour'] },
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
/** Inspector value of an image field: the attachment id plus alt text (empty strings when unset). */
export type ImageValue = { attachmentId: string; alt: string }
/** Inspector value of a ProductGrid source; both id fields are kept so switching kind does not lose a choice. */
export type ProductSourceValue = { kind: 'category' | 'products'; categoryId: string; productIds: string[] }
export type BlockFormValues = Record<
  string,
  string | number | boolean | string[] | ListItemValue | ListItemValue[] | ImageValue | ImageValue[] | ProductSourceValue
>

const asIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []

export function productSourceValue(raw: unknown): ProductSourceValue {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    kind: source.kind === 'products' ? 'products' : 'category',
    categoryId: typeof source.categoryId === 'string' ? source.categoryId : '',
    productIds: asIds(source.productIds),
  }
}

function imageValue(raw: unknown): ImageValue {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { attachmentId: asString(source.attachmentId), alt: asString(source.alt) }
}

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
      case 'image':
        values[field.id] = imageValue(raw)
        break
      case 'images':
        values[field.id] = Array.isArray(raw) ? raw.map(imageValue) : []
        break
      case 'productSource':
        values[field.id] = productSourceValue(raw)
        break
      case 'categories':
        values[field.id] = asIds(raw)
        break
      case 'number':
        if (typeof raw === 'number') values[field.id] = raw
        break
      case 'checkbox':
        values[field.id] = typeof raw === 'boolean' ? raw : field.defaultValue
        break
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
      case 'image': {
        const image = imageValue(raw)
        // A required image keeps an empty id so the schema reports "add an image" on this field.
        if (image.attachmentId || field.required) props[field.id] = { attachmentId: image.attachmentId, alt: image.alt.trim() }
        break
      }
      case 'images': {
        const images = (Array.isArray(raw) ? raw : []).map(imageValue).filter((image) => image.attachmentId)
        if (images.length < field.min) fieldErrors[field.id] = 'storefront.validation.galleryTooFew'
        props[field.id] = images.map((image) => ({ attachmentId: image.attachmentId, alt: image.alt.trim() }))
        break
      }
      case 'productSource': {
        // Only the chosen kind's ids are stored; an empty choice keeps '' / [] so the schema names it.
        const source = productSourceValue(raw)
        props[field.id] = source.kind === 'products' ? { kind: 'products', productIds: source.productIds } : { kind: 'category', categoryId: source.categoryId }
        break
      }
      case 'categories':
        props[field.id] = asIds(raw)
        break
      case 'number': {
        // Empty keeps the schema default; anything else must be a whole number in range.
        const text = typeof raw === 'number' ? String(raw) : asString(raw).trim()
        if (text) {
          const parsed = Number(text)
          if (Number.isInteger(parsed) && parsed >= field.min && parsed <= field.max) props[field.id] = parsed
          else fieldErrors[field.id] = 'storefront.validation.numberRange'
        }
        break
      }
      case 'checkbox':
        props[field.id] = typeof raw === 'boolean' ? raw : field.defaultValue
        break
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
    // Image sections start without an image: the section is listed as an issue until one is uploaded.
    case 'Image':
      return { image: { attachmentId: '', alt: '' }, width: 'contained' }
    case 'ImageText':
      return {
        image: { attachmentId: '', alt: '' },
        heading: translate('storefront.builder.defaults.imageTextHeading', 'Made with care'),
        imagePosition: 'start',
      }
    case 'Gallery':
      return { images: [] }
    case 'Testimonials':
      return {
        items: [
          {
            quote: translate('storefront.builder.defaults.quote', 'Lovely service and quick delivery.'),
            author: translate('storefront.builder.defaults.quoteAuthor', 'A happy customer'),
          },
        ],
      }
    case 'Faq':
      return {
        heading: translate('storefront.builder.defaults.faqHeading', 'Questions and answers'),
        items: [
          {
            question: translate('storefront.builder.defaults.faqQuestion', 'How do I pay?'),
            answer: translate('storefront.builder.defaults.faqAnswer', 'Pay cash on delivery or by bank transfer.'),
          },
        ],
      }
    case 'ContactInfo':
      return {
        heading: translate('storefront.builder.defaults.contactHeading', 'Contact us'),
        hours: translate('storefront.builder.defaults.contactHours', 'Monday to Friday, 9:00–17:00'),
      }
    case 'CallToAction':
      return {
        heading: translate('storefront.builder.defaults.ctaHeading', 'Ready to order?'),
        cta: { label: translate('storefront.builder.defaults.ctaLabel', 'Contact us'), href: '/contact' },
        tone: 'surface',
      }
    // Catalog sections start without a choice: listed as an issue until a category or products are picked.
    case 'ProductGrid':
      return {
        heading: translate('storefront.builder.defaults.productsHeading', 'Our products'),
        source: { kind: 'category', categoryId: '' },
        limit: 8,
        showPrice: true,
      }
    case 'CollectionList':
      return { heading: translate('storefront.builder.defaults.collectionsHeading', 'Shop by category'), categoryIds: [] }
  }
}
