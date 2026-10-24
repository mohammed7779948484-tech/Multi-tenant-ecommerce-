import { Migration } from '@mikro-orm/migrations';

export class Migration20261022133705_storefront extends Migration {

  override name = 'Migration20261022133705';

  override up(): void | Promise<void> {
    this.addSql(`create table "storefront_page_revisions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "site_id" uuid not null, "page_id" uuid not null, "revision_no" int not null, "spec" jsonb not null, "title" text not null, "seo_description" text null, "source" text not null, "source_revision_id" uuid null, "published_by_user_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "storefront_page_revisions_page_idx" on "storefront_page_revisions" ("page_id", "created_at");`);
    this.addSql(`create index "storefront_page_revisions_scope_idx" on "storefront_page_revisions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "storefront_page_revisions" add constraint "storefront_page_revisions_page_no_uniq" unique ("page_id", "revision_no");`);

    this.addSql(`alter table "storefront_pages" add "draft_spec" jsonb null, add "draft_updated_at" timestamptz null, add "published_revision_id" uuid null;`);

    // Backfill: every page published before revisions existed (the seeded home pages)
    // gets revision 1, so "published ⇔ published_revision_id is set" holds for all rows.
    // Idempotent: pages that already have a revision are skipped.
    this.addSql(`insert into "storefront_page_revisions" ("id", "tenant_id", "organization_id", "site_id", "page_id", "revision_no", "spec", "title", "seo_description", "source", "source_revision_id", "published_by_user_id", "created_at")
      select gen_random_uuid(), p."tenant_id", p."organization_id", p."site_id", p."id", 1, p."published_spec", p."title", p."seo_description", 'publish', null, null, coalesce(p."published_at", p."created_at")
      from "storefront_pages" p
      where p."published_spec" is not null
        and p."published_revision_id" is null
        and not exists (select 1 from "storefront_page_revisions" r where r."page_id" = p."id");`);
    this.addSql(`update "storefront_pages" p set "published_revision_id" = r."id"
      from "storefront_page_revisions" r
      where r."page_id" = p."id" and r."revision_no" = 1 and p."published_revision_id" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "storefront_pages" drop column "draft_spec", drop column "draft_updated_at", drop column "published_revision_id";`);
    this.addSql(`drop table if exists "storefront_page_revisions" cascade;`);
  }

}
