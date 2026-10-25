import { describe, expect, it } from '@jest/globals'
import { parseRichTextMarkup, serializeRichTextMarkup } from '../richTextMarkup'
import type { RichTextDocument } from '../../../lib/blocks/schemas'

/** TEST-016: rich-text markup parse/serialise (spec P2-Q9). */

function parse(markup: string): RichTextDocument {
  const result = parseRichTextMarkup(markup)
  if (!result.ok) throw new Error(`expected markup to parse: ${JSON.stringify(result.issues)}`)
  return result.doc
}

function issues(markup: string): string[] {
  const result = parseRichTextMarkup(markup)
  return result.ok ? [] : result.issues.map((issue) => issue.message)
}

describe('rich-text markup', () => {
  it('parses paragraphs, lists, marks and links into the structured document', () => {
    const doc = parse([
      'We roast **small batches** every *Tuesday*.',
      'Still the same paragraph, see [our story](/about).',
      '',
      '- Single origin',
      '- **Fresh** beans',
      '',
      '1. Order online',
      '2. Pick up at [the shop](https://example.com/map)',
    ].join('\n'))

    expect(doc).toEqual({
      type: 'doc',
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'We roast ' },
            { type: 'text', text: 'small batches', marks: ['bold'] },
            { type: 'text', text: ' every ' },
            { type: 'text', text: 'Tuesday', marks: ['italic'] },
            { type: 'text', text: '. Still the same paragraph, see ' },
            { type: 'link', href: '/about', children: [{ type: 'text', text: 'our story' }] },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'list',
          ordered: false,
          items: [
            [{ type: 'text', text: 'Single origin' }],
            [{ type: 'text', text: 'Fresh', marks: ['bold'] }, { type: 'text', text: ' beans' }],
          ],
        },
        {
          type: 'list',
          ordered: true,
          items: [
            [{ type: 'text', text: 'Order online' }],
            [{ type: 'text', text: 'Pick up at ' }, { type: 'link', href: 'https://example.com/map', children: [{ type: 'text', text: 'the shop' }] }],
          ],
        },
      ],
    })
  })

  it('round-trips: serialise then parse gives the same document', () => {
    const samples = [
      'Plain text.',
      'A **bold** and *italic* and ***both*** word.',
      'Link [**strong** label](/x) inside.',
      '- one\n- two with [link](https://example.com/a)\n\n1. first\n2. second',
      'Literal \\*stars\\* and \\[brackets\\] and a back\\\\slash.',
      '5 * 3 = 15',
      '\\- not a list',
      '1\\. not numbered',
    ]
    for (const markup of samples) {
      const doc = parse(markup)
      expect(parse(serializeRichTextMarkup(doc))).toEqual(doc)
    }
  })

  it('serialises documents that did not come from markup, keeping them parseable', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      blocks: [
        { type: 'paragraph', children: [{ type: 'text', text: '- starts like a list' }] },
        { type: 'paragraph', children: [{ type: 'text', text: '12. starts like a number' }] },
        { type: 'paragraph', children: [{ type: 'text', text: ' padded ', marks: ['bold'] }, { type: 'text', text: 'a*b [c]' }] },
      ],
    }
    const markup = serializeRichTextMarkup(doc)
    const reparsed = parse(markup)
    expect(reparsed.blocks).toHaveLength(3)
    expect(reparsed.blocks[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: '- starts like a list' }] })
    expect(reparsed.blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: '12. starts like a number' }] })
    expect(serializeRichTextMarkup(reparsed)).toBe(markup)
  })

  it('keeps markup that looks like HTML as text', () => {
    const doc = parse('<script>alert(1)</script> <b onclick="x">hi</b>')
    expect(doc.blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script> <b onclick="x">hi</b>' }] },
    ])
  })

  it('rejects unsafe or malformed links through the block schema', () => {
    expect(issues('[x](javascript:alert(1))')).toContain('storefront.validation.unsafeHref')
    expect(issues('[x](http://example.com)')).toContain('storefront.validation.unsafeHref')
    expect(issues('[x](//evil.example)')).toContain('storefront.validation.unsafeHref')
    expect(issues('[x](data:text/html,hi)')).toContain('storefront.validation.unsafeHref')
  })

  it('reports empty text, unclosed formatting and over-long content', () => {
    expect(issues('   \n\n ')).toEqual(['storefront.validation.textRequired'])
    expect(issues('an **open bold')).toEqual(['storefront.validation.markupUnclosed'])
    expect(issues('x'.repeat(5001))).toContain('storefront.validation.textTooLong')
  })

  it('treats brackets that are not a link as text', () => {
    expect(parse('[not a link] and [also](not a link)').blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: '[not a link] and [also](not a link)' }],
    })
  })
  it('keeps balanced parentheses inside a link target and round-trips them', () => {
    const doc = parse('See [Help](https://example.com/help_(billing)) now.')
    expect(doc.blocks[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'See ' },
        { type: 'link', href: 'https://example.com/help_(billing)', children: [{ type: 'text', text: 'Help' }] },
        { type: 'text', text: ' now.' },
      ],
    })
    expect(parse(serializeRichTextMarkup(doc))).toEqual(doc)
  })

  it('round-trips a link target with an unbalanced parenthesis', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      blocks: [{ type: 'paragraph', children: [{ type: 'link', href: 'https://example.com/a)b(c', children: [{ type: 'text', text: 'x' }] }] }],
    }
    const back = parse(serializeRichTextMarkup(doc))
    const link = (back.blocks[0] as { children: Array<{ type: string; href?: string }> }).children[0]
    expect(link.type).toBe('link')
    expect(decodeURIComponent(link.href!)).toBe('https://example.com/a)b(c')
  })
})
