import * as React from 'react'
import type { ValidatedSection } from '../../lib/blocks/pageSpec'
import { buildThemeCssVariables, type ThemeTokens } from '../../lib/theme'
import { STOREFRONT_STRUCTURAL_CSS } from '../../lib/storefrontCss'
import { serializeJsonLd } from '../../lib/structuredData'
import { renderSection } from './registry'

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
  storeName: string
  basePath: string
  logoSrc: string | null
  tokens: ThemeTokens
  sections: ValidatedSection[]
  head: StorefrontHeadData
  signInHref: string | null
  labels: { signIn: string; home: string }
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

export function StorefrontView(props: StorefrontViewProps) {
  const css = STOREFRONT_STRUCTURAL_CSS + buildThemeCssVariables(props.siteId, props.tokens)
  return (
    <div className="sf-root" data-sf-site={props.siteId.toLowerCase()}>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <style>{css}</style>
      <header className="sf-header">
        <div className="sf-container sf-header-inner">
          <a className="sf-brand" href={props.basePath || '/'} aria-label={props.labels.home}>
            {props.logoSrc ? (
              // The logo is served by the site-scoped media route; the next/image optimizer would fetch it out of band.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="sf-logo" src={props.logoSrc} alt={props.storeName} />
            ) : (
              <span>{props.storeName}</span>
            )}
          </a>
          {props.signInHref ? (
            <a className="sf-header-link" href={props.signInHref}>
              {props.labels.signIn}
            </a>
          ) : null}
        </div>
      </header>
      <main className="sf-main">
        {props.sections.map((section, index) =>
          renderSection(section, { basePath: props.basePath, isFirst: index === 0 }),
        )}
      </main>
    </div>
  )
}

/** Neutral page for a store whose published spec fails validation; its metadata is `noindex`. */
export function StorefrontUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <div className="sf-unavailable">
      <style>{STOREFRONT_STRUCTURAL_CSS}</style>
      <div>
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}
