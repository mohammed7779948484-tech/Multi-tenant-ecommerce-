import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStorefrontEvent } from '../events'
import { addCartLine, removeCartLine, updateCartLine, type CartSite } from '../lib/shopCart'

/**
 * Buyer cart writes (shopping-journey spec, commands `storefront.cart.*`).
 * Dispatched by the public cart routes with a system context pinned to the
 * store's tenant and organization; the store comes from the URL slug, the cart
 * from the cookie token's hash. Buyer self-service: not undoable and not in the
 * audit log (no `buildLog`); `storefront.cart.updated` fires after commit with
 * ids only.
 */

export const CART_ADD_LINE_COMMAND = 'storefront.cart.add_line'
export const CART_UPDATE_LINE_COMMAND = 'storefront.cart.update_line'
export const CART_REMOVE_LINE_COMMAND = 'storefront.cart.remove_line'

const logger = createLogger('storefront').child({ component: 'cart-command' })

type CartCommandBase = { site: CartSite; tokenHash: string | null }
export type CartAddLineCommandInput = CartCommandBase & { tokenHash: string; productId: string; variantId?: string | null; quantity: number; personalization?: unknown }
export type CartUpdateLineCommandInput = CartCommandBase & { lineId: string; quantity?: number; personalization?: unknown }
export type CartRemoveLineCommandInput = CartCommandBase & { lineId: string }

function deps(ctx: CommandRuntimeContext) {
  const container = ctx.container as AwilixContainer
  return { em: (container.resolve('em') as EntityManager).fork(), container }
}

/** Trusted system context for one store: no buyer identity, pinned to the store's organization. */
export function buildShopCommandContext(container: AwilixContainer, site: CartSite): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: { selectedId: site.organizationId, filterIds: [site.organizationId], allowedIds: null, tenantId: site.tenantId },
    selectedOrganizationId: site.organizationId,
    organizationIds: [site.organizationId],
    systemActor: true,
  }
}

async function emitCartUpdated(site: CartSite, cartId: string) {
  try {
    await emitStorefrontEvent('storefront.cart.updated', { id: cartId, siteId: site.id, tenantId: site.tenantId, organizationId: site.organizationId })
  } catch (err) {
    logger.warn('storefront.cart.updated emit failed', { err, siteId: site.id, cartId })
  }
}

const addLineCommand: CommandHandler<CartAddLineCommandInput, { cartId: string; created: boolean }> = {
  id: CART_ADD_LINE_COMMAND,
  isUndoable: false,
  async execute(input, ctx) {
    const result = await addCartLine(deps(ctx), input.site, input.tokenHash, input)
    await emitCartUpdated(input.site, result.cartId)
    return result
  },
}

const updateLineCommand: CommandHandler<CartUpdateLineCommandInput, { cartId: string }> = {
  id: CART_UPDATE_LINE_COMMAND,
  isUndoable: false,
  async execute(input, ctx) {
    const result = await updateCartLine(deps(ctx), input.site, input.tokenHash, input.lineId, input)
    await emitCartUpdated(input.site, result.cartId)
    return result
  },
}

const removeLineCommand: CommandHandler<CartRemoveLineCommandInput, { cartId: string }> = {
  id: CART_REMOVE_LINE_COMMAND,
  isUndoable: false,
  async execute(input, ctx) {
    const result = await removeCartLine(deps(ctx), input.site, input.tokenHash, input.lineId)
    await emitCartUpdated(input.site, result.cartId)
    return result
  },
}

registerCommand(addLineCommand)
registerCommand(updateLineCommand)
registerCommand(removeLineCommand)

const cartCommands = [addLineCommand, updateLineCommand, removeLineCommand]

export default cartCommands
