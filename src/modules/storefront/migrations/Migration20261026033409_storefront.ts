import { Migration } from '@mikro-orm/migrations';

export class Migration20261026033409_storefront extends Migration {

  override name = 'Migration20261026033409';

  override up(): void | Promise<void> {
    this.addSql(`create table "storefront_order_access" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "site_id" uuid not null, "order_id" uuid not null, "order_number" text not null, "token_hash" text not null, "cart_id" uuid not null, "proof_submitted_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "storefront_order_access_scope_idx" on "storefront_order_access" ("tenant_id", "organization_id", "site_id");`);
    this.addSql(`alter table "storefront_order_access" add constraint "storefront_order_access_cart_uniq" unique ("cart_id");`);
    this.addSql(`alter table "storefront_order_access" add constraint "storefront_order_access_number_uniq" unique ("site_id", "order_number");`);
    this.addSql(`alter table "storefront_order_access" add constraint "storefront_order_access_order_uniq" unique ("order_id");`);
  }

  override down(): void | Promise<void> {
    // Orders already placed stay in sales; only the buyers' access keys go.
    this.addSql(`drop table if exists "storefront_order_access" cascade;`);
  }

}
