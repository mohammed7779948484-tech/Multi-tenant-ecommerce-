import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CART_ADD_LINE_COMMAND, type CartAddLineCommandInput } from '../../../../../commands/cart'
import { cartLineAddSchema } from '../../../../../data/validators'
import { buildCartView, findActiveCart, newCartToken } from '../../../../../lib/shopCart'
import {
  CART_EXPECTED_HEADER,
  errorResponse,
  guardShopWrite,
  noStore,
  resolveShopRequest,
  runShopCommand,
  shopFailure,
  withCartCookie,
} from '../../../../../lib/shopRoute'
import { storefrontTag } from '../../../../openapi'
import { cartViewSchema, shopErrorSchema } from '../schemas'

/** Anonymous by design: creates the cart (and its cookie) on the first add. */
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request, context: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const blocked = await guardShopWrite(req, shop)
  if (blocked) return blocked
  const body = await req.json().catch(() => null)
  const parsed = cartLineAddSchema.safeParse(body)
  if (!parsed.success) return errorResponse(422, 'invalidRequest', undefined, shop.translate)
  try {
    let token = shop.token
    let tokenHash = shop.tokenHash
    if (!(await findActiveCart(shop.em, shop.site, tokenHash))) {
      // The previous answer set a cookie this request does not carry: the browser blocks cookies.
      if (!token && req.headers.get(CART_EXPECTED_HEADER) === '1') return errorResponse(400, 'cookiesRequired', undefined, shop.translate)
      ;({ token, hash: tokenHash } = newCartToken())
    }
    await runShopCommand<CartAddLineCommandInput, unknown>(shop, CART_ADD_LINE_COMMAND, { site: shop.site, tokenHash: tokenHash!, ...parsed.data })
    const cart = await findActiveCart(shop.em.fork(), shop.site, tokenHash)
    return withCartCookie(noStore(await buildCartView({ ...shop, em: shop.em.fork() }, shop.site, cart)), req, shop.site, token!)
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Add a line to the buyer cart',
  methods: {
    POST: {
      summary: 'Add a product (variant, personalization, quantity) to the cart',
      description:
        'Anonymous, same-origin, rate-limited per IP and store. Body: `{ productId, variantId?, quantity (1–99), personalization? }`, strict: no price, currency or scope is accepted. The product must be active in this store; a configurable product needs one of its active variants; personalization is checked against the option schema. Adding the same line again raises its quantity. Creates the cart and sets its HttpOnly cookie when there is none.',
      requestBody: { contentType: 'application/json', schema: cartLineAddSchema },
      responses: [{ status: 200, description: 'The updated cart', schema: cartViewSchema }],
      errors: [
        { status: 400, description: '`cookiesRequired`: the browser did not send back the cart cookie', schema: shopErrorSchema },
        { status: 403, description: 'Cross-origin request', schema: shopErrorSchema },
        { status: 404, description: 'Unknown store, or a product this store does not sell', schema: shopErrorSchema },
        { status: 422, description: 'Invalid body, variant, personalization, quantity or line limit, currency mismatch, no price or out of stock', schema: shopErrorSchema },
        { status: 429, description: 'Rate limited', schema: shopErrorSchema },
      ],
    },
  },
}
