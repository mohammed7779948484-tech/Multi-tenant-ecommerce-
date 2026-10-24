import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const emitMock = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined)

jest.mock('../../events', () => ({
  emitStorefrontEvent: (...args: unknown[]) => emitMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string, params?: Record<string, string>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? `{${name}}`),
  }),
}))
// Catalog reads go through the encryption-aware helpers; the fake EM stores plain rows.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, entity: unknown, where: unknown) => em.find(entity, where),
  findOneWithDecryption: (em: { findOne: (...args: unknown[]) => unknown }, entity: unknown, where: unknown) => em.findOne(entity, where),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct, CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontPage, StorefrontPageRevision, StorefrontSite } from '../../data/entities'
import { buildDefaultHomeSpec } from '../../lib/blocks/defaultHome'
import { validatePageSpec } from '../../lib/blocks/pageSpec'
import { pageStatus } from '../../lib/pages'
import { applyTemplateCommand, type TemplateApplyResult } from '../templates'

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
type Row = Record<string, unknown>

function createFakeEm() {
  const tables = new Map<unknown, Row[]>([
    [StorefrontSite, []],
    [StorefrontPage, []],
    [StorefrontPageRevision, []],
    [CatalogProductCategory, []],
    [CatalogProduct, []],
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
    async findOne(entity: unknown, where: Row) {
      return (tables.get(entity) ?? []).find((row) => matches(row, where)) ?? null
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
const fakeDataEngine = { markOrmEntityChange: () => undefined }

function seed(em: FakeEm, tenantId: string, organizationId: string) {
  const site = em.create(StorefrontSite, { tenantId, organizationId, slug: `s-${organizationId.slice(0, 6)}`, name: 'Atlas Coffee', description: 'Fresh beans from small farms.', deletedAt: null })
  em.persist(site)
  const homeSpec = buildDefaultHomeSpec({ storeName: 'Atlas Coffee' })
  const home = em.create(StorefrontPage, {
    tenantId,
    organizationId,
    siteId: site.id,
    slug: 'index',
    title: 'Atlas Coffee',
    seoDescription: 'Old description',
    publishedSpec: homeSpec,
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    publishedRevisionId: randomUUID(),
    draftSpec: null,
    draftUpdatedAt: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
  }) as StorefrontPage
  em.persist(home as unknown as Row)
  return { site: site as StorefrontSite, home }
}

function addCategory(em: FakeEm, tenantId: string, organizationId: string, name: string, extra: Row = {}) {
  const row = { id: randomUUID(), tenantId, organizationId, name, slug: name.toLowerCase(), parentId: null, isActive: true, deletedAt: null, ...extra }
  em.tables.get(CatalogProductCategory)!.push(row)
  return row.id
}

function ctxFor(em: FakeEm, tenantId: string, organizationId: string, headers: Record<string, string> = {}) {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : name === 'dataEngine' ? fakeDataEngine : undefined) },
    auth: { sub: randomUUID(), tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/storefront/templates/classic/apply', { method: 'POST', headers }),
  } as unknown as CommandRuntimeContext
}

const pages = (em: FakeEm) => em.tables.get(StorefrontPage) as unknown as StorefrontPage[]
const lockFor = (em: FakeEm, page: StorefrontPage, tenantId = tenantA, organizationId = orgA) =>
  ctxFor(em, tenantId, organizationId, { [LOCK_HEADER]: page.updatedAt!.toISOString() })

async function apply(em: FakeEm, home: StorefrontPage, templateId = 'classic') {
  const ctx = lockFor(em, home)
  const result = (await applyTemplateCommand.execute({ templateId }, ctx)) as TemplateApplyResult
  const log = await applyTemplateCommand.buildLog!({ input: { templateId }, result, ctx, snapshots: {} } as never)
  return { result, log, ctx }
}

const undo = (log: { payload?: unknown } | null | undefined, ctx: CommandRuntimeContext) =>
  applyTemplateCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })

describe('storefront.templates.apply (TEST-021)', () => {
  let em: FakeEm
  let home: StorefrontPage
  beforeEach(() => {
    em = createFakeEm()
    home = seed(em, tenantA, orgA).home
    emitMock.mockClear()
  })

  it('replaces the home draft and creates the other pages as drafts, filled with store data; nothing is published', async () => {
    const beans = addCategory(em, tenantA, orgA, 'Beans')
    const tea = addCategory(em, tenantA, orgA, 'Tea')
    addCategory(em, tenantA, orgA, 'Hidden', { isActive: false })
    addCategory(em, tenantA, orgA, 'Child', { parentId: beans })
    addCategory(em, tenantB, orgB, 'Foreign')
    const { result } = await apply(em, home)

    expect(result.createdPages.map((page) => page.slug).sort()).toEqual(['about', 'contact', 'faq'])
    expect(result.skippedSlugs).toEqual([])
    const homeSpec = home.draftSpec as { elements: Record<string, { type: string; props: Record<string, unknown> }> }
    expect(validatePageSpec(homeSpec).ok).toBe(true)
    expect(homeSpec.elements.hero.props.heading).toBe('Atlas Coffee')
    expect(homeSpec.elements.hero.props.subheading).toBe('Fresh beans from small farms.')
    expect(homeSpec.elements.products.props.source).toEqual({ kind: 'category', categoryId: beans })
    expect(homeSpec.elements.collections.props.categoryIds).toEqual([beans, tea])
    // The published page and its revision are untouched; the home page now reads "changed".
    expect(home.publishedSpec).toEqual(buildDefaultHomeSpec({ storeName: 'Atlas Coffee' }))
    expect(pageStatus(home)).toBe('changed')
    for (const created of result.createdPages) {
      const page = pages(em).find((row) => row.id === created.id)!
      expect(pageStatus(page)).toBe('draft')
      expect(page.publishedSpec).toBeNull()
      expect(validatePageSpec(page.draftSpec).ok).toBe(true)
    }
    expect(em.counters).toMatchObject({ begin: 1, commit: 1, rollback: 0 })
    expect(emitMock).toHaveBeenCalledWith(
      'storefront.template.applied',
      expect.objectContaining({ tenantId: tenantA, organizationId: orgA, templateId: 'classic', pageIds: [home.id, ...result.createdPages.map((page) => page.id)] }),
      expect.anything(),
    )
  })

  it('swaps product sections for a contact call to action when the store has no categories', async () => {
    await apply(em, home, 'showcase')
    const elements = Object.values((home.draftSpec as { elements: Record<string, { type: string }> }).elements).map((element) => element.type)
    expect(elements).not.toContain('ProductGrid')
    expect(elements).not.toContain('CollectionList')
    expect(elements).toContain('CallToAction')
  })

  it('skips template pages whose slug is taken and keeps those pages as they are', async () => {
    const about = em.create(StorefrontPage, { tenantId: tenantA, organizationId: orgA, siteId: home.siteId, slug: 'about', title: 'Our story', draftSpec: null, publishedRevisionId: null, deletedAt: null, updatedAt: new Date() }) as StorefrontPage
    em.persist(about as unknown as Row)
    const { result } = await apply(em, home)
    expect(result.skippedSlugs).toEqual(['about'])
    expect(result.createdPages.map((page) => page.slug).sort()).toEqual(['contact', 'faq'])
    expect(about.title).toBe('Our story')
  })

  it('refuses a stale home version (409) and the 30-page cap (422) without writing anything', async () => {
    await expect(applyTemplateCommand.execute({ templateId: 'classic' }, ctxFor(em, tenantA, orgA, { [LOCK_HEADER]: '2020-01-01T00:00:00.000Z' }))).rejects.toMatchObject({ status: 409 })
    for (let index = 0; index < 28; index += 1) {
      em.persist(em.create(StorefrontPage, { tenantId: tenantA, organizationId: orgA, siteId: home.siteId, slug: `p-${index}`, title: 'x', deletedAt: null }) as unknown as Row)
    }
    await expect(applyTemplateCommand.execute({ templateId: 'classic' }, lockFor(em, home))).rejects.toMatchObject({ status: 422 })
    expect(home.draftSpec).toBeNull()
    expect(pages(em).filter((page) => ['about', 'faq', 'contact'].includes(page.slug))).toEqual([])
    await expect(applyTemplateCommand.execute({ templateId: 'unknown' }, lockFor(em, home))).rejects.toMatchObject({ status: 422 })
  })

  it('works in the caller\'s own store only', async () => {
    const other = seed(em, tenantB, orgB).home
    addCategory(em, tenantA, orgA, 'Beans')
    await applyTemplateCommand.execute({ templateId: 'classic' }, lockFor(em, other, tenantB, orgB))
    expect(home.draftSpec).toBeNull()
    expect(pages(em).filter((page) => page.tenantId === tenantA).map((page) => page.slug)).toEqual(['index'])
    // B's store has no categories of its own, so A's category never appears in B's pages.
    expect(JSON.stringify(other.draftSpec)).not.toContain('Beans')
  })

  it('undo restores the home draft and removes the created pages', async () => {
    const { result, log, ctx } = await apply(em, home)
    await undo(log, ctx)
    expect(home.draftSpec).toBeNull()
    expect(home.title).toBe('Atlas Coffee')
    expect(home.seoDescription).toBe('Old description')
    expect(home.draftUpdatedAt).toBeNull()
    expect(pageStatus(home)).toBe('published')
    for (const created of result.createdPages) expect(pages(em).find((page) => page.id === created.id)!.deletedAt).toBeInstanceOf(Date)
  })

  it('undo refuses with 409 and reverts nothing once any template page changed', async () => {
    const { result, log, ctx } = await apply(em, home)
    const faq = pages(em).find((page) => page.id === result.createdPages.find((entry) => entry.slug === 'faq')!.id)!
    faq.updatedAt = new Date(faq.updatedAt!.getTime() + 1000)
    const draftAfterApply = home.draftSpec
    await expect(undo(log, ctx)).rejects.toMatchObject({ status: 409 })
    expect(home.draftSpec).toBe(draftAfterApply)
    expect(pages(em).filter((page) => result.createdPages.some((entry) => entry.id === page.id)).every((page) => !page.deletedAt)).toBe(true)
  })

  it('undo from another tenant answers 404', async () => {
    const { log } = await apply(em, home)
    seed(em, tenantB, orgB)
    await expect(undo(log, ctxFor(em, tenantB, orgB))).rejects.toMatchObject({ status: 404 })
  })
})
