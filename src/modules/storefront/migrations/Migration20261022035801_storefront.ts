import { Migration } from '@mikro-orm/migrations';

export class Migration20261022035801_storefront extends Migration {

  override name = 'Migration20261022035801';

  override up(): void | Promise<void> {
    this.addSql(`create table "storefront_pages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "site_id" uuid not null, "slug" text not null, "title" text not null, "seo_description" text null, "published_spec" jsonb null, "published_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "storefront_pages_scope_idx" on "storefront_pages" ("tenant_id", "organization_id");`);

    this.addSql(`create table "storefront_sites" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "slug" text not null, "name" text not null, "description" text null, "logo_attachment_id" uuid null, "default_locale" text not null default 'en', "first_published_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "storefront_sites_scope_idx" on "storefront_sites" ("tenant_id", "organization_id");`);

    this.addSql(`create table "storefront_themes" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "site_id" uuid not null, "tokens" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "storefront_themes_scope_idx" on "storefront_themes" ("tenant_id", "organization_id");`);

    // Partial unique indexes (soft-deleted rows must not block re-creation). Not expressible
    // through entity decorators, so they live here only; the snapshot stays decorator-derived.
    this.addSql(`create unique index "storefront_sites_slug_uniq" on "storefront_sites" ("slug") where "deleted_at" is null;`);
    this.addSql(`create unique index "storefront_sites_scope_uniq" on "storefront_sites" ("tenant_id", "organization_id") where "deleted_at" is null;`);
    this.addSql(`create unique index "storefront_themes_site_uniq" on "storefront_themes" ("site_id") where "deleted_at" is null;`);
    this.addSql(`create unique index "storefront_pages_site_slug_uniq" on "storefront_pages" ("site_id", "slug") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "storefront_pages" cascade;`);
    this.addSql(`drop table if exists "storefront_themes" cascade;`);
    this.addSql(`drop table if exists "storefront_sites" cascade;`);
  }

}
