import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { STOREFRONT_BLOCKS } from '../../lib/blocks/catalog'
import { MAX_SECTIONS_PER_PAGE, type ValidatedSection } from '../../lib/blocks/pageSpec'
import { loadSectionData, storeCatalogLinks } from '../../lib/catalogData'
import { toPreviewWire } from '../../lib/previewDataWire'
import { resolveStaffSite } from '../../lib/routeContext'
import { storefrontErrorSchema, storefrontTag } from '../openapi'

/**
 * Commerce data for the builder preview (spec P3-Q8). Read-only: it runs the
 * public section loader over the in-memory draft, without the "published
 * section" condition, and only over active rows of the caller's own tenant and
 * organization. Foreign or unknown ids simply produce no cards.
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['storefront.view', 'catalog.products.view', 'catalog.categories.view'] },
}

const COMMERCE_TYPES = new Set(['ProductGrid', 'CollectionList'])

const bodySchema = z.object({
  sections: z
    .array(z.object({ id: z.string().min(1).max(64), type: z.string().min(1).max(40), props: z.unknown() }))
    .max(MAX_SECTIONS_PER_PAGE),
})

const imageSchema = z.object({ attachmentId: z.string().uuid(), alt: z.string() }).nullable()
const sectionDataSchema = z.object({
  products: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        subtitle: z.string().nullable(),
        href: z.string(),
        image: imageSchema,
        price: z.string().nullable().describe('Formatted price text'),
        priceDetail: z.object({ amount: z.number(), currencyCode: z.string(), formatted: z.string() }).nullable().optional().describe('The same price as amount, currency and text (additive)'),
      }),
    )
    .optional(),
  categories: z
    .array(z.object({ id: z.string().uuid(), name: z.string(), description: z.string().nullable(), href: z.string(), image: imageSchema }))
    .optional(),
})
const responseSchema = z.object({ sections: z.record(z.string(), sectionDataSchema) })

export async function POST(req: Request) {
  const resolved = await resolveStaffSite(req)
  if ('response' in resolved) return resolved.response
  const { em, container, site, tenantId, organizationId, translate } = resolved
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const body = bodySchema.safeParse(raw)
  if (!body.success) {
    return NextResponse.json(
      { error: translate('storefront.errors.previewDataInvalid', 'Send up to {max} sections, each with an id, a type and props.', { max: MAX_SECTIONS_PER_PAGE }) },
      { status: 422 },
    )
  }
  // Only commerce sections with valid props are loaded; anything else is omitted.
  const sections: ValidatedSection[] = []
  for (const section of body.data.sections) {
    if (!COMMERCE_TYPES.has(section.type)) continue
    const type = section.type as 'ProductGrid' | 'CollectionList'
    const props = STOREFRONT_BLOCKS[type].props.safeParse(section.props)
    if (props.success) sections.push({ id: section.id, type, props: props.data } as ValidatedSection)
  }
  const data = sections.length
    ? await loadSectionData({ em, container }, { tenantId, organizationId }, sections, {
        links: storeCatalogLinks(`/${site.slug}`),
      })
    : {}
  return NextResponse.json({ sections: Object.fromEntries(Object.entries(data).map(([id, section]) => [id, toPreviewWire(section)])) })
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Commerce data for the builder preview',
  methods: {
    POST: {
      summary: 'Load products and categories for draft commerce sections',
      description:
        'Runs the public section loader over draft ProductGrid and CollectionList sections, limited to active rows of the caller\'s organization. Sections with invalid props, other block types and foreign ids produce no data.',
      requestBody: { contentType: 'application/json', schema: bodySchema },
      responses: [{ status: 200, description: 'Section data keyed by section id', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Not signed in', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing storefront or catalog view features', schema: storefrontErrorSchema },
        { status: 404, description: 'The organization has no storefront', schema: storefrontErrorSchema },
        { status: 422, description: 'Invalid body or more than 40 sections', schema: storefrontErrorSchema },
      ],
    },
  },
}
