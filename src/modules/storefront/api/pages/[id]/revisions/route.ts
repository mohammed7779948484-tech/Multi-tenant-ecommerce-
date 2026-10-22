import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StorefrontPage, StorefrontPageRevision } from '../../../../data/entities'
import { pageIdParamsSchema } from '../../../../lib/pageActionRoute'
import { resolveStaffSite } from '../../../../lib/routeContext'
import { storefrontErrorSchema, storefrontTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['storefront.view'] },
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const revisionItemSchema = z.object({
  id: z.string().uuid(),
  revisionNo: z.number(),
  source: z.enum(['publish', 'rollback']),
  sourceRevisionNo: z.number().nullable(),
  title: z.string(),
  createdAt: z.string(),
  publishedByUserId: z.string().uuid().nullable(),
  isCurrent: z.boolean(),
})

const revisionListSchema = z.object({
  items: z.array(revisionItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

/** Newest-first publish history of one of the caller's pages; specs are not included. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const resolved = await resolveStaffSite(req)
  if ('response' in resolved) return resolved.response
  const { em, tenantId, organizationId, translate } = resolved
  const notFound = () => NextResponse.json({ error: translate('storefront.errors.pageNotFound', 'Page not found.') }, { status: 404 })
  const params = pageIdParamsSchema.safeParse(await context.params)
  if (!params.success) return notFound()
  const query = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  const { page: pageNo, pageSize } = query.success ? query.data : { page: 1, pageSize: 20 }

  const page = await em.findOne(
    StorefrontPage,
    { id: params.data.id, tenantId, organizationId, deletedAt: null },
    { fields: ['id', 'publishedRevisionId'] },
  )
  if (!page) return notFound()

  const [rows, total] = await em.findAndCount(
    StorefrontPageRevision,
    { pageId: page.id, tenantId, organizationId },
    { orderBy: { revisionNo: 'desc' }, limit: pageSize, offset: (pageNo - 1) * pageSize },
  )
  const sourceIds = rows.map((row) => row.sourceRevisionId).filter((id): id is string => Boolean(id))
  const sources = sourceIds.length
    ? await em.find(StorefrontPageRevision, { id: { $in: sourceIds }, pageId: page.id, tenantId, organizationId }, { fields: ['id', 'revisionNo'] })
    : []
  const sourceNo = new Map(sources.map((row) => [row.id, row.revisionNo]))

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      revisionNo: row.revisionNo,
      source: row.source === 'rollback' ? 'rollback' : 'publish',
      sourceRevisionNo: row.sourceRevisionId ? sourceNo.get(row.sourceRevisionId) ?? null : null,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      publishedByUserId: row.publishedByUserId ?? null,
      isCurrent: row.id === page.publishedRevisionId,
    })),
    total,
    page: pageNo,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Storefront page revisions',
  methods: {
    GET: {
      summary: 'List the publish history of a page',
      description: 'Newest first, paginated (`pageSize` ≤ 50, default 20). Specs are not included.',
      query: querySchema,
      responses: [{ status: 200, description: 'Revisions', schema: revisionListSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.view`', schema: storefrontErrorSchema },
        { status: 404, description: 'Not one of the caller\'s pages', schema: storefrontErrorSchema },
      ],
    },
  },
}
