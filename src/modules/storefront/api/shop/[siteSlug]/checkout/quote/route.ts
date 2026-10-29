import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { checkoutQuoteSchema } from '../../../../../data/validators'
import { findActiveCart } from '../../../../../lib/shopCart'
import { buildQuote } from '../../../../../lib/shopCheckout'
import { errorResponse, guardShopWrite, noStore, resolveShopRequest, shopFailure, zodFieldErrors } from '../../../../../lib/shopRoute'
import { storefrontTag } from '../../../../openapi'
import { shopErrorSchema } from '../../cart/schemas'
import { checkoutQuoteResponseSchema } from '../schemas'

/** Anonymous by design: the cart cookie is the only capability. */
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request, context: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const blocked = await guardShopWrite(req, shop)
  if (blocked) return blocked
  const parsed = checkoutQuoteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse(422, 'invalidRequest', zodFieldErrors(parsed.error), shop.translate)
  try {
    const cart = await findActiveCart(shop.em, shop.site, shop.tokenHash)
    return noStore(await buildQuote(shop, shop.site, cart, parsed.data))
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Checkout quote',
  methods: {
    POST: {
      summary: 'Price the cart for a destination, delivery and payment method',
      description:
        'Anonymous, same-origin, rate-limited. Body: `{ destination { governorate, district, area, landmark?, note?, gps? }, shippingMethodId, paymentMethodId }`, strict. Lines are priced now by the pricing engine; delivery by the Yemen-zones provider; fees and totals by the sales calculation service, as the order will be. `quoteHash` changes whenever anything payable changes; `blocked` is true while a line can no longer be bought.',
      requestBody: { contentType: 'application/json', schema: checkoutQuoteSchema },
      responses: [{ status: 200, description: 'The quote', schema: checkoutQuoteResponseSchema }],
      errors: [
        { status: 403, description: 'Cross-origin request', schema: shopErrorSchema },
        { status: 404, description: 'Unknown or offline store', schema: shopErrorSchema },
        { status: 422, description: 'Empty cart, invalid destination, a method the store does not offer there, or delivery not served', schema: shopErrorSchema },
        { status: 429, description: 'Rate limited', schema: shopErrorSchema },
      ],
    },
  },
}
