import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { mediaParamsSchema } from '../../../../data/validators'
import { isStorefrontLogoMimeType } from '../../../../lib/media'
import { resolvePublicSite } from '../../../../lib/publicSite'
import { storefrontErrorSchema, storefrontTag } from '../../../openapi'

const logger = createLogger('storefront').child({ component: 'media-route' })

/** Anonymous by design: shoppers load store logos without a session. */
export const metadata = {
  GET: { requireAuth: false },
}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Serves an image a live store references publicly — in Phase 1 only its logo.
 * Every other id answers the same 404 (another tenant's attachment, an
 * unreferenced upload of the same tenant, a deleted or deactivated store), so
 * the route never confirms that an attachment exists.
 */
export async function GET(_req: Request, context: { params: Promise<{ siteSlug: string; attachmentId: string }> }) {
  const params = mediaParamsSchema.safeParse(await context.params)
  if (!params.success) return notFound()
  const { siteSlug, attachmentId } = params.data

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const resolved = await resolvePublicSite(em, siteSlug)
  if (!resolved || resolved.site.logoAttachmentId !== attachmentId) return notFound()
  const { site } = resolved

  const attachment = await em.findOne(Attachment, {
    id: attachmentId,
    tenantId: site.tenantId,
    organizationId: site.organizationId,
  })
  if (!attachment || !isStorefrontLogoMimeType(attachment.mimeType)) return notFound()

  let buffer: Buffer
  try {
    const storageDriverFactory =
      (container.resolve('storageDriverFactory') as StorageDriverFactory | null) ?? new StorageDriverFactory(em)
    const driver = await storageDriverFactory.resolveForPartition(attachment.partitionCode, {
      tenantId: site.tenantId,
      organizationId: site.organizationId,
    })
    buffer = (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer
  } catch (err) {
    logger.warn('Storefront media read failed', { err, siteId: site.id, attachmentId })
    return notFound()
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': attachment.mimeType.trim().toLowerCase(),
      'Content-Length': String(buffer.byteLength),
      // Short shared cache: a logo swap or a store going offline shows within minutes.
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-site',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Public storefront media',
  methods: {
    GET: {
      summary: 'Serve an image referenced by a live store',
      description:
        'Anonymous. Returns the image only when it is the referenced asset (Phase 1: the logo) of the live store `{siteSlug}`; every other combination answers 404 without revealing whether the attachment exists.',
      responses: [{ status: 200, description: 'Image bytes (PNG, JPEG, WebP, GIF or AVIF)', schema: z.any() }],
      errors: [{ status: 404, description: 'Not a live store, or not an asset it references', schema: storefrontErrorSchema }],
    },
  },
}
