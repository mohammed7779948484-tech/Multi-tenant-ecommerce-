import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogOptionSchemaTemplate, CatalogProductVariant, type CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { purchasePrices, type ShopPrice } from './catalogData'
import { readOptionDefinitions, type PersonalizationField, type PurchaseAxis, type PurchaseVariantRef } from './productOptions'
import { resolveShopAvailability, stockKey, type ShopScope } from './shopAvailability'

/**
 * Everything a buyer can choose on one product, with live prices and advisory
 * stock (shopping-journey spec, "Purchasable variant"). Read by the product page
 * and, with `bypassCache` off, by the cart service for every line it prices.
 */

export type PurchaseStock = {
  /** False when the requested quantity cannot be met (sold out). */
  canFulfil: boolean
  /** Units available when stock is tracked; `null` when it is not. */
  available: number | null
}

export type PurchaseVariant = PurchaseVariantRef & { price: ShopPrice | null; stock: PurchaseStock | null }

export type PurchaseModel = {
  productId: string
  /** True when the buyer must pick a variant (configurable flag or ≥1 active variant with axes). */
  configurable: boolean
  axes: PurchaseAxis[]
  fields: PersonalizationField[]
  variants: PurchaseVariant[]
  /** The product's own row: simple products, or the price shown before a variant is picked. */
  base: { variantId: string | null; price: ShopPrice | null; stock: PurchaseStock | null }
  quoteOnly: boolean
}

type Deps = { em: EntityManager; container: AwilixContainer }

function toStock(answer: { canFulfil: boolean; availableQuantity: number | null } | undefined): PurchaseStock | null {
  return answer ? { canFulfil: answer.canFulfil, available: answer.availableQuantity } : null
}

async function optionSchemaOf(em: EntityManager, scope: ShopScope, product: CatalogProduct): Promise<unknown> {
  const template = product.optionSchemaTemplate
  const templateId = template ? (typeof template === 'string' ? template : template.id) : null
  if (templateId) {
    const row = await findOneWithDecryption(em, CatalogOptionSchemaTemplate, { id: templateId, ...scope, deletedAt: null }, { fields: ['id', 'schema'] }, scope)
    if (row?.schema) return row.schema
  }
  // Older products keep the schema in their metadata.
  return (product.metadata as Record<string, unknown> | null | undefined)?.optionSchema ?? null
}

/**
 * The lowest of `prices` (in variant order), compared only within one currency:
 * the most common one, ties going to the first listed. Amounts in different
 * currencies are never compared.
 */
export function cheapestPrice(prices: ShopPrice[]): ShopPrice | null {
  const counts = new Map<string, number>()
  for (const price of prices) counts.set(price.currencyCode, (counts.get(price.currencyCode) ?? 0) + 1)
  let currency: string | null = null
  for (const [code, count] of counts) if (currency === null || count > counts.get(currency)!) currency = code
  return prices.filter((price) => price.currencyCode === currency).reduce<ShopPrice | null>((low, price) => (!low || price.amount < low.amount ? price : low), null)
}

/**
 * `quantity` prices the product as a line of that many units (quantity tiers)
 * and asks stock for that many, or for `stockQuantity` when other cart lines
 * share the same stock; the product page uses one. `strictStock`
 * (order placement) fails with `StockCheckFailedError` when stock cannot be
 * checked, instead of treating it as not tracked.
 */
export async function loadPurchaseModel(
  deps: Deps,
  scope: ShopScope,
  product: CatalogProduct,
  options: { bypassCache?: boolean; quantity?: number; stockQuantity?: number; strictStock?: boolean } = {},
): Promise<PurchaseModel> {
  const quantity = options.quantity ?? 1
  const stockQuantity = options.stockQuantity ?? quantity
  const { em, container } = deps
  const { axes, fields } = readOptionDefinitions(await optionSchemaOf(em, scope, product))
  const rows = await findWithDecryption(
    em,
    CatalogProductVariant,
    { product: product.id, ...scope, deletedAt: null, isActive: true },
    { fields: ['id', 'name', 'optionValues', 'isDefault', 'createdAt'], orderBy: { isDefault: 'desc', createdAt: 'asc' } },
    scope,
  )
  const refs: PurchaseVariantRef[] = rows.map((row) => ({ id: row.id, name: row.name?.trim() || '', values: { ...(row.optionValues ?? {}) } }))
  const configurable = axes.length > 0 && (product.isConfigurable || refs.length > 0)
  // A simple product with variants but no axes sells its default variant.
  const implicit = !configurable && refs.length ? refs[0]!.id : null

  const quoteOnly = Boolean(product.isQuoteOnly)
  const prices = quoteOnly ? new Map<string, ShopPrice>() : await purchasePrices(deps, scope, product.id, refs.map((ref) => ref.id), quantity)
  const stock = await resolveShopAvailability(
    container,
    scope,
    [{ productId: product.id, variantId: implicit, quantity: stockQuantity }, ...(configurable ? refs.map((ref) => ({ productId: product.id, variantId: ref.id, quantity: stockQuantity })) : [])],
    { bypassCache: options.bypassCache, strict: options.strictStock },
  )
  // From-price before a pick: the product's own price, else its cheapest variant (in one currency).
  const cheapest = cheapestPrice(refs.map((ref) => prices.get(ref.id)).filter((price): price is ShopPrice => Boolean(price)))
  return {
    productId: product.id,
    configurable,
    axes,
    fields,
    variants: configurable ? refs.map((ref) => ({ ...ref, price: prices.get(ref.id) ?? prices.get('') ?? null, stock: toStock(stock.get(stockKey(product.id, ref.id))) })) : [],
    base: {
      variantId: implicit,
      price: (implicit ? prices.get(implicit) : null) ?? prices.get('') ?? (configurable ? cheapest : null),
      stock: toStock(stock.get(stockKey(product.id, implicit))),
    },
    quoteOnly,
  }
}
