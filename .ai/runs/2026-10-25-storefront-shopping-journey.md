# Execution plan — storefront shopping journey

Source doc: .ai/specs/2026-10-25-storefront-shopping-journey.md (spec PR #2)
Companion (later run): .ai/specs/2026-10-25-storefront-buyer-accounts.md
Engine: om-auto-create-pr (steps: 18, --loop: no)

## Goal

A guest buyer completes browse → cart → checkout → order → tracking in Arabic, right-to-left, in each merchant's own theme. The order lands in the existing sales admin.

## Scope

- Spec phases 1–5 (steps 1–18 of the spec's Implementation Plan), in the `storefront` module and app-level i18n/style setup.
- shadcn/ui components added with the official CLI into `src/components/ui`; supporting libraries as the spec names (Embla through shadcn carousel, React Hook Form + Zod through shadcn form).

## Non-goals

- Coupons, loyalty points, referrals and invite rewards (owner-deferred; no controls).
- Storefront editor features.
- Merchant or platform dashboard pages, fields, navigation or settings.
- Buyer accounts (companion spec, separate run).

## Working notes

- Branch `feat/storefront-shopping-journey` from `main` (12ad6e6, PR #1 merged).
- The spec files from PR #2 are materialized locally (excluded through `.git/info/exclude`), so the spec document merges only through its own PR.
- The run uses this session's dedicated cloud checkout instead of a second worktree: the sandbox is single-purpose, and a second `node_modules` would exceed its disk allowance.

## Risks

- RTL behaviour of third-party primitives.
- The theme bridge leaking into dashboards (guarded by scoping and the browser check).
- The 500-line limit for authored files.
- Migrations must be reviewed before applying (ephemeral DB in tests).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Arabic, merchant-themed store shell

- [x] 1.1 Register the ar locale and the storefront Arabic dictionary — fa967d7
- [x] 1.2 Add shadcn components, theme bridge, portal container and dark-variant scope — fa967d7
- [x] 1.3 New store shell (header, menu sheet, search entry, footer) for all buyer pages and the preview — fa967d7
- [x] 1.4 Restyle existing sections and catalog views for RTL with token-driven utilities — fa967d7

Phase 1 closed (2026-10-25). Exit gate evidence:
- Gates: generate, typecheck, lint (0 errors), ds:check, unit 204/204, build, integration 26/26 including TC-STOREFRONT-007 (OS dark mode, 390 and 1280 px, two themes).
- Browser check on three local stores (classic, desert/large radius, midnight dark palette) at 390 and 1280 px with OS dark mode: 89/89 checks. Each store keeps its own colours; the page and menu sheet read RTL; the sheet is portalled inside the themed root and opens from the right edge; Escape returns focus; the skip link reaches main; no console errors; no horizontal scroll. The dashboard keeps admin dark mode and LTR, and the builder preview renders the store theme inside admin dark mode.
- Code review (om-code-review): approve, with 4 minor findings and 2 nits; see the PR.

Phase 1 notes (decisions L8–L12 on the spec branch, PR #2):
- `ar` is declared on the locale type registry only, not registered at runtime, so dashboards keep their language switcher (L11).
- The search entry in the header moves to step 2.2 with the search page, so Phase 1 links to no missing page.
- `button` and `card` are reused; `sheet`, `badge`, `separator` and `skeleton` were added with the shadcn CLI (`rtl: true`, adds `radix-ui`) (L12).
- The builder preview gets the theme and RTL layout but no shell; its controls and labels stay the admin's.
- The portal sign-in link left the header (L8). Platform notice bars are hidden on store pages (L9, ⚠ owner confirmation). New stores seed an Arabic home page, and merchant paragraphs take their own direction (L10).
- Carried to Phase 2: prices formatted with `ar-YE` (spec Localization) in the product card rework (2.2); a cross-tenant menu-link probe with the Phase 2 isolation checks.

### Phase 2: Browse and search

- [x] 2.1 Public catalog rule and search service — 6f95ce5
- [x] 2.2 Search page, collections index, collection pages, product cards, filters, sort, pagination — 6f95ce5
- [x] 2.3 Decision record superseding K2 for the shop — 1fab748 (spec branch, DECISIONS L13)

Phase 2 evidence (2026-10-25):
- Gates: generate, typecheck, lint (0 errors, 8 pre-existing warnings), ds:check, unit 213/213; integration 32/32 (ephemeral), including the new TC-STOREFRONT-008 (search, filters, sort, paging, collections) and TC-STOREFRONT-005 updated for S-2 and Arabic prices.
- Browser check on two differently themed local stores (dates-corner, honey-house; OS dark mode, 390 and 1280 px): 17/17. Filter sheet portalled in the themed root and opening from the right; staged apply writes `category=` to the URL; sort and in-stock write the URL; empty results name the query; clear-all keeps the query; multi-word search; the other store's products, product pages and category pages are absent or 404; inactive products absent or 404; menu links stay in the store; no console errors.
- Blocks from ecomcn (registry `@ecomcn`, installed with the shadcn CLI, `rtl: true`): product-card, product-grid, price-tag, filter-panel, filter-sheet, sort-toolbar, empty-results, category-rail. shadcn: pagination, carousel, slider, switch, toggle. Strings localized via `useT`, Arabic plural counts, prices formatted once on the server (ar-YE), Embla scrolls RTL.
- The collections index reuses the CollectionList section cards (ecomcn collection-grid holds three editorial tiles only).
- The seeded example store's prices are all channel-bound, so anonymous buyers see none there; local verification used dev fixtures with channel-less YER prices (owner question: default sales channel for store prices).

### Phase 3: Product page and persisted cart

- [x] 3.1 Cart migration, entities, validators, service and commands — fd7a779
- [x] 3.2 Cart API routes with OpenAPI — fd7a779
- [x] 3.3 Variant and personalization resolution and the product purchase panel — fd7a779
- [x] 3.4 Cart sheet, cart page and header count — fd7a779

Phase 3 closed (2026-10-26). Exit gate evidence:
- Gates: generate, typecheck, lint (0 errors, 8 pre-existing warnings), ds:check, unit 218/218, build, integration 36/36 (ephemeral; migration applied on the fresh database), including TC-STOREFRONT-009 (cart API, refusals, isolation, phone buyer flow).
- Browser check on the two themed local stores at 390 and 1280 px with OS dark mode: 38/38. The button names the missing option, then the required personalization field, and focuses it; an unmade combination reads unavailable; the price follows the variant; the cart sheet is portalled in the themed root and opens from the left edge (end); options and personalization show verbatim; the subtotal comes from the server; no checkout button; the count survives reload; the cart page edits personalization (an empty required field is refused in Arabic), re-prices on quantity and empties after undoable removal; another store sees an empty cart with the same browser; another store's line id answers 404; no console errors. A scan for English UI text found none on any store page or overlay.
- The local sandbox database got the cart migration through `yarn db:migrate` (development data only); the ephemeral test database applies it on its own.
- Code review (om-code-review): approve. Two major findings were fixed during the review: the rate limit is keyed by IP, else by cart token (it was one bucket per store when the IP is unknown), and a same-line insert race retries once. Six minor findings and two nits remain; see the PR.

Phase 2–3 notes (decisions L13–L19 on the spec branch, 1fab748):
- Add-to-cart is never disabled for a missing step: it names the step and focuses it (ecomcn pattern, L17). Line removal uses the ecomcn undo bar instead of a confirmation dialog.
- Cart commands are not undoable and not audited (L18); `storefront.cart.updated` carries ids only.
- Close labels on store pages use storefront-owned keys, because the app's English dictionary overrides `ui.*` keys (L19).
- Dashboard follow-ups recorded in the spec: store price channel, personalization field editor, stock badge threshold.
- Carried to Phase 4: stock check on merged quantities; keep order access independent of purged carts; two-tenant integration probes (TEST-J11).

PR review fixes (CodeRabbit, 2026-10-26):
- Cart line personalization is encrypted at rest (`storefront/encryption.ts`); cart reads use the decryption helpers. Existing tenants need `yarn mercato entities seed-encryption --tenant <id>`.
- The cart view returns blank optional personalization fields, so the buyer can fill them in from the cart.
- Price filter, price sorts and the price facet compare amounts in one currency (the most common one); the price range accepts at most nine integer digits a side.
- Lightbox description and empty-gallery text are translated; the cart edit dialog shows a message for unexpected failures; the stepper draft yields to a cart that settled on another quantity.
- Integration cleanup reports failed deletions.
- Gates: typecheck, lint (0 errors), ds:check, unit 219/219, integration 36/36 (includes the build). Local check: the stored value is ciphertext after add, merge, quantity change and edit.

Second review round (2026-10-26) — b91bdd2:
- Search narrows by text, collection and category in SQL over light columns, up to 2,000 matches (L16 amended); prices, stock and paging run on that set.
- A selected category always shows as a removable option; a collection page drops a `category` parameter.
- Arabic-Indic digits work in quantities, the price filter, numeric personalization and listing URLs (`src/lib/digits.ts`).
- preview-data keeps `price` as text and adds `priceDetail` (backward compatible).
- Cart writes lock the cart row; merges are checked against stock; lines are priced at their quantity; purchase models load in parallel; PATCH and DELETE renew the cookie.
- The client ignores an older cart answer; the cart sheet and page show a failed read with a retry; a variant priced in another currency shows that currency.
- ecomcn MIT notice added (THIRD_PARTY_NOTICES.md).
- Regression tests: unit (search cap and paging, facets, digits, preview wire, client cart ordering, sheet error, buy-box currency) and TC-STOREFRONT-010 (concurrency, cookie, quantity tiers, WMS tracked stock, a second store, collection filter).

### Phase 4: Checkout, order placement and tracking

- [x] 4.1 Yemen regions dataset and checkout options endpoint
- [x] 4.2 Yemen-zones shipping provider and the shop-fixtures CLI
- [x] 4.3 Quote and placement services, order access, idempotency
- [x] 4.4 Checkout page and confirmation
- [x] 4.5 Tracking API and page

Phase 4 notes (decisions L20–L26 on the spec branch):
- Dataset: OCHA COD-AB Yemen v01, 22 governorates and 335 districts (`lib/yemen`), attribution in THIRD_PARTY_NOTICES.md.
- Delivery: provider `suqna-yemen-zones` registered from `storefront/di.ts`; the destination rides in the order's shipping-method snapshot.
- Quote = order: the quote runs the live cart lines and both methods through `salesCalculationService`; placement re-quotes with live stock and answers 409 with the new quote on any change.
- Placement claims the cart, creates the order with `sales.orders.create` outside storefront transactions, then records access (one order per cart; a double submit returns the same order).
- Order access: token derived from the cart token, SHA-256 at rest, one HttpOnly cookie per order; new table `storefront_order_access` (`Migration20261026033409_storefront`, with a `down`).
- UI: ecomcn address form (district list follows the governorate), checkout stepper, delivery options, payment selector, order confirmation; shadcn combobox, radio group, field, input group, collapsible. New dependency: `@base-ui/react` (shadcn combobox).
- Dev data: `yarn mercato storefront shop-fixtures --tenant <id>` adds a sample delivery method.
- Owner items: personalization on order lines is not encrypted by the sales module (L23 ⚠); record-updating workflows do not run on buyer orders without a user (L26 ⚠).
- Deployment: run the new migration; existing tenants also need `yarn mercato entities seed-encryption --tenant <id>` (cart personalization, Phase 3 review).

Phase 4 closed (2026-10-26). Exit gate evidence:
- Gates: generate, typecheck, lint (0 errors, 8 pre-existing warnings), ds:check, unit 248/248, build, integration 50/50 (ephemeral, no retries), `db:generate` probe with no changes.
- TC-STOREFRONT-011: options and refusals; quote = sales order totals; one order for a double submit; 409 with a new quote after a price change; bank transfer with field errors; another store's methods and token answer like unknown ones; a 390 px buyer flow (classic theme) and a 1280 px flow on a second store (midnight theme) from cart to tracking page, with the governorate list portalled in the themed root and no English UI text.
- Code review (om-code-review): approve, three minor findings and one nit (direct sales/dictionary reads by scalar id; stale-claim takeover after a failed access write; fixtures command context; checkout file size).

Third review round (CodeRabbit batch A, review 5675006784, 2026-10-27). Each finding was checked against the code:
- Placement (major, held): an order created but not recorded (a failed access write, or a create slower than the claim TTL) let a later submit take the claim over and create a second order. Fixed: the order id is saved on the cart right after `sales.orders.create`; a later submit finds it and finishes the same order (access row, cart closed) instead of waiting or placing again; the claim is refreshed every 20 s while the create runs; the final write locks the cart, so two submits finishing the same order agree. Residual: a process crash between the create and saving its id on the cart is not covered (closing it would need a sales-order lookup by cart).
- Checkout client (held): a network failure left "Confirm order", options and quote loading forever. Requests now answer a network failure like a failed request, so each step shows its error and can retry.
- Order page (held): a stale `k` link with a valid order cookie put the stale token into the permalink. The permalink now uses the token that opened the order.
- Search (held): the category intersection built a `Set` per element; now once.
- TC-STOREFRONT-010 (held): the store A search now asserts 200 before the isolation check.
- Seeded home text "upload the receipt" (not changed): Phase 5 on this PR ships the buyer's transfer-proof upload, so the text becomes true before merge.
- `.coderabbit.yaml` batch filters: the owner's temporary review config, already restored in e3f411d.
- Correction: `yarn ds:check` was failing at 5f487f8, not passing as reported: the 13 baseline entries for `ecomcn/order-confirmation.tsx` pointed 4 lines above their code (the file grew after they were recorded). Re-anchored; the entries are otherwise unchanged.
- Regression evidence: the new TC-STOREFRONT-011 case fails on the old code (a fresh unfinished claim answered 409; a stale one created a second order, 201) and passes with the fix; unit test for the checkout request on a network failure.
- Gates: typecheck, lint (0 errors, 8 pre-existing warnings), ds:check, unit 250/250, integration 51/51 with build (ephemeral, no retries). No entity change (the cart's existing `converted_order_id` column carries the order id).

### Phase 5: Transfer proof and the full journey

- [ ] 5.1 Transfer proof route and form
- [ ] 5.2 Full journey and isolation verification on two stores and themes
