"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { MAX_PAGES_PER_SITE, type PageListItem, type PageStatus } from '../../lib/pages'
import { useStorefrontPermissions } from '../useStorefrontPermissions'
import { TemplateDialog } from './TemplateDialog'
import {
  PAGE_CREATE_HREF,
  PAGE_ENTITY_ID,
  PAGE_STATUS_LABEL_KEYS,
  PAGE_STATUS_VARIANTS,
  PAGES_API_PATH,
  PAGES_TABLE_ID,
  pageBuilderHref,
  pageSettingsHref,
} from './pageClient'

type Translate = ReturnType<typeof useT>

type PagesResponse = {
  items: PageListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE = 50
const STATUSES: PageStatus[] = ['draft', 'published', 'changed']

function statusLabel(t: Translate, status: PageStatus): string {
  const [key, fallback] = PAGE_STATUS_LABEL_KEYS[status]
  return t(key, fallback)
}

function buildColumns(t: Translate): ColumnDef<PageListItem>[] {
  return [
    {
      accessorKey: 'title',
      header: t('storefront.pages.columns.title', 'Title'),
      meta: { priority: 1, truncate: true, maxWidth: '18rem' },
    },
    {
      accessorKey: 'slug',
      header: t('storefront.pages.columns.path', 'Path'),
      meta: { priority: 3, truncate: true, maxWidth: '16rem' },
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.isHome ? '/' : `/${row.original.slug}`}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('storefront.pages.columns.status', 'Status'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => (
        <StatusBadge variant={PAGE_STATUS_VARIANTS[row.original.status]} dot>
          {statusLabel(t, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'publishedAt',
      header: t('storefront.pages.columns.publishedAt', 'Last published'),
      meta: { priority: 4 },
      cell: ({ row }) => formatDateTime(row.original.publishedAt) ?? '—',
    },
    {
      accessorKey: 'updatedAt',
      header: t('storefront.pages.columns.updatedAt', 'Updated'),
      meta: { priority: 5 },
      cell: ({ row }) => formatDateTime(row.original.updatedAt) ?? '—',
    },
  ]
}

export function PagesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { canManagePages } = useStorefrontPermissions()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string }>({
    contextId: PAGES_TABLE_ID,
    blockedMessage: t('storefront.builder.errors.blocked', 'Saving was blocked.'),
  })
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const [page, setPage] = React.useState(1)

  const params = React.useMemo(() => {
    const out: Record<string, string> = {
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'updatedAt',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim()) out.search = search.trim()
    const status = filterValues.status
    if (typeof status === 'string' && (STATUSES as string[]).includes(status)) out.status = status
    return out
  }, [filterValues, page, search, sorting])

  const queryKey = React.useMemo(() => ['storefront-pages', params, scopeVersion] as const, [params, scopeVersion])
  const { data, isLoading, error } = useQuery<PagesResponse>({
    queryKey,
    queryFn: async () => fetchCrudList<PageListItem>(PAGES_API_PATH, params),
  })
  const reload = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['storefront-pages'] })
  }, [queryClient])

  const columns = React.useMemo(() => buildColumns(t), [t])
  const filters = React.useMemo(
    () => [
      {
        id: 'status',
        label: t('storefront.pages.columns.status', 'Status'),
        type: 'select' as const,
        options: STATUSES.map((status) => ({ value: status, label: statusLabel(t, status) })),
      },
    ],
    [t],
  )

  // The list is unfiltered and small (30 pages max), so `total` without a
  // filter is the page count; with a filter the cap hint is not shown.
  const isFiltered = Boolean(params.search || params.status)
  const capReached = !isFiltered && (data?.total ?? 0) >= MAX_PAGES_PER_SITE

  const handleDelete = React.useCallback(
    async (row: PageListItem) => {
      const confirmed = await confirm({
        title: t('storefront.pages.confirmDelete.title', 'Delete “{title}”?', { title: row.title }),
        text: row.status === 'draft'
          ? t('storefront.pages.confirmDelete.draft', 'The draft and its content are removed.')
          : t('storefront.pages.confirmDelete.published', 'The page disappears from your store and its address stops working.'),
        confirmText: t('storefront.pages.actions.delete', 'Delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        // The row's own version: a list loaded before someone else edited the page answers 409.
        await runMutation({
          operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () => deleteCrud(PAGES_API_PATH, row.id)),
          context: { formId: PAGES_TABLE_ID, resourceKind: 'storefront.page', resourceId: row.id },
          mutationPayload: { id: row.id },
        })
        flash(t('storefront.pages.flash.deleted', 'Page deleted.'), 'success')
        reload()
      } catch (err) {
        // The guarded mutation already showed the shared conflict bar.
        if ((err as { status?: number }).status === 409) {
          reload()
          return
        }
        flash(err instanceof Error && err.message ? err.message : t('storefront.pages.errors.delete', 'The page could not be deleted.'), 'error')
      }
    },
    [confirm, reload, runMutation, t],
  )

  const actions = canManagePages ? (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <TemplateDialog onApplied={reload} />
        {capReached ? (
          <Button type="button" disabled aria-describedby="storefront-pages-cap-hint">
            <Plus className="size-4" aria-hidden="true" />
            {t('storefront.pages.actions.create', 'New page')}
          </Button>
        ) : (
          <Button asChild>
            <Link href={PAGE_CREATE_HREF}>
              <Plus className="size-4" aria-hidden="true" />
              {t('storefront.pages.actions.create', 'New page')}
            </Link>
          </Button>
        )}
      </div>
      {capReached ? (
        <span id="storefront-pages-cap-hint" className="text-xs text-muted-foreground">
          {t('storefront.pages.capReached', 'A store can have up to {max} pages. Delete one to add another.', { max: MAX_PAGES_PER_SITE })}
        </span>
      ) : null}
    </div>
  ) : null

  return (
    <>
      <DataTable<PageListItem>
        title={t('storefront.pages.title', 'Pages')}
        titleHeadingLevel={1}
        actions={actions}
        columns={columns}
        data={data?.items ?? []}
        entityId={PAGE_ENTITY_ID}
        extensionTableId={PAGES_TABLE_ID}
        searchValue={search}
        searchPlaceholder={t('storefront.pages.searchPlaceholder', 'Search by title or path')}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => {
          setFilterValues(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        isLoading={isLoading}
        error={error ? t('storefront.pages.errors.load', 'Pages could not be loaded.') : null}
        emptyState={
          isFiltered
            ? t('storefront.pages.emptySearch', 'No pages match your search.')
            : t('storefront.pages.empty', 'No pages yet.')
        }
        onRowClick={(row) => router.push(pageBuilderHref(row.id))}
        rowActions={(row) => {
          const items: RowActionItem[] = [
            { id: 'storefront.pages.edit', label: t('storefront.pages.actions.editContent', 'Edit content'), href: pageBuilderHref(row.id) },
          ]
          if (canManagePages) {
            items.push({ id: 'storefront.pages.settings', label: t('storefront.pages.actions.settings', 'Settings'), href: pageSettingsHref(row.id) })
          }
          if (row.publicPath) {
            items.push({ id: 'storefront.pages.viewLive', label: t('storefront.pages.actions.viewLive', 'View live'), href: row.publicPath })
          }
          if (canManagePages && !row.isHome) {
            items.push({
              id: 'storefront.pages.delete',
              label: t('storefront.pages.actions.delete', 'Delete'),
              destructive: true,
              onSelect: () => {
                void handleDelete(row)
              },
            })
          }
          return <RowActions items={items} />
        }}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          onPageChange: setPage,
        }}
      />
      {ConfirmDialogElement}
    </>
  )
}

export default PagesTable
