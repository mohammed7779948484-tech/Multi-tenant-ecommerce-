"use client"
import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { TagsInput, type TagsInputOption } from '@open-mercato/ui/backend/inputs/TagsInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { productSourceValue } from './blockEditors'

/**
 * Catalog pickers for ProductGrid and CollectionList (spec Phase 3 surfaces).
 * They read the catalog's own staff APIs, so a user without
 * `catalog.products.view` / `catalog.categories.view` sees an inline message
 * instead of options; the server re-checks every saved id against the tenant.
 */

type Translate = ReturnType<typeof useT>

type CategoryRow = { id?: string; name?: string; pathLabel?: string | null }
type ProductRow = { id?: string; title?: string | null; sku?: string | null }

const MAX_ITEMS = 12

function categoryOption(row: CategoryRow): TagsInputOption | null {
  if (typeof row.id !== 'string') return null
  const name = typeof row.name === 'string' && row.name.trim() ? row.name : row.id
  const path = typeof row.pathLabel === 'string' && row.pathLabel.trim() && row.pathLabel !== name ? row.pathLabel : null
  return { value: row.id, label: name, description: path }
}

function productOption(row: ProductRow): TagsInputOption | null {
  if (typeof row.id !== 'string') return null
  const title = typeof row.title === 'string' && row.title.trim() ? row.title : row.id
  return { value: row.id, label: title, description: typeof row.sku === 'string' && row.sku ? row.sku : null }
}

function useCatalogLoaders(t: Translate) {
  const [blocked, setBlocked] = React.useState<string | null>(null)
  const known = React.useRef(new Map<string, TagsInputOption>())
  const [, bump] = React.useReducer((n: number) => n + 1, 0)
  const remember = React.useCallback((options: TagsInputOption[]) => {
    for (const option of options) known.current.set(option.value, option)
    bump()
    return options
  }, [])
  const fail = React.useCallback(
    (err: unknown) => {
      const status = (err as { status?: number } | null)?.status
      setBlocked(
        status === 403
          ? t('storefront.builder.catalog.forbidden', 'You need access to the catalog to choose products and categories.')
          : t('storefront.builder.catalog.loadFailed', 'The catalog could not be loaded. Try again.'),
      )
      return [] as TagsInputOption[]
    },
    [t],
  )

  const loadCategories = React.useCallback(
    async (query?: string, ids?: string[]) => {
      const params = new URLSearchParams({ view: 'manage', pageSize: '100' })
      if (query && query.trim()) params.set('search', query.trim())
      if (ids?.length) params.set('ids', ids.join(','))
      try {
        const payload = await readApiResultOrThrow<{ items?: CategoryRow[] }>(`/api/catalog/categories?${params.toString()}`)
        setBlocked(null)
        return remember((payload.items ?? []).map(categoryOption).filter((option): option is TagsInputOption => option !== null))
      } catch (err) {
        return fail(err)
      }
    },
    [fail, remember],
  )

  const loadProducts = React.useCallback(
    async (query?: string) => {
      const params = new URLSearchParams({ pageSize: '20' })
      if (query && query.trim()) params.set('search', query.trim())
      try {
        const payload = await readApiResultOrThrow<{ items?: ProductRow[] }>(`/api/catalog/products?${params.toString()}`)
        setBlocked(null)
        return remember((payload.items ?? []).map(productOption).filter((option): option is TagsInputOption => option !== null))
      } catch (err) {
        return fail(err)
      }
    },
    [fail, remember],
  )

  /** Names for saved product ids (the products API filters by one `id` at a time). */
  const resolveProducts = React.useCallback(
    async (ids: string[]) => {
      const missing = ids.filter((id) => !known.current.has(id))
      await Promise.all(
        missing.map(async (id) => {
          try {
            const payload = await readApiResultOrThrow<{ items?: ProductRow[] }>(`/api/catalog/products?id=${encodeURIComponent(id)}&pageSize=1`)
            remember((payload.items ?? []).map(productOption).filter((option): option is TagsInputOption => option !== null))
          } catch (err) {
            fail(err)
          }
        }),
      )
    },
    [fail, remember],
  )

  return { blocked, known, loadCategories, loadProducts, resolveProducts }
}

function Blocked({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="text-xs text-muted-foreground">
      {message}
    </p>
  ) : null
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

/** ProductGrid source: one category (with its sub-categories) or hand-picked products. */
export function ProductSourceInput({ id, value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const source = productSourceValue(value)
  const { blocked, known, loadCategories, loadProducts, resolveProducts } = useCatalogLoaders(t)
  const productKey = source.productIds.join(',')

  React.useEffect(() => {
    if (source.kind === 'products' && source.productIds.length) void resolveProducts(source.productIds)
    // productKey stands for the id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, productKey, resolveProducts])

  const fetchCategoryItems = React.useCallback(
    async (query: string): Promise<LookupSelectItem[]> => {
      const options = await loadCategories(query)
      // Keep the saved category listed even when it is not on the first page.
      if (!query.trim() && source.categoryId && !options.some((option) => option.value === source.categoryId)) {
        options.unshift(...(await loadCategories(undefined, [source.categoryId])))
      }
      return options.map((option) => ({ id: option.value, title: option.label, subtitle: option.description ?? null }))
    },
    [loadCategories, source.categoryId],
  )

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        aria-label={t('storefront.builder.fields.productSource', 'Products to show')}
        value={source.kind}
        disabled={disabled}
        onValueChange={(kind) => setValue({ ...source, kind: kind === 'products' ? 'products' : 'category' })}
      >
        <SegmentedControlItem value="category">{t('storefront.builder.productSource.category', 'From a category')}</SegmentedControlItem>
        <SegmentedControlItem value="products">{t('storefront.builder.productSource.products', 'Choose products')}</SegmentedControlItem>
      </SegmentedControl>
      {source.kind === 'category' ? (
        <div className="flex flex-col gap-1" id={id}>
          <LookupSelect
            value={source.categoryId || null}
            onChange={(next) => setValue({ ...source, categoryId: next ?? '' })}
            fetchItems={fetchCategoryItems}
            minQuery={0}
            disabled={disabled}
            searchPlaceholder={t('storefront.builder.catalog.searchCategories', 'Search categories…')}
            emptyLabel={t('storefront.builder.catalog.noCategories', 'No categories found. Add categories in the catalog first.')}
          />
          <p className="text-xs text-muted-foreground">
            {t('storefront.builder.productSource.categoryHint', 'Active products in this category and its sub-categories are shown, in catalog order.')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1" id={id}>
          <TagsInput
            value={source.productIds}
            onChange={(next) => setValue({ ...source, productIds: [...new Set(next)].slice(0, MAX_ITEMS) })}
            loadSuggestions={loadProducts}
            selectedOptions={source.productIds.map((productId) => known.current.get(productId) ?? { value: productId, label: productId })}
            placeholder={t('storefront.builder.catalog.searchProducts', 'Search products…')}
            showSuggestionsOnFocus
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {t('storefront.builder.productSource.productsHint', 'Up to {max} products, shown in this order. Inactive products are skipped.', { max: MAX_ITEMS })}
          </p>
        </div>
      )}
      <Blocked message={blocked} />
    </div>
  )
}

/** CollectionList: the categories to show as cards, in order. */
export function CategoriesInput({ id, value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const ids = asIds(value)
  const { blocked, known, loadCategories } = useCatalogLoaders(t)
  const idKey = ids.join(',')

  React.useEffect(() => {
    const missing = ids.filter((categoryId) => !known.current.has(categoryId))
    if (missing.length) void loadCategories(undefined, missing)
    // idKey stands for the id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, loadCategories])

  return (
    <div className="flex flex-col gap-1" id={id}>
      <TagsInput
        value={ids}
        onChange={(next) => setValue([...new Set(next)].slice(0, MAX_ITEMS))}
        loadSuggestions={(query) => loadCategories(query)}
        selectedOptions={ids.map((categoryId) => known.current.get(categoryId) ?? { value: categoryId, label: categoryId })}
        placeholder={t('storefront.builder.catalog.searchCategories', 'Search categories…')}
        showSuggestionsOnFocus
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        {t('storefront.builder.collections.hint', 'Up to {max} categories, shown in this order. Inactive categories are skipped.', { max: MAX_ITEMS })}
      </p>
      <Blocked message={blocked} />
    </div>
  )
}
