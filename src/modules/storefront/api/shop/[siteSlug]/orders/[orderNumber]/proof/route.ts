import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { toLatinDigits } from '@/lib/digits'
import { ORDER_SUBMIT_PROOF_COMMAND, type OrderSubmitProofCommandInput } from '../../../../../../commands/proof'
import { proofFieldsSchema } from '../../../../../../data/validators'
import { orderCookieName, resolveOrderAccess } from '../../../../../../lib/shopOrders'
import { MAX_RECEIPT_BYTES, readProofForm, type ProofResult } from '../../../../../../lib/shopProof'
import { errorResponse, guardShopWrite, noStore, requestCookie, resolveShopRequest, runShopCommand, shopFailure, zodFieldErrors } from '../../../../../../lib/shopRoute'
import { storefrontTag } from '../../../../../openapi'
import { shopErrorSchema } from '../../../cart/schemas'

/** Anonymous by design: the order's token (link `k` or the order cookie) is the only capability. */
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request, context: { params: Promise<{ siteSlug: string; orderNumber: string }> }) {
  const { siteSlug, orderNumber: rawNumber } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const blocked = await guardShopWrite(req, shop)
  if (blocked) return blocked
  let orderNumber: string
  try {
    orderNumber = decodeURIComponent(rawNumber)
  } catch {
    return errorResponse(404, 'orderNotFound', undefined, shop.translate)
  }
  try {
    // The order first: without its token, nothing about the request is read or answered.
    const tokens = { link: new URL(req.url).searchParams.get('k'), cookie: requestCookie(req, orderCookieName(shop.site.id, orderNumber)) }
    const opened = await resolveOrderAccess(shop.em, shop.site, orderNumber, tokens)
    if (!opened) return errorResponse(404, 'orderNotFound', undefined, shop.translate)
    const form = await readProofForm(req)
    const receipt = form.get('receipt')
    const parsed = proofFieldsSchema.safeParse({
      reference: typeof form.get('reference') === 'string' ? toLatinDigits(form.get('reference') as string) : undefined,
      ...(typeof form.get('senderName') === 'string' ? { senderName: form.get('senderName') } : {}),
    })
    const fieldErrors: Record<string, string> = parsed.success ? {} : zodFieldErrors(parsed.error)
    if (!(receipt instanceof Blob) || receipt.size === 0) fieldErrors.receipt = 'storefront.shop.proof.errors.receipt'
    if (!parsed.success || Object.keys(fieldErrors).length) return errorResponse(422, 'invalidRequest', fieldErrors, shop.translate)
    const { result } = await runShopCommand<OrderSubmitProofCommandInput, ProofResult>(shop, ORDER_SUBMIT_PROOF_COMMAND, {
      site: shop.site,
      accessId: opened.access.id,
      reference: parsed.data.reference,
      senderName: parsed.data.senderName,
      receipt: Buffer.from(await (receipt as Blob).arrayBuffer()),
    })
    return noStore({ submittedAt: result.submittedAt }, { status: 201 })
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Send a bank-transfer proof',
  methods: {
    POST: {
      summary: "Attach the buyer's transfer reference and receipt to a bank-transfer order",
      description: `Anonymous, same-origin, rate-limited; the order's token comes from the \`k\` query parameter or the order cookie, as for tracking. Multipart body: \`reference\` (required, up to 100 characters), \`senderName\` (optional, up to 120) and \`receipt\` (a JPEG, PNG, WebP or PDF, recognized by its content, up to ${MAX_RECEIPT_BYTES / 1024 / 1024} MB). The receipt becomes a private attachment of the sales order and the details a note on it. One proof per order.`,
      requestBody: {
        contentType: 'multipart/form-data',
        schema: z.object({ reference: z.string(), senderName: z.string().optional(), receipt: z.string().describe('The receipt file') }),
      },
      responses: [{ status: 201, description: 'Proof received', schema: z.object({ submittedAt: z.string() }) }],
      errors: [
        { status: 403, description: 'Cross-origin request', schema: shopErrorSchema },
        { status: 404, description: 'Unknown store, unknown order, or no valid token', schema: shopErrorSchema },
        { status: 409, description: '`proofAlreadySubmitted`: this order already has a proof', schema: shopErrorSchema },
        { status: 413, description: '`receiptTooLarge`: the receipt is over the limit', schema: shopErrorSchema },
        { status: 422, description: 'Missing or invalid fields, a receipt that is not an image or PDF, a cash-on-delivery order (`proofNotTransfer`) or one already paid (`proofNotNeeded`)', schema: shopErrorSchema },
        { status: 429, description: 'Rate limited', schema: shopErrorSchema },
      ],
    },
  },
}
