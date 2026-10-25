import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import sharp from 'sharp'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { MAX_IMAGE_SOURCE_PIXELS, validateImageMagicBytes } from '@open-mercato/core/modules/attachments/lib/imageSafety'
import { readThumbnailCache, writeThumbnailCache } from '@open-mercato/core/modules/attachments/lib/thumbnailCache'
import { mediaParamsSchema } from '../../../../data/validators'
import { isStorefrontImageWidth } from '../../../../lib/media'
import { resolvePublicStoreImage } from '../../../../lib/publicMedia'
import { resolvePublicSite } from '../../../../lib/publicSite'
import { storefrontErrorSchema, storefrontTag } from '../../../openapi'

const logger = createLogger('storefront').child({ component: 'media-route' })

/** Anonymous by design: shoppers load store images without a session. */
export const metadata = {
  GET: { requireAuth: false },
}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

/** Our own cache keys: resized variants are never upscaled, unlike the attachments route's. */
function cacheKeyFor(width: number): string {
  return `storefront-w${width}`
}

/**
 * Serves an image a live store shows publicly: its logo, or a page image a
 * published page references (spec "Reference rules"). Every other id answers
 * the same 404 (another tenant's file, another entity's file, an unreferenced
 * upload, a deleted or deactivated store), so the route never confirms that an
 * attachment exists. Visibility is decided before the thumbnail cache or the
 * storage is read. `?w=` picks one of the fixed widths; anything else is 404.
 */
export async function GET(req: Request, context: { params: Promise<{ siteSlug: string; attachmentId: string }> }) {
  const params = mediaParamsSchema.safeParse(await context.params)
  if (!params.success) return notFound()
  const { siteSlug, attachmentId } = params.data
  const rawWidth = new URL(req.url).searchParams.get('w')
  const width = rawWidth === null ? null : Number(rawWidth)
  if (width !== null && !(Number.isInteger(width) && isStorefrontImageWidth(width))) return notFound()

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const resolved = await resolvePublicSite(em, siteSlug)
  if (!resolved) return notFound()
  const { site } = resolved
  const attachment = await resolvePublicStoreImage(em, site, attachmentId)
  if (!attachment) return notFound()
  const mimeType = attachment.mimeType.trim().toLowerCase()

  let buffer: Buffer | null = null
  try {
    // Animated GIFs are served as uploaded: resizing would keep only the first frame.
    const resize = width !== null && mimeType !== 'image/gif'
    if (resize) buffer = await readThumbnailCache(attachment.partitionCode, attachment.id, cacheKeyFor(width))
    if (!buffer) {
      const storageDriverFactory =
        (container.resolve('storageDriverFactory') as StorageDriverFactory | null) ?? new StorageDriverFactory(em)
      const driver = await storageDriverFactory.resolveForPartition(attachment.partitionCode, {
        tenantId: site.tenantId,
        organizationId: site.organizationId,
      })
      const original = (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer
      if (!validateImageMagicBytes(original, mimeType).ok) {
        logger.warn('Storefront media content does not match its type', { siteId: site.id, attachmentId })
        return notFound()
      }
      if (resize) {
        buffer = await sharp(original, { failOn: 'error', limitInputPixels: MAX_IMAGE_SOURCE_PIXELS })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .toBuffer()
        void writeThumbnailCache(attachment.partitionCode, attachment.id, cacheKeyFor(width), buffer).catch((err) => {
          logger.warn('Storefront thumbnail cache write failed', { err, siteId: site.id, attachmentId })
        })
      } else {
        buffer = original
      }
    }
  } catch (err) {
    logger.warn('Storefront media read failed', { err, siteId: site.id, attachmentId })
    return notFound()
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(buffer.byteLength),
      // Short shared cache: an image that stops being public, or a store going offline, disappears within minutes.
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
      summary: 'Serve an image a live store shows publicly',
      description:
        'Anonymous. Returns the image only when the live store `{siteSlug}` shows it publicly: its logo, or a page image referenced by one of its published pages. Optional `?w=` (320, 640, 960, 1280, 1920) returns a resized copy, never upscaled. Every other combination answers 404 without revealing whether the attachment exists.',
      responses: [{ status: 200, description: 'Image bytes (PNG, JPEG, WebP, GIF or AVIF)', schema: z.any() }],
      errors: [{ status: 404, description: 'Not a live store, or not an asset it references', schema: storefrontErrorSchema }],
    },
  },
}
