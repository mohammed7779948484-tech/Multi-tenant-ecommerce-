import type { EntityManager } from '@mikro-orm/postgresql'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { StorefrontSite } from '../data/entities'
import { loadStorePageLinks, type ShopNavLink } from './shopNav'
import { shopTranslations, type ShopTranslate } from './shopLocale'

/**
 * Everything the store shell (header menu, footer, skip link) needs on a public
 * page. The builder preview renders the frame without a shell: its controls and
 * labels stay the admin's (spec Phase 1, builder preview note).
 */
export type ShopShell = {
  locale: Locale
  /** Client dictionary for `I18nProvider` (buyer keys only). */
  dict: Dict
  links: ShopNavLink[]
  /** False when the page already ends with the merchant's own Footer section. */
  footer: boolean
  year: number
  labels: {
    skipToContent: string
    openMenu: string
    closeMenu: string
    menuDescription: string
    nav: string
    rights: string
  }
}

type ShellSite = Pick<StorefrontSite, 'id' | 'slug' | 'name' | 'tenantId' | 'organizationId'>

export function buildShopShell(
  site: ShellSite,
  links: ShopNavLink[],
  i18n: { locale: Locale; translate: ShopTranslate; clientDict: Dict },
  options: { footer: boolean; now?: Date },
): ShopShell {
  const { translate } = i18n
  const year = (options.now ?? new Date()).getFullYear()
  return {
    locale: i18n.locale,
    dict: i18n.clientDict,
    links: [{ href: `/${site.slug}`, label: translate('storefront.shop.navHome', 'Home') }, ...links],
    footer: options.footer,
    year,
    labels: {
      skipToContent: translate('storefront.shop.skipToContent', 'Skip to content'),
      openMenu: translate('storefront.shop.openMenu', 'Open menu'),
      closeMenu: translate('storefront.shop.closeMenu', 'Close menu'),
      menuDescription: translate('storefront.shop.menuDescription', "Browse the store's pages"),
      nav: translate('storefront.shop.navLabel', 'Store links'),
      rights: translate('storefront.shop.footerRights', '© {year} {store}. All rights reserved.', { year, store: site.name }),
    },
  }
}

/** Loads the Arabic dictionary and the store's page links, then builds the shell. */
export async function loadShopShell(em: EntityManager, site: ShellSite, options: { footer: boolean }) {
  const i18n = await shopTranslations()
  const links = await loadStorePageLinks(em, site)
  return { translate: i18n.translate, shell: buildShopShell(site, links, i18n, options) }
}
