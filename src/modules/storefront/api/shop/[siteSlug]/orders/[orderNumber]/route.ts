import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadOrderView, orderCookieName, resolveOrderAccess } from '../../../../../lib/shopOrders'
import { errorResponse, noStore, requestCookie, resolveShopRequest, shopFailure } from '../../../../../lib/shopRoute'
import { storefrontTag } from '../../../../openapi'
import { shopErrorSchema } from '../../cart/schemas'
import { orderViewSchema } from '../../checkout/schemas'

/** Anonymous by design: the order's token (cookie or `k`) is the only capability. */
export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request, context: { params: Promise<{ siteSlug: string; orderNumber: string }> }) {
  const { siteSlug, orderNumber: rawNumber } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  let orderNumber: string
  try {
    orderNumber = decodeURIComponent(rawNumber)
  } catch {
    return errorResponse(404, 'orderNotFound', undefined, shop.translate)
  }
  const tokens = { link: new URL(req.url).searchParams.get('k'), cookie: requestCookie(req, orderCookieName(shop.site.id, orderNumber)) }
  try {
    const opened = await resolveOrderAccess(shop.em, shop.site, orderNumber, tokens)
    const view = opened ? await loadOrderView(shop.em, shop.site, opened.access) : null
    // A wrong token, another store's order and an unknown number answer the same.
    return view ? noStore(view) : errorResponse(404, 'orderNotFound', undefined, shop.translate)
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Track an order',
  methods: {
    GET: {
      summary: "Read a guest's order with its access token",
      description:
        'Anonymous. The token comes from the `k` query parameter of the confirmation link, or from the order cookie this browser got at checkout; a `k` that does not open the order falls back to the cookie. Shows status, payment status, lines with personalization, totals, contact and address. A wrong token, another store\'s order and an unknown number all answer 404.',
      responses: [{ status: 200, description: 'The order', schema: orderViewSchema }],
      errors: [{ status: 404, description: 'Unknown store, unknown order, or no valid token', schema: shopErrorSchema }],
    },
  },
}
