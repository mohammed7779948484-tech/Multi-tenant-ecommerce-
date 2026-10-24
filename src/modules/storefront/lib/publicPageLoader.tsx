import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveSectionLabels } from '../components/public/blocks'
import { StorefrontUnavailable, StorefrontView, type StorefrontViewProps } from '../components/public/StorefrontView'
import { validatePageSpec } from './blocks/pageSpec'
import { loadSectionData, storeCatalogLinks } from './catalogData'
import { pagePublicPath } from './pages'
import { buildStorefrontMetadata, buildUnavailableMetadata } from './publicMetadata'
import { HOME_PAGE_SLUG, resolvePublicStorefrontPage, storefrontMediaPath, storefrontPublicUrl } from './publicSite'
import { buildStorefrontJsonLd } from './structuredData'

const logger = createLogger('storefront').child({ component: 'public-page' })

export type LoadedStorefrontPage =
  | { kind: 'not-found' }
  | { kind: 'redirect'; path: string }
  | { kind: 'unavailable'; title: string; message: string }
  | { kind: 'ok'; view: StorefrontViewProps }

/**
 * Server-only load of one public page (`rawPageSlug = null` is the home route),
 * memoised per request so `generateMetadata` and the page share one set of reads.
 * Non-canonical paths (mixed case, `/{site}/index`) redirect permanently; a
 * published spec that fails today's validator renders the neutral unavailable page.
 */
export const loadStorefrontPage = cache(async (rawSiteSlug: string, rawPageSlug: string | null): Promise<LoadedStorefrontPage> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const resolved = await resolvePublicStorefrontPage(em, rawSiteSlug, rawPageSlug ?? HOME_PAGE_SLUG)
  if (!resolved) return { kind: 'not-found' }
  const { site, tokens, page, revision, organizationSlug } = resolved
  const unavailable = async (): Promise<LoadedStorefrontPage> => {
    const { translate } = await resolveTranslations()
    return {
      kind: 'unavailable',
      title: translate('storefront.public.unavailableTitle', 'This store is unavailable'),
      message: translate('storefront.public.unavailableMessage', 'Please check back later.'),
    }
  }
  // A live store without its home page (a partial seed that `ensure-sites` repairs) shows the neutral page.
  if (!page) return rawPageSlug === null ? unavailable() : { kind: 'not-found' }
  // Fail closed: without its live revision the page would show the working-copy title and description.
  if (page.publishedRevisionId && !revision) {
    logger.error('Published page has no live revision; serving the unavailable page', { siteId: site.id, pageId: page.id })
    return unavailable()
  }
  const isHome = page.slug === HOME_PAGE_SLUG
  const canonicalPath = pagePublicPath(site.slug, page.slug)
  const requestedPath = rawPageSlug === null ? `/${rawSiteSlug}` : `/${rawSiteSlug}/${rawPageSlug}`
  if (requestedPath !== canonicalPath) return { kind: 'redirect', path: canonicalPath }

  const { translate } = await resolveTranslations()
  const validation = validatePageSpec(page.publishedSpec)
  if (!validation.ok) {
    logger.error('Published page failed validation; serving the unavailable page', {
      siteId: site.id,
      pageId: page.id,
      issues: validation.issues.slice(0, 10),
    })
    return {
      kind: 'unavailable',
      title: translate('storefront.public.unavailableTitle', 'This store is unavailable'),
      message: translate('storefront.public.unavailableMessage', 'Please check back later.'),
    }
  }

  const sectionData = await loadSectionData({ em, container }, { tenantId: site.tenantId, organizationId: site.organizationId }, validation.sections, {
    links: storeCatalogLinks(`/${site.slug}`),
    locale: site.defaultLocale || 'en',
  })
  const storeUrl = storefrontPublicUrl(site.slug)
  const canonicalUrl = storefrontPublicUrl(site.slug, isHome ? '' : `/${page.slug}`)
  const logoPath = site.logoAttachmentId ? storefrontMediaPath(site.slug, site.logoAttachmentId) : null
  const logoUrl = logoPath ? new URL(logoPath, storeUrl).toString() : null
  // Buyers see the live revision's title/description, never the working copy (spec P2-Q13).
  // The home page keeps the store name as its title (docs/DECISIONS.md I4).
  const live = revision ?? { title: page.title, seoDescription: null }
  const title = isHome ? site.name : live.title
  const description = live.seoDescription ?? site.description ?? null
  return {
    kind: 'ok',
    view: {
      siteId: site.id,
      siteSlug: site.slug,
      storeName: site.name,
      basePath: `/${site.slug}`,
      logoSrc: logoPath,
      tokens,
      sections: validation.sections,
      head: {
        title,
        description,
        canonicalUrl,
        siteName: site.name,
        imageUrl: logoUrl,
        locale: site.defaultLocale || 'en',
        jsonLd: buildStorefrontJsonLd({ storeName: site.name, description: site.description ?? null, url: storeUrl, logoUrl }),
      },
      signInHref: organizationSlug ? `/${encodeURIComponent(organizationSlug)}/portal/login` : null,
      labels: {
        signIn: translate('storefront.public.signIn', 'Sign in'),
        home: translate('storefront.public.home', '{store} home', { store: site.name }),
      },
      sectionLabels: resolveSectionLabels(translate),
      sectionData,
    },
  }
})

export async function storefrontPageMetadata(siteSlug: string, pageSlug: string | null): Promise<Metadata> {
  const loaded = await loadStorefrontPage(siteSlug, pageSlug)
  if (loaded.kind === 'ok') return buildStorefrontMetadata(loaded.view.head)
  if (loaded.kind === 'unavailable') return buildUnavailableMetadata(loaded.title)
  return {}
}

export async function renderStorefrontPage(siteSlug: string, pageSlug: string | null) {
  const loaded = await loadStorefrontPage(siteSlug, pageSlug)
  if (loaded.kind === 'not-found') notFound()
  if (loaded.kind === 'redirect') permanentRedirect(loaded.path)
  if (loaded.kind === 'unavailable') return <StorefrontUnavailable title={loaded.title} message={loaded.message} />
  return <StorefrontView {...loaded.view} />
}
