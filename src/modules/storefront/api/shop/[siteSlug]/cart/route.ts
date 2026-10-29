import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildCartView, findActiveCart } from '../../../../lib/shopCart'
import { errorResponse, noStore, resolveShopRequest, shopFailure } from '../../../../lib/shopRoute'
import { storefrontTag } from '../../../openapi'
import { cartViewSchema, shopErrorSchema } from './schemas'

/** Anonymous by design: the cart cookie is the only capability. */
export const metadata = {
  GET: { requireAuth: false },
}

/** The buyer's cart in this store, priced now. No cookie (or an expired cart) answers an empty cart. */
export async function GET(req: Request, context: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  try {
    const cart = await findActiveCart(shop.em, shop.site, shop.tokenHash)
    return noStore(await buildCartView(shop, shop.site, cart))
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Buyer cart',
  methods: {
    GET: {
      summary: "Read the buyer's cart in a store",
      description:
        'Anonymous. Finds the cart by the per-store HttpOnly cookie. Prices come from the pricing engine and stock from the availability contract on every read; a line that can no longer be bought carries an issue instead of failing the cart. No cookie, or an expired cart, answers an empty cart.',
      responses: [{ status: 200, description: 'The cart', schema: cartViewSchema }],
      errors: [{ status: 404, description: 'Unknown or offline store', schema: shopErrorSchema }],
    },
  },
}
