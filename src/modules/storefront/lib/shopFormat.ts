/**
 * Number and price formatting on buyer pages (shopping-journey spec, Localization).
 * Client-safe: no server imports. Prices are formatted once on the server and
 * passed to client components as text, so hydration never depends on the
 * browser's ICU data matching the server's.
 */

export const SHOP_NUMBER_LOCALE = 'ar-YE'

/** One formatter per currency: a search page formats up to 500 prices. */
const priceFormatters = new Map<string, Intl.NumberFormat>()

/** A price as the buyer sees it, or `null` when the amount or currency is unusable. */
export function formatShopPrice(amount: number | null | undefined, currencyCode: string | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || !currencyCode) return null
  try {
    let formatter = priceFormatters.get(currencyCode)
    if (!formatter) {
      formatter = new Intl.NumberFormat(SHOP_NUMBER_LOCALE, { style: 'currency', currency: currencyCode })
      priceFormatters.set(currencyCode, formatter)
    }
    return formatter.format(amount)
  } catch {
    return null
  }
}

export function formatShopNumber(value: number): string {
  return new Intl.NumberFormat(SHOP_NUMBER_LOCALE).format(value)
}

export type ShopPluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** Arabic has six plural forms; dictionaries carry one key per form (`…count.products.few`). */
export function shopPluralCategory(count: number): ShopPluralCategory {
  return new Intl.PluralRules(SHOP_NUMBER_LOCALE).select(count) as ShopPluralCategory
}

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** "٢٤ منتجًا": the count in the right Arabic plural form, from `storefront.shop.count.{noun}.{form}`. */
export function shopCountLabel(translate: Translate, noun: 'products' | 'results' | 'items', count: number): string {
  return translate(`storefront.shop.count.${noun}.${shopPluralCategory(count)}`, `{count} ${noun}`, { count: formatShopNumber(count) })
}
