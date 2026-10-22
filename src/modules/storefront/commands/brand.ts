import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorefrontSite, StorefrontTheme } from '../data/entities'
import { brandUpdateCommandSchema } from '../data/validators'
import { emitStorefrontEvent } from '../events'
import { readThemeTokens, type ThemeTokens } from '../lib/theme'
import { isStorefrontLogoMimeType } from '../lib/media'
import { ensureCommandScope, storefrontNotFound, type StorefrontCommandScope } from '../lib/commandScope'

export const BRAND_UPDATE_COMMAND_ID = 'storefront.brand.update'
export const SITE_RESOURCE_KIND = 'storefront.site'

const logger = createLogger('storefront').child({ component: 'brand-command' })

/**
 * Snapshot of the brand aggregate (site identity + theme tokens) used for the
 * audit log and undo. Holds no secrets; every field is merchant-visible.
 */
export type BrandSnapshot = {
  siteId: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  logoAttachmentId: string | null
  tokens: ThemeTokens
  updatedAt: string | null
}

type Scope = StorefrontCommandScope

async function loadAggregate(em: EntityManager, siteId: string, scope: Scope) {
  const site = await em.findOne(StorefrontSite, { id: siteId, ...scope, deletedAt: null })
  if (!site) return null
  const theme = await em.findOne(StorefrontTheme, { siteId: site.id, ...scope, deletedAt: null })
  return { site, theme }
}

function serialize(site: StorefrontSite, theme: StorefrontTheme | null): BrandSnapshot {
  return {
    siteId: site.id,
    tenantId: site.tenantId,
    organizationId: site.organizationId,
    name: site.name,
    description: site.description ?? null,
    logoAttachmentId: site.logoAttachmentId ?? null,
    tokens: readThemeTokens(theme?.tokens),
    updatedAt: site.updatedAt ? site.updatedAt.toISOString() : null,
  }
}

/**
 * A logo must be an image attachment owned by the same tenant and organization.
 * Anything else answers with a field error, never with whether the id exists
 * elsewhere.
 */
async function assertLogoAttachment(em: EntityManager, attachmentId: string, scope: Scope): Promise<void> {
  const attachment = await em.findOne(
    Attachment,
    { id: attachmentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { fields: ['id', 'mimeType'] },
  )
  if (!attachment || !isStorefrontLogoMimeType(attachment.mimeType)) {
    const { translate } = await resolveTranslations()
    const message = translate('storefront.validation.logoInvalid', 'Upload a PNG, JPEG, WebP, GIF or AVIF image.')
    throw new CrudHttpError(422, { error: message, fieldErrors: { logoAttachmentId: message } })
  }
}

function applyTokens(
  em: EntityManager,
  site: StorefrontSite,
  theme: StorefrontTheme | null,
  tokens: ThemeTokens,
  now: Date,
): StorefrontTheme {
  if (theme) {
    theme.tokens = tokens as unknown as Record<string, unknown>
    theme.updatedAt = now
    return theme
  }
  const created = em.create(StorefrontTheme, {
    tenantId: site.tenantId,
    organizationId: site.organizationId,
    siteId: site.id,
    tokens: tokens as unknown as Record<string, unknown>,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(created)
  return created
}

async function emitBrandUpdated(snapshot: BrandSnapshot, ctx: CommandRuntimeContext): Promise<void> {
  try {
    await emitStorefrontEvent(
      'storefront.brand.updated',
      {
        id: snapshot.siteId,
        tenantId: snapshot.tenantId,
        organizationId: snapshot.organizationId,
        userId: ctx.auth?.sub ?? null,
      },
      { persistent: true, tenantId: snapshot.tenantId, organizationId: snapshot.organizationId },
    )
  } catch (err) {
    // The write is committed; a failed emit must not turn a saved brand into an error.
    logger.warn('storefront.brand.updated emit failed', { err, siteId: snapshot.siteId })
  }
}

/**
 * `storefront.brand.update` — updates the store identity (name, description,
 * logo) and the theme tokens as one aggregate. The site row's `updated_at` is
 * the aggregate version: it is bumped on every save, so a stale tab conflicts
 * even when it only changed colours.
 */
const updateBrandCommand: CommandHandler<Record<string, unknown>, BrandSnapshot> = {
  id: BRAND_UPDATE_COMMAND_ID,
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = brandUpdateCommandSchema.parse(rawInput)
    const scope = await ensureCommandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const aggregate = await loadAggregate(em, input.siteId, scope)
    if (!aggregate) throw await storefrontNotFound()
    // Runs before `execute`; a stale `x-om-ext-optimistic-lock-expected-updated-at` header aborts the write.
    enforceCommandOptimisticLock({
      resourceKind: SITE_RESOURCE_KIND,
      resourceId: aggregate.site.id,
      current: aggregate.site.updatedAt ?? null,
      request: ctx.request ?? null,
    })
    return { before: serialize(aggregate.site, aggregate.theme) }
  },
  async execute(rawInput, ctx) {
    const input = brandUpdateCommandSchema.parse(rawInput)
    const scope = await ensureCommandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    if (input.logoAttachmentId) await assertLogoAttachment(em, input.logoAttachmentId, scope)
    let site: StorefrontSite | null = null
    let theme: StorefrontTheme | null = null
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        async () => {
          // Re-read the aggregate root under a row lock inside the transaction and
          // re-check the expected version, so two saves that both passed `prepare`
          // cannot both commit: the second waits for the lock, then gets 409.
          site = await em.findOne(StorefrontSite, { id: input.siteId, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (!site) throw await storefrontNotFound()
          enforceCommandOptimisticLock({
            resourceKind: SITE_RESOURCE_KIND,
            resourceId: site.id,
            current: site.updatedAt ?? null,
            request: ctx.request ?? null,
          })
          theme = await em.findOne(StorefrontTheme, { siteId: site.id, ...scope, deletedAt: null })
        },
        () => {
          const locked = site!
          locked.name = input.name
          locked.description = input.description
          locked.logoAttachmentId = input.logoAttachmentId
          locked.updatedAt = now
          theme = applyTokens(em, locked, theme, input.tokens, now)
        },
      ],
      { transaction: true, label: BRAND_UPDATE_COMMAND_ID },
    )
    const snapshot = serialize(site!, theme)
    await emitBrandUpdated(snapshot, ctx)
    return snapshot
  },
  captureAfter: async (_input, result) => result,
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as BrandSnapshot | undefined
    const flatten = (snapshot: BrandSnapshot) => ({
      name: snapshot.name,
      description: snapshot.description,
      logoAttachmentId: snapshot.logoAttachmentId,
      tokens: JSON.stringify(snapshot.tokens),
    })
    return {
      actionLabel: translate('storefront.audit.brandUpdate', 'Update storefront brand'),
      resourceKind: SITE_RESOURCE_KIND,
      resourceId: result.siteId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      changes: buildChanges(before ? flatten(before) : null, flatten(result), [
        'name',
        'description',
        'logoAttachmentId',
        'tokens',
      ]),
      snapshotBefore: before ?? null,
      snapshotAfter: result,
      payload: { undo: { before: before ?? null, after: result } satisfies UndoPayload<BrandSnapshot> },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<BrandSnapshot>>(logEntry)?.before
    if (!before?.siteId) throw new Error('[internal] Missing previous snapshot for storefront brand undo')
    const scope = await ensureCommandScope(ctx)
    // Undo never crosses scope: the snapshot must belong to the caller's tenant and organization.
    if (before.tenantId !== scope.tenantId || before.organizationId !== scope.organizationId) {
      throw await storefrontNotFound()
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const aggregate = await loadAggregate(em, before.siteId, scope)
    if (!aggregate) throw await storefrontNotFound()
    const { site } = aggregate
    let theme = aggregate.theme
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          site.name = before.name
          site.description = before.description
          site.logoAttachmentId = before.logoAttachmentId
          site.updatedAt = now
          theme = applyTokens(em, site, theme, before.tokens, now)
        },
      ],
      { transaction: true, label: `${BRAND_UPDATE_COMMAND_ID}.undo` },
    )
    await emitBrandUpdated(serialize(site, theme), ctx)
  },
}

registerCommand(updateBrandCommand)

export default updateBrandCommand
