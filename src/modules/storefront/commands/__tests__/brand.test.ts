import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const emitMock = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined)

jest.mock('../../events', () => ({
  emitStorefrontEvent: (...args: unknown[]) => emitMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { StorefrontSite, StorefrontTheme } from '../../data/entities'
import { DEFAULT_THEME_TOKENS, THEME_PRESETS, type ThemeTokens } from '../../lib/theme'
import updateBrandCommand, { type BrandSnapshot } from '../brand'

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type Row = Record<string, unknown>

/** Just enough EntityManager for the brand command: scoped lookups, create/persist, transactions. */
function createFakeEm() {
  const tables = new Map<unknown, Row[]>([
    [StorefrontSite, []],
    [StorefrontTheme, []],
    [Attachment, []],
  ])
  const counters = { begin: 0, commit: 0, rollback: 0 }
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => (value === null ? row[key] == null : row[key] === value))
  const em = {
    tables,
    counters,
    fork: () => em,
    async findOne(entity: unknown, where: Row) {
      return (tables.get(entity) ?? []).find((row) => matches(row, where)) ?? null
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
  const site = em.create(StorefrontSite, {
    tenantId,
    organizationId,
    slug: `store-${organizationId.slice(0, 8)}`,
    name: 'Old name',
    description: null,
    logoAttachmentId: null,
    defaultLocale: 'en',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
  }) as StorefrontSite
  em.persist(site as unknown as Row)
  const theme = em.create(StorefrontTheme, {
    tenantId,
    organizationId,
    siteId: site.id,
    tokens: DEFAULT_THEME_TOKENS,
    deletedAt: null,
  })
  em.persist(theme)
  return site
}

function seedAttachment(em: FakeEm, tenantId: string, organizationId: string, mimeType: string) {
  const attachment = em.create(Attachment, { tenantId, organizationId, mimeType })
  em.persist(attachment)
  return attachment.id as string
}

function ctxFor(em: FakeEm, tenantId: string, organizationId: string, headers: Record<string, string> = {}) {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { sub: randomUUID(), tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/storefront/brand', { method: 'PUT', headers }),
  } as unknown as CommandRuntimeContext
}

const midnight: ThemeTokens = { ...DEFAULT_THEME_TOKENS, colors: THEME_PRESETS.midnight!, radius: 'lg' }

function input(siteId: string, overrides: Record<string, unknown> = {}) {
  return { siteId, name: 'New name', description: 'Fresh bread daily', logoAttachmentId: null, tokens: midnight, ...overrides }
}

describe('storefront.brand.update (TEST-005)', () => {
  let em: FakeEm
  beforeEach(() => {
    em = createFakeEm()
    emitMock.mockClear()
  })

  it('updates identity and theme tokens together, bumps the aggregate version and emits after commit', async () => {
    const site = seedSite(em, tenantA, orgA)
    const ctx = ctxFor(em, tenantA, orgA)
    const result = (await updateBrandCommand.execute(input(site.id), ctx)) as BrandSnapshot

    expect(result).toMatchObject({ name: 'New name', description: 'Fresh bread daily', tokens: midnight })
    expect(site.name).toBe('New name')
    expect((em.tables.get(StorefrontTheme)![0] as { tokens: unknown }).tokens).toEqual(midnight)
    expect(site.updatedAt.getTime()).toBeGreaterThan(new Date('2026-10-01T00:00:00Z').getTime())
    expect(em.counters).toEqual({ begin: 1, commit: 1, rollback: 0 })
    expect(emitMock).toHaveBeenCalledWith(
      'storefront.brand.updated',
      expect.objectContaining({ id: site.id, tenantId: tenantA, organizationId: orgA }),
      expect.objectContaining({ persistent: true, tenantId: tenantA, organizationId: orgA }),
    )
  })

  it('rejects a stale version with 409 and accepts the current one', async () => {
    const site = seedSite(em, tenantA, orgA)
    const stale = ctxFor(em, tenantA, orgA, { [LOCK_HEADER]: '2026-09-01T00:00:00.000Z' })
    await expect(updateBrandCommand.prepare!(input(site.id), stale)).rejects.toMatchObject({ status: 409 })

    const current = ctxFor(em, tenantA, orgA, { [LOCK_HEADER]: site.updatedAt.toISOString() })
    const prepared = await updateBrandCommand.prepare!(input(site.id), current)
    expect((prepared?.before as BrandSnapshot).name).toBe('Old name')
  })

  it('re-checks the version under the row lock: a save that passed prepare loses to one committed in between', async () => {
    const site = seedSite(em, tenantA, orgA)
    const loadedVersion = site.updatedAt.toISOString()
    const ctx = ctxFor(em, tenantA, orgA, { [LOCK_HEADER]: loadedVersion })
    await updateBrandCommand.prepare!(input(site.id), ctx)
    // Another tab commits after this request's prepare ran.
    site.updatedAt = new Date(site.updatedAt.getTime() + 1000)
    await expect(updateBrandCommand.execute(input(site.id), ctx)).rejects.toMatchObject({ status: 409 })
    expect(site.name).toBe('Old name')
    expect(em.counters).toEqual({ begin: 1, commit: 0, rollback: 1 })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('undo restores the previous identity and tokens from the logged payload', async () => {
    const site = seedSite(em, tenantA, orgA)
    const ctx = ctxFor(em, tenantA, orgA)
    const prepared = await updateBrandCommand.prepare!(input(site.id), ctx)
    const result = (await updateBrandCommand.execute(input(site.id), ctx)) as BrandSnapshot
    const log = await updateBrandCommand.buildLog!({ input: input(site.id), result, snapshots: { before: prepared?.before }, ctx } as never)
    expect(log?.changes).toMatchObject({ name: { from: 'Old name', to: 'New name' } })

    await updateBrandCommand.undo!({ input: input(site.id), ctx, logEntry: { commandPayload: log?.payload } as never })
    expect(site.name).toBe('Old name')
    expect(site.description).toBeNull()
    expect((em.tables.get(StorefrontTheme)![0] as { tokens: unknown }).tokens).toEqual(DEFAULT_THEME_TOKENS)
  })

  it("answers 404 for another tenant's site and never writes it", async () => {
    const foreign = seedSite(em, tenantB, orgB)
    const ctx = ctxFor(em, tenantA, orgA)
    await expect(updateBrandCommand.prepare!(input(foreign.id), ctx)).rejects.toMatchObject({ status: 404 })
    await expect(updateBrandCommand.execute(input(foreign.id), ctx)).rejects.toMatchObject({ status: 404 })
    expect(foreign.name).toBe('Old name')
  })

  it('refuses an undo snapshot that belongs to another tenant', async () => {
    const foreign = seedSite(em, tenantB, orgB)
    const snapshot: BrandSnapshot = {
      siteId: foreign.id,
      tenantId: tenantB,
      organizationId: orgB,
      name: 'Hijacked',
      description: null,
      logoAttachmentId: null,
      tokens: DEFAULT_THEME_TOKENS,
      updatedAt: null,
    }
    const ctx = ctxFor(em, tenantA, orgA)
    await expect(
      updateBrandCommand.undo!({ input: {}, ctx, logEntry: { commandPayload: { undo: { before: snapshot } } } as never }),
    ).rejects.toMatchObject({ status: 404 })
    expect(foreign.name).toBe('Old name')
  })

  it('accepts a raster logo of the same organization and rejects foreign or SVG logos with a field error', async () => {
    const site = seedSite(em, tenantA, orgA)
    const ctx = ctxFor(em, tenantA, orgA)
    const own = seedAttachment(em, tenantA, orgA, 'image/png')
    const foreign = seedAttachment(em, tenantB, orgB, 'image/png')
    const svg = seedAttachment(em, tenantA, orgA, 'image/svg+xml')

    for (const logoAttachmentId of [foreign, svg, randomUUID()]) {
      await expect(updateBrandCommand.execute(input(site.id, { logoAttachmentId }), ctx)).rejects.toMatchObject({
        status: 422,
        body: { fieldErrors: { logoAttachmentId: expect.any(String) } },
      })
    }
    expect(site.logoAttachmentId).toBeNull()

    await updateBrandCommand.execute(input(site.id, { logoAttachmentId: own }), ctx)
    expect(site.logoAttachmentId).toBe(own)
  })
})
