import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findActiveCart } from '../../../../../lib/shopCart'
import { loadCheckoutMethods, shippingOptionsFor, toPaymentOption } from '../../../../../lib/shopCheckout'
import { errorResponse, noStore, resolveShopRequest, shopFailure } from '../../../../../lib/shopRoute'
import { findDistrict, findGovernorate, yemenGovernorates } from '../../../../../lib/yemen'
import { storefrontTag } from '../../../../openapi'
import { shopErrorSchema } from '../../cart/schemas'
import { checkoutOptionsSchema } from '../schemas'

/** Anonymous by design: what a buyer can choose at checkout in this store. */
export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request, context: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await context.params
  const shop = await resolveShopRequest(req, siteSlug)
  if (!shop) return errorResponse(404, 'storeNotFound')
  const url = new URL(req.url)
  const governorate = url.searchParams.get('governorate')
  const district = url.searchParams.get('district')
  if (governorate && !findGovernorate(governorate)) return errorResponse(422, 'destinationInvalid', { governorate: 'storefront.shop.checkout.errors.governorate' }, shop.translate)
  if (district && !findDistrict(governorate, district)) return errorResponse(422, 'destinationInvalid', { district: 'storefront.shop.checkout.errors.district' }, shop.translate)
  try {
    const cart = await findActiveCart(shop.em, shop.site, shop.tokenHash)
    const { shipping, payment } = await loadCheckoutMethods(shop.em, shop.site)
    const governorates = yemenGovernorates()
    return noStore({
      governorates: governorates.map(({ code, name }) => ({ code, name })),
      districts: (governorates.find((row) => row.code === governorate)?.districts ?? []).map(({ code, name }) => ({ code, name })),
      shippingMethods: shippingOptionsFor(shipping, governorate && district ? { governorate, district } : null, cart?.currencyCode ?? null),
      paymentMethods: payment.map(toPaymentOption),
    })
  } catch (err) {
    return shopFailure(err, shop)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontTag,
  summary: 'Checkout options',
  methods: {
    GET: {
      summary: 'Governorates, districts, delivery and payment methods for a destination',
      description:
        'Anonymous. Query: `governorate` and `district` (OCHA P-codes, optional). Lists Yemen\'s governorates, the districts of the given governorate, the store\'s Yemen-zones delivery methods (with a destination: only those serving it in the cart\'s currency, priced; without: all, unpriced), and its cash-on-delivery and bank-transfer methods. Bank transfer is omitted while its instructions are missing or still the seeded example.',
      responses: [{ status: 200, description: 'The options', schema: checkoutOptionsSchema }],
      errors: [
        { status: 404, description: 'Unknown or offline store', schema: shopErrorSchema },
        { status: 422, description: 'Unknown governorate, or a district outside it', schema: shopErrorSchema },
      ],
    },
  },
}
