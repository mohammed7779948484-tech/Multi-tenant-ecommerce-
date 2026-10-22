import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PAGE_COMMAND_IDS } from '../../../../commands/pages'
import { runPageAction } from '../../../../lib/pageActionRoute'
import { pageSpecIssueSchema, publishResultSchema, storefrontErrorSchema, storefrontTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['storefront.pages.publish'] },
}

/** Publishing always takes the saved draft, so the request body carries nothing. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
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
