import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const emitMock = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined)

jest.mock('../../events', () => ({
  emitStorefrontEvent: (...args: unknown[]) => emitMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontPage, StorefrontPageRevision, StorefrontSite } from '../../data/entities'
import { buildDefaultHomeSpec } from '../../lib/blocks/defaultHome'
import { pageStatus } from '../../lib/pages'
import {
  createPageCommand,
  deletePageCommand,
  publishPageCommand,
  rollbackPageCommand,
  updatePageCommand,
  type PageSnapshot,
  type PublishResult,
} from '../pages'

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
type Row = Record<string, unknown>

/** In-memory EntityManager: scoped equality lookups, ordering, counting and transactions. */
function createFakeEm() {
  const tables = new Map<unknown, Row[]>([
    [StorefrontSite, []],
    [StorefrontPage, []],
    [StorefrontPageRevision, []],
    [Attachment, []],
  ])
  const counters = { begin: 0, commit: 0, rollback: 0 }
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key] == null
      if (value && typeof value === 'object' && '$in' in (value as Row)) return (value as { $in: unknown[] }).$in.includes(row[key])
      return row[key] === value
    })
  const em = {
    tables,
    counters,
    fork: () => em,
    async findOne(entity: unknown, where: Row, options?: { orderBy?: Record<string, 'asc' | 'desc'> }) {
      let rows = (tables.get(entity) ?? []).filter((row) => matches(row, where))
      const order = options?.orderBy ? Object.entries(options.orderBy)[0] : null
      if (order) {
        const [key, dir] = order
        rows = [...rows].sort((a, b) => ((a[key] as number) - (b[key] as number)) * (dir === 'desc' ? -1 : 1))
      }
      return rows[0] ?? null
    },
    async find(entity: unknown, where: Row) {
      return (tables.get(entity) ?? []).filter((row) => matches(row, where))
    },
    async count(entity: unknown, where: Row) {
      return (tables.get(entity) ?? []).filter((row) => matches(row, where)).length
    },
    create(entity: { prototype: object }, data: Row) {
      return Object.assign(Object.create(entity.prototype), { id: randomUUID() }, data)
    },
    persist(row: Row) {
      const list = tables.get(row.constructor)!
      if (!list.includes(row)) list.push(row)
    },
    async flush() {},
    isInTransaction: () => false,
    async begin() {
      counters.begin += 1
    },
    async commit() {
      counters.commit += 1
    },
    async rollback() {
      counters.rollback += 1
    },
  }
  return em
}
type FakeEm = ReturnType<typeof createFakeEm>

const tenantA = randomUUID()
const orgA = randomUUID()
const tenantB = randomUUID()
const orgB = randomUUID()

function seedSite(em: FakeEm, tenantId: string, organizationId: string) {
  const site = em.create(StorefrontSite, { tenantId, organizationId, slug: `s-${organizationId.slice(0, 6)}`, name: 'Store', deletedAt: null, firstPublishedAt: new Date() })
  em.persist(site)
  const homeSpec = buildDefaultHomeSpec({ storeName: 'Store' })
  const revisionId = randomUUID()
  const home = em.create(StorefrontPage, {
    tenantId,
    organizationId,
    siteId: site.id,
    slug: 'index',
    title: 'Store',
    seoDescription: null,
    publishedSpec: homeSpec,
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    publishedRevisionId: revisionId,
    draftSpec: null,
    draftUpdatedAt: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
  }) as StorefrontPage
  em.persist(home as unknown as Row)
  em.persist(em.create(StorefrontPageRevision, { id: revisionId, tenantId, organizationId, siteId: site.id, pageId: home.id, revisionNo: 1, spec: homeSpec, title: 'Store', source: 'publish' }))
  return { site: site as StorefrontSite, home }
}

/** Side effects queued on the data engine (flushed by the command bus after commit). */
const indexMarks: Array<{ action: string; identifiers: Record<string, unknown>; indexer?: { entityType: string } }> = []
const fakeDataEngine = {
  markOrmEntityChange: (entry: (typeof indexMarks)[number]) => {
    indexMarks.push(entry)
  },
}

function ctxFor(em: FakeEm, tenantId: string, organizationId: string, headers: Record<string, string> = {}) {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : name === 'dataEngine' ? fakeDataEngine : undefined) },
    auth: { sub: randomUUID(), tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/storefront/pages', { method: 'PUT', headers }),
  } as unknown as CommandRuntimeContext
}

const pages = (em: FakeEm) => em.tables.get(StorefrontPage) as unknown as StorefrontPage[]
const revisions = (em: FakeEm, pageId: string) =>
  (em.tables.get(StorefrontPageRevision) as unknown as StorefrontPageRevision[]).filter((r) => r.pageId === pageId)

async function createPage(em: FakeEm, ctx: CommandRuntimeContext, slug = 'about', title = 'About us') {
  return (await createPageCommand.execute({ title, slug }, ctx)) as PageSnapshot
}

describe('storefront page commands (TEST-017)', () => {
  let em: FakeEm
  let ctx: CommandRuntimeContext
  beforeEach(() => {
    em = createFakeEm()
    seedSite(em, tenantA, orgA)
    ctx = ctxFor(em, tenantA, orgA)
    emitMock.mockClear()
  })

  it('creates a draft page with a starter spec under the site lock and emits after commit', async () => {
    const created = await createPage(em, ctx)
    const page = pages(em).find((p) => p.id === created.id)!
    expect(page.slug).toBe('about')
    expect(pageStatus(page)).toBe('draft')
    expect((page.draftSpec as { elements: Record<string, { type: string }> }).elements.hero.type).toBe('Hero')
    expect(em.counters).toMatchObject({ begin: 1, commit: 1 })
    expect(emitMock).toHaveBeenCalledWith('storefront.page.created', expect.objectContaining({ id: created.id, tenantId: tenantA }), expect.anything())
  })

  it('refreshes the query index entry of the page after every write', async () => {
    indexMarks.length = 0
    const created = await createPage(em, ctx)
    const page = () => pages(em).find((p) => p.id === created.id)!
    const lock = (row: StorefrontPage) => ctxFor(em, tenantA, orgA, { [LOCK_HEADER]: row.updatedAt!.toISOString() })
    await updatePageCommand.execute({ id: created.id, title: 'About the roastery' }, lock(page()))
    await publishPageCommand.execute({ id: created.id }, lock(page()))
    await deletePageCommand.execute({ id: created.id }, lock(page()))
    expect(indexMarks.map((mark) => [mark.action, mark.indexer?.entityType, mark.identifiers])).toEqual([
      ['created', 'storefront:storefront_page', { id: created.id, tenantId: tenantA, organizationId: orgA }],
      ['updated', 'storefront:storefront_page', { id: created.id, tenantId: tenantA, organizationId: orgA }],
      ['updated', 'storefront:storefront_page', { id: created.id, tenantId: tenantA, organizationId: orgA }],
      ['deleted', 'storefront:storefront_page', { id: created.id, tenantId: tenantA, organizationId: orgA }],
    ])
  })

  it('accepts only images uploaded to this store\'s pages, on save, publish and rollback (TEST-017, Phase 3a)', async () => {
    const created = await createPage(em, ctx)
    const attachments = em.tables.get(Attachment)!
    const own = randomUUID()
    const otherEntity = randomUUID()
    const foreign = randomUUID()
    attachments.push(
      { id: own, tenantId: tenantA, organizationId: orgA, entityId: 'storefront:storefront_page', recordId: created.id, mimeType: 'image/png' },
      { id: otherEntity, tenantId: tenantA, organizationId: orgA, entityId: 'customers:customer_person', recordId: randomUUID(), mimeType: 'image/png' },
      { id: foreign, tenantId: tenantB, organizationId: orgB, entityId: 'storefront:storefront_page', recordId: randomUUID(), mimeType: 'image/png' },
    )
    const withImage = (attachmentId: string) => ({
      root: 'page',
      elements: {
        page: { type: 'Page', props: {}, children: ['pic'] },
        pic: { type: 'Image', props: { image: { attachmentId, alt: 'Shop' } }, children: [] },
      },
    })
    for (const id of [otherEntity, foreign, randomUUID()]) {
      await expect(updatePageCommand.execute({ id: created.id, draftSpec: withImage(id) }, ctx)).rejects.toMatchObject({
        status: 422,
        body: { issues: [expect.objectContaining({ path: 'elements.pic.props.image.attachmentId', code: 'unknown_reference' })] },
      })
    }
    await updatePageCommand.execute({ id: created.id, draftSpec: withImage(own) }, ctx)
    const first = (await publishPageCommand.execute({ id: created.id }, ctx)) as PublishResult

    // The file is removed from the attachments library: publishing again or rolling back to it now fails on that prop.
    attachments.splice(attachments.findIndex((row) => row.id === own), 1)
    await updatePageCommand.execute({ id: created.id, title: 'Retitled' }, ctx)
    await expect(publishPageCommand.execute({ id: created.id }, ctx)).rejects.toMatchObject({ status: 422, body: { issues: [expect.objectContaining({ code: 'unknown_reference' })] } })
    await updatePageCommand.execute({ id: created.id, draftSpec: buildDefaultHomeSpec({ storeName: 'Store' }) }, ctx)
    await publishPageCommand.execute({ id: created.id }, ctx)
    await expect(rollbackPageCommand.execute({ id: created.id, revisionId: first.revisionId }, ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: expect.any(String), issues: [expect.objectContaining({ code: 'unknown_reference' })] },
    })
  })

  it('rejects invalid, reserved and taken slugs with a slug field error', async () => {
    await createPage(em, ctx)
    for (const slug of ['About', 'portal', 'index', 'about']) {
      await expect(createPageCommand.execute({ title: 'X', slug }, ctx)).rejects.toMatchObject({
        status: 422,
        body: { fieldErrors: { slug: expect.any(String) } },
      })
    }
  })

  it('caps a store at 30 pages including the home page', async () => {
    for (let i = 1; i < 30; i += 1) await createPage(em, ctx, `page-${i}`, `Page ${i}`)
    await expect(createPage(em, ctx, 'one-too-many')).rejects.toMatchObject({ status: 422, body: { error: 'A store can have at most 30 pages.' } })
  })

  it('validates the draft spec on save and returns path-level issues', async () => {
    const created = await createPage(em, ctx)
    const evil = {
      root: 'page',
      elements: {
        page: { type: 'Page', props: {}, children: ['x'] },
        x: { type: 'Script', props: { src: 'javascript:alert(1)' }, children: [] },
      },
    }
    await expect(updatePageCommand.execute({ id: created.id, draftSpec: evil }, ctx)).rejects.toMatchObject({
      status: 422,
      body: { issues: [expect.objectContaining({ path: 'elements.x.type', code: 'unknown_block' })] },
    })
  })

  it('refuses a stale version with 409', async () => {
    const created = await createPage(em, ctx)
    const stale = ctxFor(em, tenantA, orgA, { [LOCK_HEADER]: '2020-01-01T00:00:00.000Z' })
    await expect(updatePageCommand.prepare!({ id: created.id, title: 'New' }, stale)).rejects.toMatchObject({ status: 409 })
    await expect(updatePageCommand.execute({ id: created.id, title: 'New' }, stale)).rejects.toMatchObject({ status: 409 })
  })

  it('publishes numbered revisions, refuses a no-op publish and freezes the slug', async () => {
    const created = await createPage(em, ctx)
    const first = (await publishPageCommand.execute({ id: created.id }, ctx)) as PublishResult
    expect(first.revisionNo).toBe(1)
    const page = pages(em).find((p) => p.id === created.id)!
    expect(pageStatus(page)).toBe('published')
    expect(page.publishedSpec).toEqual(page.draftSpec)
    await expect(publishPageCommand.execute({ id: created.id }, ctx)).rejects.toMatchObject({ status: 422 })
    await expect(updatePageCommand.execute({ id: created.id, slug: 'renamed' }, ctx)).rejects.toMatchObject({
      status: 422,
      body: { fieldErrors: { slug: 'The address cannot change after the page was published.' } },
    })

    await updatePageCommand.execute({ id: created.id, title: 'About Atlas' }, ctx)
    expect(pageStatus(page)).toBe('changed')
    const second = (await publishPageCommand.execute({ id: created.id }, ctx)) as PublishResult
    expect(second.revisionNo).toBe(2)
    expect(revisions(em, created.id).find((r) => r.revisionNo === 2)!.title).toBe('About Atlas')
    expect(emitMock).toHaveBeenCalledWith('storefront.page.published', expect.objectContaining({ revisionNo: 2 }), expect.anything())
  })

  it('rolls back by appending a copy and resetting the draft, title and status', async () => {
    const created = await createPage(em, ctx)
    const first = (await publishPageCommand.execute({ id: created.id }, ctx)) as PublishResult
    await updatePageCommand.execute({ id: created.id, title: 'Changed title' }, ctx)
    await publishPageCommand.execute({ id: created.id }, ctx)
    await updatePageCommand.execute({ id: created.id, seoDescription: 'unpublished edit' }, ctx)

    const rolled = (await rollbackPageCommand.execute({ id: created.id, revisionId: first.revisionId }, ctx)) as PublishResult
    expect(rolled.revisionNo).toBe(3)
    const third = revisions(em, created.id).find((r) => r.revisionNo === 3)!
    expect(third).toMatchObject({ source: 'rollback', sourceRevisionId: first.revisionId, title: 'About us' })
    const page = pages(em).find((p) => p.id === created.id)!
    expect(page).toMatchObject({ title: 'About us', seoDescription: null, draftUpdatedAt: null })
    expect(pageStatus(page)).toBe('published')

    await expect(rollbackPageCommand.execute({ id: created.id, revisionId: third.id }, ctx)).rejects.toMatchObject({ status: 422 })
    await expect(rollbackPageCommand.execute({ id: created.id, revisionId: randomUUID() }, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('keeps the home page: no delete, no slug change', async () => {
    const home = pages(em).find((p) => p.slug === 'index')!
    await expect(deletePageCommand.execute({ id: home.id }, ctx)).rejects.toMatchObject({ status: 422 })
    await expect(updatePageCommand.execute({ id: home.id, slug: 'home' }, ctx)).rejects.toMatchObject({ status: 422 })
    await expect(updatePageCommand.execute({ id: home.id, slug: 'index', title: 'Home' }, ctx)).resolves.toMatchObject({ slug: 'index' })
  })

  it('undoes an update and a delete, but never moves a published address or reuses a taken slug', async () => {
    const created = await createPage(em, ctx)
    const prepared = await updatePageCommand.prepare!({ id: created.id, slug: 'about-us' }, ctx)
    const updated = (await updatePageCommand.execute({ id: created.id, slug: 'about-us' }, ctx)) as PageSnapshot
    const log = await updatePageCommand.buildLog!({ input: {}, result: updated, snapshots: { before: prepared?.before }, ctx } as never)
    await publishPageCommand.execute({ id: created.id }, ctx)
    await expect(updatePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })).rejects.toMatchObject({ status: 409 })

    const other = await createPage(em, ctx, 'contact', 'Contact')
    const before = await deletePageCommand.prepare!({ id: other.id }, ctx)
    const deleted = (await deletePageCommand.execute({ id: other.id }, ctx)) as PageSnapshot
    const deleteLog = await deletePageCommand.buildLog!({ input: {}, result: deleted, snapshots: { before: before?.before }, ctx } as never)
    await createPage(em, ctx, 'contact', 'Contact again')
    await expect(deletePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: deleteLog?.payload } as never })).rejects.toMatchObject({ status: 409 })

    const third = await createPage(em, ctx, 'faq', 'FAQ')
    const thirdBefore = await deletePageCommand.prepare!({ id: third.id }, ctx)
    const thirdDeleted = (await deletePageCommand.execute({ id: third.id }, ctx)) as PageSnapshot
    const thirdLog = await deletePageCommand.buildLog!({ input: {}, result: thirdDeleted, snapshots: { before: thirdBefore?.before }, ctx } as never)
    await deletePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: thirdLog?.payload } as never })
    expect(pages(em).find((p) => p.id === third.id)!.deletedAt).toBeNull()
  })

  it('undoing a draft save after a publish leaves the page "changed" and publishable', async () => {
    const created = await createPage(em, ctx)
    await publishPageCommand.execute({ id: created.id }, ctx)
    const page = pages(em).find((p) => p.id === created.id)!
    expect(pageStatus(page)).toBe('published')

    const prepared = await updatePageCommand.prepare!({ id: created.id, title: 'Draft B' }, ctx)
    const updated = (await updatePageCommand.execute({ id: created.id, title: 'Draft B' }, ctx)) as PageSnapshot
    const log = await updatePageCommand.buildLog!({ input: {}, result: updated, snapshots: { before: prepared?.before }, ctx } as never)
    await publishPageCommand.execute({ id: created.id }, ctx)
    expect(pageStatus(page)).toBe('published')

    // The snapshot had no unsaved changes, but the live revision is now "Draft B".
    await updatePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })
    expect(page.title).toBe('About us')
    expect(pageStatus(page)).toBe('changed')
    await expect(publishPageCommand.execute({ id: created.id }, ctx)).resolves.toMatchObject({ revisionNo: 3 })
  })

  it('refuses to undo a draft save once someone saved the draft again (409), and changes nothing', async () => {
    const created = await createPage(em, ctx)
    const page = pages(em).find((p) => p.id === created.id)!
    const prepared = await updatePageCommand.prepare!({ id: created.id, title: 'Mine' }, ctx)
    const mine = (await updatePageCommand.execute({ id: created.id, title: 'Mine' }, ctx)) as PageSnapshot
    const log = await updatePageCommand.buildLog!({ input: {}, result: mine, snapshots: { before: prepared?.before }, ctx } as never)
    // Another editor saves later (a different user's log, so the banner still offers mine).
    await updatePageCommand.execute({ id: created.id, title: 'Theirs' }, ctxFor(em, tenantA, orgA))
    page.updatedAt = new Date(page.updatedAt!.getTime() + 1000)
    await expect(updatePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })).rejects.toMatchObject({ status: 409 })
    expect(page.title).toBe('Theirs')
  })

  it('refuses to undo when a later save landed in the same millisecond (equal updated_at)', async () => {
    const created = await createPage(em, ctx)
    const page = pages(em).find((p) => p.id === created.id)!
    const prepared = await updatePageCommand.prepare!({ id: created.id, title: 'Mine' }, ctx)
    const mine = (await updatePageCommand.execute({ id: created.id, title: 'Mine' }, ctx)) as PageSnapshot
    const log = await updatePageCommand.buildLog!({ input: {}, result: mine, snapshots: { before: prepared?.before }, ctx } as never)
    await updatePageCommand.execute({ id: created.id, title: 'Theirs' }, ctxFor(em, tenantA, orgA))
    page.updatedAt = new Date(mine.updatedAt!)
    await expect(updatePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })).rejects.toMatchObject({ status: 409 })
    expect(page.title).toBe('Theirs')
  })

  it('still undoes when the stored draft only differs in key order (jsonb normalises it)', async () => {
    const created = await createPage(em, ctx)
    const page = pages(em).find((p) => p.id === created.id)!
    const prepared = await updatePageCommand.prepare!({ id: created.id, title: 'Mine' }, ctx)
    const mine = (await updatePageCommand.execute({ id: created.id, title: 'Mine' }, ctx)) as PageSnapshot
    const log = await updatePageCommand.buildLog!({ input: {}, result: mine, snapshots: { before: prepared?.before }, ctx } as never)
    const reorder = (value: unknown): unknown =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, reorder(v)]))
        : value
    page.draftSpec = reorder(page.draftSpec) as Record<string, unknown>
    await updatePageCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })
    expect(page.title).toBe('About us')
  })

  it("answers 404 for another tenant's pages and revisions and changes nothing", async () => {
    const { home: foreignHome } = seedSite(em, tenantB, orgB)
    const foreignRevision = revisions(em, foreignHome.id)[0]!
    const created = await createPage(em, ctx)
    await expect(updatePageCommand.execute({ id: foreignHome.id, title: 'Hijack' }, ctx)).rejects.toMatchObject({ status: 404 })
    await expect(publishPageCommand.execute({ id: foreignHome.id }, ctx)).rejects.toMatchObject({ status: 404 })
    await expect(deletePageCommand.execute({ id: foreignHome.id }, ctx)).rejects.toMatchObject({ status: 404 })
    await expect(rollbackPageCommand.execute({ id: created.id, revisionId: foreignRevision.id }, ctx)).rejects.toMatchObject({ status: 404 })
    expect(foreignHome.title).toBe('Store')
  })
})
