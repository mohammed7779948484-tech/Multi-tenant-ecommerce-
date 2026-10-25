import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'

/**
 * Buyer pages are Arabic (shopping-journey spec REQ-001). Arabic is an app
 * locale, declared on the framework's `LocaleRegistry` (type half of the
 * extension point). It is deliberately NOT registered at runtime with
 * `registerLocales`: that would add Arabic to the dashboards' language switcher,
 * and dashboard localization is out of scope. Store pages ask the framework's
 * dictionary loader for `ar` directly; keys without an Arabic value fall back to
 * English, as the loader does for every app locale.
 */
declare module '@open-mercato/shared/lib/i18n/config' {
  interface LocaleRegistry {
    ar: true
  }
}

export const SHOP_LOCALE: Locale = 'ar'
export const SHOP_DIRECTION = 'rtl' as const

/** Key prefixes a buyer page needs on the client (for its `I18nProvider`). */
const CLIENT_PREFIXES = ['storefront.public.', 'storefront.shop.']

export type ShopTranslate = ReturnType<typeof createFallbackTranslator>

export async function shopTranslations(): Promise<{ locale: Locale; translate: ShopTranslate; clientDict: Dict }> {
  const dict = await loadDictionary(SHOP_LOCALE)
  const clientDict: Dict = {}
  for (const [key, value] of Object.entries(dict)) {
    if (CLIENT_PREFIXES.some((prefix) => key.startsWith(prefix))) clientDict[key] = value
  }
  return { locale: SHOP_LOCALE, translate: createFallbackTranslator(dict), clientDict }
}
