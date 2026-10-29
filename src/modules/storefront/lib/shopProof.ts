import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import type { AttachmentService } from '@open-mercato/core/modules/attachments/lib/attachment-service'
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildShopCommandContext } from '../commands/cart'
import { StorefrontOrderAccess } from '../data/entities'
import { ShopError, type CartSite } from './shopCart'
import { TRANSFER_PROVIDER_KEY } from './shopCheckout'
import { shopTranslations } from './shopLocale'

/**
 * Bank-transfer proof (shopping-journey spec REQ-010, J-004). The buyer who
 * holds the order's token sends the transfer reference, an optional sender
 * name and a receipt (photo or PDF). The receipt becomes a private attachment
 * of the sales order through the installed attachments service (quota,
 * storage, events), and the merchant reads the details in a note on the order
 * (`sales.notes.create`) with a link to the receipt. One proof per order: the
 * access row's `proof_submitted_at` is claimed before anything is stored, and
 * given back (with the stored file removed) when a later step fails.
 */

const logger = createLogger('storefront').child({ component: 'shop-proof' })

type Deps = { em: EntityManager; container: AwilixContainer }

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
const ORDER_ENTITY_ID = 'sales:sales_order'
const RECEIPT_PARTITION = 'privateAttachments'
/** Payment states in which a transfer proof no longer helps: paid, refunded or cancelled. */
const SETTLED_PAYMENT = new Set(['received', 'captured', 'refunded', 'canceled'])

const RECEIPT_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }

/** The receipt's type from its first bytes (JPEG, PNG, WebP or PDF), or `null`: the name and declared type are never trusted. */
export function sniffReceiptType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  return null
}

/** Room for the multipart envelope and the text fields around the receipt. */
const FORM_OVERHEAD_BYTES = 64 * 1024

/**
 * The proof form, read with the receipt cap enforced while the body streams
 * (a declared or actual body over 5 MB plus the envelope answers 413 without
 * being buffered whole).
 */
export async function readProofForm(req: Request): Promise<FormData> {
  const limit = MAX_RECEIPT_BYTES + FORM_OVERHEAD_BYTES
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) throw new ShopError(413, 'receiptTooLarge', { receipt: 'storefront.shop.proof.errors.tooLarge' })
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !req.body) throw new ShopError(422, 'invalidRequest')
  let read = 0
  const bounded = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        read += chunk.byteLength
        if (read > limit) controller.error(new ShopError(413, 'receiptTooLarge', { receipt: 'storefront.shop.proof.errors.tooLarge' }))
        else controller.enqueue(chunk)
      },
    }),
  )
  try {
    return await new Response(bounded, { headers: { 'content-type': contentType } }).formData()
  } catch (err) {
    if (read > limit) throw new ShopError(413, 'receiptTooLarge', { receipt: 'storefront.shop.proof.errors.tooLarge' })
    if (err instanceof ShopError) throw err
    throw new ShopError(422, 'invalidRequest')
  }
}

/** Buyer text for a Markdown note: one line, every Markdown character escaped, so it shows as typed and links nowhere. */
export function noteText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\`*_{}[\]()#+\-.!|<>~:]/g, (char) => `\\${char}`)
    .trim()
}

export type ProofInput = { accessId: string; reference: string; senderName: string | null; receipt: Buffer }
export type ProofResult = { orderId: string; submittedAt: string }

/** Whether a transfer proof can be sent for an order in this state. */
export function proofAllowed(payment: { providerKey?: unknown } | null | undefined, paymentStatus: string | null | undefined): 'ok' | 'notTransfer' | 'settled' {
  if (payment?.providerKey !== TRANSFER_PROVIDER_KEY) return 'notTransfer'
  return paymentStatus && SETTLED_PAYMENT.has(paymentStatus) ? 'settled' : 'ok'
}

/**
 * Stores the proof for the order behind `access`. Answers 409 when a proof was
 * already sent, 422 for a cash-on-delivery or settled order or a receipt that
 * is not a JPEG, PNG, WebP or PDF, 413 for one over 5 MB.
 */
export async function submitTransferProof(deps: Deps, site: CartSite, input: ProofInput): Promise<ProofResult> {
  const scope = { tenantId: site.tenantId, organizationId: site.organizationId }
  const access = await deps.em.findOne(StorefrontOrderAccess, { id: input.accessId, ...scope, siteId: site.id })
  if (!access) throw new ShopError(404, 'orderNotFound')
  if (access.proofSubmittedAt) throw new ShopError(409, 'proofAlreadySubmitted')
  if (input.receipt.length > MAX_RECEIPT_BYTES) throw new ShopError(413, 'receiptTooLarge', { receipt: 'storefront.shop.proof.errors.tooLarge' })
  const mimeType = sniffReceiptType(input.receipt)
  if (!mimeType) throw new ShopError(422, 'receiptType', { receipt: 'storefront.shop.proof.errors.type' })

  const order = await findOneWithDecryption(deps.em, SalesOrder, { id: access.orderId, ...scope, deletedAt: null }, undefined, scope)
  if (!order) throw new ShopError(404, 'orderNotFound')
  const allowed = proofAllowed(order.paymentMethodSnapshot as { providerKey?: unknown } | null, order.paymentStatus ?? null)
  if (allowed === 'notTransfer') throw new ShopError(422, 'proofNotTransfer')
  if (allowed === 'settled') throw new ShopError(422, 'proofNotNeeded')

  // One proof per order, also against two submits at once: the access row is claimed first.
  const submittedAt = new Date()
  const claimed = await deps.em.fork().nativeUpdate(StorefrontOrderAccess, { id: access.id, ...scope, siteId: site.id, proofSubmittedAt: null }, { proofSubmittedAt: submittedAt })
  if (!claimed) throw new ShopError(409, 'proofAlreadySubmitted')

  const assignment = { type: ORDER_ENTITY_ID, id: order.id, href: `/backend/sales/documents/${encodeURIComponent(order.id)}?kind=order`, label: order.orderNumber }
  const attachments = deps.container.resolve('attachmentService') as AttachmentService
  let attachmentId: string | null = null
  try {
    const stored = await attachments.createScoped({
      ...scope,
      entityId: ORDER_ENTITY_ID,
      recordId: order.id,
      partitionCode: RECEIPT_PARTITION,
      fileName: `receipt-${order.orderNumber}.${RECEIPT_EXTENSIONS[mimeType]}`,
      declaredMimeType: mimeType,
      buffer: input.receipt,
      assignments: [assignment],
    })
    attachmentId = stored.id
    const { translate } = await shopTranslations()
    const body = [
      `**${translate('storefront.shop.proof.note.title', 'Bank transfer proof from the buyer')}**`,
      '',
      `- ${translate('storefront.shop.proof.note.reference', 'Transfer reference')}: ${noteText(input.reference)}`,
      ...(input.senderName ? [`- ${translate('storefront.shop.proof.note.sender', 'Sent by')}: ${noteText(input.senderName)}`] : []),
      `- [${translate('storefront.shop.proof.note.receipt', 'Receipt')}](${buildAttachmentFileUrl(stored.id)})`,
    ].join('\n')
    const commandBus = deps.container.resolve('commandBus') as CommandBus
    await commandBus.execute('sales.notes.create', {
      input: { ...scope, contextType: 'order', contextId: order.id, orderId: order.id, body },
      ctx: buildShopCommandContext(deps.container, site),
    })
    return { orderId: order.id, submittedAt: submittedAt.toISOString() }
  } catch (err) {
    // Nothing half-done stays behind: the file goes, and the buyer may send the proof again.
    if (attachmentId && attachments.releaseScoped) {
      await attachments
        .releaseScoped({ attachmentId, ...scope, expectedOwner: { entityId: ORDER_ENTITY_ID, recordId: order.id }, expectedAssignment: assignment, expectedPartitionCode: RECEIPT_PARTITION })
        .then((cleanup) => (cleanup ? cleanup() : undefined))
        .catch((releaseErr: unknown) => logger.warn('Removing a receipt after a failed proof failed', { err: releaseErr, orderId: order.id, attachmentId }))
    }
    await deps.em
      .fork()
      .nativeUpdate(StorefrontOrderAccess, { id: access.id, ...scope, proofSubmittedAt: submittedAt }, { proofSubmittedAt: null })
      .catch((releaseErr: unknown) => logger.warn('Giving back a proof claim failed', { err: releaseErr, orderId: order.id }))
    if (isCrudHttpError(err) && err.status === 413) throw new ShopError(413, 'receiptTooLarge', { receipt: 'storefront.shop.proof.errors.tooLarge' })
    if (isCrudHttpError(err) && err.status === 400) throw new ShopError(422, 'receiptType', { receipt: 'storefront.shop.proof.errors.type' })
    throw err
  }
}
