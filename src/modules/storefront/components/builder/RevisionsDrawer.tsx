"use client"
import * as React from 'react'
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

export type RevisionItem = {
  id: string
  revisionNo: number
  source: 'publish' | 'rollback'
  sourceRevisionNo: number | null
  title: string
  createdAt: string
  publishedByUserId: string | null
  isCurrent: boolean
}

type RevisionsResponse = { items: RevisionItem[]; total: number; page: number; pageSize: number; totalPages: number }

export type RevisionsDrawerProps = {
  pageId: string
  open: boolean
  canRestore: boolean
  busy: boolean
  /** Bumps after a publish or restore so an open list refreshes. */
  version: number
  onOpenChange: (open: boolean) => void
  onRestore: (revision: RevisionItem) => void
}

const PAGE_SIZE = 20

export function RevisionsDrawer({ pageId, open, canRestore, busy, version, onOpenChange, onRestore }: RevisionsDrawerProps) {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const [state, setState] = React.useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: RevisionsResponse }
  >({ kind: 'loading' })

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ kind: 'loading' })
    readApiResultOrThrow<RevisionsResponse>(
      `/api/storefront/pages/${encodeURIComponent(pageId)}/revisions?page=${page}&pageSize=${PAGE_SIZE}`,
      undefined,
      { errorMessage: t('storefront.builder.revisions.loadError', 'Revisions could not be loaded.') },
    )
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: error instanceof Error && error.message ? error.message : t('storefront.builder.revisions.loadError', 'Revisions could not be loaded.') })
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, page, pageId, t, version])

  React.useEffect(() => {
    if (open) setPage(1)
  }, [open])

  const data = state.kind === 'ready' ? state.data : null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-lg" closeAriaLabel={t('storefront.builder.revisions.close', 'Close')}>
        <DrawerHeader>
          <DrawerTitle>{t('storefront.builder.revisions.title', 'Revisions')}</DrawerTitle>
          <DrawerDescription>
            {t('storefront.builder.revisions.description', 'Every publish is kept. Restoring publishes a copy of the chosen revision and replaces the current draft.')}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {state.kind === 'loading' ? <LoadingMessage label={t('storefront.builder.revisions.loading', 'Loading revisions…')} /> : null}
          {state.kind === 'error' ? <ErrorMessage label={state.message} /> : null}
          {data && data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('storefront.builder.revisions.empty', 'This page has not been published yet.')}</p>
          ) : null}
          {data && data.items.length ? (
            <ol className="flex flex-col gap-3" aria-label={t('storefront.builder.revisions.title', 'Revisions')}>
              {data.items.map((revision) => (
                <li key={revision.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {t('storefront.builder.revisions.number', 'Revision {n}', { n: revision.revisionNo })}
                    </span>
                    {revision.isCurrent ? (
                      <StatusBadge variant="success" dot>
                        {t('storefront.builder.revisions.current', 'Live')}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <p className="text-sm">{revision.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {revision.source === 'rollback' && revision.sourceRevisionNo != null
                      ? t('storefront.builder.revisions.restoredFrom', 'Restored from revision {n}', { n: revision.sourceRevisionNo })
                      : t('storefront.builder.revisions.published', 'Published')}
                    {' · '}
                    {formatDateTime(revision.createdAt) ?? ''}
                  </p>
                  {canRestore && !revision.isCurrent ? (
                    <div>
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRestore(revision)}>
                        {t('storefront.builder.revisions.restore', 'Restore')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </DrawerBody>
        {data && data.totalPages > 1 ? (
          <DrawerFooter>
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              {t('storefront.builder.revisions.newer', 'Newer')}
            </Button>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {t('storefront.builder.revisions.page', 'Page {page} of {pages}', { page, pages: data.totalPages })}
            </span>
            <Button type="button" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((current) => current + 1)}>
              {t('storefront.builder.revisions.older', 'Older')}
            </Button>
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
