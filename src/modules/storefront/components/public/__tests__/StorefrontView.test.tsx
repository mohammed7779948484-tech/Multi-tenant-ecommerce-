import { describe, expect, it } from '@jest/globals'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StorefrontView } from '../StorefrontView'
import { validatePageSpec } from '../../../lib/blocks/pageSpec'
import { buildDefaultHomeSpec } from '../../../lib/blocks/defaultHome'
import { DEFAULT_THEME_TOKENS } from '../../../lib/theme'
import { buildStorefrontJsonLd, serializeJsonLd } from '../../../lib/structuredData'
import { buildStorefrontMetadata, buildUnavailableMetadata } from '../../../lib/publicMetadata'

const SITE_ID = '3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a'
const EVIL = '</script><script>alert(1)</script><img src=x onerror=alert(2)>'

function render(storeName: string) {
  const validation = validatePageSpec(buildDefaultHomeSpec({ storeName }))
  if (!validation.ok) throw new Error('default template invalid')
  return renderToStaticMarkup(
    <StorefrontView
      siteId={SITE_ID}
      storeName={storeName}
      basePath="/acme"
      logoSrc={null}
      tokens={{ ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#123abc' } }}
      sections={validation.sections}
      head={{
        title: storeName,
        description: 'Desc',
        canonicalUrl: 'https://suqna.example/acme',
        siteName: storeName,
        imageUrl: null,
        locale: 'en',
        jsonLd: buildStorefrontJsonLd({ storeName, description: 'Desc', url: 'https://suqna.example/acme', logoUrl: null }),
      }}
      signInHref="/acme-org/portal/login"
      labels={{ signIn: 'Sign in', home: 'Home' }}
    />,
  )
}

describe('TEST-004 SSR rendering', () => {
  it('renders the theme variables inside a scoped wrapper with intact CSS', () => {
    const html = render('Acme Store')
    expect(html).toContain(`data-sf-site="${SITE_ID}"`)
    expect(html).toContain('--sf-color-primary:#123abc')
    // Quotes inside the stylesheet must survive (selector and font names).
    expect(html).toContain(`[data-sf-site="${SITE_ID}"]{`)
    expect(html).toMatch(/<h1>Acme Store<\/h1>/)
  })

  it('renders merchant text as text, never as markup', () => {
    const html = render(EVIL)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;/script&gt;')
  })

  it('serialises JSON-LD so it cannot close its script element', () => {
    const serialized = serializeJsonLd(buildStorefrontJsonLd({ storeName: EVIL, description: null, url: 'https://x.example/a', logoUrl: null }))
    expect(serialized).not.toMatch(/[<>&]/)
    expect(JSON.parse(serialized)[0].name).toBe(EVIL)
  })

  it('renders JSON-LD in the page and no duplicate head tags', () => {
    const html = render('Acme Store')
    expect(html).toContain('application/ld+json')
    expect(html).not.toContain('<title>')
    expect(html).not.toContain('rel="canonical"')
  })

  it('builds one canonical, description and Open Graph set as Next metadata', () => {
    const metadata = buildStorefrontMetadata({
      title: 'Acme Store',
      description: 'Desc',
      canonicalUrl: 'https://suqna.example/acme',
      siteName: 'Acme Store',
      imageUrl: 'https://suqna.example/api/storefront/media/acme/x',
      locale: 'en',
      jsonLd: [],
    })
    expect(metadata).toMatchObject({
      title: { absolute: 'Acme Store' },
      description: 'Desc',
      alternates: { canonical: 'https://suqna.example/acme' },
      openGraph: { title: 'Acme Store', url: 'https://suqna.example/acme', siteName: 'Acme Store' },
      twitter: { card: 'summary' },
    })
    expect(buildUnavailableMetadata('Gone').robots).toEqual({ index: false, follow: false })
  })
})
