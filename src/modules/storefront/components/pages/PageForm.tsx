"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { suggestPageSlug } from '../../lib/slug'
import type { PageListItem, PageStatus } from '../../lib/pages'
import { BRAND_API_PATH, type BrandPayload } from '../brandForm'
import {
  PAGE_ENTITY_ID,
  PAGE_STATUS_LABEL_KEYS,
  PAGE_STATUS_VARIANTS,
  PAGES_API_PATH,
  PAGES_HREF,
  pageBuilderHref,
} from './pageClient'

type Translate = ReturnType<typeof useT>

export type PageFormValues = {
  id?: string
  title: string
  slug: string
  seoDescription: string
  /** Edit mode: CrudForm derives the optimistic-lock header from it for save and delete. */
  updatedAt?: string | null
}

const TITLE_MAX = 70
const SLUG_MAX = 48
const SEO_MAX = 160

/** The store's address, shown before the slug ("/atlas-coffee/"). Optional: the form works without it. */
function useStoreSlug(): string | null {
  const [slug, setSlug] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<BrandPayload>(`/api/${BRAND_API_PATH}`)
      .then((brand) => {
        if (!cancelled && brand?.slug) setSlug(brand.slug)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return slug
}

type SlugInputProps = CrudCustomFieldRenderProps & {
  /** Accessible name: CrudForm's visible label is not tied to custom inputs. */
  name: string
  storeSlug: string | null
  /** Create mode: follow the title until the merchant types a slug. */
  suggestFromTitle: boolean
  frozen: boolean
  t: Translate
}

function SlugInput({ id, value, setValue, values, disabled, error, autoFocus, storeSlug, suggestFromTitle, frozen, name, t }: SlugInputProps) {
  const edited = React.useRef(false)
  const title = typeof values?.title === 'string' ? values.title : ''
  const current = typeof value === 'string' ? value : ''

  React.useEffect(() => {
    if (!suggestFromTitle || edited.current) return
    const suggestion = suggestPageSlug(title)
    if (suggestion !== current) setValue(suggestion)
    // `current` is read only to avoid a redundant write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestFromTitle, title])

  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {storeSlug ? (
          <span className="shrink-0 font-mono text-sm text-muted-foreground" aria-hidden="true">
            /{storeSlug}/
          </span>
        ) : null}
        <Input
          id={id}
          value={current}
          maxLength={SLUG_MAX}
          autoFocus={autoFocus}
          disabled={disabled || frozen}
          aria-label={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={hintId}
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono"
          onChange={(event) => {
            edited.current = true
            setValue(event.target.value.toLowerCase())
          }}
        />
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {frozen
          ? t('storefront.pages.fields.slugFrozen', 'The address cannot change after the page is first published, so links to it keep working.')
          : t('storefront.pages.fields.slugHint', 'Lowercase letters, digits and hyphens. It can change until the page is first published.')}
      </p>
    </div>
  )
}

function usePageFields(t: Translate, options: { storeSlug: string | null; suggestFromTitle: boolean; slugFrozen: boolean }): CrudField[] {
  const { storeSlug, suggestFromTitle, slugFrozen } = options
  return React.useMemo<CrudField[]>(
    () => [
      {
        id: 'title',
        label: t('storefront.pages.fields.title', 'Title'),
        type: 'text',
        required: true,
        maxLength: TITLE_MAX,
        placeholder: t('storefront.pages.fields.titlePlaceholder', 'About us'),
      },
      {
        id: 'slug',
        label: t('storefront.pages.fields.slug', 'Address'),
        type: 'custom',
        required: true,
        component: (props) => (
          <SlugInput {...props} name={t('storefront.pages.fields.slug', 'Address')} storeSlug={storeSlug} suggestFromTitle={suggestFromTitle} frozen={slugFrozen} t={t} />
        ),
      },
      {
        id: 'seoDescription',
        label: t('storefront.pages.fields.seoDescription', 'Search description'),
        type: 'textarea',
        maxLength: SEO_MAX,
        showCount: true,
        description: t('storefront.pages.fields.seoDescriptionHint', 'Shown by search engines and link previews. Leave empty to use the store description.'),
      },
    ],
    [slugFrozen, storeSlug, suggestFromTitle, t],
  )
}

function usePageGroups(t: Translate, extra?: CrudFormGroup): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(
    () => [
      { id: 'page', title: t('storefront.pages.groups.page', 'Page'), column: 1, fields: ['title', 'slug', 'seoDescription'] },
      ...(extra ? [extra] : []),
    ],
    [extra, t],
  )
}

const trimmedOrNull = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length ? text : null
}

export function PageCreateForm() {
  const t = useT()
  const router = useRouter()
  const storeSlug = useStoreSlug()
  const fields = usePageFields(t, { storeSlug, suggestFromTitle: true, slugFrozen: false })
  const groups = usePageGroups(t)

  return (
    <CrudForm<PageFormValues>
      title={t('storefront.pages.create.title', 'New page')}
      titleHeadingLevel={1}
      backHref={PAGES_HREF}
      cancelHref={PAGES_HREF}
      entityId={PAGE_ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={{ title: '', slug: '', seoDescription: '' }}
      submitLabel={t('storefront.pages.create.submit', 'Create page')}
      onSubmit={async (values) => {
        const res = await createCrud<{ id: string }>(PAGES_API_PATH, {
          title: values.title,
          slug: values.slug,
          seoDescription: trimmedOrNull(values.seoDescription),
        })
        const id = res.result?.id
        // New pages open in the builder, where the starter sections are waiting.
        router.push(withFlash(id ? pageBuilderHref(id) : PAGES_HREF, t('storefront.pages.flash.created', 'Page created. Add sections, then publish.'), 'success'))
      }}
    />
  )
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; page: PageListItem }

export function PageSettingsForm({ id }: { id: string }) {
  const t = useT()
  const storeSlug = useStoreSlug()
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setState({ kind: 'not-found' })
      return
    }
    setState({ kind: 'loading' })
    fetchCrudList<PageListItem>(PAGES_API_PATH, { id, pageSize: '1' })
      .then((data) => {
        if (cancelled) return
        const page = data?.items?.[0]
        setState(page ? { kind: 'ready', page } : { kind: 'not-found' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const status = (error as { status?: number }).status
        // A foreign id simply lists nothing; a 400 is a real error (e.g. "select an organization").
        if (status === 404) {
          setState({ kind: 'not-found' })
          return
        }
        setState({ kind: 'error', message: error instanceof Error && error.message ? error.message : t('storefront.pages.errors.loadOne', 'The page could not be loaded.') })
      })
    return () => {
      cancelled = true
    }
  }, [id, t])

  const page = state.kind === 'ready' ? state.page : null
  const slugFrozen = Boolean(page && (page.isHome || page.status !== 'draft'))
  const fields = usePageFields(t, { storeSlug, suggestFromTitle: false, slugFrozen })
  const statusGroup = React.useMemo<CrudFormGroup | undefined>(() => {
    if (!page) return undefined
    const status: PageStatus = page.status
    const [key, fallback] = PAGE_STATUS_LABEL_KEYS[status]
    return {
      id: 'status',
      title: t('storefront.pages.groups.status', 'Status'),
      column: 2,
      component: () => (
        <div className="flex flex-col items-start gap-3">
          <StatusBadge variant={PAGE_STATUS_VARIANTS[status]} dot>
            {t(key, fallback)}
          </StatusBadge>
          <p className="text-sm text-muted-foreground">
            {t('storefront.pages.settings.draftNote', 'Title and search description changes go live with the next publish.')}
          </p>
          <Button asChild variant="outline">
            <Link href={pageBuilderHref(page.id)}>{t('storefront.pages.actions.editContent', 'Edit content')}</Link>
          </Button>
        </div>
      ),
    }
  }, [page, t])
  const groups = usePageGroups(t, statusGroup)
  const successRedirect = React.useMemo(() => withFlash(PAGES_HREF, t('storefront.pages.flash.saved', 'Page settings saved.'), 'success'), [t])
  const deleteRedirect = React.useMemo(() => withFlash(PAGES_HREF, t('storefront.pages.flash.deleted', 'Page deleted.'), 'success'), [t])

  if (state.kind === 'not-found') {
    return (
      <RecordNotFoundState
        label={t('storefront.pages.notFound', 'This page does not exist or was deleted.')}
        backHref={PAGES_HREF}
        backLabel={t('storefront.pages.backToList', 'Back to pages')}
      />
    )
  }
  if (state.kind === 'error') return <ErrorMessage label={state.message} />

  const initialValues: PageFormValues = page
    ? { id: page.id, title: page.title, slug: page.slug, seoDescription: page.seoDescription ?? '', updatedAt: page.updatedAt }
    : { id, title: '', slug: '', seoDescription: '', updatedAt: null }
  const loaded = page

  return (
    <CrudForm<PageFormValues>
      title={page ? t('storefront.pages.settings.title', 'Page settings — {title}', { title: page.title }) : t('storefront.pages.settings.titleLoading', 'Page settings')}
      titleHeadingLevel={1}
      backHref={PAGES_HREF}
      cancelHref={PAGES_HREF}
      entityId={PAGE_ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      isLoading={state.kind === 'loading'}
      loadingMessage={t('storefront.pages.loading', 'Loading page…')}
      submitLabel={t('storefront.pages.settings.submit', 'Save')}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      onSubmit={async (values) => {
        // Strict API: send only the fields this form owns, and the slug only when it changed.
        const payload: Record<string, unknown> = {
          id,
          title: values.title,
          seoDescription: trimmedOrNull(values.seoDescription),
        }
        if (loaded && !slugFrozen && values.slug !== loaded.slug) payload.slug = values.slug
        await updateCrud(PAGES_API_PATH, payload)
      }}
      onDelete={loaded && !loaded.isHome ? async () => { await deleteCrud(PAGES_API_PATH, id) } : undefined}
    />
  )
}
