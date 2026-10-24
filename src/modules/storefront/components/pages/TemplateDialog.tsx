"use client"
import * as React from 'react'
import { LayoutTemplate } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { PageListItem } from '../../lib/pages'
import { PAGES_API_PATH, PAGES_TABLE_ID } from './pageClient'

/**
 * "Start from a template" (spec Phase 3 surfaces, AC-011): lists the store
 * templates with the pages each drafts, asks before replacing the home page
 * draft, and applies through the guarded mutation with the home page version.
 * The response's `x-om-operation` header feeds the last-operation banner, which
 * offers Undo.
 */

export const TEMPLATES_API_PATH = '/api/storefront/templates'

type TemplateItem = { id: string; name: string; description: string; pages: Array<{ slug: string; title: string }> }
type ApplyResult = { homePageId: string; createdPages: Array<{ id: string; slug: string }>; skippedSlugs: string[]; updatedAt: string }

export function TemplateDialog({ onApplied }: { onApplied: () => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [templates, setTemplates] = React.useState<TemplateItem[]>([])
  const [choice, setChoice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string }>({
    contextId: `${PAGES_TABLE_ID}.templates`,
    blockedMessage: t('storefront.builder.errors.blocked', 'Saving was blocked.'),
  })

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setState('loading')
    readApiResultOrThrow<{ items: TemplateItem[] }>(TEMPLATES_API_PATH)
      .then((payload) => {
        if (cancelled) return
        setTemplates(payload.items)
        setChoice((current) => current || payload.items[0]?.id || '')
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const selected = templates.find((template) => template.id === choice) ?? null

  const apply = React.useCallback(async () => {
    if (!selected || busy) return
    // The template dialog is modal: close it first so the confirmation is the only dialog
    // (otherwise it sits outside the dialog's focus trap and cannot be used). Cancel reopens it.
    setOpen(false)
    const confirmed = await confirm({
      title: t('storefront.templates.confirm.title', 'Apply “{name}”?', { name: selected.name }),
      text: t(
        'storefront.templates.confirm.text',
        'This replaces the home page draft. Existing pages are kept, and nothing is published until you publish it. You can undo this right after.',
      ),
      confirmText: t('storefront.templates.actions.apply', 'Apply template'),
    })
    if (!confirmed) {
      setOpen(true)
      return
    }
    setBusy(true)
    try {
      // The home page's version guards its draft: a home page edited elsewhere answers 409 (shared conflict bar).
      const list = await fetchCrudList<PageListItem>(PAGES_API_PATH, { pageSize: '50' })
      const home = list.items.find((page) => page.isHome)
      if (!home) throw new Error(t('storefront.templates.errors.noHome', 'The home page could not be found. Reload the page and try again.'))
      const call = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(home.updatedAt), () =>
            apiCallOrThrow<ApplyResult>(`${TEMPLATES_API_PATH}/${encodeURIComponent(selected.id)}/apply`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            }),
          ),
        context: { formId: `${PAGES_TABLE_ID}.templates`, resourceKind: 'storefront.page', resourceId: home.id },
        mutationPayload: { templateId: selected.id },
      })
      const result = call.result
      const titleOf = (slug: string) => selected.pages.find((page) => page.slug === slug)?.title ?? slug
      const created = (result?.createdPages ?? []).map((page) => titleOf(page.slug))
      const skipped = (result?.skippedSlugs ?? []).map(titleOf)
      const parts = [t('storefront.templates.flash.applied', 'Template applied. The home page draft was replaced.')]
      if (created.length) parts.push(t('storefront.templates.flash.created', 'New drafts: {pages}.', { pages: created.join(', ') }))
      if (skipped.length) parts.push(t('storefront.templates.flash.skipped', 'Kept your existing pages: {pages}.', { pages: skipped.join(', ') }))
      flash(parts.join(' '), 'success')
      onApplied()
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        // The guarded mutation already showed the shared conflict bar.
        onApplied()
        return
      }
      flash(err instanceof Error && err.message ? err.message : t('storefront.templates.errors.apply', 'The template could not be applied.'), 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, confirm, onApplied, runMutation, selected, t])

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <LayoutTemplate className="size-4" aria-hidden="true" />
        {t('storefront.templates.actions.open', 'Start from a template')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (!busy ? setOpen(next) : undefined)}>
        <DialogContent
          closeAriaLabel={t('storefront.builder.picker.close', 'Close')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              // The confirmation opens during this keydown and listens for Cmd/Ctrl+Enter on
              // window; without this, the same key press would confirm it unseen.
              event.stopPropagation()
              void apply()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('storefront.templates.title', 'Start from a template')}</DialogTitle>
            <DialogDescription>
              {t('storefront.templates.description', 'A template drafts complete pages filled with your store name and categories. Review them, then publish.')}
            </DialogDescription>
          </DialogHeader>
          {state === 'loading' ? <LoadingMessage label={t('storefront.templates.loading', 'Loading templates…')} /> : null}
          {state === 'error' ? <ErrorMessage label={t('storefront.templates.errors.load', 'Templates could not be loaded.')} /> : null}
          {state === 'ready' ? (
            <RadioGroup value={choice} onValueChange={setChoice} aria-label={t('storefront.templates.title', 'Start from a template')} className="flex flex-col gap-3">
              {templates.map((template) => (
                <RadioField
                  key={template.id}
                  value={template.id}
                  disabled={busy}
                  label={template.name}
                  description={
                    <span className="flex flex-col gap-1">
                      <span>{template.description}</span>
                      <span className="text-xs">
                        {t('storefront.templates.pages', 'Pages: {pages}', { pages: template.pages.map((page) => page.title).join(', ') })}
                      </span>
                    </span>
                  }
                  containerClassName="rounded-md border p-3"
                />
              ))}
            </RadioGroup>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t('storefront.builder.picker.cancel', 'Cancel')}
            </Button>
            <Button type="button" disabled={state !== 'ready' || !selected || busy} onClick={() => void apply()}>
              {busy ? t('storefront.templates.applying', 'Applying…') : t('storefront.templates.actions.apply', 'Apply template')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}
