import { z } from 'zod'
import { STOREFRONT_BLOCKS, isStorefrontBlockType, type StorefrontBlockProps, type StorefrontBlockType } from './catalog'

/**
 * Page specs use json-render's flat shape `{ root, elements }`, but this
 * module's schema is the source of truth. v1 pages are flat: a root `Page`
 * element whose children are sections; sections have no children.
 *
 * Validation runs on save, on publish and on render. It never repairs a spec:
 * any issue rejects the whole document (no best-effort rendering).
 */

export const MAX_SPEC_BYTES = 64 * 1024
export const MAX_SECTIONS_PER_PAGE = 40
export const ELEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/

const elementIdSchema = z.string().regex(ELEMENT_ID_PATTERN, 'storefront.validation.elementId')

const rawElementSchema = z
  .object({
    type: z.string().min(1).max(40),
    props: z.record(z.string(), z.unknown()).default({}),
    children: z.array(z.string()).default([]),
  })
  .strict()

const rawSpecSchema = z
  .object({
    root: elementIdSchema,
    elements: z.record(z.string(), rawElementSchema),
  })
  .strict()

export type PageSpecIssue = { path: string; code: string; message: string }

export type ValidatedSection = {
  [K in StorefrontBlockType]: { id: string; type: K; props: StorefrontBlockProps<K> }
}[StorefrontBlockType]

export type PageSpec = {
  root: string
  elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }>
}

export type PageSpecValidation =
  | { ok: true; spec: PageSpec; sections: ValidatedSection[] }
  | { ok: false; issues: PageSpecIssue[] }

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function zodPath(prefix: string, path: ReadonlyArray<PropertyKey>): string {
  return [prefix, ...path.map((segment) => String(segment))].filter(Boolean).join('.')
}

export function validatePageSpec(raw: unknown): PageSpecValidation {
  let serialized: string
  try {
    serialized = JSON.stringify(raw) ?? ''
  } catch {
    return { ok: false, issues: [{ path: '', code: 'not_serializable', message: 'storefront.validation.specInvalid' }] }
  }
  if (byteLength(serialized) > MAX_SPEC_BYTES) {
    return { ok: false, issues: [{ path: '', code: 'too_large', message: 'storefront.validation.specTooLarge' }] }
  }

  const parsed = rawSpecSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({ path: zodPath('', issue.path), code: 'invalid_shape', message: issue.message })),
    }
  }
  const { root, elements } = parsed.data
  const issues: PageSpecIssue[] = []

  for (const id of Object.keys(elements)) {
    if (!ELEMENT_ID_PATTERN.test(id)) issues.push({ path: `elements.${id}`, code: 'invalid_id', message: 'storefront.validation.elementId' })
  }

  const ownElement = (id: string) => (Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : undefined)
  const rootElement = ownElement(root)
  if (!rootElement) {
    return { ok: false, issues: [...issues, { path: 'root', code: 'missing_root', message: 'storefront.validation.specInvalid' }] }
  }
  if (rootElement.type !== 'Page') {
    issues.push({ path: `elements.${root}.type`, code: 'invalid_root', message: 'storefront.validation.specInvalid' })
  }
  if (Object.keys(rootElement.props).length > 0) {
    issues.push({ path: `elements.${root}.props`, code: 'unknown_prop', message: 'storefront.validation.unknownProp' })
  }
  if (rootElement.children.length > MAX_SECTIONS_PER_PAGE) {
    issues.push({ path: `elements.${root}.children`, code: 'too_many_sections', message: 'storefront.validation.tooManySections' })
  }

  const referenced = new Set<string>()
  const sections: ValidatedSection[] = []
  rootElement.children.forEach((childId, index) => {
    const path = `elements.${root}.children.${index}`
    if (referenced.has(childId)) {
      issues.push({ path, code: 'duplicate_reference', message: 'storefront.validation.specInvalid' })
      return
    }
    referenced.add(childId)
    const element = ownElement(childId)
    if (!element || childId === root) {
      issues.push({ path, code: 'missing_child', message: 'storefront.validation.specInvalid' })
      return
    }
    if (!isStorefrontBlockType(element.type)) {
      issues.push({ path: `elements.${childId}.type`, code: 'unknown_block', message: 'storefront.validation.unknownBlock' })
      return
    }
    if (element.children.length > 0) {
      issues.push({ path: `elements.${childId}.children`, code: 'nested_children', message: 'storefront.validation.specInvalid' })
    }
    const propsResult = STOREFRONT_BLOCKS[element.type].props.safeParse(element.props)
    if (!propsResult.success) {
      for (const issue of propsResult.error.issues) {
        issues.push({
          path: zodPath(`elements.${childId}.props`, issue.path),
          code: issue.code === 'unrecognized_keys' ? 'unknown_prop' : 'invalid_prop',
          message: issue.message,
        })
      }
      return
    }
    sections.push({ id: childId, type: element.type, props: propsResult.data } as ValidatedSection)
  })

  for (const id of Object.keys(elements)) {
    if (id !== root && !referenced.has(id)) {
      issues.push({ path: `elements.${id}`, code: 'orphan_element', message: 'storefront.validation.specInvalid' })
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, spec: parsed.data, sections }
}
