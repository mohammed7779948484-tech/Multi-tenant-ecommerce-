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

### Phase 4: Checkout, order placement and tracking

- [ ] 4.1 Yemen regions dataset and checkout options endpoint
- [ ] 4.2 Yemen-zones shipping provider and the shop-fixtures CLI
- [ ] 4.3 Quote and placement services, order access, idempotency
- [ ] 4.4 Checkout page and confirmation
- [ ] 4.5 Tracking API and page

### Phase 5: Transfer proof and the full journey

- [ ] 5.1 Transfer proof route and form
- [ ] 5.2 Full journey and isolation verification on two stores and themes
