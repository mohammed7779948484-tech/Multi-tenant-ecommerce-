"use client"
import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { STOREFRONT_BLOCKS } from '../../lib/blocks/catalog'
import type { SectionData } from '../../lib/sectionDataTypes'
import type { BuilderSection } from './builderSpec'
import { stableStringify } from './builderSpec'

/**
 * Commerce data for the builder preview (spec P3-Q8): posts the draft's
 * ProductGrid and CollectionList sections to `/api/storefront/preview-data`
 * after edits settle. Results are keyed by the section's validated props, which
 * is what the preview component can see. While a request runs the last data
 * stays on screen; a 403 or failure clears it and reports why.
 */

export const PREVIEW_DATA_PATH = '/api/storefront/preview-data'
const DEBOUNCE_MS = 400

export type PreviewDataState = { data: Map<string, SectionData>; problem: null | 'forbidden' | 'failed' }

type CommerceType = 'ProductGrid' | 'CollectionList'
const isCommerce = (type: string): type is CommerceType => type === 'ProductGrid' || type === 'CollectionList'

/** The key a preview section uses to find its data: its props after schema defaults. */
export function previewDataKey(type: CommerceType, props: unknown): string | null {
  const parsed = STOREFRONT_BLOCKS[type].props.safeParse(props)
  return parsed.success ? `${type}:${stableStringify(parsed.data)}` : null
}

export function usePreviewSectionData(sections: readonly BuilderSection[]): PreviewDataState {
  const [state, setState] = React.useState<PreviewDataState>({ data: new Map(), problem: null })
  const request = React.useMemo(() => {
    const items: Array<{ id: string; type: CommerceType; props: unknown; key: string }> = []
    for (const section of sections) {
      if (!isCommerce(section.type)) continue
      const key = previewDataKey(section.type, section.props)
      if (key) items.push({ id: section.id, type: section.type, props: section.props, key })
    }
    return items
  }, [sections])
  const requestKey = React.useMemo(() => stableStringify(request.map(({ id, type, props }) => ({ id, type, props }))), [request])

  React.useEffect(() => {
    if (!request.length) {
      setState((current) => (current.data.size || current.problem ? { data: new Map(), problem: null } : current))
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const call = await apiCall<{ sections?: Record<string, SectionData> }>(PREVIEW_DATA_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sections: request.map(({ id, type, props }) => ({ id, type, props })) }),
        })
        if (cancelled) return
        if (!call.ok) {
          setState({ data: new Map(), problem: call.status === 403 ? 'forbidden' : 'failed' })
          return
        }
        const byId = call.result?.sections ?? {}
        const data = new Map<string, SectionData>()
        for (const item of request) if (byId[item.id]) data.set(item.key, byId[item.id])
        setState({ data, problem: null })
      } catch {
        if (!cancelled) setState({ data: new Map(), problem: 'failed' })
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // requestKey stands for `request`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  return state
}
