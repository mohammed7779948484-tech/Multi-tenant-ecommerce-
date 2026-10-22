import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * The storefront of one organization. At most one non-deleted site per
 * (tenant, organization); the slug is the platform-global public path segment.
 * Uniqueness of both lives in the migration as partial unique indexes because
 * soft-deleted rows must not block re-creation.
 */
@Entity({ tableName: 'storefront_sites' })
@Index({ name: 'storefront_sites_scope_idx', properties: ['tenantId', 'organizationId'] })
export class StorefrontSite {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** Scalar id of an `attachments:attachment` row in the same tenant/organization. */
  @Property({ name: 'logo_attachment_id', type: 'uuid', nullable: true })
  logoAttachmentId?: string | null

  @Property({ name: 'default_locale', type: 'text', default: 'en' })
  defaultLocale: string = 'en'

  @Property({ name: 'first_published_at', type: Date, nullable: true })
  firstPublishedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  /** Version of the brand aggregate (site identity + theme tokens). */
  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Theme tokens of a site (1:1). Versioned through the owning site's `updated_at`. */
@Entity({ tableName: 'storefront_themes' })
@Index({ name: 'storefront_themes_scope_idx', properties: ['tenantId', 'organizationId'] })
export class StorefrontTheme {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'site_id', type: 'uuid' })
  siteId!: string

  /** Theme tokens v1 — validated by `themeTokensSchema` on every write and read. */
  @Property({ type: 'json' })
  tokens!: Record<string, unknown>

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A storefront page. Phase 1 only stores the published home page seeded at
 * signup (`slug = 'index'`); drafts and revisions arrive in Phase 2.
 */
@Entity({ tableName: 'storefront_pages' })
@Index({ name: 'storefront_pages_scope_idx', properties: ['tenantId', 'organizationId'] })
export class StorefrontPage {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'site_id', type: 'uuid' })
  siteId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'seo_description', type: 'text', nullable: true })
  seoDescription?: string | null

  /** A page spec `{ root, elements }`; validated on save, publish and render. */
  @Property({ name: 'published_spec', type: 'json', nullable: true })
  publishedSpec?: Record<string, unknown> | null

  @Property({ name: 'published_at', type: Date, nullable: true })
  publishedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
