import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveStaffSite } from '../../lib/routeContext'
import { loadTemplateStoreData } from '../../lib/templateData'
import { listStoreTemplates } from '../../lib/templates'
import { storefrontErrorSchema, storefrontTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['storefront.view'] },
}

const templateListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      pages: z.array(z.object({ slug: z.string(), title: z.string() })),
    }),
  ),
})

/** Store templates in the caller's language, with the pages each would draft for this store. */
export async function GET(req: Request) {
  const resolved = await resolveStaffSite(req)
  if ('response' in resolved) return resolved.response
  const { em, tenantId, organizationId, translate } = resolved
  const data = await loadTemplateStoreData(em, { tenantId, organizationId })
  if (!data) return NextResponse.json({ error: translate('storefront.errors.notFound', 'Storefront not found.') }, { status: 404 })
  return NextResponse.json({ items: listStoreTemplates(translate, data) })
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Storefront templates',
  methods: {
    GET: {
      summary: 'List store templates',
      description: 'Templates with their name, description and the pages each would draft, in the caller\'s language.',
      responses: [{ status: 200, description: 'Templates', schema: templateListSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.view`', schema: storefrontErrorSchema },
        { status: 404, description: 'The organization has no storefront', schema: storefrontErrorSchema },
      ],
    },
  },
}
