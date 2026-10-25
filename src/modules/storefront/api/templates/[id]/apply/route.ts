import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PAGE_RESOURCE_KIND } from '../../../../commands/pages'
import { TEMPLATE_COMMAND_ID, type TemplateApplyResult } from '../../../../commands/templates'
import { buildStaffCommandContext, resolveStaffSite } from '../../../../lib/routeContext'
import { isStoreTemplateId } from '../../../../lib/templates'
import { pageSpecIssueSchema, storefrontErrorSchema, storefrontTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['storefront.pages.manage'] },
}

const logger = createLogger('storefront').child({ component: 'template-apply-route' })

const applyBodySchema = z.object({}).strict()

const applyResultSchema = z.object({
  homePageId: z.string().uuid(),
  createdPages: z.array(z.object({ id: z.string().uuid(), slug: z.string() })),
  skippedSlugs: z.array(z.string()),
  updatedAt: z.string(),
})

type LogEntryLike = { id?: unknown; undoToken?: unknown; commandId?: unknown; actionLabel?: unknown; resourceKind?: unknown; resourceId?: unknown; createdAt?: unknown }

/** `x-om-operation`: lets the platform's last-operation banner offer Undo (as CRUD routes do). */
function operationHeader(logEntry: LogEntryLike | null | undefined): string | null {
  if (!logEntry || typeof logEntry.undoToken !== 'string' || typeof logEntry.id !== 'string' || typeof logEntry.commandId !== 'string') return null
  const createdAt = logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : typeof logEntry.createdAt === 'string' ? logEntry.createdAt : new Date().toISOString()
  return serializeOperationMetadata({
    id: logEntry.id,
    undoToken: logEntry.undoToken,
    commandId: logEntry.commandId,
    actionLabel: typeof logEntry.actionLabel === 'string' ? logEntry.actionLabel : null,
    resourceKind: typeof logEntry.resourceKind === 'string' ? logEntry.resourceKind : null,
    resourceId: typeof logEntry.resourceId === 'string' ? logEntry.resourceId : null,
    executedAt: createdAt,
  })
}

/**
 * Applies a store template as drafts. Send the home page's `updatedAt` in
 * `x-om-ext-optimistic-lock-expected-updated-at`; the body is `{}`.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const resolved = await resolveStaffSite(req)
  if ('response' in resolved) return resolved.response
  const { translate } = resolved
  const { id } = await context.params
  if (!isStoreTemplateId(id)) {
    return NextResponse.json({ error: translate('storefront.errors.templateNotFound', 'Template not found.') }, { status: 404 })
  }
  const raw = await req.text()
  let body: unknown = {}
  try {
    body = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    body = null
  }
  if (!applyBodySchema.safeParse(body).success) {
    return NextResponse.json({ error: translate('storefront.errors.templateBody', 'Applying a template takes no request body fields.') }, { status: 422 })
  }
  try {
    const guard = await runRouteMutationGuards({
      container: resolved.container,
      req,
      auth: { userId: resolved.auth.sub, tenantId: resolved.tenantId, organizationId: resolved.organizationId },
      input: { resourceKind: PAGE_RESOURCE_KIND, resourceId: resolved.site.id, operation: 'update', mutationPayload: { templateId: id } },
    })
    if (!guard.ok) return guard.response
    // Guards may not swap the template: the URL decides it.
    const commandBus = resolved.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, TemplateApplyResult>(TEMPLATE_COMMAND_ID, {
      input: { templateId: id },
      ctx: buildStaffCommandContext(resolved, req),
    })
    await guard.runAfterSuccess()
    const response = NextResponse.json({
      homePageId: result.homePageId,
      createdPages: result.createdPages,
      skippedSlugs: result.skippedSlugs,
      updatedAt: result.updatedAt,
    })
    const header = operationHeader(logEntry as LogEntryLike | null)
    if (header) response.headers.set('x-om-operation', header)
    return response
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('Storefront template apply failed', { err, templateId: id })
    return NextResponse.json({ error: translate('storefront.errors.save', 'The change could not be saved.') }, { status: 500 })
  }
}

const specErrorSchema = storefrontErrorSchema.extend({ issues: z.array(pageSpecIssueSchema).optional() })

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Apply a store template',
  methods: {
    POST: {
      summary: 'Draft a store template\'s pages',
      description:
        'Replaces the home page draft and creates the template\'s other pages as drafts when their slug is free (taken slugs are skipped and listed). Nothing is published. Send the home page `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`. The response carries `x-om-operation` for undo; undo answers 409 once any of the pages changed. Emits `storefront.template.applied`.',
      requestBody: { contentType: 'application/json', schema: applyBodySchema },
      responses: [{ status: 200, description: 'Applied', schema: applyResultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.pages.manage`', schema: storefrontErrorSchema },
        { status: 404, description: 'Unknown template or no storefront', schema: storefrontErrorSchema },
        { status: 409, description: 'The home page changed since it was loaded', schema: storefrontErrorSchema },
        { status: 422, description: 'Body fields, or the store would pass 30 pages (`pageLimit`)', schema: specErrorSchema },
      ],
    },
  },
}
