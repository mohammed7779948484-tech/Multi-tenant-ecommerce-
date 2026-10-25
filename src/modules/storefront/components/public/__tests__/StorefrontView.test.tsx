import { describe, expect, it } from '@jest/globals'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StorefrontFrame, StorefrontView } from '../StorefrontView'
import { CollectionPageView, ProductPageView } from '../CatalogViews'
import { buildShopShell } from '../../../lib/shopShell'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import ar from '../../../i18n/ar.json'
import { validatePageSpec } from '../../../lib/blocks/pageSpec'
import { buildDefaultHomeSpec } from '../../../lib/blocks/defaultHome'
import { DEFAULT_THEME_TOKENS } from '../../../lib/theme'
import { buildStorefrontJsonLd, serializeJsonLd } from '../../../lib/structuredData'
import { buildStorefrontMetadata, buildUnavailableMetadata } from '../../../lib/publicMetadata'

const SITE_ID = '3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a'
const EVIL = '</script><script>alert(1)</script><img src=x onerror=alert(2)>'

function shell(storeName: string, footer = false) {
  const dict = ar as Record<string, string>
  return buildShopShell(
    { id: SITE_ID, slug: 'acme', name: storeName, tenantId: 't', organizationId: 'o' },
    [{ href: '/acme/about', label: 'من نحن' }],
    { locale: 'ar', translate: createFallbackTranslator(dict), clientDict: dict },
    { footer, now: new Date('2026-10-25T00:00:00Z') },
  )
}

function render(storeName: string, footer = false) {
  const validation = validatePageSpec(buildDefaultHomeSpec({ storeName }))
  if (!validation.ok) throw new Error('default template invalid')
  return renderToStaticMarkup(
    <StorefrontView
      siteId={SITE_ID}
      siteSlug="acme"
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
      labels={{ home: 'Home' }}
      shell={shell(storeName, footer)}
      sectionLabels={{
        contactAddress: 'Address',
        contactPhone: 'Phone',
        contactEmail: 'Email',
        contactHours: 'Opening hours',
        productsEmpty: 'Products soon',
        categoriesEmpty: 'Collections soon',
      }}
    />,
  )
}

describe('TEST-J02 Arabic store shell', () => {
  it('renders the public page right to left in Arabic with the store menu', () => {
    const html = render('Acme Store')
    expect(html).toMatch(/class="sf-root sf-shop"[^>]*dir="rtl"[^>]*lang="ar"/)
    expect(html).toContain('aria-label="فتح القائمة"')
    expect(html).toContain('href="#sf-main"')
    expect(html).toContain('انتقل إلى المحتوى')
    expect(html).toContain('data-sf-portal=""')
    expect(html).not.toContain('portal/login')
  })

  it('adds the shell footer only when asked (pages without their own Footer section)', () => {
    expect(render('Acme Store')).not.toContain('<footer class="sf-footer sf-shell-footer"')
    const html = render('Acme Store', true)
    expect(html).toContain('<footer class="sf-footer sf-shell-footer"')
    expect(html).toContain('© 2026 Acme Store. جميع الحقوق محفوظة.')
    expect(html).toContain('href="/acme/about"')
  })

  it('wraps product and collection pages in the same Arabic shell, with the shell footer', () => {
    const frame = {
      siteId: SITE_ID,
      siteSlug: 'acme',
      storeName: 'Acme',
      basePath: '/acme',
      logoSrc: null,
      tokens: DEFAULT_THEME_TOKENS,
      labels: { home: 'Home' },
      shell: shell('Acme', true),
      head: { title: 'P', description: null, canonicalUrl: 'https://x.example/acme', siteName: 'Acme', imageUrl: null, locale: 'ar', jsonLd: [] },
    }
    const product = renderToStaticMarkup(
      <ProductPageView {...frame} product={{ title: 'تمر', subtitle: null, description: null, price: null, images: [] }} back={{ href: '/acme/collections/dates', label: 'العودة إلى تمور' }} />,
    )
    expect(product).toMatch(/class="sf-root sf-shop"[^>]*dir="rtl"[^>]*lang="ar"/)
    expect(product).toContain('<footer class="sf-footer sf-shell-footer"')
    expect(product).toContain('العودة إلى تمور')
    const collection = renderToStaticMarkup(
      <CollectionPageView
        {...frame}
        category={{ name: 'تمور', description: null }}
        products={[]}
        emptyLabel="منتجات جديدة في الطريق."
        pagination={{ page: 2, pageCount: 3, previousHref: '/acme/collections/dates', nextHref: '/acme/collections/dates?page=3', label: 'الصفحات', status: 'صفحة 2 من 3', previous: 'السابق', next: 'التالي' }}
      />,
    )
    expect(collection).toContain('صفحة 2 من 3')
    expect(collection).toContain('rel="prev"')
  })

  it('keeps the builder preview bare: no shop marker, menu or buyer dictionary', () => {
    const html = renderToStaticMarkup(
      <StorefrontFrame siteId={SITE_ID} storeName="Acme" basePath="/acme" logoSrc={null} tokens={DEFAULT_THEME_TOKENS} labels={{ home: 'Home' }} preview>
        <p>section</p>
      </StorefrontFrame>,
    )
    expect(html).toContain('class="sf-root"')
    expect(html).not.toContain('class="sf-root sf-shop"')
    expect(html).toContain('dir="rtl"')
    expect(html).not.toContain('data-slot="sheet-trigger"')
  })
})

describe('TEST-004 SSR rendering', () => {
  it('renders the theme variables inside a scoped wrapper with intact CSS', () => {
    const html = render('Acme Store')
    expect(html).toContain(`data-sf-site="${SITE_ID}"`)
    expect(html).toContain('--sf-color-primary:#123abc')
    // Quotes inside the stylesheet must survive (selector and font names).
    expect(html).toContain(`[data-sf-site="${SITE_ID}"],body:has(.sf-shop[data-sf-site="${SITE_ID}"]){`)
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
