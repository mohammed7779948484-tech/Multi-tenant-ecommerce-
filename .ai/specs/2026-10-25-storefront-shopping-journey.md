# Storefront Shopping Journey (Arabic, guest checkout)

**Date**: 2026-10-25
**Status**: Ready for implementation

> Authored with `om-spec-writing --autonomous` under the owner's brief of 2026-10-25, which authorizes preparing and implementing this specification without a further approval gate. Every autonomous default is listed under **Open Questions** with its rationale. Companion spec: `.ai/specs/2026-10-25-storefront-buyer-accounts.md` (signed-in buyers). The remaining storefront-builder editor work is deferred in `.ai/specs/2026-10-22-storefront-builder.md`.

## TLDR

A buyer reaches a Suqna store, browses and searches the merchant's real catalog in Arabic, picks a variant and fills personalization fields, keeps a persisted cart, checks out as a guest with a Yemeni address (governorate → district, landmark, optional GPS point), sees a delivery price for that destination, pays by cash on delivery or bank transfer, gets an order number, and follows the order on a tracking page where a bank-transfer receipt can be uploaded.

Every buyer surface (existing and new) is Arabic and right-to-left, and wears the merchant's own brand: logo, eight colours, fonts, radius and density from the existing theme tokens. It is never styled as Suqna.

Reused from Open Mercato 0.9.0, not rebuilt:

- **Catalog:** products, variants, option schemas, categories, prices via `catalogPricingService`.
- **Availability:** the shared availability contract with the `wms` provider.
- **Sales:** orders through the `sales.orders.create` command, totals through `salesCalculationService`, payment and shipping methods, the shipping-provider registry, document numbers, status dictionaries and order notes.
- **Attachments:** receipt images.
- **Localization:** the framework's locale registry.

New, app-owned:

- the persisted cart;
- guest order access tokens;
- a Yemen delivery-zone shipping provider;
- the Yemen administrative-division dataset;
- the Arabic dictionary;
- the buyer UI, built on shadcn/ui.

## Problem Statement

The storefront shipped in PR #1 renders branded pages, product cards and product and collection pages, but a buyer cannot buy:

- There is no cart, no checkout and no order.
- The UI is English and left-to-right.
- Only products that a published section shows are reachable (DECISIONS K2), so search and browsing cannot exist.

The owner's market is Yemen. Reference evidence of local expectations (the Safqi demo audit, see **Research**) shows the following:

- Buyers expect guest checkout.
- Addresses are given as governorate → district → street/landmark, not postal codes.
- Delivery is priced by destination.
- Payment is cash on delivery or a bank or wallet transfer proved by a receipt image.
- Order numbers are human-readable and tracked without an account.

Merchants on Suqna cannot take an order today without staff entering it by hand in the sales admin.

## Overview and Success Measures

- **Primary outcome:** a guest buyer completes browse → cart → checkout → order on a phone in Arabic, and the order appears in the merchant's existing sales admin with correct lines, prices, delivery charge, payment method and address. Target: the end-to-end journey passes on two stores with different themes, at 390 px and 1280 px.
- **Leading indicators:**
  - add-to-cart success rate;
  - checkout submit errors by reason (stock, price change, validation);
  - orders per store per day;
  - share of bank-transfer orders with a receipt uploaded.

  These are read from the `storefront.*` events this spec emits.
- **Baseline:** 0 buyer-placed orders; there is no buyer path.
- **Market / product reference:** the Safqi demo storefront audit (archive `safqi-storefront-journey.zip`, studied 2026-10-25; summarised under **Research**).
  - Adopted: guest-first checkout, sequential checkout validation, governorate → district address with driver note, destination-priced delivery, COD plus transfer with receipt, readable order numbers, a public tracking page and personalization shown verbatim through cart and order.
  - Rejected or deferred (see **Non-goals**): coupons, loyalty, referrals, the AI assistant, PWA and web push, Q&A and reviews, multi-currency display, and an interactive map.

## Goals

- **REQ-001** — Every buyer-facing storefront surface (the existing home, pages, product and collection pages, and every new surface in this spec) is Arabic and right-to-left. That covers labels, validation messages, errors, empty states and accessible names. Merchant-authored content is shown as written.
- **REQ-002** — Every buyer surface wears the current merchant's theme (colours, fonts, radius, density, logo, name). That covers dialogs, sheets, popovers and other portalled UI. No library default palette or Suqna branding shows, and nothing leaks into another store or the dashboards.
- **REQ-003** — A buyer browses the store's active catalog: a category index, category pages with sub-categories, and product cards with price, image and availability.
- **REQ-004** — A buyer searches by text and narrows by category, price range and in-stock only, sorts by newest, price (both directions) or name, and pages through results. The URL carries the state, so a result list is shareable.
- **REQ-005** — A product page shows the gallery, description, price for the selected variant, availability, variant choice by option (for example colour and size), quantity, and the product's personalization fields (required or optional text). Add-to-cart is enabled only when the selection is complete and valid.
- **REQ-006** — A persisted cart, per store and per browser:
  - add, change quantity, edit personalization and remove lines;
  - prices are always computed by the server;
  - availability is re-checked;
  - the cart survives reloads and browser restarts for 30 days.
- **REQ-007** — Guest checkout collects the buyer's name and Yemeni mobile number and a delivery address:
  - governorate and district from the official list;
  - area/street and landmark, plus an optional GPS point;
  - an optional note for the courier.

  It shows the delivery price for that destination and the payment methods the store accepts, and the totals shown are the totals the order gets.
- **REQ-008** — Placing the order creates a sales order through the installed `sales.orders.create` command. Prices and stock are re-checked first, the order is placed at most once per submission, and the cart is closed. The buyer sees a confirmation with the order number.
- **REQ-009** — A guest follows an order on a tracking page reachable only with the order's access link, which is stored in the buyer's browser. (The buyer-accounts spec adds a second key: the signed-in owner of the order.) The page shows status, payment status, lines with personalization, totals and the address.
- **REQ-010** — For a bank-transfer order the buyer sees the store's transfer instructions and can submit the transfer reference and a receipt image once. The merchant sees them on the order in the existing sales admin (an order note plus the attachment).
- **REQ-011** — Tenant isolation:
  - every read and write is pinned to the store's tenant and organization;
  - foreign or unknown ids of products, variants, cart lines, orders, districts and attachments answer exactly like random ids (404 or the same 422);
  - one store's cart, order access and theme never reach another store.
- **REQ-012** — Deferred capabilities are recorded, and no non-working control for them is shown. Dashboard follow-up work is specified (**Deferred dashboard work**).

## Non-goals

- Coupons, loyalty points, referrals and invite-a-friend rewards. Deferred by the owner; no input, banner or placeholder is shown.
- Buyer accounts, saved addresses, order history, wishlist and buyer notifications. These belong to the companion spec `2026-10-25-storefront-buyer-accounts.md`.
- Any change to merchant or platform dashboards (pages, fields, navigation, settings). Merchants configure delivery rates and transfer instructions through the existing sales configuration screens; see **Deferred dashboard work**.
- Storefront editor (builder) features. Deferred in the storefront-builder spec; existing builder behaviour is preserved.
- Online card payment or any external payment gateway (owner constraint P4).
- An interactive map picker, an AI shopping assistant, PWA install and web push, product reviews and Q&A, brands, multi-currency display, Kurdish or English storefront languages, and inventory reservation at checkout (see **Risks**).
- Automatic discounts or promotions shown in the cart. None are configured in Suqna today, and the sales calculation handles adjustments if a later spec adds them.

## Proposed Solution

The storefront module grows from "published pages" to "a shop".

1. **Arabic, themed shell.**
   - Register `ar` as an app locale through the framework's `LocaleRegistry` augmentation and `registerLocales`. Storefront routes render with the Arabic dictionary, `lang="ar" dir="rtl"`.
   - Standard controls come from shadcn/ui components added to the project's existing shadcn setup (`components.json`, `src/components/ui`) with the official CLI.
   - A theme bridge maps the merchant's validated tokens onto shadcn's CSS variables inside the store root only.
   - Portalled UI renders into a container inside that root, so it inherits the store's theme.
   - Tailwind's `dark:` variant is scoped away from store roots, so a buyer's OS dark mode never overrides the merchant's palette.
2. **Public catalog.**
   - The store's active catalog becomes browsable. A product is public when it is active and not deleted in the store's organization; a category is public when it is active.
   - This replaces K2's "only what a section shows" rule for the shop. Merchants already control visibility through the product's active flag in the catalog admin.
   - Search, filter and sort run server-side over scoped catalog queries; the URL is the state.
3. **Product page and cart.**
   - The product page resolves variants from the product's option schema (`select` options) and the variants' `optionValues`. Personalization fields are the schema's `text`/`textarea` options.
   - The cart lives in two app-owned tables keyed by an opaque per-store cookie token (hashed at rest). Lines hold ids, quantity and personalization only; prices and availability are computed on every read through the installed pricing service and availability contract.
4. **Checkout.**
   - The quote and the order use the same server path: lines priced by `catalogPricingService`, and totals by `salesCalculationService` with the chosen shipping and payment methods.
   - Delivery is priced by a registered sales shipping provider, `suqna-yemen-zones`. Its settings (configured on a sales shipping method) hold rates per governorate P-code with optional district overrides; the destination travels in the order's shipping-method snapshot, so later recalculation in the admin stays correct.
   - Orders are created by dispatching `sales.orders.create` through the command bus with a system context pinned to the store's tenant and organization, the same pattern as `payment_policy` (DECISIONS J17).
5. **Order access and transfer proof.**
   - Each order gets a random 256-bit access token; only its hash is stored. The token is set as a per-store cookie and appears in the confirmation link.
   - The tracking page needs the token.
   - A transfer proof creates a sales order note (`sales.notes.create`) and an attachment on the order, so the merchant sees both in the existing order screen.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| S-1 Two specs: this one (guest purchase loop) and buyer accounts | Each is independently deployable; guest checkout works without accounts | One spec | Repository rule: one capability per spec |
| S-2 Public catalog = active products and categories of the store's organization | Browse and search need the whole catalog; `isActive` is the merchant's existing control | Keep K2 (only what sections show); add a per-store assortment table | K2 makes search pointless; an assortment table needs dashboard work that is out of scope |
| S-3 Arabic via the framework locale registry; storefront always renders `ar` | "Use the existing localization mechanisms"; the framework supports app locales without patching | Hard-coded Arabic strings; forcing `OM_FORCED_LOCALE` | Strings must stay in dictionaries; forcing would turn dashboards Arabic |
| S-4 shadcn/ui from the official registry into `src/components/ui`, themed by a scoped variable bridge | Owner requirement; one component family; merchant theme as source of truth | `@open-mercato/ui` primitives | Those carry the admin design system (fixed tokens such as `--accent-indigo` for checkboxes, admin dark mode); they suit dashboards, not merchant-themed stores |
| S-5 Portal container inside the store root | Dialogs, sheets and popovers inherit the merchant theme and `dir` | Theme variables on `:root` | Would bleed into dashboards in a shared tab and break isolation of theme scopes |
| S-6 App-owned cart tables, prices never stored | No cart exists in 0.9.0 (`checkout` is pay-links; sales has quotes/orders only); live pricing prevents stale totals | Store the cart as a sales quote | Quotes carry staff workflow (numbering, approval, statuses); one quote per anonymous visitor would flood the merchant's quotes |
| S-7 Orders via `sales.orders.create` with a system context | Reuses document numbers, totals, events, notifications, WMS reservation on confirmation, the admin UI | A storefront order table | Duplicates sales; the merchant would not see orders in the sales admin |
| S-8 Delivery pricing as a registered sales shipping provider | Sales exposes `registerShippingProvider`; settings are edited in the existing shipping-method screen; totals stay in `salesCalculationService` | Storefront-owned rate table | Needs a new dashboard; totals would diverge from sales |
| S-9 Yemen governorates and districts from OCHA COD-AB (CC BY-IGO) as a bundled dataset with P-codes | Official, stable codes; Arabic names; attribution permitted | Hand-typed list | Error-prone; no stable codes |
| S-10 Optional GPS point via the browser Geolocation API plus a landmark field; no map tiles | Works on low-end phones and slow data; no third-party tile requests or 800 KB map bundle | MapLibre with OpenFreeMap | Data cost and privacy of third-party tiles; deferred |
| S-11 Guest order access by hashed random token, no lookup by phone | Phone numbers are unverified (no SMS, P6), so phone lookup would expose orders to anyone who knows a number | Order number + phone lookup | Enumeration and privacy risk |
| S-12 Availability is advisory at browse/cart and live (`bypassCache`) at placement; reservation stays with WMS on merchant confirmation | Uses the installed contract and subscriber; no new stock ledger | Reserve at placement | Needs the `availability` module's reserve API (not enabled) or a parallel reservation model |
| S-13 Buyer client calls use `apiCall` with `x-om-unauthorized-redirect: 0` | Shared HTTP helper; buyer pages must never bounce to staff login | Raw `fetch` | UI rule: `apiCall` for data calls |
| S-14 Forms with React Hook Form + Zod via shadcn `Form` | shadcn's documented form pattern; Zod is already the schema library | `CrudForm` | `CrudForm` is the admin form host with admin chrome |

## Research

- **Reference archive (Safqi demo audit, 2026-10-25).** Read: `README.md`, `INDEX.md`, `STOREFRONT-SPEC.md`, `CUSTOMER-ACCOUNT-FEATURES.md`; screenshots 90–99 (guest purchase) and 60–114 (account); the checkout-form structure and API payload samples.
  - **Demonstrated** (screenshot plus payload evidence):
    - guest session and guest order `ORD-000086`;
    - mandatory personalization fields carried to the cart and the order;
    - 21–22 governorates with dependent districts;
    - delivery priced after the address (1,500 YER);
    - COD, and transfer with account choice, sender name, reference and receipt image;
    - the order page with the order number, status, payment status, lines, totals and address;
    - the confirm button disabled until address, shipping and payment are complete.
  - **Configuration-only or not working in the demo:**
    - `/favorites` is a dead route;
    - `account/downloads` is called but has no UI;
    - the "apps" pages redirect home;
    - Web Push depends on FCM keys.
  - **Inconsistent calculation, not copied:** the cart shows a "free shipping over threshold" discount of −31,200 on the subtotal while the order still charges 1,500 delivery (screenshots 93, 98).
  - **The auditor's inferences, not evidence:** "Open Mercato gap" statements in `STOREFRONT-SPEC.md` §7 were checked against this repository (see the capability map). Several are wrong for 0.9.0: sales already has shipping providers and payment methods, the catalog has option schemas with text inputs, and availability has a contract.
  - **Not copied:** branding, the assistant "Safko", rates, account numbers, customer data and credentials.
- **Address data.** The OCHA Common Operational Dataset (COD-AB, Yemen, v01, valid 2019-11-22) has 22 governorates and 335 districts, each with a P-code, an Arabic name and a centroid. Licence CC BY-IGO 3.0; attribution goes in `THIRD_PARTY_NOTICES.md`.
- **Yemeni mobile numbers.** These are national 9-digit numbers starting `70`, `71`, `73`, `77` or `78` (the reference used `7[01378]\d{7}`), entered with an optional `0` prefix or `+967`. They are stored as E.164 `+9677XXXXXXXX`.

## Capability Map (Open Mercato 0.9.0, verified in `node_modules/@open-mercato/*/src`)

| Requirement | Verified existing implementation | Reused / extended | Genuine gap (built here) |
|---|---|---|---|
| Catalog, variants, options | `catalog/data/entities.ts` (`CatalogProduct.optionSchemaTemplate`, `isConfigurable`; `CatalogProductVariant.optionValues`, `isActive`, `isDefault`); `catalog/data/types.ts` `CatalogProductOptionDefinition.inputType: 'select'\|'text'\|'textarea'\|'number'`, `isRequired` | Read by scalar id with `findWithDecryption`, pinned to the store scope (existing `catalogData.ts`) | Buyer-facing variant resolution and personalization validation |
| Pricing | `catalog/services/catalogPricingService.ts` (`resolvePriceMany`), `catalog/lib/pricing.ts` (`buildPriceRowFilter`, `selectBestPrice`) | Same call path the catalog API uses (DECISIONS K1); anonymous pricing context | — |
| Availability | `shared/lib/availability` (`resolveAvailability`, `bypassCache`), `wms/lib/availabilityProvider.ts` (registered provider `wms`) | Called per product/variant; the catalog-only fallback answers `not_tracked` | — |
| Inventory reservation | `wms/subscribers/sales-order-confirmed-reserve.ts`, `sales-order-cancelled-release.ts` | Unchanged: reserve on merchant confirmation | Placement-time reservation (deferred, Risks) |
| Search | Catalog fields are plaintext (no catalog encryption map); `catalog/lib/productSearch.ts` serves staff search | Scoped `$ilike` over title/SKU/subtitle in the store's organization | Buyer search API and facets |
| Cart | None. `@open-mercato/checkout` is pay-links (`checkout/AGENTS.md`); `sales` has quotes/orders; the availability contract mentions a future `cart` module that is not shipped | — | `storefront_carts`, `storefront_cart_lines` |
| Orders | `sales/commands/documents.ts` `sales.orders.create` (number generator, `salesCalculationService`, line snapshots, staff notification `sales.order.created`, CRUD side effects); `sales/data/validators.ts` `orderCreateSchema` | Dispatched through the command bus with a system context (pattern of `payment_policy/lib/policy.ts`) | Buyer-side quote/placement service, idempotency |
| Totals | `sales/services/salesCalculationService.ts`; provider totals in `sales/lib/providers/totals.ts` | The quote uses the same calculation as the order | — |
| Shipping methods and pricing | `SalesShippingMethod` (`providerKey`, `metadata.providerSettings`); `sales/lib/providers/registry.ts` `registerShippingProvider`; flat-rate provider in `defaultProviders.ts` | New provider `suqna-yemen-zones`, settings edited in the existing shipping-method screen | Destination-based rates, Yemen dataset |
| Payment methods | `SalesPaymentMethod`; providers `cash-on-delivery` (fee settings) and `wire-transfer` (`instructions`, `accountNumber`, `dueDays`); `payment_policy` keeps only these active (DECISIONS I2) | Listed for checkout; instructions shown for transfer | — |
| Statuses | `sales/lib/dictionaries.ts` order statuses (`pending_approval`, `confirmed`, …), payment statuses (`pending`, `received`, …) | Order placed as `pending_approval` / payment `pending`; buyer labels map known values to Arabic, unknown values show the merchant's label | — |
| Order notes | `sales.notes.create` (`sales/commands/notes.ts`) | Transfer proof note | — |
| Attachments | `attachments` module (`Attachment` entity, storage) | Receipt stored as an attachment of `sales:sales_order` | Public upload route with size/type checks |
| Customers | `customers` `CustomerAddress` (`region`, `city`, `latitude`, `longitude`) | Companion spec (saved addresses) | — |
| Buyer identity | `customer_accounts` (login requires `emailVerifiedAt`; `signup.ts` sends email) | Companion spec | Email-free signup (P6) |
| Notifications | `notifications`; portal notifications API for customer users | Staff `sales.order.created` notification already fires | Buyer notifications: companion spec |
| Localization | `shared/lib/i18n/config.ts` `LocaleRegistry` augmentation, `locale-registry.ts` `registerLocales` | `ar` registered app-side; storefront dictionary `i18n/ar.json` | Arabic copy |
| HTTP client | `@open-mercato/ui/backend/utils/apiCall` (with `x-om-unauthorized-redirect`) | Buyer client calls | — |
| Commands | `@open-mercato/shared/lib/commands` (`registerCommand`, `withAtomicFlush`, undo) | Cart and access-token writes as commands | — |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Store | `storefront:site` row resolved by public slug; its `tenantId`/`organizationId` pin every read and write | `storefront_sites` | Unknown or deleted slug → 404 |
| Public product | Not deleted, `isActive`, in the store's organization | `catalog_products` | Otherwise 404 (product page) or absent (lists) |
| Public category | Not deleted, `isActive`, in the store's organization | `catalog_product_categories` | As above |
| Purchasable variant | Active, not deleted, belongs to the product. A configurable product (`isConfigurable` or ≥1 active variant) requires a variant; a simple product uses the product row (variant id null, or its single default variant) | `catalog_product_variants` | 422 `storefront.shop.errors.variantRequired` / `variantUnavailable` |
| Personalization | The product's option-schema options with `inputType` `text`/`textarea`/`number`; required when `isRequired`. Values are trimmed strings ≤ 200 (text), ≤ 1,000 (textarea), numeric (number). Unknown codes are rejected. Values are plain text and never rendered as HTML | `CatalogOptionSchemaTemplate.schema` | 422 with a field error per code |
| Variant axes | Schema options with `inputType: 'select'`; a variant matches when its `optionValues[code]` equals the chosen choice code for every axis | Schema + `optionValues` | No match → add-to-cart disabled; the server answers 422 |
| Unit price | Gross price from `catalogPricingService.resolvePriceMany` for the variant (else product), anonymous context, at read time | Catalog prices | No price → line "not purchasable" (422 on add/placement) |
| Cart | One active cart per (store, cookie token). Lines are unique by (product, variant, personalization hash); adding the same line again increases quantity. Max 50 lines, quantity 1–99 per line. Expires 30 days after the last write | `storefront_carts` | Over limits → 422 |
| Cart currency | The currency of the first priced line; a line priced in another currency is refused | Price rows | 422 `storefront.shop.errors.currencyMismatch` |
| Destination | Governorate P-code + district P-code (the district must belong to the governorate), area/street (required, ≤ 200), landmark (optional, ≤ 200), courier note (optional, ≤ 500), GPS (optional; lat 12–19.5, lng 41.5–54.5) | Bundled OCHA dataset | 422 field errors |
| Yemeni mobile | Accepts `7XXXXXXXX`, `07XXXXXXXX` or `+967 7XXXXXXXX` with second digit 0/1/3/7/8; stored as `+9677XXXXXXXX` | Validator | 422 `phone` |
| Delivery rate | Provider `suqna-yemen-zones` settings `{ currencyCode, rates: [{ governorate, district?, amount }], defaultAmount? }`. A district rate overrides its governorate rate; otherwise `defaultAmount`; otherwise the destination is not served | Shipping method `providerSettings` | Not served → the method is hidden for that address; no method → checkout explains delivery is unavailable there |
| Quote | Server-computed totals for the current cart, destination, shipping and payment method: lines (priced), shipping, payment fees and grand total from `salesCalculationService` | Computed | — |
| Placement | Re-price and re-check availability (`bypassCache`) and quote. If the new quote's hash differs from the client-held `quoteHash` (any price, line, stock or fee change, including a deactivated product), answer 409 with the new quote. Create the order (status `pending_approval`, payment `pending`, channel none) and mark the cart converted. Idempotent per cart: a second submit returns the same order | `sales_orders` + `storefront_carts.converted_order_id` | 409 price/stock change; 422 validation |
| Access token | 32 random bytes, base64url; SHA-256 hash stored; one per order; set as an HttpOnly cookie `sf_ord_<siteId8>` (path `/{siteSlug}`, 90 days) and embedded in the confirmation link `?k=` | `storefront_order_access` | Missing/invalid → the tracking page answers 404 |
| Transfer proof | Allowed once per order while payment status is `pending` and the method's provider is `wire-transfer`. Reference ≤ 64 chars (required), sender name ≤ 120 (optional), receipt image (JPEG/PNG/WebP ≤ 5 MB, required) | `sales_notes` + `attachments` + `storefront_order_access.proof_submitted_at` | Second attempt → 409; wrong method → 422 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Anonymous buyer | Browse, search, cart, checkout, place order, track own orders, submit transfer proof | Store resolved from the URL slug; cart and orders only through their own cookie or link token | none (public routes, `requireAuth: false`) |
| Merchant staff | See and process buyer orders in the existing sales admin | Existing sales ACL | existing `sales.*` |
| System context | Create the order and the transfer note on the buyer's behalf | `systemActor: true`, `organizationScope` pinned to the store's organization, tenant from the store row; never from the request | — |

Trusted scope is derived only from the store row resolved by slug (DECISIONS J1 pattern). Request bodies never carry `tenantId` or `organizationId`; strict schemas reject them.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Catalog reads | Reuse | `catalog` | Scalar ids, `findWithDecryption` | Source of truth |
| Prices | Reuse | `catalog` | DI `catalogPricingService` | Catalog forbids re-implementing pricing |
| Availability | Reuse | shared contract + `wms` | `resolveAvailability` | Installed contract |
| Order | Reuse | `sales` | Command bus `sales.orders.create`, `sales.notes.create` | Merchant works orders in sales |
| Totals | Reuse | `sales` | DI `salesCalculationService` | Document math rule |
| Delivery price | Extend | `sales` | `registerShippingProvider` (`@open-mercato/core/modules/sales/lib/providers`) | Provider registry is the extension seam |
| Receipt file | Reuse | `attachments` | Attachment row on `sales:sales_order` | Merchant sees files on the order |
| Cart | App-own | `storefront` | Own tables; ids of catalog rows | No installed cart |
| Order access | App-own | `storefront` | Own table; `sales_order` id | No buyer access concept in sales |
| Yemen regions | App-own data | `storefront/lib/yemen` | Bundled JSON | Public reference data |
| Arabic copy | App-own | `storefront/i18n/ar.json` + app locale registration | Framework i18n | Existing mechanism |

## Architecture and Data Flow

```text
Buyer (RSC page) ─► storefront loaders ─► catalog (findWithDecryption), catalogPricingService, resolveAvailability
Buyer (client island) ─► apiCall ─► /api/storefront/shop/{site}/cart ─► cart commands ─► storefront_carts/lines
                                    /checkout/quote ─► quote service ─► salesCalculationService (+ suqna-yemen-zones)
                                    /checkout/place ─► placement service ─► commandBus: sales.orders.create (system ctx)
                                                                         └► storefront_order_access (token hash)
                                    /orders/{number}/proof ─► attachments + commandBus: sales.notes.create
sales.order.created (installed) ─► staff notification (installed); wms reserves on sales.order.confirmed (installed)
```

- **Module boundaries:** all new behaviour lives in the existing `storefront` module. It owns the store, its theme and now its shop runtime. No new module is needed because cart, checkout and tracking share one invariant: the store's scope resolved by slug.
- **Extension points:** `registerShippingProvider` for delivery pricing; the command bus for sales writes; the availability registry; the framework locale registry; shadcn components in the project's component folder.
- **Alternatives considered:** reusing the customer portal shell (`portal`) for buyer pages. It is rejected because the portal is organization-branded admin-style UI keyed by organization slug, not by store, and it carries the admin design system.
- **Compatibility:**
  - Existing public URLs (`/{site}`, `/{site}/{page}`, `/{site}/products/{key}`, `/{site}/collections/{key}`) stay. New URLs use segments the store's page slugs cannot take; `search`, `cart`, `checkout` and `orders` are added to the reserved page slugs, and existing pages with those slugs are checked by a migration-free CLI report.
  - Builder preview output keeps the same section markup; only styling changes.

## User Journeys

### Journey J-001 — Browse and find

1. A buyer opens `/{site}` on a phone. The page is Arabic, right-to-left and in the merchant's colours. The header shows the logo, a menu button (sheet), a search button and a cart button with a count.
2. The buyer opens the menu and picks a category. The category page lists products in a two-column grid with price and availability badges, plus sub-category chips.
3. The buyer searches "قهوة" and sorts by lowest price. The URL becomes `/{site}/search?q=قهوة&sort=price_asc`. The filters sheet offers category, price range and in-stock only.
4. With no results, the page says so and offers to clear filters.

### Journey J-002 — Configure and add to cart

1. On a product page the buyer swipes the gallery, picks colour "ذهبي" and size "كبير". The price and availability update for that variant.
2. The buyer fills the required personalization field. Add-to-cart stays disabled while a required field is empty or no variant matches, and the reason is shown.
3. The buyer adds two. The cart sheet opens with the line (variant and personalization shown verbatim), the subtotal and "إتمام الطلب" (checkout).
4. Out of stock: the button reads "غير متوفر" (unavailable) and is disabled. If the server refuses (stock or price changed), the sheet shows the reason and the refreshed line.

### Journey J-003 — Guest checkout

1. Checkout shows three steps:
   1. contact and address;
   2. delivery;
   3. payment and review.

   The order summary is collapsible on phones and pinned at the side on desktop.
2. The buyer enters name and mobile, picks a governorate and then a district from searchable lists, types the area/street and a landmark, and optionally taps "استخدام موقعي الحالي" (use my location), which stores the GPS point.
3. Delivery options for that district appear with prices. If none serves it, the page says delivery is unavailable there and the buyer cannot continue.
4. The buyer chooses cash on delivery or bank transfer. Transfer shows the store's instructions and account number with a copy button.
5. "تأكيد الطلب" (confirm order) is enabled only when every step is valid. Prices or stock changed since the quote → 409, and the refreshed quote is shown with a notice. Double click → one order.
6. The confirmation page shows the order number, a "follow your order" link with a copy action, and, for transfer, the store's transfer instructions. The proof form joins it in Phase 5.

### Journey J-004 — Track and prove payment

1. The buyer reopens the tracking link (or the same browser with the cookie): order number, date, status and payment status in Arabic, lines, totals and the address.
2. For a bank-transfer order with pending payment, the buyer submits the reference and a receipt photo. The page then shows "تم استلام إثبات التحويل" (transfer proof received); the merchant sees the note and the file on the order.
3. A wrong token → the same 404 as an unknown order.

## UI and Interaction Contracts

Buyer surfaces are public storefront pages, not backend pages. `.ai/guides/backend-ui.md` and the UI skill's `frontend-and-design-system.md` apply for states, accessibility and responsiveness. Admin components (`DataTable`, `CrudForm`) do not apply.

Exception, with rationale: buyer UI uses shadcn/ui components themed by the merchant (decision S-4) instead of `@open-mercato/ui` primitives. `@open-mercato/ui` encodes the platform's admin design tokens, which must not override merchant identity.

The closest installed references are:

- the portal shell (`@open-mercato/ui/portal/PortalShell`), for the header/nav/footer layout and account affordances;
- the existing storefront public views (`components/public/StorefrontView.tsx`, `CatalogViews.tsx`).

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| Store shell (all `/{site}/**`) | Header (logo/name, menu sheet, search, cart count), footer | Server: site, theme, categories; client: cart count from `GET …/cart` (`count`) | `PortalShell`, `StorefrontView` | shadcn `Sheet`, `Button`, `Badge`, `Separator` | loading (count skeleton), error (count hidden) | REQ-001, REQ-002 |
| `/{site}` and `/{site}/{page}` | Existing sections restyled RTL | Existing loaders | `StorefrontView` | existing blocks + shadcn `Card`, `Carousel` | existing unavailable/404 | REQ-001, REQ-002 |
| `/{site}/collections` | Category index | Scoped categories | `CatalogViews` | `Card` grid | empty | REQ-003 |
| `/{site}/collections/{key}` | Category products, sub-categories, sort, paging | Search service | `CatalogViews` | `Card`, `Badge`, `Pagination`, `Select` | empty, 404 | REQ-003, REQ-004 |
| `/{site}/search` | Text search, filters (sheet on mobile, sidebar ≥1024 px), sort, paging | Search service; GET form, URL state | — | `Input`, `Select`, `Checkbox`, `Sheet`, `Accordion`, `Pagination`, `Badge` | empty, no results, invalid params clamp | REQ-004 |
| `/{site}/products/{key}` | Gallery, variant axes, personalization, quantity, add to cart | Product loader; `POST …/cart/lines` | `CatalogViews` | `Carousel`, `ToggleGroup`, `Input`, `Textarea`, `Button`, `Badge`, `Alert` | unavailable, out of stock, no price, submitting, server error | REQ-005 |
| Cart sheet + `/{site}/cart` | Lines, quantity stepper, edit personalization, remove (confirm), subtotal, checkout | `GET …/cart`, `PATCH/DELETE …/cart/lines/{lineId}` | — | `Sheet`, `Button`, `Input`, `AlertDialog`, `Skeleton`, `Alert` | loading, empty, stale price/stock notices, error | REQ-006 |
| `/{site}/checkout` | Contact and address, delivery, payment, review, place | `GET …/checkout/options`, `POST …/checkout/quote`, `POST …/checkout/place` | — | `Form` (RHF+Zod), `Input`, `Textarea`, `Command`+`Popover` (searchable selects), `RadioGroup`, `Card`, `Collapsible`, `Alert`, `Button` | empty cart redirect, loading quote, unavailable destination, 409 price change, 422 field errors, submitting | REQ-007, REQ-008 |
| `/{site}/orders/{number}` | Confirmation + tracking, transfer proof form | `GET …/orders/{number}`, `POST …/orders/{number}/proof` | — | `Card`, `Badge`, `Separator`, `Form`, `Input`, `Button`, `Alert` | 404, proof submitted, proof error, upload too large | REQ-009, REQ-010 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Buyer | Header: menu (home, categories, store pages), search, cart. Footer: store pages, contact | none | home → product → add → checkout → order (≤ 3 taps from product to checkout) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Search | "لا توجد نتائج" (no results) + clear-filters button | 2-col grid < 640 px, 3 cols ≥ 640, 4 cols ≥ 1024; filters in a sheet below 1024 px | Filter sheet traps focus; Esc closes; Apply submits |
| Cart | "سلتك فارغة" (your cart is empty) + continue-shopping button | Sheet full-height on phones, 420 px side sheet on desktop (opens from the left edge in RTL) | Quantity stepper buttons labelled; remove confirmation; focus returns to the cart button |
| Checkout | Empty cart → message + link to the store | Single column < 1024 px with collapsible summary; two columns ≥ 1024 | Fields in DOM order; errors announced (`aria-live`); Enter submits the step; place-order button disabled while submitting |

### Theme bridge (all buyer surfaces)

- The store root (`.sf-root[data-sf-theme]`) sets the theme variables:

  | shadcn variable | Merchant token |
  |---|---|
  | `--background` | `background` |
  | `--foreground` | `text` |
  | `--card` / `--popover` | `surface` |
  | `--card-foreground` / `--popover-foreground` | `text` |
  | `--primary` | `primary` |
  | `--primary-foreground` | `onPrimary` |
  | `--secondary` / `--muted` | colour-mix of `surface` and `border` |
  | `--muted-foreground` | `mutedText` |
  | `--accent` | `accent` |
  | `--accent-foreground` | `text` |
  | `--border` / `--input` | `border` |
  | `--ring` | `accent` |
  | `--radius` | from the radius token |

  Fonts come from the theme's font stacks.
- `--destructive` stays the platform semantic token (status colour, not brand).
- Portalled content renders into `[data-sf-portal]` inside the store root (a context provider passed to the shadcn wrappers).
- `@custom-variant dark` is redefined to exclude `.sf-root` descendants, so admin dark mode never restyles a store.
- No hard-coded colours. Every colour comes from tokens.

### Localization

- New keys go under `storefront.shop.*` and `storefront.public.*` in `storefront/i18n/ar.json`.
- English (`en.json`) gets the same keys as fallback; other locales fall back to English, as the framework does.
- Dynamic values (store name, product titles, prices) are interpolated. Prices are formatted with `Intl.NumberFormat('ar-YE', { style: 'currency', currency })`.
- Arabic-Indic digits are not forced. Latin digits are kept for phone and order numbers, isolated with `dir="ltr"` spans.

## Data Models

### `storefront:cart` (`storefront_carts`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid | pk | no | immutable |
| `tenant_id`, `organization_id`, `site_id` | uuid, required | index (`tenant_id`, `organization_id`, `site_id`) | no | from the store row |
| `token_hash` | text, required | unique | no (SHA-256 of a 256-bit secret) | set on create |
| `status` | text: `active` / `converted` | index (`site_id`, `status`) | no | `converted` on placement |
| `currency_code` | text, nullable | — | no | first priced line |
| `converted_order_id` | uuid, nullable | — | no | sales order id; derived (set in the same transaction as the order-access row) |
| `expires_at` | timestamptz | index | no | now + 30 days on each write |
| `created_at`, `updated_at` | timestamptz | — | no | `updated_at` is the version |

### `storefront:cart_line` (`storefront_cart_lines`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid | pk | no | |
| `tenant_id`, `organization_id` | uuid | with `cart_id` | no | same as the cart |
| `cart_id` | uuid → `storefront_carts` (same module) | index | no | cascade on cart delete |
| `product_id`, `variant_id` | uuid; variant nullable | — | no | catalog ids, re-validated on every read |
| `quantity` | int 1–99 | — | no | |
| `personalization` | jsonb `{ code: string }` | — | buyer free text (non-PII by contract; not encrypted) | validated against the schema |
| `line_key` | text | unique (`cart_id`, `line_key`) | no | hash of product/variant/personalization |
| `created_at`, `updated_at` | timestamptz | — | no | |

### `storefront:order_access` (`storefront_order_access`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid | pk | no | |
| `tenant_id`, `organization_id`, `site_id` | uuid | index | no | from the store |
| `order_id` | uuid | unique | no | sales order id |
| `order_number` | text | unique (`site_id`, `order_number`) | no | copy of the sales number for URL lookup |
| `token_hash` | text | — | no | SHA-256 |
| `cart_id` | uuid | unique | no | **the** idempotency key of placement: one order per cart |
| `proof_submitted_at` | timestamptz nullable | — | no | set once |
| `created_at` | timestamptz | — | no | append-only except `proof_submitted_at` |

Migrations: two additive migrations (Phase 3: carts and lines; Phase 4: order access) creating these three tables; no change to shipped migrations or other modules' tables. Buyer name, phone and address live in the sales order's customer and address snapshots, encrypted by the sales module's existing encryption map. They are not duplicated here.

## API, Command, and Error Contracts

All routes:

- live under `/api/storefront/shop/{siteSlug}/…`;
- are public (`metadata: { requireAuth: false }`) with an `openApi` document per method;
- use strict Zod bodies;
- resolve the store by slug (unknown → 404);
- are rate-limited through the shared rate-limit helper (per IP + site), on writes and on the quote.

Custom guarded routes, not `makeCrudRoute`: there is no staff auth, and scope comes from the slug.

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `…/cart` | public + cart cookie | — | `{ lines[{ id, product, variant, personalization, quantity, unitPrice, lineTotal, availability, issues[] }], subtotal, currencyCode, count, updatedAt }` | no cookie → empty cart | REQ-006 |
| `POST` | `…/cart/lines` | public | `{ productId, variantId?, quantity, personalization? }` | 200 cart; creates cart + cookie when absent; `storefront.cart.updated` | 404 product; 422 variant/personalization/limits/currency/no price/unavailable; 400 `cookiesRequired` when a follow-up write arrives without the cookie the previous answer set; 429 rate limit | REQ-005, REQ-006 |
| `PATCH` | `…/cart/lines/{lineId}` | public + cookie | `{ quantity?, personalization? }` | 200 cart | 404 (foreign/unknown line); 422 | REQ-006 |
| `DELETE` | `…/cart/lines/{lineId}` | public + cookie | — | 200 cart | 404 | REQ-006 |
| `GET` | `…/checkout/options` | public | `?governorate=&district=` | `{ governorates[], districts[], shippingMethods[{ id, name, amount, currencyCode }], paymentMethods[{ id, name, kind, instructions?, accountNumber? }] }`; bank transfer is omitted while its instructions are missing or equal the seeded example text | 422 unknown codes; 429 | REQ-007 |
| `POST` | `…/checkout/quote` | public + cookie | `{ destination, shippingMethodId, paymentMethodId }` | `{ lines, subtotal, shipping, fees, grandTotal, currencyCode, quoteHash }` | 422; 409 cart changed | REQ-007 |
| `POST` | `…/checkout/place` | public + cookie | `{ contact{ name, phone }, destination, shippingMethodId, paymentMethodId, quoteHash }` | 201 `{ orderNumber, trackingUrl }`; sets the order cookie; `sales.order.created` (installed), `storefront.order.placed` | 409 `{ quote }` price/stock changed; 422; idempotent replay → 200 same order | REQ-008 |
| `GET` | `…/orders/{orderNumber}` | public + order token (cookie or `k`) | — | order view model | 404 for missing/invalid token | REQ-009 |
| `POST` | `…/orders/{orderNumber}/proof` | public + order token | multipart: `reference`, `senderName?`, `receipt` | 201; `sales.notes.create`; attachment; `storefront.order.proof_submitted` | 404; 409 already submitted; 413 too large; 422 type/method | REQ-010 |
| Command | `storefront.cart.add_line` / `update_line` / `remove_line` | system (public route) | as above | events | 422/404 | REQ-006 |
| Command | `storefront.checkout.place` | system | as above | dispatches `sales.orders.create` | 409/422 | REQ-008 |

Cart writes are not undoable from the buyer UI; the commands declare `isUndoable: false` (buyer self-service, no audit undo).

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `storefront.cart.updated` | storefront | none yet (analytics later) | — | fire-and-forget after commit |
| `storefront.order.placed` | storefront | none yet | — | after commit; payload ids only |
| `sales.order.created` | sales (installed) | sales notifications (installed) | staff with `sales.orders.manage` notified | installed behaviour |
| `sales.order.confirmed` | sales (merchant action) | `wms` (installed) | stock reservation | installed |
| `storefront.order.proof_submitted` | storefront | none yet | — | after commit |
| Expired carts | cart creation (no job) | `storefront` cart service | each new cart deletes at most 50 expired carts of the same store (`expires_at < now()`), inside the creating transaction | idempotent; bounded; no scheduler needed |

## Security, Privacy, and Compliance

- **Authorization:** public routes; possession of the cart cookie or order token is the only capability. Tokens are 256-bit random values; hashes are compared in constant time.
- **Tenant isolation:**
  - The store row pins every query; ids from the client are looked up within that scope.
  - A cart line id from another cart answers 404; an order token for store B on store A answers 404.
  - Cookies are named per site and limited to the store's path.
- **Sensitive data:**
  - Buyer contact and address go only into the sales order snapshots (sales encryption map).
  - The tracking view shows them only with the token.
  - Logs carry ids, never names, phones or addresses.
- **Abuse and failure modes:**
  - Rate limits on cart writes, quote, place and proof.
  - Quantity and line caps.
  - Upload type sniffing (magic bytes, as the media route does) and a size cap.
  - No HTML rendering of buyer text.
  - Price tampering is impossible because the client never sends prices.
  - Replay of place returns the same order.
  - CSRF: all writes are JSON or multipart with `SameSite=Lax` cookies and an Origin check against the platform host.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-J01 | unit | dictionaries | Every `storefront.public.*`/`storefront.shop.*` key exists in `ar.json`; the theme bridge maps tokens to variables | No missing keys; variables scoped | REQ-001, REQ-002 |
| TEST-J02 | integration (browser) | two stores with different themes, catalog fixtures | Visit home, category, search, product, cart, checkout at 390 and 1280 px | `dir=rtl`, `lang=ar`; computed primary colour equals each store's token; sheet/dialog inherit it; no English strings in the UI | REQ-001, REQ-002 |
| TEST-J03 | unit + API | catalog fixtures (active/inactive, categories, prices) | search with q, category, price range, in stock, sort, page | correct sets and order; inactive excluded; other store's products absent | REQ-003, REQ-004, REQ-011 |
| TEST-J04 | unit | option schema with axes + personalization; variants | Variant resolution, personalization validation | matches, required/unknown/too long refused | REQ-005 |
| TEST-J05 | API | product with variants, prices, stock | Add, merge same line, change quantity, edit personalization, remove; caps; currency mismatch; foreign line id | cart totals from the server; 404 for foreign lines | REQ-006, REQ-011 |
| TEST-J06 | unit | rates settings | Provider picks the district rate, then the governorate rate, then the default; not served | amounts and hiding | REQ-007 |
| TEST-J07 | API | store with COD + transfer methods, zone shipping method | Options (transfer hidden while it carries the seeded example instructions), quote, place; price change between quote and place; double place; cross-store ids | 409 with a new quote; one order; order lines, shipping, payment and address snapshot in sales; foreign ids 404/422 | REQ-007, REQ-008, REQ-011 |
| TEST-J08 | API + browser | placed order | Tracking with cookie, with `k`, with a wrong token, from another store; confirmation link opens the tracking page | 200/200/404/404 | REQ-009, REQ-011 |
| TEST-J09 | API | transfer order | Submit proof; second submit; COD order proof; oversized file | note + attachment on the order; 409; 422; 413 | REQ-010 |
| TEST-J10 | integration (browser) | fresh tenant + fixtures | Full guest journey on a phone viewport | order visible in `/backend/sales/orders` with matching totals | REQ-001…010 |
| TEST-J11 | security | two fresh tenants | Cross-store cart/order/product/district/attachment ids | identical 404/422; no data | REQ-011 |

## Implementation Phases

### Phase 1 — Arabic, merchant-themed store shell

- **Depends on:** none (builds on PR #1).
- **Outcome:** every existing buyer page is Arabic and RTL in a redesigned shell (header with menu sheet and search entry; the cart button arrives in Phase 3), themed per merchant through shadcn/ui.
- **Why this order / value delivered:** every later surface sits in this shell; stores look right immediately.
- **Deliverables:**
  - `ar` locale registration (type augmentation plus `registerLocales`);
  - `storefront/i18n/ar.json`;
  - shadcn components (button, sheet, badge, separator, card, skeleton) via the CLI;
  - `components/shop/StoreShell.tsx`, the theme bridge and the portal container;
  - the dark-variant scope in `globals.css`;
  - existing sections and product/collection views restyled with logical properties.
- **Builder preview (deferred editor surface):** the preview renders through the same store frame. This phase changes only markup and CSS there; the builder's controls, data and behaviour are untouched. A regression check (`TC-STOREFRONT-003` builder preview) must stay green.
- **Requirements closed:** REQ-001 and REQ-002 for existing surfaces; REQ-012 (no deferred-feature control) checked at the exit gate.
- **Tests:** TEST-J01, the TEST-J02 subset (home/page/product/collection), existing `TC-STOREFRONT-001…006` updated for Arabic text.
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`, plus storefront integration tests.
- **Exit gate:** two stores with different themes render Arabic RTL pages at 390 and 1280 px with their own colours in the header, sections and an open menu sheet; dashboards are unchanged; the builder preview still renders.

### Phase 2 — Browse and search

- **Depends on:** Phase 1.
- **Outcome:** category index and pages, the search page with filters, sort and paging, and product cards with price and availability.
- **Deliverables:**
  - `lib/shopCatalog.ts` (public catalog rule, search service);
  - `frontend/[siteSlug]/search`, `frontend/[siteSlug]/collections` (index);
  - collection pages on the search service;
  - reserved slugs extended, plus a CLI report `storefront reserved-slugs` that lists existing pages whose slug is now reserved (read-only; no migration);
  - `ProductCard`, the filter sheet, sort select and pagination;
  - DECISIONS entry superseding K2 for the shop.
- **Requirements closed:** REQ-003, REQ-004; REQ-011 for catalog reads (TEST-J03 cross-store part); REQ-012 checked at the exit gate.
- **Tests:** TEST-J03, TEST-J02 (search/category).
- **Exit gate:** search with q/category/price/in-stock/sort/page returns correct, scoped results on two stores; empty states shown.

### Phase 3 — Product page and persisted cart

- **Depends on:** Phase 2.
- **Outcome:** variant and personalization selection, add to cart, cart sheet and page, line editing.
- **Deliverables:**
  - migration (carts and lines);
  - entities, validators and commands;
  - `/api/storefront/shop/{site}/cart*`;
  - `lib/shopCart.ts`, `lib/productOptions.ts`;
  - the product purchase panel, cart sheet and `/{site}/cart`;
  - bounded purge of expired carts on cart creation;
  - shadcn `toggle-group`, `input`, `textarea`, `alert-dialog`, `alert`.
- **Checkout button:** the cart's "إتمام الطلب" (checkout) action is not rendered in this phase; it appears with Phase 4. No dead link ships.
- **Requirements closed:** REQ-005, REQ-006; REQ-011 for cart ids (foreign line ids 404).
- **Tests:** TEST-J04, TEST-J05.
- **Exit gate:** on two stores a buyer adds a configured personalized product, edits and removes lines, and reloads with the cart intact; foreign ids are 404; prices come from the server.

### Phase 4 — Checkout, order placement and tracking

- **Depends on:** Phase 3.
- **Outcome:**
  - guest checkout with Yemen address and destination-priced delivery;
  - COD and transfer payment;
  - quote = order totals;
  - order creation in sales;
  - the confirmation and the read-only tracking page the confirmation links to.
- **Deliverables:**
  - Yemen dataset (`lib/yemen/regions.json` + loader + attribution in `THIRD_PARTY_NOTICES.md`);
  - shipping provider `suqna-yemen-zones` (registered from `storefront/di.ts`, a new file);
  - `order_access` migration;
  - quote and placement services;
  - checkout API;
  - `/{site}/checkout` (RHF + Zod, shadcn `form`, `radio-group`, `command`, `popover`, `collapsible`);
  - `/{site}/orders/{number}` (read-only tracking, Arabic status labels) and its API;
  - development fixture CLI `storefront shop-fixtures --tenant <id>`, which creates a zone shipping method with Yemeni sample rates and is clearly marked as development data.
- **Requirements closed:** REQ-007, REQ-008, REQ-009; REQ-011 for checkout and orders.
- **Tests:** TEST-J06, TEST-J07, TEST-J08.
- **Exit gate:** a guest places COD and transfer orders on two stores; the orders appear in the sales admin with the same totals shown at checkout; a price change answers 409; a double submit makes one order; the confirmation's link opens the tracking page; another store's token is 404.

### Phase 5 — Transfer proof and the full journey

- **Depends on:** Phase 4.
- **Outcome:** a bank-transfer buyer submits the reference and receipt image from the tracking page; the merchant sees the note and file on the order.
- **Deliverables:**
  - proof route (attachments + `sales.notes.create`) and form;
  - the end-to-end journey test on two themes and viewports;
  - the final cross-store probe.
- **Requirements closed:** REQ-010; REQ-011 for proofs; REQ-012 final check. TEST-J10 re-runs the whole journey as a regression oracle for requirements already closed in Phases 1–4.
- **Tests:** TEST-J09, TEST-J10, TEST-J11.
- **Exit gate:** the full guest journey passes in the browser at 390 and 1280 px on two differently themed stores; cross-store probes fail closed.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | all | `ar.json`, locale registration | 1 (existing), 2–5 (new) | TEST-J01, J02, J10 | AC-001 |
| REQ-002 | all | theme bridge, portal container | 1–5 | TEST-J02, J10 | AC-002 |
| REQ-003 | J-001, collections | `shopCatalog` | 2 | TEST-J03 | AC-003 |
| REQ-004 | J-001, search | search service | 2 | TEST-J03 | AC-003 |
| REQ-005 | J-002, product page | `productOptions`, `POST …/cart/lines` | 3 | TEST-J04, J05 | AC-004 |
| REQ-006 | J-002, cart | carts/lines, cart API | 3 | TEST-J05 | AC-004 |
| REQ-007 | J-003, checkout | options/quote API, zone provider | 4 | TEST-J06, J07 | AC-005 |
| REQ-008 | J-003, place | place API, `sales.orders.create` | 4 | TEST-J07, J10 | AC-005 |
| REQ-009 | J-004, tracking | order access, order API | 4 | TEST-J08 | AC-006 |
| REQ-010 | J-004, proof | proof API, notes, attachments | 5 | TEST-J09 | AC-006 |
| REQ-011 | all | scope rules | 2, 3, 4, 5 (each phase closes its own surfaces) | TEST-J03, J05, J07, J08, J09, J11 | AC-007 |
| REQ-012 | — | this document | 1–5 (checked at every exit gate) | review at each exit gate | AC-008 |

### Extension-surface traceability

Every row adapts one reference capability from `src/modules/example/references/surface-inventory.json`. The reference module is source-present and unregistered; it is used as a reading reference only.

| Surface | Requirement | Reference capability → exact source | Phase | Own test | Mechanism |
|---|---|---|---|---|---|
| Public shop API routes `api/shop/[siteSlug]/**` (custom guarded routes, per-method `metadata` + `openApi`) | REQ-006…REQ-010 | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 3–5 | TEST-J05, J07, J08, J09 | emitted-example |
| OpenAPI documents for the shop routes | REQ-006…REQ-010 | `api.openapi` → `src/modules/example/api/openapi.ts` | 3–5 | TEST-J05 (schema served by `api_docs`) | emitted-example |
| Frontend pages `frontend/[siteSlug]/{search,collections,cart,checkout,orders/[orderNumber]}` | REQ-003…REQ-009 | `ui.frontend-page` → `src/modules/example/frontend/example.tsx` | 2–4 | TEST-J02, J10 | emitted-example |
| Commands `storefront.cart.add_line`, `storefront.cart.update_line`, `storefront.cart.remove_line`, `storefront.checkout.place` | REQ-006, REQ-008 | `commands.write` → `src/modules/example/commands/todos.ts` | 3–4 | TEST-J05, J07 | emitted-example |
| Entities `storefront:cart`, `storefront:cart_line`, `storefront:order_access` | REQ-006, REQ-009 | `data.entities` → `src/modules/example/data/entities.ts` | 3–4 | TEST-J05, J08 | emitted-example |
| Validators (strict Zod bodies) | REQ-005…REQ-010 | `data.validators` → `src/modules/example/data/validators.ts` | 3–5 | TEST-J04, J05 | emitted-example |
| Migrations (carts + lines; order access) | REQ-006, REQ-009 | `data.migrations` → `src/modules/example/migrations/Migration20260804120546_example.ts` | 3–4 | TEST-J05, J08 (run on a fresh ephemeral DB) | emitted-example |
| Events `storefront.cart.updated`, `storefront.order.placed`, `storefront.order.proof_submitted` | REQ-006, REQ-008, REQ-010 | `events.typed-definitions` → `src/modules/example/events.ts` | 3–5 | TEST-J05, J07, J09 | emitted-example |
| Shipping provider `suqna-yemen-zones` registered at DI time | REQ-007 | `module.di-registration` → `src/modules/example/di.ts` | 4 | TEST-J06, J07 | emitted-example |
| Development fixture CLI `storefront shop-fixtures` (Phase 4) and `storefront reserved-slugs` report (Phase 2) | REQ-007, REQ-003 | `module.cli-command` → `src/modules/example/cli.ts` | 4 | TEST-J07 (fixture used by the test setup) | emitted-example |
| Arabic dictionary `storefront/i18n/ar.json` | REQ-001 | `module.i18n-catalogs` → `src/modules/example/i18n/en.json` | 1 | TEST-J01 | emitted-example |
| App locale registration (`ar` in `LocaleRegistry` + `registerLocales`) | REQ-001 | — | 1 | TEST-J01 | framework-only |

## Implementation Plan

Each step is testable and leaves the app working. Steps run in phase order; a phase starts only after the previous phase's exit gate.

**Phase 1 — Arabic, merchant-themed store shell**

1. Register the `ar` locale app-side (type augmentation plus `registerLocales` in bootstrap). Add `storefront/i18n/ar.json` with every existing `storefront.public.*` key and section label. Test: TEST-J01 dictionary completeness.
2. Add shadcn components with the CLI into `src/components/ui`. Add the store portal-container context and the theme bridge, which emits shadcn variables from validated tokens inside `.sf-root`. Scope the `dark` variant away from `.sf-root`. Test: theme bridge unit test (TEST-J01).
3. Build the new store shell: RTL header with logo/name, menu `Sheet` and search entry, plus a footer. Use it for home, pages, product and collection views and for the builder preview. Test: existing `TC-STOREFRONT-001/005` updated; TEST-J02 subset.
4. Restyle the existing sections with logical properties and token-driven Tailwind utilities. Check two themes at 390 px and 1280 px. Test: TEST-J02 subset.

**Phase 2 — Browse and search**

5. `lib/shopCatalog.ts`: the public catalog rule (S-2) and the search service (q, category tree, price range, in stock, sort, page). Test: TEST-J03 unit.
6. Pages `/{site}/search` and `/{site}/collections`, with collection pages moved onto the search service. Add `ProductCard`, the filter sheet, sort and pagination. Extend the reserved slugs and add the `storefront reserved-slugs` report. Test: TEST-J03 API and browser.
7. Record the DECISIONS entry superseding K2 for the shop. Test: n/a (documentation).

**Phase 3 — Product page and persisted cart**

8. Migration plus entities for carts and lines, validators, and the cart service with live pricing and availability. Commands `storefront.cart.*`. Test: TEST-J05 unit.
9. Cart API routes (cookie token, strict bodies, rate limits) with OpenAPI. Test: TEST-J05 API, foreign ids 404.
10. `lib/productOptions.ts` (variant axes, personalization) and the product purchase panel on the product page. Test: TEST-J04.
11. Cart sheet, `/{site}/cart` and the header cart count. Test: TEST-J05 browser.

**Phase 4 — Checkout and order placement**

12. Yemen dataset with attribution and the options endpoint. Test: TEST-J06 data.
13. Shipping provider `suqna-yemen-zones` and the `storefront shop-fixtures` CLI. Test: TEST-J06.
14. Quote and placement services (pricing, availability, `salesCalculationService`, `sales.orders.create` with a system context), the order-access migration and entity, and idempotency. Test: TEST-J07 API.
15. Checkout page and confirmation. Test: TEST-J07 browser.
16. Tracking API and page with Arabic status labels, linked from the confirmation. Test: TEST-J08.

**Phase 5 — Transfer proof and the full journey**

17. Proof route (attachments plus `sales.notes.create`) and the proof form. Test: TEST-J09.
18. Full journey and isolation probes on two stores and two themes. Test: TEST-J10, TEST-J11.

## Resolved assumptions (autonomous defaults)

| Question | Chosen answer | Rationale | Marker |
|---|---|---|---|
| Q-001 Split into several specs? | Two specs (S-1) | Guest checkout works without accounts | — |
| Q-002 Which products are public? | All active products and categories of the store's organization (S-2) | Search and browse require it; `isActive` is the merchant's control | ⚠ NEEDS HUMAN CONFIRMATION: widens visibility compared with K2 |
| Q-003 Storefront languages | Arabic only | Owner brief | — |
| Q-004 Delivery pricing configuration | Zone provider settings on sales shipping methods (S-8) | Reuses sales; merchant UI deferred | — |
| Q-005 Guest order access | Token link plus cookie, no phone lookup (S-11) | Phones are unverified | — |
| Q-006 Reservation at placement | No; WMS on confirmation (S-12) | Installed behaviour | — |
| Q-007 Map | GPS point and landmark only (S-10) | Data cost, privacy, bundle size | — |

## Edge Cases and Failure Scenarios

| Scenario | What the buyer sees | System behaviour |
|---|---|---|
| Product deactivated while in a cart | The line shows "لم يعد متوفراً" (no longer available) with a remove action; checkout is blocked until it is removed | The cart read marks the line `unavailable`; placement answers 409 |
| Price changed while in a cart | The line shows the new price; at placement a notice asks the buyer to confirm again | Quote hash mismatch → 409 with the new quote |
| Stock runs out between quote and placement | Notice on the affected line | Live availability (`bypassCache`) at placement → 409 |
| No delivery method serves the district | "التوصيل غير متاح لهذه المنطقة حالياً" (delivery is not available in this area yet); continue disabled | The options endpoint returns no methods for that destination |
| Store has no zone shipping method at all | The checkout explains delivery is not set up yet; the cart still works | Checkout options return an empty list |
| Seeded example transfer instructions | Bank transfer is not offered | The method is hidden while its instructions equal the seed text |
| Double tap on "confirm order" | One order | Placement is idempotent per cart (`storefront_order_access.cart_id` unique) |
| `sales.orders.create` fails (DB error) | Generic error, cart intact, retry possible | Transaction rolled back; nothing converted |
| Cookie blocked by the browser | Cart cannot persist; the add answer explains cookies are required | Cart routes answer 400 `cookiesRequired` when the token cannot round-trip |
| Unknown or foreign ids, wrong store slug | 404 page or the same 422 as an unknown id | Scoped lookups only |
| Geolocation denied or unavailable | Message; address can still be completed | GPS optional |
| Receipt upload too large or not an image | Field error | 413 / 422, nothing stored |

## Rollout, Migration, and Rollback

- **Migrations:** two additive migrations (Phase 3: carts and lines; Phase 4: order access), generated with `yarn db:generate` and reviewed. They create tables only. Rollback is the migration `down` (drop tables); orders already placed remain in sales.
- **Setup:**
  - The zone shipping provider is registered at DI time.
  - Existing stores have no zone shipping method until the merchant creates one in the sales configuration (or development uses `storefront shop-fixtures`). Without one, checkout tells the buyer that delivery is unavailable and does not place orders.
  - The seeded example shipping methods (USD flat rates) are not offered to buyers: only methods with provider `suqna-yemen-zones` are.
- **Feature exposure:** shop routes are live for every store once deployed. The header cart appears with Phase 3, and the checkout link only after Phase 4.
- **Observability:** placement logs (ids only), plus 409/422 reasons by code.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Oversell between placement and merchant confirmation (reservation happens on confirmation) | Two buyers order the last item | Live availability check at placement; the merchant sees stock on confirm | Accepted until `availability` reservation is adopted |
| Seeded example payment instructions (ACME IBAN) shown to buyers | Buyer transfers to a fake account | Transfer is offered only when instructions are present and differ from the seed's example text; documented dashboard follow-up | The merchant must configure instructions |
| Price changes between quote and placement | Buyer surprised | 409 with a refreshed quote, re-confirmation required | — |
| Public catalog widens visibility (S-2) | Products a merchant left active but did not intend to sell become reachable | `isActive` is the merchant's control; DECISIONS entry; release note | Accepted |
| Cart spam | DB growth | Rate limits, caps, 30-day expiry with bounded purge on cart creation | — |
| RTL with third-party components | Mirrored icons and layouts wrong | `dir` provider for Radix; logical classes; browser checks in RTL | — |
| Theme contrast | Merchant palettes with low contrast make controls unreadable | Existing contrast warnings in the brand wizard; focus ring uses `accent` | Merchant's responsibility |
| Guest loses the tracking link and cookie | Cannot see the order | The confirmation shows a copyable link; buyer accounts (companion spec) bring order history | Accepted |
| District data age (2019) | New districts missing | P-codes are stable; dataset version recorded; update path documented | Low |

## Deferred dashboard work

Each buyer feature here that needs merchant UI later:

| Buyer feature | Merchant settings / actions needed | Data | Permissions | Dependencies |
|---|---|---|---|---|
| Delivery pricing | A Yemen-zones editor: per governorate/district rates, default, unserved areas, currency; preview of a destination's price. Today: JSON in the shipping method's provider settings | `SalesShippingMethod.providerSettings` | `sales.settings.manage` | This spec's provider |
| Transfer instructions | Bank/wallet accounts list (name, holder, number), instructions text in Arabic. Today: wire-transfer provider settings (`instructions`, `accountNumber`) | `SalesPaymentMethod.providerSettings` | `sales.settings.manage` | — |
| Transfer proof review | "Receipt received" badge in the orders list, a proof preview, mark payment received | Order notes, attachments, payment status | `sales.orders.manage` | Phase 5 |
| Buyer order statuses | Mapping of order/fulfilment statuses to buyer-visible Arabic labels | Status dictionaries | `sales.settings.manage` | — |
| Public catalog control | Per-product "hidden from store" or per-store assortment beyond `isActive` | catalog | `catalog.products.manage` | S-2 |
| Abandoned carts | List and analytics | `storefront_carts` | `storefront.view` | Phase 3 |
| Store language | Later languages (English, Kurdish) | site settings | `storefront.brand.manage` | Locale work |

## Acceptance Criteria

- [ ] **AC-001** — On two stores, every buyer page and dialog is Arabic, `dir="rtl"`, including errors and empty states; no English UI text remains (merchant content excepted).
- [ ] **AC-002** — On two stores with different themes, header, buttons, cards, sheets, dialogs and form controls use each store's colours, font, radius and logo; the dashboards and the other store are unaffected.
- [ ] **AC-003** — Search, category browsing, filters, sort and paging return the store's active products only, correctly ordered, with shareable URLs.
- [ ] **AC-004** — A buyer selects a variant, fills personalization, adds to cart, edits and removes lines; the cart persists across reloads; prices and availability come from the server.
- [ ] **AC-005** — A guest places COD and transfer orders with a Yemeni address. Delivery is priced by destination. Checkout totals equal the sales order totals. A price change gives 409, and a double submit gives one order.
- [ ] **AC-006** — The tracking page shows the order with its token only, and a transfer proof appears on the order in the sales admin.
- [ ] **AC-007** — Cross-store ids and tokens fail exactly like unknown ones.
- [ ] **AC-008** — Deferred items and dashboard follow-ups are documented; no non-working control exists.
- [ ] Every buyer surface has loading, empty, error, conflict, keyboard, accessibility and responsive states; the configured validation gate passes.
- [ ] Every affected API and UI path has self-contained integration coverage.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`; `sales`, `catalog`, `checkout`, `shared`, `ui` package `AGENTS.md`; spec-delivery guide; template |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Requirement traceability |
| Every workflow completes end to end without a catch-all integration phase | pass | Phases 1–5 each close requirements |
| Platform-native reuse and extension points were chosen before custom code | pass | Capability map, Reuse map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI contracts, with the S-4 exception recorded |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Phases |

Verdict: Ready for implementation

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Split into several specs? | engineering | no | Two: this spec and buyer accounts (S-1), 2026-10-25 |
| Q-002 | Which products are public in the shop? | product | no | All active products of the store's organization (S-2); supersedes K2 for the shop, 2026-10-25 |
| Q-003 | Which storefront languages? | product | no | Arabic only at launch (owner brief), 2026-10-25 |
| Q-004 | How is delivery priced and configured? | product | no | Zone provider with settings on sales shipping methods (S-8); merchant UI deferred, 2026-10-25 |
| Q-005 | How does a guest reach an order later? | product | no | Token link plus cookie, no phone lookup (S-11), 2026-10-25 |
| Q-006 | Reserve stock at placement? | engineering | no | No; keep WMS reservation on confirmation (S-12), 2026-10-25 |
| Q-007 | Map for location? | product | no | GPS point and landmark, no tiles (S-10), 2026-10-25 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-25 | Initial specification (autonomous, owner brief of 2026-10-25) |
| 2026-10-25 | Fresh-context scope review applied: tracking moved into Phase 4 (no dead confirmation link); each phase closes its own isolation and deferred-control checks; migration count, cart routes, idempotency source, placement 409 rule, error codes, reserved-slug report and the builder-preview boundary made consistent |
