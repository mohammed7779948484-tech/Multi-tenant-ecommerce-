import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import { StorefrontPage, StorefrontPageRevision, StorefrontSite } from '../../data/entities'
import { pageCreateSchema, pageUpdateSchema } from '../../data/validators'
import { PAGE_COMMAND_IDS } from '../../commands/pages'
import { resolveStoreOrganizationId } from '../../lib/commandScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { pagePublicPath, pageStatus } from '../../lib/pages'
import { HOME_PAGE_SLUG_VALUE } from '../../lib/slug'
import {
  buildStorefrontCrudOpenApi,
  pageListResponseSchema,
  storefrontErrorSchema,
} from '../openapi'

const ENTITY_ID = 'storefront:storefront_page' as const

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().max(100).optional(),
    status: z.enum(['draft', 'published', 'changed']).optional(),
    sortField: z.string().optional().default('updated_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .passthrough()
type Query = z.infer<typeof querySchema>

/** Bodies pass through to the commands, which parse strictly and answer 422 with field errors. */
const passthroughBody = z.object({}).passthrough()

// `updated_at` is projected because the optimistic-lock round trip needs it.
const baseListFields = [
  'id',
  'slug',
  'title',
  'seo_description',
  'published_at',
  'published_revision_id',
  'draft_updated_at',
  'updated_at',
  'tenant_id',
  'organization_id',
]

// Specs (up to 64 KB each) are projected only for a single-record request — the
// builder's load — never for grid pages.
function isSingleRecordRequest(query: Pick<Query, 'id'>): boolean {
  return typeof query.id === 'string' && query.id.length > 0
}

const sortFieldMap: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  updated_at: 'updated_at',
  updatedAt: 'updated_at',
  published_at: 'published_at',
  publishedAt: 'published_at',
}

type Row = {
  id: string
  slug: string
  title: string
  seo_description?: string | null
  published_at?: Date | string | null
  published_revision_id?: string | null
  draft_updated_at?: Date | string | null
  updated_at?: Date | string | null
  draft_spec?: Record<string, unknown> | null
  published_spec?: Record<string, unknown> | null
}

function toIso(value: unknown): string | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export type PageListItem = {
  id: string
  slug: string
  title: string
  seoDescription: string | null
  status: 'draft' | 'published' | 'changed'
  isHome: boolean
  publicPath: string | null
  publishedAt: string | null
  publishedRevisionNo: number | null
  draftUpdatedAt: string | null
  updatedAt: string | null
  draftSpec?: Record<string, unknown> | null
  publishedSpec?: Record<string, unknown> | null
  /** Internal: resolved to `publishedRevisionNo` in `afterList`, then dropped. */
  publishedRevisionId?: string | null
}

function transformItem(row: Row): PageListItem {
  const draftUpdatedAt = toIso(row.draft_updated_at)
  const item: PageListItem = {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    seoDescription: row.seo_description ?? null,
    status: pageStatus({
      publishedRevisionId: row.published_revision_id ?? null,
      draftUpdatedAt: draftUpdatedAt ? new Date(draftUpdatedAt) : null,
    }),
    isHome: row.slug === HOME_PAGE_SLUG_VALUE,
    publicPath: null,
    publishedAt: toIso(row.published_at),
    publishedRevisionNo: null,
    draftUpdatedAt,
    updatedAt: toIso(row.updated_at),
    publishedRevisionId: row.published_revision_id ?? null,
  }
  if ('draft_spec' in row) item.draftSpec = row.draft_spec ?? null
  if ('published_spec' in row) item.publishedSpec = row.published_spec ?? null
  return item
}

/**
 * Adds each page's public path and live revision number. All pages in one
 * response belong to the caller's single site (the list is scoped to the
 * selected organization), so one site read and one batched revision read suffice.
 */
async function decorateItems(res: { items?: PageListItem[] }, ctx: CrudCtx): Promise<void> {
  const items = Array.isArray(res.items) ? res.items : []
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = await resolveStoreOrganizationId(ctx)
  if (!items.length || !tenantId || !organizationId) {
    items.forEach((item) => delete item.publishedRevisionId)
    return
  }
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const site = await em.findOne(StorefrontSite, { tenantId, organizationId, deletedAt: null }, { fields: ['id', 'slug'] })
  const revisionIds = items.map((item) => item.publishedRevisionId).filter((id): id is string => Boolean(id))
  const revisions = revisionIds.length
    ? await em.find(StorefrontPageRevision, { id: { $in: revisionIds }, tenantId, organizationId }, { fields: ['id', 'revisionNo'] })
    : []
  const revisionNo = new Map(revisions.map((revision) => [revision.id, revision.revisionNo]))
  for (const item of items) {
    item.publishedRevisionNo = item.publishedRevisionId ? revisionNo.get(item.publishedRevisionId) ?? null : null
    item.publicPath = site && item.status !== 'draft' ? pagePublicPath(site.slug, item.slug) : null
    delete item.publishedRevisionId
  }
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['storefront.view'] },
    POST: { requireAuth: true, requireFeatures: ['storefront.pages.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['storefront.pages.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['storefront.pages.manage'] },
  },
  orm: {
    entity: StorefrontPage,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: querySchema,
    entityId: ENTITY_ID,
    fields: (query: Query) => [...baseListFields, ...(isSingleRecordRequest(query) ? ['draft_spec', 'published_spec'] : [])],
    sortFieldMap,
    buildFilters: async (q: Query, ctx): Promise<Where<Row>> => {
      const filters: Where<Row> = {}
      const F = filters as Record<string, WhereValue>
      // A store is one organization: pin the list to it even when the caller's
      // selector says "all organizations" (the factory already pins the tenant).
      const organizationId = await resolveStoreOrganizationId(ctx)
      if (!organizationId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(400, {
          error: translate('storefront.errors.organizationRequired', 'Select a single organization to manage its storefront.'),
        })
      }
      F.organization_id = organizationId
      if (q.id) F.id = q.id
      if (q.ids) {
        const ids = q.ids.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 100)
        if (ids.length) F.id = { $in: ids }
      }
      if (q.search) {
        const pattern = `%${escapeLikePattern(q.search)}%`
        ;(filters as Record<string, unknown>).$or = [{ title: { $ilike: pattern } }, { slug: { $ilike: pattern } }]
      }
      // Publish and rollback clear `draft_updated_at`, so the status is plain column predicates.
      if (q.status === 'draft') F.published_revision_id = null
      if (q.status === 'published') {
        F.published_revision_id = { $ne: null }
        F.draft_updated_at = null
      }
      if (q.status === 'changed') {
        F.published_revision_id = { $ne: null }
        F.draft_updated_at = { $ne: null }
      }
      return filters
    },
    transformItem,
  },
  hooks: {
    afterList: async (res, ctx) => decorateItems(res as { items?: PageListItem[] }, ctx),
  },
  actions: {
    create: {
      commandId: PAGE_COMMAND_IDS.create,
      schema: passthroughBody,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: PAGE_COMMAND_IDS.update,
      schema: passthroughBody,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ ok: true, updatedAt: (result as { updatedAt: string | null }).updatedAt }),
    },
    delete: {
      commandId: PAGE_COMMAND_IDS.delete,
      mapInput: ({ raw }) => {
        const source = raw as { query?: Record<string, unknown>; body?: Record<string, unknown> }
        return { id: source.query?.id ?? source.body?.id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = buildStorefrontCrudOpenApi({
  resourceName: 'Storefront page',
  pluralName: 'Storefront pages',
  description:
    'Pages of the caller\'s store (scope from the session). Writes send the page `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`; a stale value answers 409. Request bodies are strict: unknown keys answer 422.',
  querySchema,
  listResponseSchema: pageListResponseSchema,
  create: {
    schema: pageCreateSchema,
    status: 201,
    description: 'Creates a draft page with a starter spec. 422 for slug rules (`fieldErrors.slug`) or the 30-page cap.',
  },
  update: {
    schema: pageUpdateSchema,
    responseSchema: z.object({ ok: z.literal(true), updatedAt: z.string().nullable() }),
    description:
      'Saves settings and/or the draft spec. `draftSpec` is validated by the page-spec validator: 422 `{ error, fieldErrors, issues: [{ path, code, message }] }`. Slug changes after the first publish answer 422 `slugFrozen`.',
  },
  del: {
    description: 'Soft-deletes a page (`?id=`). The home page cannot be deleted (422).',
    errors: [
      { status: 404, description: 'Not one of the caller\'s pages', schema: storefrontErrorSchema },
      { status: 409, description: 'The page changed since it was loaded', schema: storefrontErrorSchema },
      { status: 422, description: 'Home page', schema: storefrontErrorSchema },
    ],
  },
})
