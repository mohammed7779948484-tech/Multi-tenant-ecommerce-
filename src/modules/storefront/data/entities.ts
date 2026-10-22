import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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
 * A storefront page. The home page (`slug = 'index'`) is seeded at signup;
 * merchants add up to 30 pages. Buyers only ever see the published revision:
 * `published_spec` plus the title/SEO description of `published_revision_id`.
 * `draft_spec`, `title` and `seo_description` are the working copy.
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

  /** The saved working draft; `null` until the first draft save (the builder starts from `published_spec`). */
  @Property({ name: 'draft_spec', type: 'json', nullable: true })
  draftSpec?: Record<string, unknown> | null

  /** Set when the draft spec, title or SEO description is saved; cleared by publish and rollback. */
  @Property({ name: 'draft_updated_at', type: Date, nullable: true })
  draftUpdatedAt?: Date | null

  /** The revision buyers see; non-null once the page was ever published (freezes the slug). */
  @Property({ name: 'published_revision_id', type: 'uuid', nullable: true })
  publishedRevisionId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Append-only publish history of a page. Written by publish and rollback inside
 * the page's row-locked transaction; never updated or deleted, so it carries no
 * `updated_at`/`deleted_at` (exempt from optimistic locking as an audit log).
 */
@Entity({ tableName: 'storefront_page_revisions' })
@Index({ name: 'storefront_page_revisions_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'storefront_page_revisions_page_idx', properties: ['pageId', 'createdAt'] })
@Unique({ name: 'storefront_page_revisions_page_no_uniq', properties: ['pageId', 'revisionNo'] })
export class StorefrontPageRevision {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'site_id', type: 'uuid' })
  siteId!: string

  @Property({ name: 'page_id', type: 'uuid' })
  pageId!: string

  @Property({ name: 'revision_no', type: 'integer' })
  revisionNo!: number

  /** A spec that passed `validatePageSpec` when it was written. */
  @Property({ type: 'json' })
  spec!: Record<string, unknown>

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'seo_description', type: 'text', nullable: true })
  seoDescription?: string | null

  /** `publish` or `rollback`. */
  @Property({ type: 'text' })
  source!: string

  @Property({ name: 'source_revision_id', type: 'uuid', nullable: true })
  sourceRevisionId?: string | null

  @Property({ name: 'published_by_user_id', type: 'uuid', nullable: true })
  publishedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
