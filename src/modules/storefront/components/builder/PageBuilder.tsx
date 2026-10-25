"use client"
import * as React from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, History, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MAX_SECTIONS_PER_PAGE, validatePageSpec, type PageSpecIssue } from '../../lib/blocks/pageSpec'
import type { StorefrontBlockType } from '../../lib/blocks/catalog'
import type { PageListItem, PageStatus } from '../../lib/pages'
import { BRAND_API_PATH, type BrandPayload } from '../brandForm'
import { PAGE_STATUS_LABEL_KEYS, PAGE_STATUS_VARIANTS, PAGES_API_PATH, PAGES_HREF } from '../pages/pageClient'
import { useStorefrontPermissions } from '../useStorefrontPermissions'
import { BLOCK_EDITORS, defaultBlockProps } from './blockEditors'
import { draftToSpec, issueSectionId, moveSection, newSectionId, specToDraft, stableStringify, type BuilderDraft } from './builderSpec'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'
import { RevisionsDrawer, type RevisionItem } from './RevisionsDrawer'
import { SectionInspector } from './SectionInspector'
import { SectionPicker } from './SectionPicker'
import { resolveSectionLabels } from '../public/blocks'
import { usePreviewSectionData } from './usePreviewSectionData'

type Translate = ReturnType<typeof useT>

type Loaded = {
  page: PageListItem
  brand: BrandPayload
}

type PublishResult = { revisionId: string; revisionNo: number; updatedAt: string }

type HttpError = Error & { status?: number; issues?: PageSpecIssue[] }

const MUTATION_CONTEXT_ID = 'storefront-page-builder'

/**
 * json-render loads on demand with the preview, as its own chunk. The app shell
 * references every module's admin pages, so anything this file imports
 * statically can be preloaded on unrelated routes — including public store
 * pages, which must never ship json-render (spec P2-Q12, TEST-012).
 */
const BuilderPreview = React.lazy(() => import('./BuilderPreview').then((module) => ({ default: module.BuilderPreview })))

function blockName(t: Translate, type: StorefrontBlockType): string {
  const [key, fallback] = BLOCK_EDITORS[type].label
  return t(key, fallback)
}

function serialize(draft: BuilderDraft): string {
  return stableStringify(draftToSpec(draft))
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keeps a preview failure (e.g. its chunk failed to load after a deploy) from taking the unsaved draft down with it. */
class PreviewBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Section builder for one page (spec: builder contract). The draft lives in
 * component state until Save draft; Publish saves pending edits first and then
 * publishes with the version the save returned. Every write goes through
 * `useGuardedMutation` with the page's optimistic-lock version; a 409 opens the
 * shared conflict bar.
 */
export function PageBuilder({ pageId }: { pageId: string }) {
  const t = useT()
  const sectionLabels = React.useMemo(() => resolveSectionLabels(t), [t])
  const permissions = useStorefrontPermissions()
  const canEdit = permissions.canManagePages
  const canPublish = permissions.canPublishPages
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('storefront.builder.errors.blocked', 'Saving was blocked.'),
  })

  const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [draft, setDraft] = React.useState<BuilderDraft>({ rootId: 'page', sections: [] })
  const [savedSnapshot, setSavedSnapshot] = React.useState('')
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<PageStatus>('draft')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [revisionsOpen, setRevisionsOpen] = React.useState(false)
  const [revisionsVersion, setRevisionsVersion] = React.useState(0)
  const [serverIssues, setServerIssues] = React.useState<PageSpecIssue[]>([])
  const [busy, setBusy] = React.useState<null | 'saving' | 'publishing' | 'restoring'>(null)
  const [viewport, setViewport] = React.useState<'desktop' | 'phone'>('desktop')
  const [reloadKey, setReloadKey] = React.useState(0)
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const addButtonRef = React.useRef<HTMLButtonElement>(null)
  // After the first load, reloads (after a restore) refresh in place instead of
  // replacing the builder with a loading state.
  const hasLoadedRef = React.useRef(false)
  // Resolves when the in-place reload after a restore has finished (or failed), so the
  // builder stays busy until the restored draft is on screen.
  const reloadDoneRef = React.useRef<(() => void) | null>(null)
  const settleReload = React.useCallback(() => {
    reloadDoneRef.current?.()
    reloadDoneRef.current = null
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const background = hasLoadedRef.current
    if (!UUID_PATTERN.test(pageId)) {
      setLoadState('not-found')
      return
    }
    if (!background) {
      setLoadState('loading')
      setLoadError(null)
    }
    Promise.all([
      fetchCrudList<PageListItem>(PAGES_API_PATH, { id: pageId, pageSize: '1' }),
      readApiResultOrThrow<BrandPayload>(`/api/${BRAND_API_PATH}`),
    ])
      .then(([list, brand]) => {
        if (cancelled) return
        const page = list?.items?.[0]
        if (!page) {
          setLoadState('not-found')
          settleReload()
          return
        }
        const next = specToDraft(page.draftSpec ?? page.publishedSpec)
        setLoaded({ page, brand })
        setDraft(next)
        setSavedSnapshot(serialize(next))
        setUpdatedAt(page.updatedAt)
        setStatus(page.status)
        setServerIssues([])
        setSelectedId((current) => (current && next.sections.some((section) => section.id === current) ? current : next.sections[0]?.id ?? null))
        hasLoadedRef.current = true
        setLoadState('ready')
        settleReload()
      })
      .catch((error: unknown) => {
        if (cancelled) return
        settleReload()
        const message = error instanceof Error && error.message ? error.message : t('storefront.builder.errors.load', 'The page could not be loaded.')
        if (background) {
          // Keep the builder on screen; the user can reload the page.
          flash(message, 'error')
          return
        }
        if ((error as HttpError).status === 404) {
          setLoadState('not-found')
          return
        }
        setLoadError(message)
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [pageId, reloadKey, settleReload, t])

  const spec = React.useMemo(() => draftToSpec(draft), [draft])
  const previewData = usePreviewSectionData(draft.sections)
  // Without catalog access (403) or when loading fails, commerce sections say why instead of looking empty.
  const previewSectionLabels = React.useMemo(() => {
    if (!previewData.problem) return sectionLabels
    const message =
      previewData.problem === 'forbidden'
        ? t('storefront.builder.preview.catalogForbidden', 'Products show here on the live store. You need access to the catalog to preview them.')
        : t('storefront.builder.preview.catalogFailed', 'Products could not be loaded for the preview. Your draft is safe.')
    return { ...sectionLabels, productsEmpty: message, categoriesEmpty: message }
  }, [previewData.problem, sectionLabels, t])
  const dirty = loadState === 'ready' && stableStringify(spec) !== savedSnapshot
  // Validator messages are translation keys; anything else (a raw schema default) gets the generic message.
  const clientIssues = React.useMemo(() => {
    const validation = validatePageSpec(spec)
    if (validation.ok) return []
    return validation.issues.map((issue) => ({
      ...issue,
      message: issue.message.startsWith('storefront.')
        ? t(issue.message, t('storefront.validation.invalidValue', 'Enter a valid value.'))
        : t('storefront.validation.invalidValue', 'Enter a valid value.'),
    }))
  }, [spec, t])
  const issues = clientIssues.length ? clientIssues : serverIssues
  const issueBySection = React.useMemo(() => {
    const map = new Map<string, PageSpecIssue>()
    for (const issue of issues) {
      const id = issueSectionId(issue, draft)
      if (id && !map.has(id)) map.set(id, issue)
    }
    return map
  }, [draft, issues])

  // Unsaved edits: ask before closing the tab, following a link or going back.
  useUnsavedChangesGuard(dirty, () =>
    confirm({
      title: t('storefront.builder.confirmLeave.title', 'Leave without saving?'),
      text: t('storefront.builder.confirmLeave.text', 'Your draft has changes that are not saved yet. They will be lost.'),
      confirmText: t('storefront.builder.confirmLeave.leave', 'Leave'),
      variant: 'destructive',
    }),
  )

  const updateDraft = React.useCallback((next: BuilderDraft) => {
    setDraft(next)
    setServerIssues([])
  }, [])

  const selectedIndex = draft.sections.findIndex((section) => section.id === selectedId)
  const selectedSection = selectedIndex >= 0 ? draft.sections[selectedIndex] : null
  const atCap = draft.sections.length >= MAX_SECTIONS_PER_PAGE
  // Edits pause while a save, publish or restore is in flight, so nothing typed meanwhile is overwritten.
  const editable = canEdit && !busy

  const focusRow = (id: string) => {
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus())
  }

  const addSection = (type: StorefrontBlockType) => {
    if (atCap || !editable) return
    const id = newSectionId(type, [draft.rootId, ...draft.sections.map((section) => section.id)])
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : draft.sections.length
    const sections = [...draft.sections]
    sections.splice(insertAt, 0, { id, type, props: defaultBlockProps(type, t) })
    updateDraft({ ...draft, sections })
    setSelectedId(id)
    setInspectorOpen(true)
  }

  const move = (index: number, delta: -1 | 1) => {
    if (!editable) return
    const sections = moveSection(draft.sections, index, delta)
    if (sections === draft.sections) return
    updateDraft({ ...draft, sections })
    const id = draft.sections[index].id
    setSelectedId(id)
    focusRow(id)
  }

  const remove = async (index: number) => {
    const section = draft.sections[index]
    if (!section || !editable) return
    const ok = await confirm({
      title: t('storefront.builder.confirmRemove.title', 'Remove section {n}?', { n: index + 1 }),
      text: t('storefront.builder.confirmRemove.text', 'The {block} section is removed from the draft. Nothing changes publicly until you publish.', {
        block: blockName(t, section.type),
      }),
      confirmText: t('storefront.builder.actions.remove', 'Remove'),
      variant: 'destructive',
    })
    if (!ok) return
    const sections = draft.sections.filter((_, position) => position !== index)
    updateDraft({ ...draft, sections })
    const next = sections[Math.min(index, sections.length - 1)]
    setSelectedId(next?.id ?? null)
    if (next) focusRow(next.id)
    else requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  const applySection = (sectionId: string, props: Record<string, unknown>) => {
    if (!editable) return
    updateDraft({ ...draft, sections: draft.sections.map((section) => (section.id === sectionId ? { ...section, props } : section)) })
    setInspectorOpen(false)
    focusRow(sectionId)
  }

  const onRowKeyDown = (event: React.KeyboardEvent, index: number) => {
    const section = draft.sections[index]
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? -1 : 1
      if (event.altKey) {
        if (editable) move(index, delta)
        return
      }
      const target = draft.sections[index + delta]
      if (target) {
        setSelectedId(target.id)
        focusRow(target.id)
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      setSelectedId(section.id)
      setInspectorOpen(true)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && editable) {
      event.preventDefault()
      void remove(index)
    }
  }

  const describeError = (error: unknown, fallback: string): string =>
    error instanceof Error && error.message ? error.message : fallback

  /** Saves the draft; resolves to the new version, or null when the save failed (already reported). */
  const saveDraft = async (): Promise<string | null> => {
    if (!loaded) return null
    const payload = { id: pageId, draftSpec: spec }
    try {
      const res = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            updateCrud<{ ok: boolean; updatedAt: string | null }>(PAGES_API_PATH, payload),
          ),
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'storefront.page', resourceId: pageId },
        mutationPayload: payload,
      })
      const nextVersion = res.result?.updatedAt ?? null
      setUpdatedAt(nextVersion)
      setSavedSnapshot(stableStringify(spec))
      setStatus((current) => (current === 'draft' ? 'draft' : 'changed'))
      setServerIssues([])
      return nextVersion
    } catch (error) {
      const httpError = error as HttpError
      if (httpError.status === 409) return null
      if (Array.isArray(httpError.issues) && httpError.issues.length) {
        setServerIssues(httpError.issues)
        const first = issueSectionId(httpError.issues[0], draft)
        if (first) setSelectedId(first)
      }
      flash(describeError(error, t('storefront.builder.errors.save', 'The draft could not be saved.')), 'error')
      return null
    }
  }

  const handleSave = async () => {
    if (busy || !dirty || clientIssues.length) return
    setBusy('saving')
    try {
      const version = await saveDraft()
      if (version !== null) flash(t('storefront.builder.flash.saved', 'Draft saved. Publish to make it public.'), 'success')
    } finally {
      setBusy(null)
    }
  }

  const handlePublish = async () => {
    if (busy || clientIssues.length) return
    setBusy('publishing')
    try {
      let version = updatedAt
      if (dirty) {
        version = await saveDraft()
        if (version === null) return
      }
      const res = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(version), () =>
            apiCallOrThrow<PublishResult>(`/api/storefront/pages/${encodeURIComponent(pageId)}/publish`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            }),
          ),
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'storefront.page', resourceId: pageId },
        mutationPayload: { id: pageId },
      })
      const result = res.result
      if (result) setUpdatedAt(result.updatedAt)
      setStatus('published')
      setServerIssues([])
      // The first publish gives the page a public address.
      setLoaded((current) =>
        current && !current.page.publicPath
          ? { ...current, page: { ...current.page, publicPath: current.page.isHome ? `/${current.brand.slug}` : `/${current.brand.slug}/${current.page.slug}` } }
          : current,
      )
      setRevisionsVersion((current) => current + 1)
      flash(t('storefront.builder.flash.published', 'Published as revision {n}. Your store shows it now.', { n: result?.revisionNo ?? '' }), 'success')
    } catch (error) {
      const httpError = error as HttpError
      if (httpError.status === 409) return
      if (Array.isArray(httpError.issues) && httpError.issues.length) setServerIssues(httpError.issues)
      flash(describeError(error, t('storefront.builder.errors.publish', 'The page could not be published.')), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async (revision: RevisionItem) => {
    if (busy) return
    const replacesDraft = dirty || status === 'changed'
    // The drawer is modal: close it first so the confirmation is the only dialog
    // (otherwise it sits outside the drawer's focus trap and is hidden from screen readers).
    setRevisionsOpen(false)
    const ok = await confirm({
      title: t('storefront.builder.confirmRestore.title', 'Restore revision {n}?', { n: revision.revisionNo }),
      text: replacesDraft
        ? t(
            'storefront.builder.confirmRestore.replaceDraft',
            'This publishes a copy of revision {n} right away and replaces your current draft, including changes that were never published. This cannot be undone.',
            { n: revision.revisionNo },
          )
        : t('storefront.builder.confirmRestore.text', 'This publishes a copy of revision {n} right away.', { n: revision.revisionNo }),
      confirmText: t('storefront.builder.revisions.restore', 'Restore'),
      variant: replacesDraft ? 'destructive' : 'default',
    })
    if (!ok) {
      setRevisionsOpen(true)
      return
    }
    setBusy('restoring')
    try {
      const res = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            apiCallOrThrow<PublishResult>(`/api/storefront/pages/${encodeURIComponent(pageId)}/rollback`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ revisionId: revision.id }),
            }),
          ),
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'storefront.page', resourceId: pageId },
        mutationPayload: { id: pageId, revisionId: revision.id },
      })
      flash(
        t('storefront.builder.flash.restored', 'Revision {from} restored and published as revision {n}.', {
          from: revision.revisionNo,
          n: res.result?.revisionNo ?? '',
        }),
        'success',
      )
      setRevisionsVersion((current) => current + 1)
      // The draft, title and description were reset on the server; refresh them in place and
      // stay busy until that reload lands, so an edit made meanwhile cannot be overwritten by it.
      await new Promise<void>((resolve) => {
        reloadDoneRef.current = resolve
        setReloadKey((current) => current + 1)
      })
    } catch (error) {
      if ((error as HttpError).status === 409) return
      flash(describeError(error, t('storefront.builder.errors.restore', 'The revision could not be restored.')), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (loadState === 'not-found') {
    return (
      <RecordNotFoundState
        label={t('storefront.pages.notFound', 'This page does not exist or was deleted.')}
        backHref={PAGES_HREF}
        backLabel={t('storefront.pages.backToList', 'Back to pages')}
      />
    )
  }
  if (loadState === 'error') {
    return (
      <ErrorMessage
        label={loadError ?? t('storefront.builder.errors.load', 'The page could not be loaded.')}
        action={
          <Button type="button" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>
            {t('storefront.builder.actions.retry', 'Try again')}
          </Button>
        }
      />
    )
  }
  if (loadState === 'loading' || !loaded) return <LoadingMessage label={t('storefront.pages.loading', 'Loading page…')} />

  const { page, brand } = loaded
  const [statusKey, statusFallback] = PAGE_STATUS_LABEL_KEYS[status]
  const canPublishNow = canPublish && (dirty || status !== 'published') && clientIssues.length === 0
  const busyLabel =
    busy === 'saving'
      ? t('storefront.builder.busy.saving', 'Saving…')
      : busy === 'publishing'
        ? t('storefront.builder.busy.publishing', 'Publishing…')
        : busy === 'restoring'
          ? t('storefront.builder.busy.restoring', 'Restoring…')
          : null

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2" aria-busy={busy ? true : undefined}>
      {page.publicPath ? (
        <Button asChild variant="ghost">
          <a href={page.publicPath} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('storefront.pages.actions.viewLive', 'View live')}
          </a>
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={() => setRevisionsOpen(true)}>
        <History className="size-4" aria-hidden="true" />
        {t('storefront.builder.actions.revisions', 'Revisions')}
      </Button>
      {canEdit ? (
        <Button type="button" variant="outline" disabled={Boolean(busy) || !dirty || clientIssues.length > 0} onClick={() => void handleSave()}>
          {busy === 'saving' ? busyLabel : t('storefront.builder.actions.save', 'Save draft')}
        </Button>
      ) : null}
      {canPublish ? (
        <Button type="button" disabled={Boolean(busy) || !canPublishNow} onClick={() => void handlePublish()}>
          {busy === 'publishing' ? busyLabel : t('storefront.builder.actions.publish', 'Publish')}
        </Button>
      ) : null}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        leading={
          <Button asChild variant="ghost" size="sm">
            <Link href={PAGES_HREF}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('storefront.pages.backToList', 'Back to pages')}
            </Link>
          </Button>
        }
        title={page.title}
        titleAction={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={PAGE_STATUS_VARIANTS[status]} dot>
              {t(statusKey, statusFallback)}
            </StatusBadge>
            {dirty ? (
              <StatusBadge variant="info" dot>
                {t('storefront.builder.unsaved', 'Unsaved edits')}
              </StatusBadge>
            ) : null}
          </div>
        }
        actions={headerActions}
      />
      {!canEdit && permissions.loaded ? (
        <p className="text-sm text-muted-foreground">{t('storefront.builder.readOnly', 'You can view this page but not change it.')}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="sf-builder-sections" className="flex flex-col gap-3 lg:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <h2 id="sf-builder-sections" className="text-base font-semibold">
              {t('storefront.builder.sections', 'Sections ({count}/{max})', { count: draft.sections.length, max: MAX_SECTIONS_PER_PAGE })}
            </h2>
          </div>
          {canEdit ? (
            <p id="sf-builder-keys" className="text-xs text-muted-foreground">
              {t('storefront.builder.keyboardHint', 'Arrow keys move between sections, Alt+Arrow reorders, Enter edits, Delete removes.')}
            </p>
          ) : null}
          {draft.sections.length ? (
            <ol className="flex flex-col gap-1" aria-label={t('storefront.builder.sectionList', 'Page sections')}>
              {draft.sections.map((section, index) => {
                const selected = section.id === selectedId
                const issue = issueBySection.get(section.id)
                const name = blockName(t, section.type)
                return (
                  <li
                    key={section.id}
                    className={`flex items-center gap-1 rounded-md border px-1 py-1 ${selected ? 'border-primary bg-accent' : 'border-transparent'}`}
                  >
                    <Button
                      ref={(node) => {
                        if (node) rowRefs.current.set(section.id, node)
                        else rowRefs.current.delete(section.id)
                      }}
                      type="button"
                      variant="ghost"
                      className="min-w-0 flex-1 justify-start"
                      aria-current={selected ? 'true' : undefined}
                      aria-describedby={canEdit ? 'sf-builder-keys' : undefined}
                      tabIndex={selected || (!selectedId && index === 0) ? 0 : -1}
                      onClick={() => setSelectedId(section.id)}
                      onDoubleClick={() => {
                        setSelectedId(section.id)
                        setInspectorOpen(true)
                      }}
                      onKeyDown={(event) => onRowKeyDown(event, index)}
                    >
                      <span className="text-muted-foreground">{index + 1}</span>
                      <span className="truncate">{name}</span>
                      {issue ? (
                        <StatusBadge variant="error" className="ml-auto">
                          {t('storefront.builder.needsFix', 'Needs a fix')}
                        </StatusBadge>
                      ) : null}
                    </Button>
                    {canEdit ? (
                      <>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label={t('storefront.builder.actions.moveUp', 'Move section {n} up', { n: index + 1 })}
                          disabled={!editable || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label={t('storefront.builder.actions.moveDown', 'Move section {n} down', { n: index + 1 })}
                          disabled={!editable || index === draft.sections.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : null}
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={
                        canEdit
                          ? t('storefront.builder.actions.edit', 'Edit section {n}', { n: index + 1 })
                          : t('storefront.builder.actions.view', 'View section {n}', { n: index + 1 })
                      }
                      onClick={() => {
                        setSelectedId(section.id)
                        setInspectorOpen(true)
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </IconButton>
                    {canEdit ? (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={t('storefront.builder.actions.removeSection', 'Remove section {n}', { n: index + 1 })}
                        disabled={!editable}
                        onClick={() => void remove(index)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t('storefront.builder.noSections', 'This page has no sections yet.')}</p>
          )}
          {canEdit ? (
            <div className="flex flex-col items-start gap-1">
              <Button ref={addButtonRef} type="button" variant="outline" disabled={atCap || !editable} aria-describedby={atCap ? 'sf-builder-cap' : undefined} onClick={() => setPickerOpen(true)}>
                <Plus className="size-4" aria-hidden="true" />
                {t('storefront.builder.actions.add', 'Add section')}
              </Button>
              {atCap ? (
                <span id="sf-builder-cap" className="text-xs text-muted-foreground">
                  {t('storefront.builder.capReached', 'A page can have up to {max} sections.', { max: MAX_SECTIONS_PER_PAGE })}
                </span>
              ) : null}
            </div>
          ) : null}

          <div role="status" aria-live="polite" className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <span className="font-medium">{t('storefront.builder.issues.title', 'Issues')}</span>
            {issues.length === 0 ? (
              <span className="text-muted-foreground">{t('storefront.builder.issues.none', 'None. The page is ready to publish.')}</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {issues.slice(0, 10).map((issue, index) => {
                  const sectionId = issueSectionId(issue, draft)
                  const position = sectionId ? draft.sections.findIndex((section) => section.id === sectionId) : -1
                  const where =
                    position >= 0
                      ? t('storefront.builder.issues.section', 'Section {n} · {block}', { n: position + 1, block: blockName(t, draft.sections[position].type) })
                      : t('storefront.builder.issues.page', 'Page')
                  const message = issue.message
                  return (
                    <li key={`${issue.path}-${index}`} className="text-status-error-text">
                      {sectionId ? (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-left text-status-error-text"
                          onClick={() => {
                            setSelectedId(sectionId)
                            setInspectorOpen(true)
                          }}
                        >
                          {where}: {message}
                        </Button>
                      ) : (
                        <span>
                          {where}: {message}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="sf-builder-preview" className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="sf-builder-preview" className="text-base font-semibold">
              {t('storefront.builder.preview', 'Preview')}
            </h2>
            <SegmentedControl
              value={viewport}
              onValueChange={(value) => setViewport(value === 'phone' ? 'phone' : 'desktop')}
              aria-label={t('storefront.builder.viewport', 'Preview width')}
            >
              <SegmentedControlItem value="desktop">{t('storefront.builder.viewportDesktop', 'Desktop')}</SegmentedControlItem>
              <SegmentedControlItem value="phone">{t('storefront.builder.viewportPhone', 'Phone')}</SegmentedControlItem>
            </SegmentedControl>
          </div>
          {draft.sections.length === 0 ? (
            <EmptyState
              title={t('storefront.builder.empty.title', 'Nothing to preview yet')}
              description={t('storefront.builder.empty.description', 'Add a section to start building this page.')}
              actions={
                canEdit ? (
                  <Button type="button" disabled={!editable} onClick={() => setPickerOpen(true)}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t('storefront.builder.actions.add', 'Add section')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div
              role="region"
              aria-label={t('storefront.builder.previewRegion', 'Preview of the draft')}
              className="overflow-hidden rounded-lg border bg-muted/30 p-2"
            >
              {/* `inert`: the preview's links and buttons can be neither focused nor followed (the labelled region stays announced). */}
              <div inert className={`mx-auto overflow-hidden rounded-md ${viewport === 'phone' ? 'max-w-sm' : 'w-full'}`}>
                <PreviewBoundary fallback={<ErrorMessage label={t('storefront.builder.errors.preview', 'The preview could not be loaded. Your draft is safe; reload the page to try again.')} />}>
                  <React.Suspense fallback={<LoadingMessage label={t('storefront.builder.previewLoading', 'Loading preview…')} />}>
                    <BuilderPreview
                      spec={spec}
                      siteId={brand.siteId}
                      storeName={brand.name}
                      basePath={`/${brand.slug}`}
                      logoSrc={brand.logoUrl}
                      tokens={brand.tokens}
                      labels={{
                        home: t('storefront.public.home', '{store} home', { store: brand.name }),
                        unavailable: t('storefront.builder.previewUnavailable', 'Preview unavailable for this section. Open it to fix the highlighted fields.'),
                        sections: previewSectionLabels,
                      }}
                      sectionData={previewData.data}
                    />
                  </React.Suspense>
                </PreviewBoundary>
              </div>
            </div>
          )}
        </section>
      </div>

      <SectionPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={addSection} />
      <SectionInspector
        pageId={pageId}
        section={selectedSection}
        position={selectedIndex}
        open={inspectorOpen}
        readOnly={!editable}
        onOpenChange={(open) => {
          setInspectorOpen(open)
          if (!open && selectedSection) focusRow(selectedSection.id)
        }}
        onApply={applySection}
      />
      <RevisionsDrawer
        pageId={pageId}
        open={revisionsOpen}
        canRestore={canPublish}
        busy={Boolean(busy)}
        version={revisionsVersion}
        onOpenChange={setRevisionsOpen}
        onRestore={(revision) => void handleRestore(revision)}
      />
      {ConfirmDialogElement}
    </div>
  )
}

export default PageBuilder
