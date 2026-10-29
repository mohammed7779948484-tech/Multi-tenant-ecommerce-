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

/**
 * A buyer's cart in one store (shopping-journey spec, Data Models). Anonymous:
 * the browser holds a random per-store token in an HttpOnly cookie and only its
 * SHA-256 lands here. Lines hold ids, quantities and personalization; prices and
 * stock are computed on every read, never stored. Scope always comes from the
 * store row resolved by slug.
 */
@Entity({ tableName: 'storefront_carts' })
@Index({ name: 'storefront_carts_scope_idx', properties: ['tenantId', 'organizationId', 'siteId'] })
@Index({ name: 'storefront_carts_site_status_idx', properties: ['siteId', 'status'] })
@Index({ name: 'storefront_carts_expires_idx', properties: ['siteId', 'expiresAt'] })
@Unique({ name: 'storefront_carts_token_hash_uniq', properties: ['tokenHash'] })
export class StorefrontCart {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'site_id', type: 'uuid' })
  siteId!: string

  /** SHA-256 (hex) of the 256-bit cookie token. */
  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  /** `active`; `placing` while its order is created (a short claim); `converted` once it is an order. */
  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  /** Currency of the first priced line; a line priced in another currency is refused. */
  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  /** Sales order id once converted (Phase 4). */
  @Property({ name: 'converted_order_id', type: 'uuid', nullable: true })
  convertedOrderId?: string | null

  /** 30 days after the last write. */
  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One line of a cart: a product (and variant) of the cart's store, a quantity
 * and the buyer's personalization values. Unique per cart by `lineKey`, a hash
 * of product, variant and personalization, so adding the same line again
 * increases its quantity. Ids are re-validated against the catalog on every read.
 */
@Entity({ tableName: 'storefront_cart_lines' })
@Index({ name: 'storefront_cart_lines_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'storefront_cart_lines_cart_idx', properties: ['cartId'] })
@Unique({ name: 'storefront_cart_lines_key_uniq', properties: ['cartId', 'lineKey'] })
export class StorefrontCartLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'integer' })
  quantity!: number

  /** `{ optionCode: value }`; buyer free text, rendered as text only. */
  @Property({ type: 'json', default: '{}' })
  personalization: Record<string, string> = {}

  @Property({ name: 'line_key', type: 'text' })
  lineKey!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * A guest's key to one order (shopping-journey spec REQ-009, S-11): the
 * SHA-256 of a random 256-bit token the buyer holds in a per-store cookie and
 * in the confirmation link. One row per sales order and per cart: `cart_id`
 * unique is the placement's idempotency key (a second submit of the same cart
 * finds this row). `order_number` copies the sales number for URL lookups.
 * Append-only except `proof_submitted_at` (Phase 5).
 */
@Entity({ tableName: 'storefront_order_access' })
@Index({ name: 'storefront_order_access_scope_idx', properties: ['tenantId', 'organizationId', 'siteId'] })
@Unique({ name: 'storefront_order_access_order_uniq', properties: ['orderId'] })
@Unique({ name: 'storefront_order_access_number_uniq', properties: ['siteId', 'orderNumber'] })
@Unique({ name: 'storefront_order_access_cart_uniq', properties: ['cartId'] })
export class StorefrontOrderAccess {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'site_id', type: 'uuid' })
  siteId!: string

  /** The sales order (scalar id; no cross-module relation). */
  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

  @Property({ name: 'order_number', type: 'text' })
  orderNumber!: string

  /** SHA-256 (hex) of the 256-bit access token. */
  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  /** Set once when the buyer submits a transfer proof (Phase 5). */
  @Property({ name: 'proof_submitted_at', type: Date, nullable: true })
  proofSubmittedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
