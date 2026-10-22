import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { StorefrontTheme } from '../../data/entities'
import { buildStaffCommandContext, resolveStaffSite } from '../../lib/routeContext'
import { brandUpdateSchema } from '../../data/validators'
import { BRAND_UPDATE_COMMAND_ID, SITE_RESOURCE_KIND, type BrandSnapshot } from '../../commands/brand'
import { zodIssuesToFieldErrors } from '../../lib/fieldErrors'
import { storefrontMediaPath, storefrontPublicUrl } from '../../lib/publicSite'
import { readThemeTokens, themeTokensSchema } from '../../lib/theme'
import { storefrontErrorSchema, storefrontTag } from '../openapi'

const logger = createLogger('storefront').child({ component: 'brand-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['storefront.view'] },
  PUT: { requireAuth: true, requireFeatures: ['storefront.brand.manage'] },
}

const brandResponseSchema = z.object({
  siteId: z.string().uuid(),
  slug: z.string(),
  publicUrl: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoAttachmentId: z.string().uuid().nullable(),
  logoUrl: z.string().nullable(),
  tokens: themeTokensSchema,
  updatedAt: z.string().nullable(),
})

/** The caller's site (scope from the session) plus its theme. */
async function resolveCurrentSite(req: Request) {
  const resolved = await resolveStaffSite(req)
  if ('response' in resolved) return resolved
  const { em, site, tenantId, organizationId } = resolved
  const theme = await em.findOne(StorefrontTheme, { siteId: site.id, tenantId, organizationId, deletedAt: null })
  return { ...resolved, theme }
}

function toResponse(input: {
  siteId: string
  slug: string
  name: string
  description: string | null
  logoAttachmentId: string | null
  tokens: unknown
  updatedAt: string | null
}) {
  return {
    siteId: input.siteId,
    slug: input.slug,
    publicUrl: storefrontPublicUrl(input.slug),
    name: input.name,
    description: input.description,
    logoAttachmentId: input.logoAttachmentId,
    logoUrl: input.logoAttachmentId ? storefrontMediaPath(input.slug, input.logoAttachmentId) : null,
    tokens: readThemeTokens(input.tokens),
    updatedAt: input.updatedAt,
  }
}

export async function GET(req: Request) {
  const resolved = await resolveCurrentSite(req)
  if ('response' in resolved) return resolved.response
  const { site, theme } = resolved
  return NextResponse.json(
    toResponse({
      siteId: site.id,
      slug: site.slug,
      name: site.name,
      description: site.description ?? null,
      logoAttachmentId: site.logoAttachmentId ?? null,
      tokens: theme?.tokens,
      updatedAt: site.updatedAt ? site.updatedAt.toISOString() : null,
    }),
  )
}

export async function PUT(req: Request) {
  const resolved = await resolveCurrentSite(req)
  if ('response' in resolved) return resolved.response
  const { translate } = resolved

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: translate('storefront.errors.invalidBody', 'The request body must be JSON.') }, { status: 400 })
  }
  const parsed = brandUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: translate('storefront.errors.validation', 'Fix the highlighted fields and save again.'),
        fieldErrors: zodIssuesToFieldErrors(parsed.error.issues, translate),
      },
      { status: 422 },
    )
  }

  try {
    // Mutation-guard registry contract for custom write routes: registered guards
    // (plus the legacy bridge) run with the caller's features before the write;
    // a guard may rewrite the payload, which is validated again before dispatch.
    const guard = await runRouteMutationGuards({
      container: resolved.container,
      req,
      auth: { userId: resolved.auth.sub, tenantId: resolved.tenantId, organizationId: resolved.organizationId },
      input: {
        resourceKind: SITE_RESOURCE_KIND,
        resourceId: resolved.site.id,
        operation: 'update',
        mutationPayload: parsed.data as unknown as Record<string, unknown>,
      },
    })
    if (!guard.ok) return guard.response
    let input = parsed.data
    if (guard.modifiedPayload) {
      const revalidated = brandUpdateSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
      if (!revalidated.success) {
        return NextResponse.json(
          {
            error: translate('storefront.errors.validation', 'Fix the highlighted fields and save again.'),
            fieldErrors: zodIssuesToFieldErrors(revalidated.error.issues, translate),
          },
          { status: 422 },
        )
      }
      input = revalidated.data
    }

    const commandBus = resolved.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, BrandSnapshot>(BRAND_UPDATE_COMMAND_ID, {
      input: { siteId: resolved.site.id, ...input },
      ctx: buildStaffCommandContext(resolved, req),
    })

    // Runs each guard's after-success hook; failures are logged by the helper, never surfaced.
    await guard.runAfterSuccess()

    return NextResponse.json(
      toResponse({
        siteId: result.siteId,
        slug: resolved.site.slug,
        name: result.name,
        description: result.description,
        logoAttachmentId: result.logoAttachmentId,
        tokens: result.tokens,
        updatedAt: result.updatedAt,
      }),
    )
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('Storefront brand update failed', { err })
    return NextResponse.json({ error: translate('storefront.errors.save', 'The brand could not be saved.') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Storefront brand',
  methods: {
    GET: {
      summary: 'Read the storefront brand of the selected organization',
      description: 'Returns store identity, theme tokens and the aggregate version (`updatedAt`) used for optimistic locking.',
      responses: [{ status: 200, description: 'Storefront brand', schema: brandResponseSchema }],
      errors: [
        { status: 400, description: 'A single organization must be selected', schema: storefrontErrorSchema },
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.view`', schema: storefrontErrorSchema },
        { status: 404, description: 'The organization has no storefront', schema: storefrontErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update the storefront brand of the selected organization',
      description:
        'Replaces store identity and theme tokens in one command (`storefront.brand.update`). Send `x-om-ext-optimistic-lock-expected-updated-at` with the `updatedAt` you loaded; a stale value answers 409. Changes are live immediately.',
      requestBody: { contentType: 'application/json', schema: brandUpdateSchema },
      responses: [{ status: 200, description: 'Updated storefront brand', schema: brandResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid JSON or no single organization selected', schema: storefrontErrorSchema },
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.brand.manage`', schema: storefrontErrorSchema },
        { status: 404, description: 'The organization has no storefront', schema: storefrontErrorSchema },
        { status: 409, description: 'The brand changed since it was loaded', schema: storefrontErrorSchema },
        { status: 422, description: 'Field-level validation errors', schema: storefrontErrorSchema },
      ],
    },
  },
}
