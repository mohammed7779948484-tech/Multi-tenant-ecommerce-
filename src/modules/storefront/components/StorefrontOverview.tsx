"use client"
import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, Palette } from 'lucide-react'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { COLOR_TOKEN_KEYS } from '../lib/theme'
import { BRAND_API_PATH, BRAND_HREF, type BrandPayload } from './brandForm'

type FeatureCheckResponse = { ok: boolean }

/** Server authorization stays authoritative; this only hides an action the caller cannot use. */
function useCanManageBrand(): boolean {
  const [allowed, setAllowed] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    void apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: ['storefront.brand.manage'] }),
    })
      .then((res) => {
        if (!cancelled) setAllowed(Boolean(res.ok && res.result?.ok))
      })
      .catch(() => {
        if (!cancelled) setAllowed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return allowed
}

export function StorefrontOverview() {
  const t = useT()
  const canManage = useCanManageBrand()
  const [brand, setBrand] = React.useState<BrandPayload | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<BrandPayload>(`/api/${BRAND_API_PATH}`, undefined, {
      errorMessage: t('storefront.errors.load', 'The storefront could not be loaded.'),
    })
      .then((payload) => {
        if (cancelled) return
        setBrand(payload)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if ((err as { status?: number }).status === 404) {
          setState('missing')
          return
        }
        setError(err instanceof Error && err.message ? err.message : t('storefront.errors.load', 'The storefront could not be loaded.'))
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const actions = brand ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline">
        <a href={brand.publicUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-4" aria-hidden="true" />
          {t('storefront.actions.viewStore', 'View store')}
        </a>
      </Button>
      {canManage ? (
        <Button asChild>
          <Link href={BRAND_HREF}>
            <Palette className="size-4" aria-hidden="true" />
            {t('storefront.actions.editBrand', 'Edit brand')}
          </Link>
        </Button>
      ) : null}
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('storefront.overview.title', 'Storefront')}
        description={t('storefront.overview.description', 'Your public store and how it looks.')}
        actions={actions}
      />
      {state === 'loading' ? <LoadingMessage label={t('storefront.overview.loading', 'Loading storefront…')} /> : null}
      {state === 'error' && error ? <ErrorMessage label={error} /> : null}
      {state === 'missing' ? (
        <EmptyState
          title={t('storefront.overview.missingTitle', 'No storefront yet')}
          description={t('storefront.overview.missing', 'This organization has no storefront yet. An operator can create it with: yarn mercato storefront ensure-sites')}
        />
      ) : null}
      {state === 'ready' && brand ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="storefront-overview-store">
            <SectionHeader title={t('storefront.overview.store', 'Store')} />
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 sm:gap-y-2">
              <dt className="text-muted-foreground">{t('storefront.brand.fields.name', 'Store name')}</dt>
              <dd className="sm:col-span-2" id="storefront-overview-store">{brand.name}</dd>
              <dt className="text-muted-foreground">{t('storefront.overview.address', 'Public address')}</dt>
              <dd className="sm:col-span-2 break-all">
                <a className="underline underline-offset-4" href={brand.publicUrl} target="_blank" rel="noopener noreferrer">
                  {brand.publicUrl}
                </a>
              </dd>
              <dt className="text-muted-foreground">{t('storefront.brand.fields.description', 'Short description')}</dt>
              <dd className="sm:col-span-2">{brand.description ?? t('storefront.overview.noDescription', 'Not set')}</dd>
              <dt className="text-muted-foreground">{t('storefront.brand.fields.logo', 'Logo')}</dt>
              <dd className="sm:col-span-2">{brand.logoAttachmentId ? t('storefront.overview.logoSet', 'Uploaded') : t('storefront.overview.logoMissing', 'Store name shown instead')}</dd>
            </dl>
          </section>
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <SectionHeader title={t('storefront.overview.theme', 'Theme')} />
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('storefront.overview.palette', 'Colour palette')}>
              {COLOR_TOKEN_KEYS.map((key) => (
                <li key={key} className="flex items-center gap-2 text-xs">
                  {/* Merchant data, validated as #rrggbb by the API; shown only as a swatch. */}
                  <span className="size-5 shrink-0 rounded border" style={{ backgroundColor: brand.tokens.colors[key] }} aria-hidden="true" />
                  <span className="truncate">{t(`storefront.brand.colors.${key}`, key)}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 sm:gap-y-2">
              <dt className="text-muted-foreground">{t('storefront.brand.fields.headingFont', 'Heading font')}</dt>
              <dd className="sm:col-span-2">{t(`storefront.fonts.${brand.tokens.fonts.heading}`, brand.tokens.fonts.heading)}</dd>
              <dt className="text-muted-foreground">{t('storefront.brand.fields.bodyFont', 'Body font')}</dt>
              <dd className="sm:col-span-2">{t(`storefront.fonts.${brand.tokens.fonts.body}`, brand.tokens.fonts.body)}</dd>
              <dt className="text-muted-foreground">{t('storefront.brand.fields.radius', 'Corner radius')}</dt>
              <dd className="sm:col-span-2">{t(`storefront.radius.${brand.tokens.radius}`, brand.tokens.radius)}</dd>
              <dt className="text-muted-foreground">{t('storefront.brand.fields.density', 'Spacing')}</dt>
              <dd className="sm:col-span-2">{t(`storefront.density.${brand.tokens.density}`, brand.tokens.density)}</dd>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default StorefrontOverview
