import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStorefrontEvent } from '../events'
import type { CartSite } from '../lib/shopCart'
import { placeOrder, type PlaceInput, type PlaceResult } from '../lib/shopOrders'

/**
 * `storefront.checkout.place` (shopping-journey spec REQ-008): turns the cart
 * behind a cookie token into a sales order. Dispatched by the public place
 * route with a system context pinned to the store; the sales order itself is
 * created by the installed `sales.orders.create` command, which writes its own
 * audit entry and events. Not undoable from the buyer side (an order is
 * cancelled by the merchant in the sales admin). `storefront.order.placed`
 * fires after commit with ids only.
 */

export const CHECKOUT_PLACE_COMMAND = 'storefront.checkout.place'

const logger = createLogger('storefront').child({ component: 'checkout-command' })

export type CheckoutPlaceCommandInput = PlaceInput & { site: CartSite; cartToken: string }

const placeCommand: CommandHandler<CheckoutPlaceCommandInput, PlaceResult> = {
  id: CHECKOUT_PLACE_COMMAND,
  isUndoable: false,
  async execute(input, ctx) {
    const container = ctx.container as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()
    const { site, cartToken, ...place } = input
    const result = await placeOrder({ em, container }, site, cartToken, place)
    if (!result.replay) {
      try {
        await emitStorefrontEvent('storefront.order.placed', { id: result.orderId, siteId: site.id, tenantId: site.tenantId, organizationId: site.organizationId })
      } catch (err) {
        logger.warn('storefront.order.placed emit failed', { err, siteId: site.id, orderId: result.orderId })
      }
    }
    return result
  },
}

registerCommand(placeCommand)

const checkoutCommands = [placeCommand]

export default checkoutCommands
