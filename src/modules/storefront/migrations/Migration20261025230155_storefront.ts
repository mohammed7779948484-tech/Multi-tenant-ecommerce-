import { Migration } from '@mikro-orm/migrations';

export class Migration20261025230155_storefront extends Migration {

  override name = 'Migration20261025230155';

  override up(): void | Promise<void> {
    this.addSql(`create table "storefront_carts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "site_id" uuid not null, "token_hash" text not null, "status" text not null default 'active', "currency_code" text null, "converted_order_id" uuid null, "expires_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "storefront_carts_expires_idx" on "storefront_carts" ("site_id", "expires_at");`);
    this.addSql(`create index "storefront_carts_site_status_idx" on "storefront_carts" ("site_id", "status");`);
    this.addSql(`create index "storefront_carts_scope_idx" on "storefront_carts" ("tenant_id", "organization_id", "site_id");`);
    this.addSql(`alter table "storefront_carts" add constraint "storefront_carts_token_hash_uniq" unique ("token_hash");`);

    this.addSql(`create table "storefront_cart_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "cart_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "quantity" int not null, "personalization" jsonb not null default '{}', "line_key" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "storefront_cart_lines_cart_idx" on "storefront_cart_lines" ("cart_id");`);
    this.addSql(`create index "storefront_cart_lines_scope_idx" on "storefront_cart_lines" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "storefront_cart_lines" add constraint "storefront_cart_lines_key_uniq" unique ("cart_id", "line_key");`);
  }

  // Rollback (shopping-journey spec, Rollout): carts are buyer scratch state; orders already placed live in sales.
  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "storefront_cart_lines";`);
    this.addSql(`drop table if exists "storefront_carts";`);
  }

}
