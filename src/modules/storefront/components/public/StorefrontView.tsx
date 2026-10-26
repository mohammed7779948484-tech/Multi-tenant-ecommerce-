import * as React from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ValidatedSection } from '../../lib/blocks/pageSpec'
import type { ThemeTokens } from '../../lib/theme'
import { buildShopThemeCss } from '../../lib/shopTheme'
import type { ShopShell } from '../../lib/shopShell'
import { SHOP_DIRECTION } from '../../lib/shopDirection'
import { STOREFRONT_STRUCTURAL_CSS } from '../../lib/storefrontCss'
import { serializeJsonLd } from '../../lib/structuredData'
import { publicMediaResolver } from '../../lib/mediaUrls'
import type { SectionLabels } from './blocks'
import type { SectionData } from '../../lib/sectionDataTypes'
import { renderSection } from './registry'
import { ShopProviders } from '../shop/ShopProviders'
import { StoreMenu } from '../shop/StoreMenu'
import { StoreCartSheet } from '../shop/ShopCart'

export type StorefrontHeadData = {
  title: string
  description: string | null
  canonicalUrl: string
  siteName: string
  imageUrl: string | null
  locale: string
  jsonLd: Record<string, unknown>[]
}

export type StorefrontViewProps = {
  siteId: string
  siteSlug: string
  storeName: string
  basePath: string
  logoSrc: string | null
  tokens: ThemeTokens
  sections: ValidatedSection[]
  head: StorefrontHeadData
  labels: { home: string }
  /** Public pages only: Arabic shell (menu, footer, buyer dictionary). */
  shell: ShopShell
  sectionLabels: SectionLabels
  /** Store data for commerce sections, keyed by section id. */
  sectionData?: Record<string, SectionData>
}

/**
 * JSON-LD for the store. It is the one place that needs raw script text: the
 * string comes only from `serializeJsonLd` (which escapes `<`, `>`, `&`,
 * U+2028/U+2029) over typed fields, never from merchant markup. Title,
 * description, canonical and Open Graph tags go through Next metadata instead
 * (`buildStorefrontMetadata`), so the document has exactly one of each.
 */
export function StorefrontJsonLd({ data }: { data: Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // Serialised by serializeJsonLd from typed fields; see the comment above.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}

export type StorefrontFrameProps = Pick<StorefrontViewProps, 'siteId' | 'storeName' | 'basePath' | 'logoSrc' | 'tokens' | 'labels'> & {
  children: React.ReactNode
  /** Public pages pass the shell; the builder preview renders the bare frame. */
  shell?: ShopShell
  /** Builder preview: the frame sizes to its content instead of filling the viewport. */
  preview?: boolean
}

/**
 * Theme wrapper, header, main region and footer of a store page. Shared by the
 * public page and the admin builder preview, so the preview shows the store's
 * theme and right-to-left layout around the sections. Only public pages carry
 * `.sf-shop` (which themes `<body>` and keeps admin dark mode off the page) and
 * the shell's menu and footer.
 */
export function StorefrontFrame(props: StorefrontFrameProps) {
  const { shell } = props
  const css = STOREFRONT_STRUCTURAL_CSS + buildShopThemeCss(props.siteId, props.tokens)
  return (
    <div
      className={shell ? 'sf-root sf-shop' : 'sf-root'}
      data-sf-site={props.siteId.toLowerCase()}
      data-sf-preview={props.preview ? '' : undefined}
      dir={SHOP_DIRECTION}
      lang={shell?.locale}
    >
      <style>{css}</style>
      <ShopProviders
        dir={SHOP_DIRECTION}
        i18n={shell ? { locale: shell.locale, dict: shell.dict } : undefined}
        cart={shell ? { siteSlug: shell.siteSlug } : undefined}
      >
        {shell ? (
          <a className="sf-skip" href="#sf-main">
            {shell.labels.skipToContent}
          </a>
        ) : null}
        <header className="sf-header">
          <div className="sf-container sf-header-inner">
            {shell ? (
              <StoreMenu
                storeName={props.storeName}
                links={shell.links}
                labels={{ open: shell.labels.openMenu, close: shell.labels.closeMenu, description: shell.labels.menuDescription, nav: shell.labels.nav }}
              />
            ) : null}
            <a className="sf-brand" href={props.basePath || '/'} aria-label={props.labels.home}>
              {props.logoSrc ? (
                // The logo is served by the site-scoped media route; the next/image optimizer would fetch it out of band.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sf-logo" src={props.logoSrc} alt={props.storeName} />
              ) : (
                <span>{props.storeName}</span>
              )}
            </a>
            {shell ? (
              <div className="sf-header-actions">
                <Button asChild variant="ghost" size="icon" className="sf-menu-trigger">
                  <a href={shell.searchHref} aria-label={shell.labels.search}>
                    <SearchIcon aria-hidden="true" />
                  </a>
                </Button>
                <StoreCartSheet cartHref={shell.cartHref} shopHref={props.basePath || '/'} />
              </div>
            ) : null}
          </div>
        </header>
        <main id="sf-main" className="sf-main" tabIndex={-1}>
          {props.children}
        </main>
        {shell?.footer ? <StoreFooter shell={shell} /> : null}
      </ShopProviders>
    </div>
  )
}

/** Shell footer for pages without the merchant's own Footer section (product and collection pages). */
function StoreFooter({ shell }: { shell: ShopShell }) {
  return (
    <footer className="sf-footer sf-shell-footer">
      <div className="sf-container sf-footer-inner">
        <p>{shell.labels.rights}</p>
        <nav aria-label={shell.labels.nav}>
          <ul>
            {shell.links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  )
}

export function StorefrontView(props: StorefrontViewProps) {
  const media = publicMediaResolver(props.siteSlug)
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        {props.sections.map((section, index) =>
          renderSection(section, {
            basePath: props.basePath,
            isFirst: index === 0,
            media,
            labels: props.sectionLabels,
            data: props.sectionData?.[section.id],
          }),
        )}
      </StorefrontFrame>
    </>
  )
}

/** Neutral page for a store whose published spec fails validation; its metadata is `noindex`. */
export function StorefrontUnavailable({ title, message, lang }: { title: string; message: string; lang?: string }) {
  return (
    <div className="sf-unavailable" dir={SHOP_DIRECTION} lang={lang}>
      <style>{STOREFRONT_STRUCTURAL_CSS}</style>
      <div>
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}
