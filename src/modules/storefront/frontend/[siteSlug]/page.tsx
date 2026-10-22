import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { validatePageSpec } from '../../lib/blocks/pageSpec'
import { buildStorefrontMetadata, buildUnavailableMetadata } from '../../lib/publicMetadata'
import { resolvePublicStorefront, storefrontMediaPath, storefrontPublicUrl } from '../../lib/publicSite'
import { buildStorefrontJsonLd } from '../../lib/structuredData'
import { StorefrontUnavailable, StorefrontView, type StorefrontViewProps } from '../../components/public/StorefrontView'

const logger = createLogger('storefront').child({ component: 'public-page' })

type Params = { siteSlug?: string }

type LoadedStorefront =
  | { kind: 'not-found' }
  | { kind: 'redirect'; slug: string }
  | { kind: 'unavailable'; title: string; message: string }
  | { kind: 'ok'; view: StorefrontViewProps }

/**
 * Server-only load of one store, memoised per request so `generateMetadata`
 * and the page share a single set of reads. Every read after the slug lookup
 * is pinned to the site's own tenant and organization (`resolvePublicStorefront`).
 * The published spec is validated again here: an invalid one is never rendered.
 */
const loadStorefront = cache(async (rawSlug: string): Promise<LoadedStorefront> => {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const resolved = await resolvePublicStorefront(em, rawSlug)
  if (!resolved) return { kind: 'not-found' }
  const { site, tokens, home, organizationSlug } = resolved
  if (rawSlug !== site.slug) return { kind: 'redirect', slug: site.slug }

  const { translate } = await resolveTranslations()
  const validation = home?.publishedSpec ? validatePageSpec(home.publishedSpec) : null
  if (!validation || !validation.ok) {
    logger.error('Published home page failed validation; serving the unavailable page', {
      siteId: site.id,
      issues: validation && !validation.ok ? validation.issues.slice(0, 10) : 'missing',
    })
    return {
      kind: 'unavailable',
      title: translate('storefront.public.unavailableTitle', 'This store is unavailable'),
      message: translate('storefront.public.unavailableMessage', 'Please check back later.'),
    }
  }

  const canonicalUrl = storefrontPublicUrl(site.slug)
  const logoPath = site.logoAttachmentId ? storefrontMediaPath(site.slug, site.logoAttachmentId) : null
  const logoUrl = logoPath ? new URL(logoPath, canonicalUrl).toString() : null
  const description = home?.seoDescription ?? site.description ?? null
  const storeParams = { store: site.name }
  return {
    kind: 'ok',
    view: {
      siteId: site.id,
      storeName: site.name,
      basePath: `/${site.slug}`,
      logoSrc: logoPath,
      tokens,
      sections: validation.sections,
      head: {
        // Phase 1: the home page is titled by the brand's store name, so a rename in
        // the wizard shows at once. Per-page titles arrive with page authoring (Phase 2).
        title: site.name,
        description,
        canonicalUrl,
        siteName: site.name,
        imageUrl: logoUrl,
        locale: site.defaultLocale || 'en',
        jsonLd: buildStorefrontJsonLd({ storeName: site.name, description, url: canonicalUrl, logoUrl }),
      },
      signInHref: organizationSlug ? `/${encodeURIComponent(organizationSlug)}/portal/login` : null,
      labels: {
        signIn: translate('storefront.public.signIn', 'Sign in'),
        home: translate('storefront.public.home', '{store} home', storeParams),
      },
    },
  }
})

async function generateStorefrontMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = await loadStorefront(params.siteSlug ?? '')
  if (loaded.kind === 'ok') return buildStorefrontMetadata(loaded.view.head)
  if (loaded.kind === 'unavailable') return buildUnavailableMetadata(loaded.title)
  return {}
}

export default async function StorefrontHomePage({ params }: { params: Params }) {
  const loaded = await loadStorefront(params.siteSlug ?? '')
  if (loaded.kind === 'not-found') notFound()
  if (loaded.kind === 'redirect') permanentRedirect(`/${loaded.slug}`)
  if (loaded.kind === 'unavailable') return <StorefrontUnavailable title={loaded.title} message={loaded.message} />
  return <StorefrontView {...loaded.view} />
}

/** Read by the frontend catch-all's `generateMetadata` (see docs/UPSTREAM_DIVERGENCES.md). */
StorefrontHomePage.generateMetadata = generateStorefrontMetadata
