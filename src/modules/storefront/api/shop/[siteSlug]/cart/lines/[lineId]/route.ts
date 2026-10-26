import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  CART_REMOVE_LINE_COMMAND,
  CART_UPDATE_LINE_COMMAND,
  type CartRemoveLineCommandInput,
  type CartUpdateLineCommandInput,
} from '../../../../../../commands/cart'
import { cartLineUpdateSchema } from '../../../../../../data/validators'
import { buildCartView, findActiveCart } from '../../../../../../lib/shopCart'
import { errorResponse, guardShopWrite, noStore, resolveShopRequest, runShopCommand, shopFailure, withCartCookie, type ShopRequest } from '../../../../../../lib/shopRoute'
import { storefrontTag } from '../../../../../openapi'
import { cartViewSchema, shopErrorSchema } from '../../schemas'

/** Anonymous by design: the cart cookie is the only capability; a line of another cart answers 404. */
export const metadata = {
  PATCH: { requireAuth: false },
  DELETE: { requireAuth: false },
}

type Context = { params: Promise<{ siteSlug: string; lineId: string }> }

/** The cart after a write; the write moved its expiry 30 days on, so the cookie is renewed to match. */
async function respondWithCart(req: Request, shop: ShopRequest) {
  const em = shop.em.fork()
  const res = noStore(await buildCartView({ ...shop, em }, shop.site, await findActiveCart(em, shop.site, shop.tokenHash)))
  return shop.token ? withCartCookie(res, req, shop.site, shop.token) : res
}

export async function PATCH(req: Request, context: Context) {
  const { siteSlug, lineId } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const blocked = await guardShopWrite(req, shop)
  if (blocked) return blocked
  const parsed = cartLineUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse(422, 'invalidRequest', undefined, shop.translate)
  try {
    await runShopCommand<CartUpdateLineCommandInput, unknown>(shop, CART_UPDATE_LINE_COMMAND, { site: shop.site, tokenHash: shop.tokenHash, lineId, ...parsed.data })
    return respondWithCart(req, shop)
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export async function DELETE(req: Request, context: Context) {
  const { siteSlug, lineId } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const blocked = await guardShopWrite(req, shop)
  if (blocked) return blocked
  try {
    await runShopCommand<CartRemoveLineCommandInput, unknown>(shop, CART_REMOVE_LINE_COMMAND, { site: shop.site, tokenHash: shop.tokenHash, lineId })
    return respondWithCart(req, shop)
  } catch (err) {
    return shopFailure(err, shop)
  }
}

const lineErrors = [
  { status: 403, description: 'Cross-origin request', schema: shopErrorSchema },
  { status: 404, description: 'Unknown store, or a line that is not in this browser\'s cart (another cart\'s line answers the same)', schema: shopErrorSchema },
  { status: 429, description: 'Rate limited', schema: shopErrorSchema },
]

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Change or remove a cart line',
  methods: {
    PATCH: {
      summary: 'Change a line\'s quantity or personalization',
      description:
        'Anonymous, same-origin, rate-limited. Body: `{ quantity?, personalization? }` (at least one), strict. The line must belong to the cart behind this browser\'s cookie in this store. An edit that makes the line equal to another merges the two.',
      requestBody: { contentType: 'application/json', schema: cartLineUpdateSchema },
      responses: [{ status: 200, description: 'The updated cart', schema: cartViewSchema }],
      errors: [...lineErrors, { status: 422, description: 'Invalid body, personalization or quantity; no price or out of stock', schema: shopErrorSchema }],
    },
    DELETE: {
      summary: 'Remove a line',
      description: 'Anonymous, same-origin, rate-limited. The line must belong to the cart behind this browser\'s cookie in this store.',
      responses: [{ status: 200, description: 'The updated cart', schema: cartViewSchema }],
      errors: lineErrors,
    },
  },
}
