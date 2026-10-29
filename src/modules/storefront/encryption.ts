import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * At-rest encryption for buyer free text. A cart line's personalization can hold
 * a recipient's name or a gift message. It is never searched or sorted: lines are
 * matched by `line_key`, a hash computed before encryption. Reads go through the
 * `…WithDecryption` helpers with the store's tenant and organization.
 *
 * The map is materialized when a tenant is created; existing tenants need
 * `yarn mercato entities seed-encryption --tenant <id>`.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'storefront:storefront_cart_line',
    fields: [{ field: 'personalization' }],
  },
]

export default defaultEncryptionMaps
