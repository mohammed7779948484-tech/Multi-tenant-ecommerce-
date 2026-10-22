# Storefront Builder

**Date**: 2026-10-22
**Status**: Ready for implementation

> Authored with `om-spec-writing --autonomous` (skeleton → resolved assumptions → research → design → breakdown → review). Every autonomous default is recorded in **Resolved assumptions** and in the **Open Questions** table so the product owner can override it before a dependent phase starts.

## TLDR

Every Suqna merchant gets a per-tenant storefront that looks like their brand within minutes of self-service signup: a site and theme are seeded when the tenant is created, a default home page is published immediately, and a brand wizard in the admin sets the store name, logo, eight colour tokens, a font pair, a corner radius and a density. Phase 2 adds page authoring (pages with draft/publish/rollback and a section builder whose editor uses `json-render` for section picking and live preview), Phase 3 media and commerce blocks, Phase 4 SEO and indexability. Custom-domain canonical hosts (roadmap Phase 5) and catalog-constrained AI generation (roadmap Phase 6) are designed in their own follow-up specs. Public pages are server-rendered by our own block registry; no client JSON renderer ships to buyers. Reused: `onboarding`, `directory`, `portal`, `customer_accounts` (buyer identity, `domain_mappings`), `catalog`, `attachments`, `translations`, `audit_logs`.

## Resolved assumptions (autonomous defaults)

Owner-chosen defaults from the brief are marked **owner**; the rest are autonomous defaults picked as the most reversible, lowest-blast-radius answer.

| ID | Decision | Rationale | Marker |
|---|---|---|---|
| Q1 | One spec for the storefront builder (Phases 1–4); custom domains + canonical host (roadmap Phase 5), AI generation (roadmap Phase 6), storefront translations and self-hosted webfonts get their own follow-up specs. | Revised after the scope-cohesion review: those capabilities each work on the Phase 1 foundation alone, so they are independently deployable and are split out. | — |
| Q2 | Public platform path is `/{siteSlug}` (pages later `/{siteSlug}/{pageSlug}`), a sibling of `/{orgSlug}/portal`. Static platform routes win by route specificity; colliding slugs are reserved. | Mirrors the installed `[orgSlug]` portal convention and keeps URLs short; reversible by adding a prefix route later. | ⚠ NEEDS HUMAN CONFIRMATION |
| Q3 | Storefront owns `site.slug`, initialised from the organization slug, globally unique, frozen after first publish. | The public path is platform-global, so it needs its own global uniqueness; the organization slug stays the portal's concern. Frozen-after-first-publish is the owner's default. | owner (freeze) |
| Q4 | Brand/theme saves go live immediately; drafts/revisions apply to pages only (Phase 2). | Smallest surface; "new stores publish immediately" is the owner's default. A theme draft can be added later without changing tokens. | ⚠ NEEDS HUMAN CONFIRMATION |
| Q5 | Phase 1 offers curated **system font stacks** (no font files, no third-party requests); self-hosted webfont files join the same enum in the follow-up webfonts spec. | Satisfies "self-hosted" trivially (nothing is fetched from a third party) without adding a dependency in Phase 1. | owner (self-hosted) |
| Q6 | RichText is a constrained structured document (paragraphs, bullet/numbered lists, bold/italic marks, links) rendered as React text nodes — never HTML. | "Sanitised" by construction: there is no HTML to sanitise, so no sanitiser bypass exists. | owner (limited rich text) |
| Q7 | Module id `storefront`. | Matches the requested `/backend/storefront/...` route; the plural guideline yields to the explicit route (installed `catalog`, `portal`, `content` are singular too). | — |
| Q8 | Phase 1 includes the logo (upload through `attachments`, public serving through a site-scoped media route that serves only assets the site references). | The brand is name + logo + colours + fonts; the media route is designed once and extended in Phase 4. | — |
| Q9 | Existing tenants are backfilled by an idempotent CLI command `yarn mercato storefront ensure-sites`. | Reversible, explicit, and reuses the same idempotent seeding function as `onTenantCreated`. | — |
| Q10 | One storefront per organization; `onTenantCreated` seeds it for the tenant's initial organization. | Portal routes, buyer accounts and domain mappings are organization-scoped. | — |
| D1 | Store served at its platform path at launch; custom-domain binding available. | — | owner |
| D2 | New stores publish immediately. | — | owner |

## Problem Statement

A Suqna merchant who signs up today receives an admin back office (catalog, orders, inventory, customers) and a customer portal at `/{orgSlug}/portal`, but no public storefront. They cannot show their brand, content or products to buyers without building a separate website, which breaks the platform's core promise: a store of their own within minutes of signup. No installed Open Mercato module models a site, theme or page, and none offers a page builder. Evidence: the enabled frontend routes are only portal, auth, onboarding, legal and token pages (`.mercato/generated/frontend-routes.generated.ts`).

## Overview and Success Measures

- **Primary outcome:** a merchant who completes signup has a public, branded home page reachable at `/{siteSlug}` without any manual setup, and can re-brand it in under five minutes.
- **Leading indicators:** share of new tenants with a seeded site (target 100%); share completing the brand wizard within the first session; public page server response time (target p95 < 300 ms uncached on the dev profile) and zero client-side renderer bundles on public pages.
- **Baseline:** 0 storefronts; 0 public merchant pages.
- **Market / product reference:** Shopify Online Store 2.0 (JSON templates of sections and blocks, theme settings), Puck and GrapesJS (open-source visual editors), WordPress Gutenberg (typed blocks with validation), Medusa and Saleor (headless commerce with a separate Next.js storefront). See **Research** for what is adopted and rejected.

## Goals

- **REQ-001** — Every new tenant gets one storefront site, theme and published home page during provisioning, idempotently.
- **REQ-002** — A merchant can set store name, description, logo, eight colour tokens, a font pair, radius and density from `/backend/storefront/brand`, with validation errors per field and optimistic-lock conflict handling.
- **REQ-003** — The public home page `/{siteSlug}` is server-rendered by the storefront's own block registry with the site's theme tokens as scoped CSS custom properties and correct page metadata (title, description, canonical, Open Graph, JSON-LD).
- **REQ-004** — Page specs are validated on save, on publish and on render; unknown block types, unknown props, oversize specs and disallowed URLs are rejected with field-level errors and never rendered best-effort.
- **REQ-005** — Strict tenant isolation: every query is scoped by the trusted `tenant_id`/`organization_id`; a cross-tenant id answers 404.
- **REQ-006** — Merchants manage pages with draft and published states, immutable publish revisions and rollback; the public site serves only published revisions.
- **REQ-007** — Merchants add, reorder, edit and remove sections in a builder whose editor uses `json-render` (catalog, live preview) while public pages never ship a client JSON renderer.
- **REQ-008** — Media and commerce blocks (Image, Gallery, ProductGrid, CollectionList) render tenant-scoped attachments and catalog data.
- **REQ-009** — Stores are indexable: per-page SEO fields, a per-store sitemap and robots policy, cache revalidation on publish.

Follow-up specs (separate documents, not designed here): **storefront custom domains and canonical host** (roadmap Phase 5: one canonical host per store, verified domain binding, 301 from the non-canonical host, `src/proxy.ts` change), **storefront AI generation** (roadmap Phase 6: catalog-constrained generation behind a flag and `ai_assistant`), **storefront translations**, **self-hosted webfonts**.

## Non-goals

- Checkout, cart, payments or any payment gateway (policy: cash on delivery and bank transfer through `sales`).
- Merchant-supplied CSS, HTML, scripts, class names or inline styles — ever.
- A shared cross-tenant buyer identity or platform-wide buyer cookie.
- Shipping `@json-render/react` or any client JSON renderer to public pages.
- Multiple storefronts per organization; theme marketplaces; third-party theme code.
- Blog/articles, forms, and A/B testing (candidates for later specs).

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Merchant admin (tenant `admin` role) | View storefront status, edit brand; (Phase 2) manage and publish pages | own organization; derived from staff session | `storefront.view`, `storefront.brand.manage`; Phase 2: `storefront.pages.manage`, `storefront.pages.publish` |
| Merchant employee | View storefront status and public URL | own organization | `storefront.view` |
| Platform superadmin | Same as admin within the selected organization | selected organization via the standard org switcher | wildcard grants |
| Anonymous buyer | Read published pages and site-referenced public media | site resolved from the public slug (a verified domain mapping is added by the custom-domains follow-up spec) | none |
| Signed-in buyer | Same as anonymous; portal links go to that tenant's `/{orgSlug}/portal` | tenant-scoped `customer_accounts` session (host-only cookie) | portal features (unchanged) |

Staff scope is derived from the authenticated session and the organization switcher (`resolveOrganizationScopeForRequest`); request bodies never carry `tenantId`/`organizationId`. Anonymous scope is derived only from a site row resolved by its globally unique slug (or verified domain) and is then pinned to that row's `tenant_id`/`organization_id` for every subsequent read. Setup hooks receive trusted `tenantId`/`organizationId` from `setupInitialTenant`.

## Research

Requirements were challenged against the leaders in hosted and open-source storefront building.

| Product | What it gets right | Adopted here | Rejected / skipped and why |
|---|---|---|---|
| Shopify Online Store 2.0 | Pages are JSON templates of typed **sections** with schema-declared settings; theme settings are a typed schema; hard caps (25 sections per template, 50 blocks per section) keep pages fast and editable | Typed section catalog with schema-validated props; theme as a typed token set; hard caps (40 sections, 30 pages, 64 KB) | Liquid templates and merchant theme code: arbitrary code is a security and support liability; our merchants never ship code |
| Puck (MIT, React) | Component config `{ fields, defaultProps, render }`; data as JSON; editor and renderer share the same config | One catalog drives editor field forms, preview and SSR render | Puck's client renderer on public pages and its open `zones`/slots model; we render server-side and keep pages flat (Page → sections) in v1 |
| GrapesJS | Mature drag-and-drop editing | — | Stores raw HTML/CSS: exactly the merchant HTML/CSS surface our security model forbids |
| WordPress Gutenberg | Typed blocks with attribute schemas; invalid blocks are detected and never silently "fixed" | Validation on save, publish and render; invalid content is rejected, not rendered best-effort | Block HTML serialisation (`<!-- wp:... -->` comments); we store pure JSON |
| Medusa / Saleor | Headless commerce with a separate Next.js storefront, SSR for SEO | SSR for SEO and Core Web Vitals | A separate storefront app per merchant: multi-tenant theming must live inside the platform |
| `json-render` (vercel-labs) | A catalog of components with Zod props constrains what a spec (or an AI) may describe; flat `{ root, elements }` specs; `catalog.prompt()` for AI | Spec shape `{ root, elements }`; Zod props per block; the same catalog becomes a `defineCatalog` in the editor (Phase 2) and in the AI follow-up spec | Its dynamic expressions (`$state`, `$cond`, `$template`, `$computed`, directives such as `$t`), `visible`, `on`, `watch` and `repeat` are rejected in stored specs: public pages are static, literal content |

Complexity skipped deliberately: nested layouts and named slots (v1 pages are a flat list of sections), per-section custom CSS, scripted interactions, theme inheritance trees.

## Proposed Solution

A new app module `storefront` owns sites, themes and pages. It keeps a server-safe **block catalog** — one Zod props schema per block, with no React import — and a separate **server block registry** mapping each block type to an SSR-safe React component. A page is stored as JSON in the shape `{ root, elements }`, validated by our schema (the source of truth) on save, on publish and on render. The public route `/{siteSlug}` resolves the site by its globally unique slug, pins every subsequent query to that site's tenant and organization, validates the published spec, and renders it through the registry inside a wrapper that carries the theme as CSS custom properties. Page metadata (title, description, canonical, Open Graph, JSON-LD) is rendered by the page and hoisted into `<head>` by React 19. `json-render` enters only in the admin editor (Phase 2), which adapts the same catalog with `defineCatalog` for section picking and live preview, and later for catalog-constrained AI generation (follow-up spec).

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Own block catalog + SSR registry for public pages | SEO and Core Web Vitals; zero client renderer JS on buyer pages | `@json-render/next` `createNextApp` / `@json-render/react` `Renderer` on public pages | Ships a client renderer and hydration to buyers; owner decision forbids it |
| Catalog definitions separate from React components | Server-safe validation (API, setup, CLI) without importing React; mirrors `@json-render/shadcn/catalog` vs `@json-render/shadcn` | One file per block with schema + component | Would drag React into validators and setup hooks |
| Flat page: root `Page` element whose children are sections; sections have no children | Simple validation, reorder is a list operation, matches section-based market leaders | Arbitrary nesting with slots | Harder to validate and edit; no v1 requirement needs nesting |
| Theme as validated tokens in JSONB with a `version` | Token set can grow (new colours, fonts) without migrations; validated on every read | One column per token | Migration per token change; no validation benefit |
| Theme CSS = constant structural stylesheet + generated custom-property block | No merchant CSS; values come only from validated tokens | Tailwind arbitrary values per element; inline `style` from merchant data | Violates the design-system rule and the "no inline styles" rule |
| RichText as a structured document | No HTML anywhere, so nothing to sanitise | Sanitised HTML (e.g. `sanitize-html`) | Sanitiser bypasses are a recurring vulnerability class |
| Brand saved through one command on the site aggregate | One transaction, one optimistic-lock version, one undo | Separate site and theme endpoints | Two writes can half-fail and need two versions |
| Public media through a site-scoped route that serves only referenced assets | Anonymous buyers cannot read tenant-scoped attachments through `/api/attachments/image` (it answers 401), and making a partition public would expose every asset | Moving storefront assets into the public `productsMedia` partition | Any tenant-scoped id would still 401; and public partitions widen exposure beyond what the site references |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Site | The storefront of one organization; at most one non-deleted site per `(tenant_id, organization_id)` | `storefront_sites` | Seeding is idempotent: an existing site is reused |
| Site slug | Public path segment; `^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$`; globally unique among non-deleted sites; not a reserved word; frozen once `first_published_at` is set | `storefront_sites.slug` | Seeding derives it from the organization slug, appends `-2`, `-3`… on collision or reserved word; Phase 1 has no slug edit, Phase 2 allows edits only before first publish |
| Reserved slugs | `api, backend, login, logout, reset, onboarding, terms, privacy, docs, quote, messages, checkout-demo, portal, sitemap.xml, robots.txt, favicon.ico, assets, static, _next, admin, storefront` | code constant | Treated as a collision |
| Theme tokens v1 | `{ version: 1, colors: { background, surface, text, mutedText, primary, onPrimary, accent, border }, fonts: { heading, body }, radius, density }`; colours `#rrggbb` (lower-cased on save); fonts from the font-stack enum; radius `none|sm|md|lg|full`; density `compact|comfortable|spacious` | `storefront_themes.tokens` | Rejected field by field |
| Contrast floor | `text` on `background` and `onPrimary` on `primary` must reach 3:1 (WCAG AA large text); below 4.5:1 the wizard warns | validator | 400 with field errors |
| Page spec | `{ root: string, elements: Record<string, Element> }`; `elements[root].type === 'Page'`; `Page.children` lists section ids (0–40); each section is referenced exactly once, has no children, and its `type` is a catalog block; element keys are exactly `type`, `props`, `children`; props are validated by the block's strict Zod schema | `storefront_pages.published_spec` (Phase 2 adds `draft_spec`) | Rejected with a list of `{ path, code, message }` issues; at render time an invalid spec renders the neutral "store unavailable" page with `noindex`, never a partial page |
| Text limits | 200 characters per text field unless the block allows more (Hero heading 120, RichText total text 5,000, alt text 200) | block schemas | Field-level error |
| Safe href | `/`-rooted site-relative path (not `//`, no backslash or control characters) or an absolute `https:` URL; ≤ 500 characters | validator | Rejected; `javascript:`, `data:`, `http:` and protocol-relative URLs never pass |
| Asset reference | Images are attachment ids (UUID) belonging to the site's tenant and organization; never URLs | validator + media route | Unknown, foreign or unreferenced ids answer 404 |
| Caps | Spec ≤ 64 KB serialised; ≤ 40 sections per page; ≤ 30 pages per store | validator / page command (Phase 2) | 400 with a readable message |
| Published | Phase 1: `published_spec` + `published_at` on the page. Phase 2: an immutable `storefront_page_revisions` row per publish; rollback publishes a copy of an earlier revision | `storefront_pages`, `storefront_page_revisions` | Public site reads only published content |

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Tenant and organization creation | reuse | `onboarding`, `auth` `setupInitialTenant`, `directory` | `setup.onTenantCreated` hook | Signup already provisions tenant + org + owner |
| Organization name and slug for seeding | reuse (read-only) | `directory` `Organization` | scoped `findOneWithDecryption` in the seeding function | The platform identity module; snapshot into the site, never a relation |
| Sites, themes, pages, revisions | app-own | new `storefront` | own entities, commands, APIs | No installed module models a storefront |
| Logo and images | reuse | `attachments` | `POST /api/attachments` for upload; DI `storageDriverFactory` + scoped read for public serving | Existing storage, partitions, quotas, thumbnails |
| Buyer identity and portal | reuse unchanged | `customer_accounts`, `portal` | links to `/{orgSlug}/portal` | Tenant-scoped buyers already exist |
| Custom domains | reuse (follow-up spec) | `customer_accounts` `domain_mappings` + `src/proxy.ts` | domain-resolve endpoint + proxy rewrite | Verified domains already exist |
| Products and categories | reuse (Phase 4) | `catalog` | scoped read service / query engine | Source of truth for products |
| Translations | reuse (follow-up spec) | `translations` | `translations.ts` for site fields | Translation Manager already exists |
| Audit | reuse | `audit_logs` | command bus action logs | Every command is audited automatically |
| AI generation | reuse (follow-up spec, optional) | `ai_assistant` (currently disabled) | guarded optional DI + feature flag | Nothing in this spec may depend on it |

## Architecture and Data Flow

```text
signup /onboarding --verify--> setupInitialTenant --> storefront setup.onTenantCreated
                                                      --> ensureStorefrontSite(em, scope)
                                                          --> storefront_sites + storefront_themes
                                                          --> storefront_pages(home, published_spec)
                                                          --> event storefront.site.created
admin /backend/storefront/brand --apiCall--> PUT /api/storefront/brand
                                              --> mutation guards --> command storefront.brand.update
                                              --> site + theme (one transaction, site.updated_at lock)
                                              --> event storefront.brand.updated (after commit)
buyer GET /{siteSlug} --> (frontend) catch-all --> storefront/frontend/[siteSlug]/page.tsx (server)
                      --> site by slug --> theme + home page scoped to the site's tenant/org
                      --> validatePageSpec --> block registry (SSR) --> HTML + scoped CSS vars + <head> metadata
buyer GET /api/storefront/media/{siteSlug}/{attachmentId} --> site-referenced? --> attachment bytes (scoped)
editor (Phase 2) --> json-render defineCatalog(adapter(blockCatalog)) --> section picker + live preview (admin only)
```

- **Module boundaries:** `storefront` owns everything storefront-specific; it reads `directory`, `attachments` and (Phase 4) `catalog` only by scalar id under the site's scope, and never holds an ORM relation to them.
- **Extension points:** setup hook (`onTenantCreated`), page metadata/nav, frontend page discovery, API discovery, command bus, typed events, CLI command, i18n catalogs.
- **Alternatives considered:** a CMS-style `content` page (the installed `content` module only serves static legal pages and has no data model), and Shopify-style themes as code (rejected above).
- **Compatibility:** all identifiers are new and additive. Once released they are frozen surfaces under `BACKWARD_COMPATIBILITY.md`: routes `/api/storefront/*`, `/backend/storefront*`, `/{siteSlug}`; entity ids `storefront:site|theme|page|page_revision`; events `storefront.*`; ACL features `storefront.*`; CLI `storefront ensure-sites`; the page-spec JSON shape (versioned through its schema; additive evolution only).

## User Journeys

### Journey J-001 — Signup to a live storefront

1. A merchant signs up at `/onboarding`, verifies their email and is provisioned.
2. `onTenantCreated` seeds the site (slug from the organization slug), default theme tokens and a published home page built from the default template with the store name.
3. The merchant visits `/{siteSlug}` and sees a branded home page; the admin overview shows the public URL.
4. Failure: if seeding throws, provisioning surfaces the error from `setupInitialTenant`; the seeding function is idempotent, so `yarn mercato storefront ensure-sites --tenant <id>` repairs a partially provisioned tenant.

### Journey J-002 — Re-brand in the wizard

1. The merchant opens `/backend/storefront` → **Edit brand** → `/backend/storefront/brand`.
2. Steps: Identity (name, description, logo upload) → Colours (eight tokens, presets, contrast hints) → Typography and shape (font pair, radius, density) → Review (preview and save).
3. Save sends one `PUT /api/storefront/brand` with the record version; the public page reflects the change on the next request.
4. Failures: field errors keep the user's input; a 409 shows the shared conflict dialog with reload; a missing site (404) shows guidance to run the ensure command; an upload error keeps the previous logo.

### Journey J-003 — Buyer visits a store (Phase 1 scope)

1. A buyer opens `/{siteSlug}`; the server renders the home page with the theme, logo and metadata.
2. The header's **Sign in** links to `/{orgSlug}/portal/login` of the same tenant.
3. Failure: unknown slug → 404; a spec that fails validation → neutral "store unavailable" page with `noindex` and an error log entry.

### Journey J-004 — Page authoring (Phase 2)

Merchant creates a page (draft), adds/reorders sections in the builder with live preview, publishes (immutable revision), later rolls back to an earlier revision; buyers only ever see published revisions. Slug edits are allowed until the first publish.

## UI and Interaction Contracts

Closest installed references: `/backend/directory/branding` (directory organization branding page: logo upload with `ImageUpload`, single-record settings form) and `/backend/customer_accounts/settings/domain` (single-record settings with status/stepper). Rules: `.ai/guides/backend-ui.md`, `om-backend-ui-design`.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/storefront` | Overview: public URL, theme summary (swatches, fonts), last change; **Edit brand**, **View store** | `GET /api/storefront/brand` via `apiCall` | `/backend/customer_accounts/settings/domain` | `Page`, `PageBody`, `SectionHeader`, `Button`, `LoadingMessage`, `ErrorMessage`, `EmptyState` | loading, empty (no site → guidance), error, permission denied | REQ-001, REQ-002 |
| `/backend/storefront/brand` | Brand wizard (CrudForm with step groups) | `GET`/`PUT /api/storefront/brand`; logo via `POST /api/attachments` | `/backend/directory/branding` | `Page`, `CrudForm` (groups as steps; `type: 'custom'` fields for colour, font pair, radius, density, logo via `ImageUpload`) | loading, validation error, server error, conflict (409), success flash, permission denied | REQ-002, REQ-004 |
| `/{siteSlug}` (public) | Branded home page | server-side reads, no client fetch | `/[orgSlug]/portal` (public frontend page) | storefront server components only; no backend chrome | not found, unavailable (invalid spec), success | REQ-003, REQ-004, REQ-005 |
| `/backend/storefront/pages`, `/backend/storefront/pages/[id]` (Phase 2) | Page list, page settings, builder | Phase 2 APIs | `/backend/catalog/products` | `DataTable`, `CrudForm`, builder canvas (Phase 3 exception: `json-render` preview) | full set | REQ-006, REQ-007 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Merchant admin | **Storefront** → Overview (`/backend/storefront`); Brand reached from the overview action | none in Phase 1 | `/backend` → Storefront → Edit brand → Save (3 clicks) |
| Employee | **Storefront** → Overview (read-only, no Edit brand action) | none | `/backend` → Storefront |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Overview | "This organization has no storefront yet" + the ensure command for operators | single column below `md` | actions reachable in tab order; links have accessible names |
| Brand wizard | n/a (always seeded) | groups stack; colour grid 2 columns on narrow screens | CrudForm submit with Cmd/Ctrl+Enter; colour inputs labelled; contrast warnings announced via `role="status"` |

### `/backend/storefront/brand` — Brand wizard

```text
┌──────────────────────────────────────────────────────────────┐
│ Storefront brand                                  [View store]│
│ 1 Identity · 2 Colours · 3 Typography & shape · 4 Review      │
├──────────────────────────────────────────────────────────────┤
│ Identity: Store name [______]  Description [______]           │
│           Logo [ImageUpload]                                  │
│ Colours:  Background ■ #ffffff  Surface ■ …  (8 tokens)       │
│           Presets: [Classic] [Midnight] [Desert] [Forest]     │
│           ⚠ Text contrast 3.8:1 — consider a darker text      │
│ Typography & shape: Heading font ▾  Body font ▾               │
│           Radius ( none sm md lg full )  Density ( … )        │
├──────────────────────────────────────────────────────────────┤
│ Review: summary of changes          [View store] [Save brand] │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** one CrudForm, four groups presented as numbered steps; Save validates everything server-side and returns field errors keyed by field id (`name`, `colors.primary`, …); `initialValues.updatedAt` drives optimistic locking; a 409 opens the shared conflict surface.
- **Responsive and accessibility:** labels on every input; colour fields pair a native colour input with a HEX text input; focus moves to the first invalid field after a failed save.
- **Localization:** namespace `storefront.*` in `i18n/{en,de,es,pl,ko}.json`.
- **Design-system and theming:** admin UI uses semantic tokens only; merchant colours appear only inside the preview wrapper as CSS custom properties.

Exception (approved here): the colour, font-pair, radius, density and logo inputs are `type: 'custom'` CrudForm fields because no built-in field type renders a colour swatch or a segmented choice; they are composed from exported primitives (`Input`, `Button`, `ImageUpload`) and semantic tokens.

## Data Models

### `storefront:site` (`storefront_sites`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | index `(tenant_id, organization_id)`; partial unique `(tenant_id, organization_id) WHERE deleted_at IS NULL` | no | trusted context only |
| `slug` | text, required | partial unique `(slug) WHERE deleted_at IS NULL` (global) | no | see Site slug rule; frozen after `first_published_at` |
| `name` | text, required | — | no | 1–80 characters |
| `description` | text, nullable | — | no | ≤ 160 characters; default meta description |
| `logo_attachment_id` | UUID, nullable | — | no | attachment in the same tenant/org, image MIME |
| `default_locale` | text, required, default `en` | — | no | BCP-47 short code |
| `first_published_at` | timestamptz, nullable | — | no | set when the first page is published (seed sets it) |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | — | no | `updated_at` is the brand aggregate version |

### `storefront:theme` (`storefront_themes`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | index `(tenant_id, organization_id)` | no | trusted context only |
| `site_id` | UUID, required | partial unique `(site_id) WHERE deleted_at IS NULL` | no | scalar id of the owning site |
| `tokens` | JSONB, required | — | no | Theme tokens v1, validated on write and read |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | — | no | written by the brand command; versioned through the site |

### `storefront:page` (`storefront_pages`) — Phase 1 subset

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | index `(tenant_id, organization_id)` | no | trusted context only |
| `site_id` | UUID, required | partial unique `(site_id, slug) WHERE deleted_at IS NULL` | no | scalar id |
| `slug` | text, required | see above | no | `index` for the home page; Phase 2 page slugs follow the site slug grammar |
| `title` | text, required | — | no | ≤ 70 characters (search-result title length) |
| `seo_description` | text, nullable | — | no | ≤ 160 characters |
| `published_spec` | JSONB, nullable | — | no | valid page spec or null (unpublished) |
| `published_at` | timestamptz, nullable | — | no | set on publish |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | — | no | standard |

Phase 2 adds `draft_spec` (JSONB), `published_revision_id` (UUID) and the append-only `storefront:page_revision` (`storefront_page_revisions`: `id`, scope, `page_id`, `revision_no` unique per page, `spec`, `title`, `seo_description`, `published_by_user_id`, `created_at`; never updated or deleted). No field holds PII, so no encryption map is needed; merchant-entered text is public marketing content.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/storefront/brand` | auth + `storefront.view` | none | `{ site: { id, slug, name, description, logoAttachmentId, defaultLocale, firstPublishedAt, publicPath }, tokens, updatedAt }` | 401, 403, 404 (`storefront.errors.siteNotFound`), 400 `organization_scope_required` | REQ-002 |
| `PUT` | `/api/storefront/brand` | auth + `storefront.brand.manage` | `{ name, description \| null, logoAttachmentId \| null, tokens }` + optimistic-lock header from `updatedAt` | 200 `{ ok: true, updatedAt }`; event `storefront.brand.updated` after commit | 400 `{ error, fieldErrors }`; 403; 404; 409 stale version | REQ-002, REQ-004, REQ-005 |
| command | `storefront.brand.update` | via route; mutation guards run first | validated input + scope from context | updated site + theme in one `withAtomicFlush(..., { transaction: true })` | `enforceCommandOptimisticLock` on the site; undo restores the previous identity and tokens | REQ-002 |
| `GET` | `/api/storefront/media/{siteSlug}/{attachmentId}` | public (`requireAuth: false`) | path params | image bytes; `Cache-Control: public, max-age=300`; `X-Content-Type-Options: nosniff` | 404 for unknown site, unreferenced/foreign/non-image attachment (never 401/403) | REQ-003, REQ-005 |
| CLI | `yarn mercato storefront ensure-sites [--tenant <id>]` | operator | optional tenant | per-organization result lines | idempotent | REQ-001 |
| Phase 2 | `/api/storefront/pages` (makeCrudRoute), `POST …/pages/{id}/publish`, `POST …/pages/{id}/rollback`, `GET …/pages/{id}/revisions` | `storefront.pages.manage` / `storefront.pages.publish` | page fields / draft spec / revision id | revision rows; events `storefront.page.published`, `storefront.page.rolled_back` | 400 spec issues, 409, 404 cross-tenant | REQ-006 |

Both brand routes are custom (singleton aggregate, not a list), so they wire `runMutationGuards` with the caller's features, merge `modifiedPayload`, and run post-success callbacks after commit; each route exports per-method `metadata` and `openApi`. Scope is derived with `resolveOrganizationScopeForRequest`; body fields named `tenantId`/`organizationId` are ignored by the strict schema.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `storefront.site.created` | seeding function | workflow trigger discovery today (e.g. a "new store" automation) | — | emitted once per created site; seeding is idempotent so a re-run emits nothing |
| `storefront.brand.updated` | `storefront.brand.update` | workflow trigger discovery today; Phase 4 cache revalidation | — | after commit; command log gives audit and undo |
| `storefront.page.published` / `storefront.page.rolled_back` | Phase 2 commands | Phase 4 sitemap/cache | revalidation | after commit |

No jobs or notifications in Phase 1. No phase in this spec depends on an optional module.

## Security, Privacy, and Compliance

- **Authorization:** declarative `requireFeatures` on every page and API method; no role-name checks; UI hides Edit brand without `storefront.brand.manage` but the server enforces it.
- **Tenant isolation:** staff routes derive scope from the session and filter every read/write by `tenant_id` + `organization_id`; anonymous routes derive scope only from the site row found by slug and repeat those predicates on theme, page and attachment reads; ids from another tenant answer 404. Global uniqueness of `slug` is the only cross-tenant fact, and it reveals nothing beyond the public URL.
- **Content safety:** strict block schemas; text renders as React text nodes (no `dangerouslySetInnerHTML`); no merchant `className`, `style`, `ref` or HTML props exist in any schema; hrefs pass the safe-href rule; images are attachment ids served only through the site-scoped media route; JSON-LD is serialised with `<`, `>` and `&` escaped.
- **Theme CSS:** generated only from validated tokens (HEX regex, enums) into fixed custom-property names; the structural stylesheet is a code constant.
- **Abuse and failure modes:** slug enumeration reveals only public stores; oversize specs are rejected before parsing deeply (byte cap first); the media route answers 404 for everything it does not explicitly serve; buyer sessions stay tenant-scoped (`customer_accounts`, host-only cookie) and the storefront sets no cookies.
- **Sensitive data:** none stored by this module.

## Edge Cases and Failure Scenarios

| Scenario | Behaviour the user sees |
|---|---|
| Tenant deactivated (`tenants.is_active = false`) or organization soft-deleted | Public site resolution requires an active tenant and a non-deleted organization; otherwise `/{siteSlug}` answers 404 and the media route 404s. Staff routes already fail through auth. |
| Logo attachment deleted after it was set | Public page renders the store name in place of the logo; the media route answers 404; the wizard shows the logo as missing and lets the merchant upload another. |
| Seeding cannot derive a slug (organization slug empty or all reserved) | Slug falls back to `store-` + the first 8 characters of the organization id; still unique, still valid. |
| Two seeds race for the same slug | The partial unique index rejects the loser, which retries with the next suffix (bounded to 20 attempts, then the id-based fallback). |
| Stored tokens fail validation after a schema change | Render falls back to the default token set for the affected fields and logs a warning; the wizard opens with the stored values and field errors so the merchant can fix them. |
| `PUT /api/storefront/brand` with a `logoAttachmentId` from another tenant or a non-image | 400 with a field error on `logoAttachmentId` (no existence leak beyond "not a usable image"). |
| Database unavailable during public render | Standard 500 page from the framework; nothing partial is cached. |

## Integration Coverage

Tests are self-contained (each creates and removes its own fixtures) and map to real API and UI paths. Unit tests live in `src/modules/storefront/**/__tests__/`; API/UI integration tests in `src/modules/storefront/__integration__/` (auto-discovered by `.ai/qa/tests/playwright.config.ts`).

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | none | `validatePageSpec` on the default template and on malicious specs: unknown block, unknown prop, `$state`/`$cond` expression object, `className`/`style` prop, `javascript:`/`data:`/`http:`/`//` hrefs, dangling child, element referenced twice, nested children on a section, 41 sections, > 64 KB | default template valid; every malicious case rejected with a `{ path, code }` issue | REQ-004 |
| TEST-002 | unit | none | theme tokens: bad HEX, uppercase HEX (normalised), unknown font, contrast below 3:1, extra keys | rejections keyed by field path; normalisation applied | REQ-002, REQ-004 |
| TEST-003 | unit | none | slug derivation: reserved words, collisions, unicode/emoji names, length | valid slug grammar; deterministic suffixing | REQ-001 |
| TEST-004 | unit | none | CSS emission from tokens; JSON-LD serialisation with `</script>` in store name | only `--sf-*` declarations with validated values; `<` escaped | REQ-003, REQ-004 |
| TEST-005 | unit (command) | in-memory command context | `storefront.brand.update` execute, undo, stale version | identity + tokens updated together; undo restores; stale version → 409 | REQ-002 |
| TEST-006 | integration (API) | tenant A admin + employee (created through onboarding or `auth setup`) | `GET/PUT /api/storefront/brand` as admin; `PUT` as employee | admin 200; employee 403 on PUT; field errors on invalid tokens; 409 on stale `updatedAt` | REQ-002, REQ-004 |
| TEST-007 | security | tenants A and B | B reads `/api/storefront/brand` (gets B's site only); B requests A's logo through `/api/storefront/media/{B-slug}/{A-logo-id}`; anonymous requests an unreferenced attachment of A | B never sees A's data; all foreign/unreferenced media → 404 | REQ-005 |
| TEST-008 | integration (public) | tenant A with brand set | `GET /{siteSlug}` | 200; HTML contains `--sf-color-primary` with A's value, `<title>`, meta description, canonical, `og:title`, JSON-LD; no `json-render` module in the HTML or its scripts | REQ-003 |
| TEST-009 | integration (provisioning) | fresh signup | onboarding flow end to end | site, theme, home page exist; public page 200 | REQ-001 |
| TEST-010 | UI | tenant A admin | brand wizard: load, invalid colour, save, conflict (two tabs), keyboard submit | errors per field, success flash, conflict surface | REQ-002 |
| TEST-011 | integration (Phase 2) | tenant A | create page, edit draft with the builder (add, reorder, remove sections), publish, edit again, rollback | revisions immutable; public serves the published revision only; spec validated on every save and publish | REQ-006, REQ-007, REQ-004 |
| TEST-012 | integration (Phase 2) | tenant A | load public pages after builder use | public HTML and route chunks contain no `@json-render/*` code | REQ-007 |
| TEST-013 | integration (Phase 3) | tenants A and B with products and images | ProductGrid/Gallery/Image/CollectionList render | only the site's own products and images; foreign ids rejected on save | REQ-008, REQ-005 |
| TEST-014 | integration (Phase 4) | tenant A with published pages | per-page SEO fields; sitemap and robots endpoints; revalidation after publish | sitemap lists published pages only; changes visible after publish | REQ-009 |

## Implementation Phases

Phases are dependency ordered. Only the current phase may enter implementation; each phase leaves a working app and closes with its own evidence.

### Phase 1 — Brand foundation and published home page

- **Depends on:** none
- **Outcome:** every new tenant has a live, branded home page at `/{siteSlug}`; merchants re-brand it in the wizard.
- **Why this order / value delivered:** everything else (pages, builder, media, SEO, AI) builds on the site, theme, block catalog and SSR renderer; merchants get a storefront immediately.
- **Deliverables:** module `storefront` (`index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `cli.ts`, `i18n/*.json`); entities `storefront:site`, `storefront:theme`, `storefront:page` (Phase 1 subset) + migration and snapshot; validators (theme tokens, page spec, safe href, slug); block catalog (Hero, RichText, Features, Footer) and SSR registry; seeding function + `onTenantCreated`; command `storefront.brand.update`; routes `GET/PUT /api/storefront/brand`, `GET /api/storefront/media/{siteSlug}/{attachmentId}`; pages `/backend/storefront`, `/backend/storefront/brand`, `/{siteSlug}`; CLI `storefront ensure-sites`.
- **Steps:**
  1. Module skeleton, ACL, setup role grants, i18n, activation in `src/modules.ts`; `yarn generate` green.
  2. Entities, validators and migration (reviewed `yarn db:generate` output scoped to `storefront`); unit tests TEST-002, TEST-003.
  3. Block catalog, page-spec validator, default home template, SSR registry, CSS/JSON-LD helpers; TEST-001, TEST-004.
  4. Seeding function, `onTenantCreated`, CLI `ensure-sites`; run it for the existing platform tenant; TEST-009.
  5. Brand command + routes (+ media route); TEST-005, TEST-006, TEST-007.
  6. Backend overview + brand wizard; TEST-010.
  7. Public `/{siteSlug}` page with theme and metadata; TEST-008.
- **Independent slices / estimated commits:** (a) data + validators, (b) catalog + renderer, (c) API + command, (d) admin UI, (e) public page — about five commits.
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-005; REQ-004 for brand saves and rendering.
- **Tests:** TEST-001 … TEST-010.
- **Validation:** `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn test` (storefront tests), API/public checks against two tenants.
- **Exit gate:** two freshly signed-up tenants each have a site; tenant A completes the wizard and its public page shows A's tokens and metadata; tenant B sees none of A's site, theme or media; the wizard works in light and dark admin themes and at narrow width.

### Phase 2 — Page authoring: pages, publishing and the json-render builder

- **Depends on:** Phase 1 exit gate
- **Outcome:** merchants create up to 30 pages, add/reorder/edit/remove sections with live preview, publish immutable revisions and roll back; buyers see `/{siteSlug}/{pageSlug}`.
- **Why this order / value delivered:** page authoring is one capability (pages without an editor deliver nothing); it reuses the Phase 1 catalog and renderer.
- **Deliverables:** `draft_spec`, `published_revision_id`, `storefront_page_revisions`; page CRUD (`makeCrudRoute`, `indexer`), publish/rollback/revisions commands and routes with optimistic locking; slug edit before first publish and freeze after; dependencies `@json-render/core` + `@json-render/react` (admin only; asked at phase start per AGENTS.md); adapter `blockCatalog → defineCatalog`; preview registry reusing the SSR block components; `/backend/storefront/pages` (`DataTable`) and the page builder (approved custom canvas inside the standard page shell; prop forms from block schemas through `CrudForm`); public multi-page route.
- **Steps:** (1) entities + migration; (2) commands + routes + OpenAPI with TEST-011 API part; (3) page list and settings UI; (4) json-render adapter with a parity test (every catalog block present, no extra components); (5) builder canvas and preview; (6) public multi-page route and TEST-012 bundle assertion.
- **Requirements closed:** REQ-006, REQ-007; REQ-004 for save and publish.
- **Tests:** TEST-001 (extended with page caps), TEST-011, TEST-012.
- **Validation:** generate, typecheck, lint, tests, two-tenant checks.
- **Exit gate:** a page authored in the builder round-trips through draft save, publish and rollback; the public site never serves a draft; public routes ship no json-render code.

### Phase 3 — Media and commerce blocks

- **Depends on:** Phase 2
- **Outcome:** Image, Gallery, ProductGrid and CollectionList blocks.
- **Deliverables:** two independent slices: (a) media blocks + the media route extended to page-referenced assets; (b) commerce blocks + a scoped catalog read (published products/categories only).
- **Requirements closed:** REQ-008. **Tests:** TEST-013. **Exit gate:** two-tenant media and product isolation proven.

### Phase 4 — SEO and indexability

- **Depends on:** Phase 2
- **Outcome:** per-page SEO fields, per-store sitemap and robots policy, cache revalidation on `storefront.*` events.
- **Requirements closed:** REQ-009. **Tests:** TEST-014. **Exit gate:** sitemap lists published pages only; edits are visible after publish without stale cache.

Roadmap Phases 5 (custom domains and canonical host) and 6 (AI generation, flag-gated behind `ai_assistant`) are designed in their own follow-up specs; nothing in Phases 1–4 depends on them.

## Phasing

Phase 1 (brand + home) → Phase 2 (page authoring: pages, publishing, json-render builder) → Phase 3 (media + commerce blocks) and Phase 4 (SEO and indexability), which both depend only on Phase 2. Roadmap Phases 5 (custom domains, canonical host) and 6 (AI, flag-gated) follow in separate specs. Each phase is independently shippable once its exit gate passes.

## Implementation Plan

The numbered steps under each phase in **Implementation Phases** are the plan; each step is testable and leaves the app working. Phase 1 is approved for this delivery; Phases 2–4 require their own go-ahead.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, setup hook, CLI | `storefront_sites/themes/pages`, `storefront.site.created`, `storefront ensure-sites` | Phase 1 | TEST-003, TEST-009 | AC-001 |
| REQ-002 | J-002, `/backend/storefront`, `/backend/storefront/brand` | `GET/PUT /api/storefront/brand`, `storefront.brand.update`, `storefront.brand.updated` | Phase 1 | TEST-002, TEST-005, TEST-006, TEST-010 | AC-002 |
| REQ-003 | J-003, `/{siteSlug}` | page render, media route | Phase 1 | TEST-004, TEST-008 | AC-003 |
| REQ-004 | all write and render paths | `validatePageSpec`, token validator | Phase 1 (seed + brand + render), Phase 2 (save/publish) | TEST-001, TEST-002, TEST-006 | AC-004 |
| REQ-005 | all routes | scoped reads/writes, media route | Phase 1 (+ every later phase) | TEST-007, TEST-013 | AC-005 |
| REQ-006 | J-004, pages UI | page CRUD, publish, rollback, revisions | Phase 2 | TEST-011 | AC-006 |
| REQ-007 | J-004, builder | json-render adapter, preview | Phase 2 | TEST-011, TEST-012 | AC-007 |
| REQ-008 | builder, public pages | media/commerce blocks | Phase 3 | TEST-013 | AC-008 |
| REQ-009 | public pages | per-page SEO, sitemap/robots, revalidation | Phase 4 | TEST-014 | AC-009 |

### Extension-surface traceability (Phase 1)

Each new discovery surface adapts exactly one reference file from `src/modules/example` (`references/surface-inventory.json`).

| Surface | Requirement | Reference capability → exact file | Phase | Own test | Classification |
|---|---|---|---|---|---|
| `storefront/index.ts` metadata | REQ-001 | `module.metadata` → `src/modules/example/index.ts` | 1 | TEST-009 | emitted-example |
| `storefront/acl.ts` | REQ-002 | `module.acl-features` → `src/modules/example/acl.ts` | 1 | TEST-006 | emitted-example |
| `storefront/setup.ts` (role grants + `onTenantCreated`) | REQ-001 | `module.setup-role-features` → `src/modules/example/setup.ts` | 1 | TEST-009 | emitted-example |
| `storefront/i18n/*.json` | REQ-002 | `module.i18n-catalogs` → `src/modules/example/i18n/en.json` | 1 | TEST-010 | emitted-example |
| `storefront/data/entities.ts` | REQ-001 | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-009 | emitted-example |
| `storefront/data/validators.ts` | REQ-004 | `data.validators` → `src/modules/example/data/validators.ts` | 1 | TEST-001 | emitted-example |
| `storefront/migrations/*` | REQ-001 | `data.migrations` → `src/modules/example/migrations/Migration20251030150038.ts` | 1 | TEST-009 | emitted-example |
| `storefront/commands/brand.ts` | REQ-002 | `commands.write` → `src/modules/example/commands/todos.ts` | 1 | TEST-005 | emitted-example |
| `storefront/events.ts` | REQ-002 | `events.typed-definitions` → `src/modules/example/events.ts` | 1 | TEST-005 | emitted-example |
| `storefront/api/brand/route.ts`, `api/media/[siteSlug]/[attachmentId]/route.ts` | REQ-002, REQ-003 | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 1 | TEST-006, TEST-007 | emitted-example |
| `storefront/api/openapi.ts` | REQ-002 | `api.openapi` → `src/modules/example/api/openapi.ts` | 1 | TEST-006 | emitted-example |
| `storefront/cli.ts` | REQ-001 | `module.cli-command` → `src/modules/example/cli.ts` | 1 | TEST-009 | emitted-example |
| `storefront/backend/page.tsx` + `page.meta.ts` | REQ-002 | `ui.page-shell` → `src/modules/example/backend/page.tsx` | 1 | TEST-010 | emitted-example |
| `storefront/backend/storefront/brand/page.tsx` | REQ-002 | `ui.form-edit` → `src/modules/example/components/TodoForm.tsx` | 1 | TEST-010 | emitted-example |
| `storefront/frontend/[siteSlug]/page.tsx` | REQ-003 | `ui.frontend-page` → `src/modules/example/frontend/example.tsx` | 1 | TEST-008 | emitted-example |

The reference module is source-present and unregistered; nothing above is behavior the app already has until `storefront` is enabled.

## Rollout, Migration, and Rollback

- **Migration:** one additive migration creates the three tables; reviewed from `yarn db:generate` and applied with `yarn db:migrate` (the owner approved applying Phase 1 migrations in this delivery). No existing table changes.
- **Seed/backfill:** new tenants via `onTenantCreated`; existing tenants via `yarn mercato storefront ensure-sites` (idempotent; safe to re-run).
- **Feature flags:** none in Phases 1–4 (the module is enabled or not).
- **Rollback:** remove `{ id: 'storefront', from: '@app' }` from `src/modules.ts` and run `yarn generate`: routes, pages, grants, setup hooks and CLI disappear; tables remain untouched (dropping them is a separate, explicit migration). Brand edits are undoable through the command log.
- **Observability:** `createLogger('storefront')` for seeding results, render-time validation failures (site id + issue codes, never content), and media 404 reasons at debug level.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Seeding error inside `setupInitialTenant` blocks signup | New merchants cannot finish onboarding | seeding is defensive (catches its own errors and logs them) and idempotent; `ensure-sites` repairs; TEST-009 | A tenant may start without a site until repaired |
| React 19 metadata hoisting fails or duplicates `<title>` under the framework catch-all | Wrong or duplicate SEO tags | TEST-008 asserts exactly one `<title>`/canonical; fallback is route `pageTitle` metadata | Minor until verified |
| Global slug race between concurrent seeds | Duplicate slug insert fails | database partial unique index + retry with the next suffix | Negligible |
| Slug collides with a future framework route | Store shadowed by a static route | reserved list + specificity ordering; a custom domain (follow-up spec) is unaffected | A framework upgrade adding a top-level route needs the reserved list updated (upgrade checklist in `docs/UPSTREAM_DIVERGENCES.md`) |
| Invalid stored spec after a schema change | Store renders "unavailable" | schema evolution is additive only; render-time validation logs issues; a migration rewrites specs when a block changes | Requires discipline at block changes |
| Uncached public rendering (DB reads per request) | Load on popular stores | Phase 4 adds caching/revalidation on `storefront.*` events | Acceptable at launch scale |
| Anonymous media route becomes an asset oracle | Data exposure | serves only ids the site references; 404 otherwise; image MIME only | Low |

## Acceptance Criteria

- [ ] **AC-001** — A merchant who completes self-service signup has exactly one site, one theme and one published home page; re-running `ensure-sites` changes nothing.
- [ ] **AC-002** — From `/backend/storefront/brand` a merchant saves name, description, logo, eight colours, font pair, radius and density; invalid values show field errors; a stale save returns a conflict without overwriting.
- [ ] **AC-003** — `GET /{siteSlug}` returns server-rendered HTML whose scoped CSS custom properties, title, description, canonical, Open Graph and JSON-LD come from that site; no client JSON renderer is shipped.
- [ ] **AC-004** — Every malicious or oversize spec in TEST-001 is rejected on save and on render; the public page never renders a partially valid spec.
- [ ] **AC-005** — Tenant B can read none of tenant A's site, theme, pages or media through any staff or public route; foreign ids answer 404.
- [ ] **AC-006** — Publish creates an immutable revision; rollback restores an earlier one; drafts are never public.
- [ ] **AC-007** — Builder edits round-trip through draft save and publish; public routes ship no `@json-render/*` code.
- [ ] **AC-008** — Media and commerce blocks render only the site's tenant data.
- [ ] **AC-009** — Each store exposes per-page SEO, a sitemap of published pages and a robots policy; publishing refreshes them.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`; `.ai/guides/{architecture,contracts,backend-ui,spec-delivery}.md`; `om-module-scaffold` + blueprints; module facts for portal, directory, customer_accounts, attachments, onboarding; installed core/shared/onboarding/auth `AGENTS.md`; `json-render-*` skills |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Requirement Traceability + Extension-surface traceability |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-004 map to Phases 1–3; each phase has its own tests and exit gate |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts (CrudForm custom-field exception recorded) |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Phases |

Verdict: **Ready for implementation** (Phase 1 approved by the owner's brief; Phases 2–4 are approved individually later).

## 🔍 Architectural Review: Storefront Builder

### Summary

Reviewed with the `om-spec-writing` checklist on 2026-10-22. The scope-cohesion item was delegated to a fresh-context reviewer that received only this file's path; its verdict on the first draft was FAIL, because the draft bundled custom domains, AI generation, translations and webfonts, each of which works on the Phase 1 foundation alone. Those were split into follow-up specs, pages and the builder were merged into one page-authoring phase, and the Phase 1 wizard preview was dropped. The remaining design keeps one capability (the storefront builder) in four dependency-ordered phases and is ready for Phase 1.

### Findings

#### ⛔ Critical

- None. Tenant isolation, merchant-content safety and the no-client-renderer rule are specified with tests (TEST-001, TEST-007, TEST-008).

#### ⚠️ High

- **Bundled capabilities (scope cohesion, fresh-context reviewer).** Custom domains/canonical host and AI generation were independently deployable. *Resolved:* split into follow-up specs (roadmap Phases 5 and 6 keep their numbers).
- **Deactivated tenant or deleted organization kept a public store (author review).** *Resolved:* public resolution requires an active tenant and a live organization (Edge Cases).

#### 🔹 Medium

- **Phase 1 ships a full spec validator with no spec save path (reviewer).** *Kept, with reason:* render-time validation is an owner requirement and the validator is the render gate; strict schemas reject `$state`/`$cond` objects at no extra cost; TEST-001 proves the gate.
- **Anonymous media route arrives in Phase 1 (reviewer).** *Kept, with reason:* the logo is part of the brand in the owner's brief; the route serves only ids the site references and answers 404 otherwise.
- **Commerce and media blocks share a phase (reviewer).** *Resolved:* two independent slices inside Phase 3.
- **Deleted logo behaviour undefined (author review).** *Resolved:* store name replaces the logo; media 404.
- **Cross-module reads of `directory` and `attachments` entities.** *Accepted:* read-only, scalar ids, scoped by the site's tenant/organization; no ORM relations. The installed catch-all page and `portal` read `Organization` the same way.

#### Low

- **Pages without an editor in the old Phase 2 (reviewer).** *Resolved:* pages and builder merged.
- **Events without consumers (reviewer).** *Kept:* both events feed workflow-trigger discovery today.
- **Slug-freeze logic in Phase 1, live preview in the wizard (reviewer).** *Resolved:* enforcement moves to Phase 2; preview replaced by a summary and a "View store" link.
- **JSON-LD/OG in Phase 1 (reviewer).** *Kept:* the owner requires indexable pages with correct metadata from the first published page.

### Checklist

| Heuristic | Verdict | Justification |
|---|---|---|
| 1. Architectural diff | pass | Standard CRUD is referenced, not re-documented; the spec spends its length on the catalog, validation, rendering and isolation |
| 2. Scope cohesion | pass (after revision) | Fresh-context reviewer's FAIL resolved by splitting four capabilities into follow-up specs |
| 3. Canonical mechanisms | pass | `CrudForm`, `DataTable`, `apiCall`, commands, `makeCrudRoute` (Phase 2), mutation guards, `setup.ts`, CLI; the custom brand route and CrudForm custom fields carry stated reasons |
| 4. Contracts and compatibility | pass | All surfaces new and additive; frozen-surface list in Architecture → Compatibility |
| 5. Reversibility | pass | Brand undo via command log; module removal rollback; Phase 2 rollback by revision |
| 6. Boundaries and coupling | pass | Scalar ids only; optional modules not required |
| 7. Sensitive data | pass | No PII stored; public marketing content only |
| 8. Failure scenarios | pass | Edge Cases table + Risks |
| 9. Testability | pass | Every step names a TEST id; exit gates are observable |

## Open Questions

All questions are resolved; see **Resolved assumptions** for rationale. Rows marked ⚠ need human confirmation before the dependent phase ships.

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q1 | Split into several specs? | product owner | no | One spec, six phases — autonomous default, 2026-10-22 |
| Q2 | Platform path shape | product owner | no | `/{siteSlug}` with reserved slugs — autonomous default ⚠ NEEDS HUMAN CONFIRMATION, 2026-10-22 |
| Q3 | Store slug source and freezing | product owner | no | Own `site.slug`, frozen after first publish — owner default + autonomous, 2026-10-22 |
| Q4 | Theme publication semantics | product owner | no | Live on save — autonomous default ⚠ NEEDS HUMAN CONFIRMATION, 2026-10-22 |
| Q5 | Fonts in Phase 1 | product owner | no | System font stacks now, self-hosted files in the webfonts follow-up spec — owner default (self-hosted) + autonomous, 2026-10-22 |
| Q6 | RichText storage | product owner | no | Structured document, no HTML — owner default (limited rich text) + autonomous, 2026-10-22 |
| Q7 | Module id | engineering | no | `storefront` — autonomous default, 2026-10-22 |
| Q8 | Logo in Phase 1 | product owner | no | Included with a site-scoped media route — autonomous default, 2026-10-22 |
| Q9 | Backfill for existing tenants | engineering | no | Idempotent CLI `storefront ensure-sites` — autonomous default, 2026-10-22 |
| Q10 | Storefront cardinality | product owner | no | One per organization — autonomous default, 2026-10-22 |
| D1 | Launch host | product owner | no | Platform path at launch, custom-domain binding available — owner, 2026-10-22 |
| D2 | Publication of new stores | product owner | no | Publish immediately — owner, 2026-10-22 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-22 | Skeleton with open questions Q1–Q10 |
| 2026-10-22 | Questions resolved under autonomous defaults; problem, goals, scope filled |
| 2026-10-22 | Research, design and implementation breakdown |
| 2026-10-22 | Review: scope split (custom domains, AI, translations, webfonts → follow-up specs), pages + builder merged, edge cases added; status Ready for implementation (Phase 1) |
