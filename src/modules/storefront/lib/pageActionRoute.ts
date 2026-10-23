import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PAGE_RESOURCE_KIND, type PublishResult } from '../commands/pages'
import { buildStaffCommandContext, resolveStaffSite } from './routeContext'

const logger = createLogger('storefront').child({ component: 'page-action-route' })

export const pageIdParamsSchema = z.object({ id: z.string().uuid() })

/**
 * Shared body of the publish and rollback routes: trusted scope from the session,
 * the mutation-guard registry (guards may rewrite the payload, which the command
 * re-validates strictly), the command, then the guards' after-success hooks.
 * A malformed or foreign page id answers 404 like any other missing page.
 */
export async function runPageAction(
  req: Request,
  params: Promise<{ id: string }>,
  commandId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const resolved = await resolveStaffSite(req)
  if ('response' in resolved) return resolved.response
  const { translate } = resolved
  const parsedParams = pageIdParamsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: translate('storefront.errors.pageNotFound', 'Page not found.') }, { status: 404 })
  }
  const pageId = parsedParams.data.id
  try {
    const guard = await runRouteMutationGuards({
      container: resolved.container,
      req,
      auth: { userId: resolved.auth.sub, tenantId: resolved.tenantId, organizationId: resolved.organizationId },
      input: { resourceKind: PAGE_RESOURCE_KIND, resourceId: pageId, operation: 'update', mutationPayload: body },
    })
    if (!guard.ok) return guard.response
    const input = { ...body, ...(guard.modifiedPayload ?? {}), id: pageId }
    const commandBus = resolved.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, PublishResult>(commandId, {
      input,
      ctx: buildStaffCommandContext(resolved, req),
    })
    // Committed: `runAfterSuccess` catches and logs each hook's failure itself, so it never fails the request.
    await guard.runAfterSuccess()
    return NextResponse.json({
      pageId: result.pageId,
      revisionId: result.revisionId,
      revisionNo: result.revisionNo,
      publishedAt: result.publishedAt,
      updatedAt: result.updatedAt,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('Storefront page action failed', { err, commandId, pageId })
    return NextResponse.json({ error: translate('storefront.errors.save', 'The change could not be saved.') }, { status: 500 })
  }
}
