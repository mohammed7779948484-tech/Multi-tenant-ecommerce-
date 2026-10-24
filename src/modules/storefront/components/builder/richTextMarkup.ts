import {
  richTextDocumentSchema,
  type RichTextDocument,
  type RichTextInline,
} from '../../lib/blocks/schemas'

/**
 * The RichText block's editing markup (spec P2-Q9). A small, explicit subset,
 * parsed by this file into the structured document the block stores — never
 * into HTML:
 *
 *   blank line        new paragraph or list
 *   `- item`          bullet item         `1. item`   numbered item
 *   `**bold**`        bold                `*italic*`  italic
 *   `[label](href)`   link (https:// or a store path starting with /)
 *   `\*` `\[` `\]` `\\` `\-`   a literal character
 *
 * Anything else — including text that looks like HTML — stays text. A `*`
 * followed by a space never opens formatting, so "5 * 3" needs no escape.
 */

type Mark = 'bold' | 'italic'
type TextNode = Extract<RichTextInline, { type: 'text' }>
type Block = RichTextDocument['blocks'][number]

export type MarkupIssue = { message: string }
export type MarkupParseResult = { ok: true; doc: RichTextDocument } | { ok: false; issues: MarkupIssue[] }

const BULLET = /^-\s+/
const NUMBERED = /^\d{1,3}\.\s+/
const ESCAPABLE = new Set(['\\', '*', '[', ']', '-', '(', ')', '.'])

class MarkupError extends Error {}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const left = [...(a ?? [])].sort().join(',')
  const right = [...(b ?? [])].sort().join(',')
  return left === right
}

function textNode(text: string, bold: boolean, italic: boolean): TextNode {
  const marks: Mark[] = []
  if (bold) marks.push('bold')
  if (italic) marks.push('italic')
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

/**
 * Merges neighbouring text with equal marks. Blank text nodes are invalid in a
 * document, so whitespace-only text joins the previous node (the previous
 * link's label when that is a link) and is dropped at the start.
 */
function normalizeInline<T extends RichTextInline>(nodes: T[]): T[] {
  const out: RichTextInline[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (node.type === 'link') {
      out.push(node)
      continue
    }
    if (!node.text.trim()) {
      if (!last) continue
      if (last.type === 'text') {
        out[out.length - 1] = { ...last, text: last.text + node.text }
      } else {
        const children = [...last.children]
        const tail = children[children.length - 1]
        children[children.length - 1] = { ...tail, text: tail.text + node.text }
        out[out.length - 1] = { ...last, children }
      }
      continue
    }
    if (last && last.type === 'text' && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = { ...last, text: last.text + node.text }
      continue
    }
    out.push(node)
  }
  return out as T[]
}

/** Parses inline markup. `allowLinks` is false inside a link label (links do not nest). */
function parseInline(source: string, allowLinks: boolean): RichTextInline[] {
  const nodes: RichTextInline[] = []
  let buffer = ''
  let bold = false
  let italic = false
  const flush = () => {
    if (buffer) nodes.push(textNode(buffer, bold, italic))
    buffer = ''
  }
  // A marker opens only before a non-space character and closes only after one.
  const canOpen = (index: number, width: number) => {
    const next = source[index + width]
    return next !== undefined && !/\s/.test(next)
  }
  const canClose = (index: number) => {
    const previous = source[index - 1]
    return previous !== undefined && !/\s/.test(previous)
  }

  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === '\\' && i + 1 < source.length && ESCAPABLE.has(source[i + 1])) {
      buffer += source[i + 1]
      i += 2
      continue
    }
    if (char === '*') {
      const double = source[i + 1] === '*'
      const width = double ? 2 : 1
      const open = double ? bold : italic
      if (open ? canClose(i) : canOpen(i, width)) {
        flush()
        if (double) bold = !bold
        else italic = !italic
        i += width
        continue
      }
      buffer += source.slice(i, i + width)
      i += width
      continue
    }
    if (char === '[' && allowLinks) {
      const link = readLink(source, i)
      if (link) {
        flush()
        const children = parseInline(link.label, false).map((node) => {
          if (node.type !== 'text') throw new MarkupError('storefront.validation.markupInvalid')
          // Formatting around a link applies to its label too.
          const marks = new Set<Mark>(node.marks ?? [])
          if (bold) marks.add('bold')
          if (italic) marks.add('italic')
          return marks.size ? { ...node, marks: [...marks] } : { type: 'text' as const, text: node.text }
        })
        if (!children.length) throw new MarkupError('storefront.validation.markupLinkLabel')
        nodes.push({ type: 'link', href: link.href.trim(), children: normalizeInline(children) })
        i = link.end
        continue
      }
    }
    buffer += char
    i += 1
  }
  if (bold || italic) throw new MarkupError('storefront.validation.markupUnclosed')
  flush()
  return normalizeInline(nodes)
}

/** `[label](href)` starting at `start`; null when the brackets do not form a link. */
function readLink(source: string, start: number): { label: string; href: string; end: number } | null {
  let i = start + 1
  let label = ''
  while (i < source.length) {
    const char = source[i]
    if (char === '\\' && i + 1 < source.length) {
      label += char + source[i + 1]
      i += 2
      continue
    }
    if (char === ']') break
    if (char === '[') return null
    label += char
    i += 1
  }
  if (source[i] !== ']' || source[i + 1] !== '(') return null
  const close = source.indexOf(')', i + 2)
  if (close < 0) return null
  const href = source.slice(i + 2, close)
  if (/\s/.test(href.trim()) || !href.trim()) return null
  return { label, href, end: close + 1 }
}

function parseBlock(lines: string[]): Block {
  const first = lines[0]
  const ordered = NUMBERED.test(first)
  if (ordered || BULLET.test(first)) {
    const marker = ordered ? NUMBERED : BULLET
    const items: string[] = []
    for (const line of lines) {
      if (marker.test(line)) items.push(line.replace(marker, ''))
      else items[items.length - 1] = `${items[items.length - 1]} ${line}`
    }
    return { type: 'list', ordered, items: items.map((item) => parseInline(item, true)) }
  }
  return { type: 'paragraph', children: parseInline(lines.join(' '), true) }
}

export function parseRichTextMarkup(markup: string): MarkupParseResult {
  const blocks: string[][] = []
  let current: string[] = []
  for (const rawLine of markup.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      if (current.length) blocks.push(current)
      current = []
      continue
    }
    // A list line right after a paragraph line starts a new block.
    const startsList = BULLET.test(line) || NUMBERED.test(line)
    if (current.length && startsList && !(BULLET.test(current[0]) || NUMBERED.test(current[0]))) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length) blocks.push(current)
  if (!blocks.length) return { ok: false, issues: [{ message: 'storefront.validation.textRequired' }] }

  let doc: RichTextDocument
  try {
    doc = { type: 'doc', blocks: blocks.map(parseBlock) }
  } catch (error) {
    if (error instanceof MarkupError) return { ok: false, issues: [{ message: error.message }] }
    throw error
  }
  const checked = richTextDocumentSchema.safeParse(doc)
  if (!checked.success) {
    const messages = [...new Set(checked.error.issues.map((issue) => issue.message))]
    return { ok: false, issues: messages.map((message) => ({ message })) }
  }
  return { ok: true, doc: checked.data }
}

function escapeText(text: string): string {
  return text.replace(/[\\*[\]]/g, (char) => `\\${char}`)
}

function serializeText(node: TextNode): string {
  const text = node.text.replace(/\s*\n\s*/g, ' ')
  const marks = node.marks ?? []
  if (!marks.length) return escapeText(text)
  // Markers must touch the text, so edge whitespace moves outside them.
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
  const [lead, core, trail] = match ? [match[1], match[2], match[3]] : ['', text, '']
  const marker = (marks.includes('bold') ? '**' : '') + (marks.includes('italic') ? '*' : '')
  return `${lead}${marker}${escapeText(core)}${[...marker].reverse().join('')}${trail}`
}

function serializeInline(nodes: RichTextInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return serializeText(node)
      const label = node.children.map(serializeText).join('')
      return `[${label}](${node.href.replace(/\)/g, '%29').replace(/\s/g, '%20')})`
    })
    .join('')
}

/** Escapes a line start that would otherwise read as a list marker. */
function guardLineStart(text: string): string {
  if (/^-\s/.test(text)) return `\\${text}`
  const numbered = /^(\d{1,3})\.(\s)/.exec(text)
  if (numbered) return `${numbered[1]}\\.${text.slice(numbered[1].length + 1)}`
  return text
}

export function serializeRichTextMarkup(doc: RichTextDocument): string {
  return doc.blocks
    .map((block) => {
      if (block.type === 'paragraph') return guardLineStart(serializeInline(block.children).trim())
      return block.items
        .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${guardLineStart(serializeInline(item).trim())}`)
        .join('\n')
    })
    .join('\n\n')
}
