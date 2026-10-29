import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { toLatinDigits } from '@/lib/digits'
import { CHECKOUT_PLACE_COMMAND, type CheckoutPlaceCommandInput } from '../../../../../commands/checkout'
import { checkoutPlaceSchema } from '../../../../../data/validators'
import type { PlaceResult } from '../../../../../lib/shopOrders'
import { errorResponse, guardShopWrite, noStore, resolveShopRequest, runShopCommand, shopFailure, withOrderCookie, zodFieldErrors } from '../../../../../lib/shopRoute'
import { normalizeYemeniMobile } from '../../../../../lib/yemen'
import { storefrontTag } from '../../../../openapi'
import { shopErrorSchema } from '../../cart/schemas'
import { checkoutPlaceResponseSchema, checkoutQuoteResponseSchema } from '../schemas'

/** Anonymous by design: the cart cookie is the only capability; the answer sets the order's cookie. */
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request, context: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const blocked = await guardShopWrite(req, shop)
  if (blocked) return blocked
  const parsed = checkoutPlaceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse(422, 'invalidRequest', zodFieldErrors(parsed.error), shop.translate)
  const phone = normalizeYemeniMobile(parsed.data.contact.phone, toLatinDigits)
  if (!phone) return errorResponse(422, 'invalidRequest', { 'contact.phone': 'storefront.shop.checkout.errors.phone' }, shop.translate)
  if (!shop.token) return errorResponse(422, 'cartEmpty', undefined, shop.translate)
  try {
    const { result } = await runShopCommand<CheckoutPlaceCommandInput, PlaceResult>(shop, CHECKOUT_PLACE_COMMAND, {
      ...parsed.data,
      contact: { name: parsed.data.contact.name, phone },
      site: shop.site,
      cartToken: shop.token,
    })
    const trackingUrl = `/${shop.site.slug}/orders/${encodeURIComponent(result.orderNumber)}?k=${result.token}`
    const res = noStore({ orderNumber: result.orderNumber, trackingUrl }, { status: result.replay ? 200 : 201 })
    return withOrderCookie(res, req, shop.site, result.orderNumber, result.token)
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Place the order',
  methods: {
    POST: {
      summary: 'Turn the cart into a sales order',
      description:
        'Anonymous, same-origin, rate-limited. Body: the quote body plus `contact { name, phone }` (a Yemeni mobile, stored as +9677XXXXXXXX) and the `quoteHash` the buyer confirmed. Re-prices with live stock; when anything changed (or a line can no longer be bought) answers 409 with the new `quote` and creates nothing. Otherwise creates the order through `sales.orders.create` (pending approval, payment pending), closes the cart, sets an HttpOnly order cookie and answers 201 with the tracking link. A repeated submit of the same cart answers 200 with the same order; a submit while another of the same cart runs waits for it.',
      requestBody: { contentType: 'application/json', schema: checkoutPlaceSchema },
      responses: [
        { status: 201, description: 'Order placed', schema: checkoutPlaceResponseSchema },
        { status: 200, description: 'The same cart was already placed: its order', schema: checkoutPlaceResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Cross-origin request', schema: shopErrorSchema },
        { status: 404, description: 'Unknown or offline store', schema: shopErrorSchema },
        { status: 409, description: '`quoteChanged`: prices, stock, delivery or fees changed; the body carries the new `quote`. `orderInProgress`: another submit of this cart is still running after a 15 s wait', schema: shopErrorSchema.extend({ quote: checkoutQuoteResponseSchema.optional() }) },
        { status: 422, description: 'Empty cart, invalid contact or destination, or a method the store does not offer there', schema: shopErrorSchema },
        { status: 429, description: 'Rate limited', schema: shopErrorSchema },
        { status: 503, description: '`stockCheckFailed`: live stock could not be checked; nothing was created', schema: shopErrorSchema },
      ],
    },
  },
}
