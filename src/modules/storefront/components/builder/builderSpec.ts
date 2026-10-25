import { ELEMENT_ID_PATTERN, type PageSpec, type PageSpecIssue } from '../../lib/blocks/pageSpec'
import { isStorefrontBlockType, type StorefrontBlockType } from '../../lib/blocks/catalog'

/** One section as the builder edits it: the element id, its block type and its raw props. */
export type BuilderSection = { id: string; type: StorefrontBlockType; props: Record<string, unknown> }

export type BuilderDraft = { rootId: string; sections: BuilderSection[] }

const DEFAULT_ROOT_ID = 'page'

/**
 * Reads a stored spec into an ordered section list. Saved drafts passed the
 * validator, so anything unexpected (an unknown block, a missing child) is
 * dropped rather than shown; a spec that is not an object yields an empty page.
 */
export function specToDraft(raw: unknown): BuilderDraft {
  const spec = raw && typeof raw === 'object' ? (raw as Partial<PageSpec>) : {}
  const rootId = typeof spec.root === 'string' && ELEMENT_ID_PATTERN.test(spec.root) ? spec.root : DEFAULT_ROOT_ID
  const elements = spec.elements && typeof spec.elements === 'object' ? spec.elements : {}
  const own = (id: string) => (Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : undefined)
  const root = own(rootId)
  const sections: BuilderSection[] = []
  for (const id of Array.isArray(root?.children) ? root.children : []) {
    const element = typeof id === 'string' ? own(id) : undefined
    if (!element || !isStorefrontBlockType(element.type)) continue
    sections.push({ id, type: element.type, props: element.props && typeof element.props === 'object' ? { ...element.props } : {} })
  }
  return { rootId, sections }
}

export function draftToSpec(draft: BuilderDraft): PageSpec {
  const elements: PageSpec['elements'] = {
    [draft.rootId]: { type: 'Page', props: {}, children: draft.sections.map((section) => section.id) },
  }
  for (const section of draft.sections) {
    elements[section.id] = { type: section.type, props: section.props, children: [] }
  }
  return { root: draft.rootId, elements }
}

/** A fresh element id for a new section, e.g. `features-3`, unique within the page. */
export function newSectionId(type: StorefrontBlockType, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = type.toLowerCase()
  for (let n = 1; n < 1000; n += 1) {
    const id = `${base}-${n}`
    if (!used.has(id)) return id
  }
  throw new Error('[internal] no free section id')
}

export function moveSection(sections: BuilderSection[], index: number, delta: -1 | 1): BuilderSection[] {
  const target = index + delta
  if (index < 0 || index >= sections.length || target < 0 || target >= sections.length) return sections
  const next = [...sections]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

/**
 * Which section an issue path points at: `elements.<id>…` names it directly,
 * `elements.<root>.children.<n>` by position. Page-level issues return null.
 */
export function issueSectionId(issue: Pick<PageSpecIssue, 'path'>, draft: BuilderDraft): string | null {
  const parts = issue.path.split('.')
  if (parts[0] !== 'elements' || !parts[1]) return null
  if (parts[1] === draft.rootId) {
    if (parts[2] === 'children' && parts[3] !== undefined) return draft.sections[Number(parts[3])]?.id ?? null
    return null
  }
  return draft.sections.some((section) => section.id === parts[1]) ? parts[1] : null
}

export { stableStringify } from '../../lib/stableJson'
