import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineCatalog, validateSpec } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import { validatePageSpec } from '../pageSpec'

/**
 * The facts behind docs/DECISIONS.md S1/S2 (spec "Revision 2026-10-23"), kept
 * runnable: if a json-render upgrade changes one of them, this test fails and
 * the decision must be revisited instead of silently drifting.
 */

function distEntry(pkg: string, file: string): string {
  // The packages export no package.json; jest runs from the app root.
  return readFileSync(path.join(process.cwd(), 'node_modules', pkg, 'dist', file), 'utf8')
}

describe('json-render assumptions (installed 0.21.0)', () => {
  it('@json-render/core and the React schema entry import no React (they may run on the server)', () => {
    const imports = (source: string) => [...source.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1])
    expect(imports(distEntry('@json-render/core', 'index.mjs')).filter((name) => /react/.test(name))).toEqual([])
    const schemaEntry = distEntry('@json-render/react', 'schema.mjs')
    const chunk = /from "\.\/(chunk-[^"]+)"/.exec(schemaEntry)?.[1]
    expect(imports(schemaEntry).filter((name) => /react/.test(name))).toEqual([])
    if (chunk) expect(imports(distEntry('@json-render/react', chunk)).filter((name) => /react/.test(name))).toEqual([])
  })

  it('catalog.validate checks element types but not props, so our strict validator stays the gate', () => {
    const catalog = defineCatalog(schema, {
      components: {
        Page: { props: z.object({}).strict(), slots: ['default'], description: 'page' },
        Hero: { props: z.object({ heading: z.string().max(5) }).strict(), description: 'hero' },
      },
      actions: {},
    })
    const spec = {
      root: 'p',
      elements: {
        p: { type: 'Page', props: {}, children: ['h'] },
        h: { type: 'Hero', props: { heading: 'far too long', className: 'x', $state: '/x' }, children: [], visible: { $state: '/a' } },
      },
    }
    expect(catalog.validate(spec).success).toBe(true)
    expect(validateSpec(spec as never).valid).toBe(true)
    // Ours rejects the same spec.
    expect(validatePageSpec({ root: 'p', elements: { p: spec.elements.p, h: { type: 'Hero', props: spec.elements.h.props, children: [] } } }).ok).toBe(false)
  })
})
