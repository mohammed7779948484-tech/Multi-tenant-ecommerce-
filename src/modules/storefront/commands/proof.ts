import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStorefrontEvent } from '../events'
import type { CartSite } from '../lib/shopCart'
import { submitTransferProof, type ProofInput, type ProofResult } from '../lib/shopProof'

/**
 * `storefront.order.submit_proof` (shopping-journey spec REQ-010): the buyer's
 * bank-transfer proof for an order they hold the token of. Dispatched by the
 * public proof route with a system context pinned to the store; the receipt is
 * stored by the installed attachments service and the note is written by the
 * installed `sales.notes.create` command (its own audit entry). Not undoable
 * from the buyer side. `storefront.order.proof_submitted` fires after commit
 * with ids only.
 */

export const ORDER_SUBMIT_PROOF_COMMAND = 'storefront.order.submit_proof'

const logger = createLogger('storefront').child({ component: 'proof-command' })

export type OrderSubmitProofCommandInput = ProofInput & { site: CartSite }

const submitProofCommand: CommandHandler<OrderSubmitProofCommandInput, ProofResult> = {
  id: ORDER_SUBMIT_PROOF_COMMAND,
  isUndoable: false,
  async execute(input, ctx) {
    const container = ctx.container as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()
    const { site, ...proof } = input
    const result = await submitTransferProof({ em, container }, site, proof)
    try {
      await emitStorefrontEvent('storefront.order.proof_submitted', { id: result.orderId, siteId: site.id, tenantId: site.tenantId, organizationId: site.organizationId })
    } catch (err) {
      logger.warn('storefront.order.proof_submitted emit failed', { err, siteId: site.id, orderId: result.orderId })
    }
    return result
  },
}

registerCommand(submitProofCommand)

const proofCommands = [submitProofCommand]

export default proofCommands
