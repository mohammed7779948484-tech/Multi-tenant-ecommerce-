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

- [ ] 1.1 Register the ar locale and the storefront Arabic dictionary
- [ ] 1.2 Add shadcn components, theme bridge, portal container and dark-variant scope
- [ ] 1.3 New store shell (header, menu sheet, search entry, footer) for all buyer pages and the preview
- [ ] 1.4 Restyle existing sections and catalog views for RTL with token-driven utilities

### Phase 2: Browse and search

- [ ] 2.1 Public catalog rule and search service
- [ ] 2.2 Search page, collections index, collection pages, product cards, filters, sort, pagination
- [ ] 2.3 Decision record superseding K2 for the shop

### Phase 3: Product page and persisted cart

- [ ] 3.1 Cart migration, entities, validators, service and commands
- [ ] 3.2 Cart API routes with OpenAPI
- [ ] 3.3 Variant and personalization resolution and the product purchase panel
- [ ] 3.4 Cart sheet, cart page and header count

### Phase 4: Checkout, order placement and tracking

- [ ] 4.1 Yemen regions dataset and checkout options endpoint
- [ ] 4.2 Yemen-zones shipping provider and the shop-fixtures CLI
- [ ] 4.3 Quote and placement services, order access, idempotency
- [ ] 4.4 Checkout page and confirmation
- [ ] 4.5 Tracking API and page

### Phase 5: Transfer proof and the full journey

- [ ] 5.1 Transfer proof route and form
- [ ] 5.2 Full journey and isolation verification on two stores and themes
