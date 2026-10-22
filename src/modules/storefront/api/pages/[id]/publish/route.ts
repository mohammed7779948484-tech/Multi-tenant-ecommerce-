import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PAGE_COMMAND_IDS } from '../../../../commands/pages'
import { runPageAction } from '../../../../lib/pageActionRoute'
import { pageSpecIssueSchema, publishResultSchema, storefrontErrorSchema, storefrontTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['storefront.pages.publish'] },
}

const publishBodySchema = z.object({}).strict()

/** Publishing always takes the saved draft, so the body must be empty (`{}` or none); anything else answers 422. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await req.text()
  let body: unknown = {}
  try {
    body = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    body = null
  }
  const parsed = publishBodySchema.safeParse(body)
  if (!parsed.success) {
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('storefront.errors.publishBody', 'Publishing takes no request body fields.') }, { status: 422 })
  }
  return runPageAction(req, context.params, PAGE_COMMAND_IDS.publish, {})
}

const specErrorSchema = storefrontErrorSchema.extend({ issues: z.array(pageSpecIssueSchema).optional() })

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Publish a storefront page',
  methods: {
    POST: {
      summary: 'Publish the saved draft as a new revision',
      description:
        'Validates the saved draft and publishes it (spec, title, SEO description) as revision `max + 1` under the page row lock. Send the page `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`. Emits `storefront.page.published` after commit.',
      responses: [{ status: 200, description: 'Published', schema: publishResultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.pages.publish`', schema: storefrontErrorSchema },
        { status: 404, description: 'Not one of the caller\'s pages', schema: storefrontErrorSchema },
        { status: 409, description: 'The page changed since it was loaded', schema: storefrontErrorSchema },
        { status: 422, description: 'Spec issues or nothing to publish', schema: specErrorSchema },
      ],
    },
  },
}
