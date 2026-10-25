import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PAGE_COMMAND_IDS } from '../../../../commands/pages'
import { pageRollbackBodySchema } from '../../../../data/validators'
import { zodIssuesToFieldErrors } from '../../../../lib/fieldErrors'
import { runPageAction } from '../../../../lib/pageActionRoute'
import { publishResultSchema, storefrontErrorSchema, storefrontTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['storefront.pages.publish'] },
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await req.json().catch(() => null)
  const parsed = pageRollbackBodySchema.safeParse(raw)
  if (!parsed.success) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      {
        error: translate('storefront.errors.validation', 'Fix the highlighted fields and save again.'),
        fieldErrors: zodIssuesToFieldErrors(parsed.error.issues, translate),
      },
      { status: 422 },
    )
  }
  return runPageAction(req, context.params, PAGE_COMMAND_IDS.rollback, parsed.data)
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Roll a storefront page back',
  methods: {
    POST: {
      summary: 'Re-publish an earlier revision',
      description:
        'Appends a `rollback` revision copying `revisionId` (spec, title, SEO description) and resets the draft to it, replacing unpublished draft changes. Send the page `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`. Emits `storefront.page.rolled_back` after commit.',
      requestBody: { contentType: 'application/json', schema: pageRollbackBodySchema },
      responses: [{ status: 200, description: 'Rolled back', schema: publishResultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: storefrontErrorSchema },
        { status: 403, description: 'Missing `storefront.pages.publish`', schema: storefrontErrorSchema },
        { status: 404, description: 'Not one of the caller\'s pages or not a revision of this page', schema: storefrontErrorSchema },
        { status: 409, description: 'The page changed since it was loaded', schema: storefrontErrorSchema },
        { status: 422, description: 'Invalid body, revision already live, or revision fails today\'s validator', schema: storefrontErrorSchema.extend({ issues: z.array(z.unknown()).optional() }) },
      ],
    },
  },
}
