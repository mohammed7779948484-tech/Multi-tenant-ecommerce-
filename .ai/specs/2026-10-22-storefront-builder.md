# Storefront Builder

**Date**: 2026-10-22
**Status**: Phase 1 implemented and verified (2026-10-22); Phases 2–4 pending

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

**Phase 2 defaults** (resolved at the Phase 2 detail pass, 2026-10-22, `om-spec-writing --autonomous`; the owner started Phase 2 with "Continue with the phase 2"):

| ID | Decision | Rationale | Marker |
|---|---|---|---|
| P2-Q1 | The home page keeps slug `index` and is served at `/{siteSlug}`; every other page is served at `/{siteSlug}/{pageSlug}`. Page slugs follow the site-slug grammar. Reserved page slugs: `index, portal, api, cart, checkout, account, search, products, collections, media, assets, sitemap.xml, robots.txt`. | `portal` is reserved because `/{orgSlug}/portal` wins by route specificity whenever a site slug equals its organization slug (the seeded default); commerce words are kept free for Phases 3–4. | ⚠ NEEDS HUMAN CONFIRMATION |
| P2-Q2 | One working draft per page (`draft_spec`), saved explicitly with **Save draft**. No autosave and no per-user drafts. | Smallest surface: one version token per page, no draft-merge rules. | — |
| P2-Q3 | Publish always publishes the **saved** draft, never unsaved editor state; the builder's **Publish** saves first and then publishes with the version the save returned. | The revision is exactly what passed server validation. | — |
| P2-Q4 | Rollback appends a new revision that copies an older one (`source = rollback`) and resets the draft (spec, title, SEO description) to that content; when the page has unpublished changes the confirmation says they will be replaced. There is no unpublish in Phase 2; deleting a page removes it from the public site. | Revisions stay append-only and auditable; "undo a publish" is a rollback. | ⚠ NEEDS HUMAN CONFIRMATION (rollback replaces unpublished draft changes) |
| P2-Q13 | A page's title and SEO description are **draft** fields like its sections: editing them marks the page `changed`, and they reach buyers only through publish (the public route reads them from the published revision). The page slug is not draft content: it is editable only before the first publish, when the page is not public. For the home page the public `<title>` stays the store name (`docs/DECISIONS.md` I4); its SEO description falls back to the site description. | One publish model for everything buyers see. | — |
| P2-Q5 | The home page cannot be deleted and its slug is fixed. | The store must always have a home page. | — |
| P2-Q6 | A page slug is editable until that page is first published and frozen afterwards; the site slug stays non-editable (every site is published at creation, so the owner's freeze rule already applies). | Owner default "slug frozen after first publish", applied per page. | owner (freeze) |
| P2-Q7 | New features `storefront.pages.manage` (create, settings, save draft, delete; depends on `storefront.view`) and `storefront.pages.publish` (publish, rollback; depends on `storefront.pages.manage`). Defaults: admin `storefront.*`, employee `storefront.view` only. | Least privilege; publishing is the step buyers see. | — |
| P2-Q8 | Builder: `@json-render/core` `defineCatalog` built from our block catalog (plus `Page`); the section picker lists catalog components with their descriptions; the live preview renders the in-memory draft with `@json-render/react` and a registry that wraps the **same** SSR block components inside the theme wrapper; section props are edited in a keyed, compact, embedded `CrudForm` inside an inspector drawer (installed reference: the workflows step inspector). | One catalog drives validation, editing, preview and the public render; no second component family. | — |
| P2-Q14 | Each block declares its editor fields in an editor-field map kept in parity with its Zod schema (TEST-015): `text`/`textarea` for strings, `link` (`label` + `href`) for CTAs, `select` for enums (Hero `align`), `list` for Features items (`title`, `body`, 1–6) and Footer links (`label`, `href`, ≤ 8) — a CrudForm custom field with add, remove and move up/down — and `richtext` (P2-Q9) for RichText `content`. Field-level Zod issues land on those fields. The preview registry reuses the public block components, which stay synchronous React components with no server-only imports (asserted by TEST-015 rendering every block through the preview registry). | No generated forms from arbitrary schemas; explicit and testable. | — |
| P2-Q9 | RichText is edited in a textarea with a minimal markup — blank line = paragraph, `- ` = bullet item, `1. ` = numbered item, `**bold**`, `*italic*`, `[label](href)` — parsed by our code into the structured document and serialised back for editing. No HTML anywhere. | No rich-text editor dependency; the supported subset round-trips losslessly. | — |
| P2-Q10 | No navigation-menu builder in Phase 2. Merchants link pages from Footer links and Hero CTAs with site-relative hrefs (`/about` renders as `/{siteSlug}/about`). | Already supported by the Phase 1 renderer; a menu builder is a separate feature. | — |
| P2-Q11 | Revisions are kept without a retention limit in Phase 2 (pages are capped at 30); the revisions list is paginated, 20 per page. | Retention is a later policy decision; nothing is lost meanwhile. | — |
| P2-Q12 | Dependencies `@json-render/core@0.21.0` and `@json-render/react@0.21.0`, pinned exact, imported only by client components under `src/modules/storefront/components/builder/**`. | Owner decision "json-render is admin-editor only"; TEST-012 proves no public route ships it. | owner (json-render in the editor) |

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
| Merchant employee | View storefront status and public URL; (Phase 2) read the pages list and builder read-only | own organization | `storefront.view` |
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

A new app module `storefront` owns sites, themes and pages. It keeps a server-safe **block catalog** — one Zod props schema per block, with no React import — and a separate **server block registry** mapping each block type to an SSR-safe React component. A page is stored as JSON in the shape `{ root, elements }`, validated by our schema (the source of truth) on save, on publish and on render. The public route `/{siteSlug}` resolves the site by its globally unique slug, pins every subsequent query to that site's tenant and organization, validates the published spec, and renders it through the registry inside a wrapper that carries the theme as CSS custom properties. Page metadata (title, description, canonical, Open Graph) is returned through Next metadata by the page's static `generateMetadata` (see `docs/DECISIONS.md` I3); JSON-LD is rendered in the page. `json-render` enters only in the admin editor (Phase 2), which adapts the same catalog with `defineCatalog` for section picking and live preview, and later for catalog-constrained AI generation (follow-up spec).

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
| Site slug | Public path segment; `^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$`; globally unique among non-deleted sites; not a reserved word; frozen once `first_published_at` is set | `storefront_sites.slug` | Seeding derives it from the organization slug, appends `-2`, `-3`… on collision or reserved word; no site-slug edit in Phases 1–2 (every site is published at creation, so the freeze already applies; P2-Q6) |
| Reserved slugs | `api, backend, login, logout, reset, onboarding, terms, privacy, docs, quote, messages, checkout-demo, portal, sitemap.xml, robots.txt, favicon.ico, assets, static, _next, admin, storefront` | code constant | Treated as a collision |
| Theme tokens v1 | `{ version: 1, colors: { background, surface, text, mutedText, primary, onPrimary, accent, border }, fonts: { heading, body }, radius, density }`; colours `#rrggbb` (lower-cased on save); fonts from the font-stack enum; radius `none|sm|md|lg|full`; density `compact|comfortable|spacious` | `storefront_themes.tokens` | Rejected field by field |
| Contrast floor | `text` on `background` and `onPrimary` on `primary` must reach 3:1 (WCAG AA large text); below 4.5:1 the wizard warns | validator | 422 with field errors |
| Page spec | `{ root: string, elements: Record<string, Element> }`; `elements[root].type === 'Page'`; `Page.children` lists section ids (0–40); each section is referenced exactly once, has no children, and its `type` is a catalog block; element keys are exactly `type`, `props`, `children`; props are validated by the block's strict Zod schema | `storefront_pages.published_spec` (Phase 2 adds `draft_spec`) | Rejected with a list of `{ path, code, message }` issues; at render time an invalid spec renders the neutral "store unavailable" page with `noindex`, never a partial page |
| Text limits | 200 characters per text field unless the block allows more (Hero heading 120, RichText total text 5,000, alt text 200) | block schemas | Field-level error |
| Safe href | `/`-rooted site-relative path (not `//`, no backslash or control characters) or an absolute `https:` URL; ≤ 500 characters | validator | Rejected; `javascript:`, `data:`, `http:` and protocol-relative URLs never pass |
| Asset reference | Images are attachment ids (UUID) belonging to the site's tenant and organization; never URLs | validator + media route | Unknown, foreign or unreferenced ids answer 404 |
| Caps | Spec ≤ 64 KB serialised; ≤ 40 sections per page; ≤ 30 pages per store | validator / page command (Phase 2) | 400 with a readable message |
| Published | Phase 1: `published_spec` + `published_at` on the page. Phase 2: an immutable `storefront_page_revisions` row per publish; rollback publishes a copy of an earlier revision | `storefront_pages`, `storefront_page_revisions` | Public site reads only published content |
| Page slug (Phase 2) | Site-slug grammar; unique per site among non-deleted pages; not reserved (P2-Q1); `index` only for the home page; editable until the page's first publish | `storefront_pages.slug` | 422 with `fieldErrors.slug` (`slugInvalid`, `slugReserved`, `slugTaken`, `slugFrozen`) |
| Page status (Phase 2) | `draft` — never published; `published` — published and no newer saved draft; `changed` — published and a draft saved after the last publish (`draft_updated_at > published_at`) | derived from `published_revision_id`, `published_at`, `draft_updated_at` | — |
| Page cap | ≤ 30 non-deleted pages per site, including the home page; enforced inside the create transaction under a row lock on the site | page create command | 422 `storefront.errors.pageLimit` |
| Revision | Append-only snapshot `{ spec, title, seoDescription }` with `revision_no` 1, 2, 3… per page; `source` is `publish` or `rollback` (with `source_revision_id`) | `storefront_page_revisions` | Never updated or deleted |

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
- **Compatibility:** all identifiers are new and additive. Once released they are frozen surfaces under `BACKWARD_COMPATIBILITY.md`: routes `/api/storefront/*`, `/backend/storefront*`, `/{siteSlug}`; entity ids `storefront:storefront_site|storefront_theme|storefront_page|storefront_page_revision` (the generated ids; corrected at the Phase 2 detail pass — the earlier short names never existed in code); events `storefront.*`; ACL features `storefront.*`; CLI `storefront ensure-sites`; the page-spec JSON shape (versioned through its schema; additive evolution only).

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
| `/backend/storefront/pages` (Phase 2) | Page list: search, status filter; **New page**; row actions Edit content, Settings, View live, Delete | `GET /api/storefront/pages` via `DataTable` + `fetchCrudList`; delete via `deleteCrud` with the row's version | `/backend/catalog/products` | `Page`, `DataTable` (`extensionTableId: 'storefront.pages'`), `RowActions`, `StatusBadge`, `useConfirmDialog` | loading, empty search result, error, permission (read-only without `storefront.pages.manage`), cap reached (New page disabled with hint) | REQ-006 |
| `/backend/storefront/pages/create` (Phase 2) | Create a page: title, slug (suggested from the title until edited), SEO description; then open the builder | `createCrud('storefront/pages')` | `/backend/catalog/products/create` | `Page`, `CrudForm` (`entityId: 'storefront:storefront_page'`) | validation (slug rules, cap), server error, success redirect | REQ-006 |
| `/backend/storefront/pages/[id]` (Phase 2) | Page settings: title, slug (disabled with a hint once published), SEO description; Delete (not for home) | list route `?id=` + `updateCrud`/`deleteCrud` | `/backend/catalog/products/[id]` | `Page`, `CrudForm` edit mode (`initialValues.updatedAt`) | loading, not found (`RecordNotFoundState`), validation, conflict (409), success flash | REQ-006 |
| `/backend/storefront/pages/[id]/builder` (Phase 2) | Section builder: add (picker), edit (inspector), reorder, remove; Save draft; Publish; Revisions (restore) | list route `?id=`; `PUT /api/storefront/pages`; publish/rollback/revisions routes; writes through `useGuardedMutation` + optimistic-lock header | `/backend/definitions/visual-editor` (workflows: custom canvas + keyed inspector `CrudForm`) | `Page` shell; approved custom canvas; `Dialog` (picker), `Drawer` (inspector, revisions), embedded compact `CrudForm`, `Button`, `StatusBadge`, `Alert`, `EmptyState`, `useConfirmDialog`; json-render `Renderer` for the preview only | see the builder section below | REQ-004, REQ-006, REQ-007 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Merchant admin | **Storefront** → Overview (`/backend/storefront`), Pages (`/backend/storefront/pages`, Phase 2); Brand reached from the overview action | none | `/backend` → Storefront → Edit brand → Save (3 clicks); Phase 2: Storefront → Pages → Edit content → Publish |
| Employee | **Storefront** → Overview (read-only, no Edit brand action); Pages list read-only (Phase 2) | none | `/backend` → Storefront |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Overview | "This organization has no storefront yet" + the ensure command for operators | single column below `md` | actions reachable in tab order; links have accessible names |
| Brand wizard | n/a (always seeded) | groups stack; colour grid 2 columns on narrow screens | Enter in a text field submits the full-page CrudForm (Cmd/Ctrl+Enter is the CrudForm *dialog* shortcut, corrected during implementation); colour inputs labelled; contrast warnings announced via `role="status"` |

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

### `/backend/storefront/pages` — Page list (Phase 2)

```text
┌ Storefront › Pages ──────────────────────────────────────────── [New page] ┐
│ Search [________]   Status [All ▾]                                         │
│ Title        Path            Status               Last published  Updated  │
│ Home         /atlas-coffee   ● Published          22 Oct 10:04    10:04  ⋯ │
│ About us     /…/about        ● Unpublished changes 21 Oct 18:30   10:12  ⋯ │
│ Wholesale    /…/wholesale    ○ Draft              —               09:55  ⋯ │
└────────────────────────────────────────────────────────────────────────────┘
⋯ = Edit content · Settings · View live (published only) · Delete (not Home; confirm)
```

### Pages list, create and settings — contracts (Phase 2)

| Route | Feature gate (`page.meta.ts`) | Actions by permission | Loading / empty / error | Conflict | Keyboard / a11y | Responsive / theme |
|---|---|---|---|---|---|---|
| `/backend/storefront/pages` (nav item "Pages" under Storefront) | `storefront.view` | New page, Edit content, Settings, Delete only with `storefront.pages.manage` (feature-check, wildcard-aware); View live for published pages | `DataTable` loading; "No pages match" for an empty search; `ErrorMessage` on load failure | row delete sends the row's `updatedAt`; 409 shows the shared conflict bar and reloads the table | `DataTable` keyboard model; `RowActions` labelled; status = `StatusBadge` text + colour (never colour alone); Delete via `useConfirmDialog` (Cmd/Ctrl+Enter, Escape) | `DataTable` responsive columns; semantic tokens, light and dark |
| `/backend/storefront/pages/create` | `storefront.pages.manage` | Create | server error flash | n/a | `CrudForm` labels and error focus; Enter submits | single column; tokens |
| `/backend/storefront/pages/[id]` | `storefront.pages.manage` | Save, Delete (not home) | `LoadingMessage`; `RecordNotFoundState`; `ErrorMessage` | `initialValues.updatedAt`; 409 → shared conflict bar | `CrudForm` labels; slug input disabled with a described hint after first publish; Delete confirmation | single column; tokens |
| `/backend/storefront/pages/[id]/builder` | `storefront.view` (read-only without `storefront.pages.manage`) | see the builder below | see the builder below | see the builder below | see the builder below | see the builder below |

```text
Create page                                   Page settings — About us
Title        [About us_______]                Title        [About us_______]
Slug         [about__________] /atlas/about   Slug         [about] (frozen after first publish)
SEO descr.   [________________]               SEO descr.   [________________]
             [Cancel] [Create page]           [Delete page]        [Cancel] [Save]
```

### `/backend/storefront/pages/[id]/builder` — Section builder (Phase 2)

```text
┌ Storefront › Pages › About us › Builder ────────────────────────────────────┐
│ ← Pages  About us  ● Unpublished changes  [Revisions] [Save draft] [Publish] │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ Sections (3/40)          │ Preview   ( Desktop | Phone )                     │
│ ▸ 1 Hero        ↑ ↓ ✎ 🗑 │ ┌──────────────────────────────────────────────┐ │
│   2 Rich text   ↑ ↓ ✎ 🗑 │ │ live json-render preview of the draft,       │ │
│   3 Footer      ↑ ↓ ✎ 🗑 │ │ inside the store's theme wrapper             │ │
│ [+ Add section]          │ └──────────────────────────────────────────────┘ │
├──────────────────────────┴──────────────────────────────────────────────────┤
│ Issues (role=status): none │ "Section 2 › Rich text: link must be https or /…" │
└──────────────────────────────────────────────────────────────────────────────┘
Add section → Dialog: catalog blocks (name + description from the json-render catalog)
Edit (✎, or Enter on the selected row) → inspector Drawer: keyed compact CrudForm for that
  block's props; Apply writes into the in-memory draft; Cancel/Escape discards
Revisions → Drawer: revision list (no, source, title, date, current); Restore → confirm → rollback
```

- **Behavior:** the draft lives in page state until **Save draft** (`PUT` with `draftSpec` and the page version). **Publish** saves first when there are unsaved edits, then publishes with the version the save returned. Client-side `validatePageSpec` runs on every edit so issues show before saving; server issues (`issues[].path`) map onto the same list and select the offending section. A 409 opens the shared conflict bar with Reload. Without `storefront.pages.publish`, Publish and Restore are hidden (the server still enforces them); without `storefront.pages.manage` the builder is read-only.
- **States:** loading (`LoadingMessage`), not found (`RecordNotFoundState`), load error (`ErrorMessage`), empty page (`EmptyState` in the preview with **Add section**), section cap (Add disabled at 40 with a hint), unsaved changes (status badge + browser leave prompt), saving/publishing (buttons disabled, `aria-busy`), issues, conflict, success flash, preview error (an error boundary per section shows "Preview unavailable for this section"; editing continues).
- **Keyboard and accessibility:** the section list is a labelled list of buttons — Up/Down move the selection, Alt+Up/Alt+Down reorder, Enter opens the inspector, Delete removes after confirmation; every icon button has an accessible name; dialogs and drawers submit with Cmd/Ctrl+Enter and close with Escape; the preview is a labelled region marked `inert` so its links and buttons cannot be focused or followed; issues are announced through `role="status"`.
- **Responsive:** below `lg` the preview stacks under the section list; the Phone toggle constrains the preview to 390 px.
- **Theming:** the admin chrome uses semantic tokens in light and dark mode; the preview always shows the merchant's theme (it is the store's look), scoped by the same `[data-sf-site]` wrapper and `.sf-*` structural classes as the public page.

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

### `storefront:page` — Phase 2 additions (generated entity id `storefront:storefront_page`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `draft_spec` | JSONB, nullable | — | no | the saved working draft; `null` means "no draft yet" (the builder starts from `published_spec`); validated by `validatePageSpec` on every save |
| `draft_updated_at` | timestamptz, nullable | — | no | set when a draft spec, title or SEO description is saved; cleared by publish and rollback; drives the `changed` status |
| `published_revision_id` | UUID, nullable | — | no | the revision `published_spec` came from; non-null ⇔ the page was ever published (freezes the page slug) |
| `updated_at` | (existing) | — | no | the page's optimistic-lock version for settings, draft save, delete, publish and rollback |

### `storefront:page_revision` (`storefront_page_revisions`, generated entity id `storefront:storefront_page_revision`) — new, append-only

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | index `(tenant_id, organization_id)` | no | copied from the page inside the publishing transaction |
| `site_id`, `page_id` | UUID, required | index `(page_id, created_at)`; unique `(page_id, revision_no)` | no | scalar ids |
| `revision_no` | integer, required | see above | no | `max + 1` under the page row lock |
| `spec` | JSONB, required | — | no | a spec that passed `validatePageSpec` when written |
| `title` / `seo_description` | text / text nullable | — | no | snapshot of the page fields at publish; the public route reads these, never the page row's working values |
| `source` | text, required | — | no | `publish` or `rollback` |
| `source_revision_id` | UUID, nullable | — | no | the copied revision for `rollback` |
| `published_by_user_id` | UUID, nullable | — | no | staff user id (scalar); `null` for system writes (seeding, migration backfill) |
| `created_at` | timestamptz | — | no | publish time; no `updated_at`/`deleted_at` (append-only, exempt from optimistic locking) |

**Migration (Phase 2):** additive — three nullable columns on `storefront_pages`, the new table and its indexes, plus a backfill that writes revision 1 (`source = publish`, `published_by_user_id = null`) for every page that already has a `published_spec` and points `published_revision_id` at it. The Phase 1 seeding function writes the same revision 1 for every new home page. No field holds PII, so no encryption map is needed; merchant-entered text is public marketing content.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/storefront/brand` | auth + `storefront.view` | none | `{ site: { id, slug, name, description, logoAttachmentId, defaultLocale, firstPublishedAt, publicPath }, tokens, updatedAt }` | 401, 403, 404 (`storefront.errors.siteNotFound`), 400 `organization_scope_required` | REQ-002 |
| `PUT` | `/api/storefront/brand` | auth + `storefront.brand.manage` | `{ name, description \| null, logoAttachmentId \| null, tokens }` + optimistic-lock header from `updatedAt` | 200 with the brand payload (`GET` shape); event `storefront.brand.updated` after commit | 422 `{ error, fieldErrors }`; 403 (a foreign `tenantId` in the body is refused by the platform with 403); 404; 409 stale version | REQ-002, REQ-004, REQ-005 |
| command | `storefront.brand.update` | via route; mutation guards run first | validated input + scope from context | updated site + theme in one `withAtomicFlush(..., { transaction: true })` | `enforceCommandOptimisticLock` on the site; undo restores the previous identity and tokens | REQ-002 |
| `GET` | `/api/storefront/media/{siteSlug}/{attachmentId}` | public (`requireAuth: false`) | path params | image bytes; `Cache-Control: public, max-age=300`; `X-Content-Type-Options: nosniff` | 404 for unknown site, unreferenced/foreign/non-image attachment (never 401/403) | REQ-003, REQ-005 |
| CLI | `yarn mercato storefront ensure-sites [--tenant <id>]` | operator | optional tenant | per-organization result lines | idempotent | REQ-001 |

**Phase 2 contracts.** Request schemas are strict: unknown keys (including `tenantId`, `organizationId`, `siteId`, `publishedSpec`, `publishedRevisionId`) answer 422 `unknownField`. Scope always comes from the staff session; every lookup filters by `tenant_id` + `organization_id` (+ `site_id` of the caller's site), so another tenant's or organization's page or revision id answers **404**. Writes carry the page's `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`; a stale value answers **409**. Spec issues answer **422** `{ error, fieldErrors, issues: [{ path, code, message }] }` with messages from `storefront.validation.*`.

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/storefront/pages` (`makeCrudRoute` list; no `indexer` — pages are not part of global search, and indexing would copy the 64 KB draft JSONB into the query index; `status` maps to explicit column predicates) | auth + `storefront.view` | `page`, `pageSize ≤ 100`, `search` (title/slug), `status` (`draft\|published\|changed`), `id`/`ids` | `{ items: [{ id, slug, title, seoDescription, status, isHome, publicPath, publishedAt, publishedRevisionNo, draftUpdatedAt, updatedAt }], total, page, pageSize, totalPages }`; single-record requests (`id`) add `draftSpec` and `publishedSpec` | 401, 403 | REQ-006 |
| `POST` / command `storefront.pages.create` | `/api/storefront/pages` | auth + `storefront.pages.manage`; mutation guards (factory) | `{ title (1–70), slug, seoDescription? (≤160) }` | `{ id }`; the page starts with a starter draft (one Hero whose heading is the title, one Footer); event `storefront.page.created` `{ id, tenantId, organizationId, siteId }` | 422 `fieldErrors.slug` (invalid/reserved/taken), 422 `storefront.errors.pageLimit`; cap checked under a `SELECT … FOR UPDATE` on the site row; undo soft-deletes the page | REQ-006 |
| `PUT` / command `storefront.pages.update` | `/api/storefront/pages` | auth + `storefront.pages.manage`; mutation guards | `{ id, title?, slug?, seoDescription?, draftSpec? }` + lock header | `{ ok: true, updatedAt }`; a change to `draftSpec`, `title` or `seoDescription` sets `draft_updated_at`; event `storefront.page.updated` `{ id, tenantId, organizationId, siteId }` | 422 spec issues (`validatePageSpec`: unknown block/prop, unsafe href, > 64 KB, > 40 sections…), 422 `slugFrozen` after first publish, 422 home slug change, 409, 404; version re-checked under the page row lock; undo restores the previous title, SEO description and draft, and the previous slug only while the page has never been published (otherwise 409 `storefront.errors.undoSlugFrozen`) | REQ-004, REQ-006 |
| `DELETE` / command `storefront.pages.delete` | `/api/storefront/pages?id=` | auth + `storefront.pages.manage`; mutation guards | `id` + lock header | `{ ok: true }`; soft delete; revisions kept; event `storefront.page.deleted` `{ id, tenantId, organizationId, siteId }` | 422 `storefront.errors.homeNotDeletable`, 409, 404; undo restores the page under the site row lock, re-checking the 30-page cap (422 `pageLimit`) and slug uniqueness (409 `storefront.errors.undoSlugTaken`) | REQ-006 |
| `POST` / command `storefront.pages.publish` | `/api/storefront/pages/{id}/publish` | auth + `storefront.pages.publish`; `runRouteMutationGuards` | `{}` + lock header | `{ pageId, revisionId, revisionNo, publishedAt, updatedAt }`; inserts revision `max + 1`, snapshots the draft spec (or the current published spec when only the title/SEO description changed and `draft_spec` is null) with the page's current title and SEO description, copies the spec into `published_spec`, sets `published_at`, `published_revision_id`, clears `draft_updated_at`; event `storefront.page.published` after commit | 422 spec issues (validated again), 422 `storefront.errors.nothingToPublish` (already published and `draft_updated_at` is null), 409, 404; one transaction under the page row lock; not undoable (rollback is the reverse) | REQ-004, REQ-006 |
| `POST` / command `storefront.pages.rollback` | `/api/storefront/pages/{id}/rollback` | auth + `storefront.pages.publish`; `runRouteMutationGuards` | `{ revisionId }` + lock header | same shape as publish; appends a `rollback` revision copying `spec`, `title`, `seoDescription` of `revisionId`, and resets the draft, title and SEO description to it; event `storefront.page.rolled_back` | 404 when the revision is not this page's, 422 `storefront.errors.revisionInvalid` when the old spec fails today's validator, 422 `storefront.errors.alreadyCurrent`, 409; not undoable (roll back again) | REQ-006 |
| `GET` | `/api/storefront/pages/{id}/revisions` | auth + `storefront.view` | `page`, `pageSize ≤ 50` (default 20) | `{ items: [{ id, revisionNo, source, sourceRevisionNo, title, createdAt, publishedByUserId, isCurrent }], total, page, pageSize, totalPages }`, newest first; no specs | 401, 403, 404 | REQ-006 |
| frontend | `/{siteSlug}/{pageSlug}` | public | path params | the page's **published** spec rendered like the home page; title and description come from the published revision (`published_revision_id`), canonical from the page path | 404 for unknown, unpublished, deleted, reserved or `index` slugs (`/{siteSlug}/index` → 308 to `/{siteSlug}`); mixed case → 308 to the canonical lower-case path | REQ-003, REQ-005, REQ-006 |

Both brand routes are custom (singleton aggregate, not a list), so they wire `runMutationGuards` with the caller's features, merge `modifiedPayload`, and run post-success callbacks after commit; each route exports per-method `metadata` and `openApi`. Scope is derived with `resolveOrganizationScopeForRequest`; body fields named `tenantId`/`organizationId` are ignored by the strict schema.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `storefront.site.created` | seeding function | workflow trigger discovery today (e.g. a "new store" automation) | — | emitted once per created site; seeding is idempotent so a re-run emits nothing |
| `storefront.brand.updated` | `storefront.brand.update` | workflow trigger discovery today; Phase 4 cache revalidation | — | after commit; command log gives audit and undo |
| `storefront.page.created` / `.updated` / `.deleted` | Phase 2 page commands | workflow trigger discovery | — | after commit; command log gives audit and undo |
| `storefront.page.published` / `storefront.page.rolled_back` | Phase 2 commands | workflow trigger discovery; Phase 4 sitemap/cache | revalidation (Phase 4) | after commit; payload `{ id, tenantId, organizationId, siteId, revisionId, revisionNo }`; the revision row is the audit record |

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
| `PUT /api/storefront/brand` with a `logoAttachmentId` from another tenant or a non-image | 422 with a field error on `logoAttachmentId` (no existence leak beyond "not a usable image"). |
| Database unavailable during public render | Standard 500 page from the framework; nothing partial is cached. |
| Two tabs edit the same page draft (Phase 2) | The second **Save draft**/**Publish** answers 409; the builder keeps the local draft and shows the conflict bar with Reload. |
| Publish races another publish (Phase 2) | The page row lock serialises them; the second sees a newer version and answers 409, so `revision_no` never collides. |
| Two creates race for the 30th page (Phase 2) | The site row lock serialises the cap check; the loser gets 422 `pageLimit`. |
| Rollback to a revision that fails today's validator (Phase 2) | 422 `revisionInvalid`; nothing changes. |
| Restoring a deleted page whose slug was reused (Phase 2) | Undo answers 409; the reused page is untouched. |
| A buyer requests a draft-only, deleted or reserved page path (Phase 2) | 404; drafts are never served. |
| The json-render preview throws for one section (Phase 2) | That section shows "Preview unavailable"; the rest of the preview and all editing keep working. |

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
| TEST-010 | UI | tenant A admin | brand wizard: load, invalid colour, save, conflict (two tabs), keyboard submit (Enter in a text field) | errors per field, success flash, conflict surface | REQ-002 |
| TEST-011 | integration (Phase 2, `TC-STOREFRONT-002`) | tenant A admin (env superadmin's organization) | create page; save invalid draft (unknown block, `javascript:` href, 41 sections); save valid draft; stale save; publish; request the public path; edit draft again; publish rev 2; rollback to rev 1; slug edit after publish; title-only change then publish; rollback to the current revision; revisions pages 1–2; `/{siteSlug}/index` and a mixed-case path; delete; create pages up to the cap; employee save; a manage-only role publishes | 422 with `issues`; 409 on stale; revision numbers 1→2→3 (`rollback` source); public serves only the published revision (draft text and draft title absent until publish); `slugFrozen`; `alreadyCurrent`; pagination totals; 308 to the canonical path; deleted page 404; 31st page `pageLimit`, home not deletable; employee 403; manage-only 403 on publish | REQ-004, REQ-006 |
| TEST-012 | integration (Phase 2) | tenant A with a published page | fetch `/{siteSlug}` and `/{siteSlug}/{pageSlug}` and every `/_next/static` script they reference; positive control: the builder route's chunks | no public HTML or chunk contains `json-render`; the builder chunks do | REQ-007 |
| TEST-015 | unit (Phase 2) | none | json-render adapter vs block catalog | catalog components = `Page` + every `STOREFRONT_BLOCK_TYPES` entry, no extras; each component's props schema is the block's own schema object | REQ-007 |
| TEST-016 | unit (Phase 2) | none | rich-text markup parse/serialise | round trip of paragraphs, lists, bold, italic, links; unsafe hrefs rejected; markup that looks like HTML stays text | REQ-004, REQ-007 |
| TEST-017 | unit (command, Phase 2) | in-memory command context | page create/update/delete/publish/rollback | cap under lock, slug rules, draft validation, revision numbering, rollback copy + draft reset, `nothingToPublish`, foreign-scope 404, undo of update and delete | REQ-004, REQ-006 |
| TEST-018 | UI (Phase 2) | tenant A admin, real browser | pages list (create, delete with confirm, delete conflict); builder: add via picker, edit in inspector (text, link, list, rich text), reorder (keyboard), remove, save draft, publish, restore a revision (with the replace-draft warning), conflict in two tabs; narrow width and dark admin theme | public page changes only after publish/restore; conflict bars shown; keyboard path works; layout and contrast hold in both themes | REQ-006, REQ-007 |
| TEST-019 | security (Phase 2) | tenants A and B (fresh signups) | B reads, updates, publishes, rolls back and lists revisions of A's page ids; B requests A's page path under B's slug | every call 404; A's page unchanged | REQ-005 |
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

- **Depends on:** Phase 1 exit gate (verified 2026-10-22)
- **Outcome:** merchants create up to 30 pages, add/reorder/edit/remove sections with live preview, publish immutable revisions and roll back; buyers see `/{siteSlug}/{pageSlug}`.
- **Why this order / value delivered:** page authoring is one capability (pages without an editor deliver nothing); it reuses the Phase 1 catalog, validator and renderer.
- **Deliverables:** the data-model additions and migration (with backfill); commands `storefront.pages.{create,update,delete,publish,rollback}`; `/api/storefront/pages` (`makeCrudRoute`) plus publish, rollback and revisions routes; ACL `storefront.pages.manage`/`.publish` with default grants; events; the public multi-page route; pages list, create and settings UI; the json-render adapter, rich-text markup and per-block editor fields; the builder; i18n in en/de/es/pl/ko; dependencies per P2-Q12.
- **Steps:**
  1. Entities, migration (reviewed `yarn db:generate`, scoped), backfill, seeding writes revision 1; TEST-001 extended with page slugs and caps.
  2. Page commands with locks and undo; TEST-017.
  3. Routes + OpenAPI + ACL/setup + events; TEST-011 API part (integration spec).
  4. Public `/{siteSlug}/{pageSlug}`; TEST-011 public part.
  5. Pages list, create and settings UI.
  6. json-render adapter, rich-text markup, editor-field map; TEST-015, TEST-016.
  7. Builder canvas, picker, inspector, revisions drawer, keyboard path; TEST-018.
  8. TEST-012 bundle assertion, TEST-019 two-tenant checks, full gates and review.
- **Requirements closed:** REQ-006, REQ-007; REQ-004 for save and publish. **Acceptance IDs:** AC-004 (save/publish part), AC-005 (pages and revisions), AC-006, AC-007, AC-010.
- **Tests:** TEST-001 (extended), TEST-011, TEST-012, TEST-015 … TEST-019.
- **Validation:** `yarn generate`, `yarn db:generate` probe, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test`, `yarn build`, `TC-STOREFRONT-001/002`, two-tenant checks.
- **Exit gate:** a page authored in the builder round-trips through draft save, publish and rollback; the public site never serves a draft (spec, title or SEO description); public routes ship no json-render code; tenant B cannot reach any of tenant A's pages or revisions; slug, cap and home-page rules hold (AC-010); the new admin screens pass their state contracts at narrow width and in light and dark admin themes.

### Phase 3 — Media and commerce blocks

- **Depends on:** Phase 2
- **Outcome:** Image, Gallery, ProductGrid and CollectionList blocks.
- **Deliverables:** two independent slices: (a) media blocks + the media route extended to page-referenced assets; (b) commerce blocks + a scoped catalog read (published products/categories only).
- **Requirements closed:** REQ-008. **Tests:** TEST-013. **Exit gate:** two-tenant media and product isolation proven.

### Phase 4 — SEO and indexability

- **Depends on:** Phase 2
- **Outcome:** per-page SEO additions beyond Phase 2's title and SEO description (Open Graph image, `noindex` flag), per-store sitemap and robots policy, cache revalidation on `storefront.*` events.
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
| REQ-004 | all write and render paths | `validatePageSpec`, token validator | Phase 1 (seed + brand + render), Phase 2 (save/publish) | TEST-001, TEST-002, TEST-006, TEST-011, TEST-016, TEST-017 | AC-004 |
| REQ-005 | all routes | scoped reads/writes, media route | Phase 1 (+ every later phase) | TEST-007, TEST-013, TEST-019 | AC-005 |
| REQ-006 | J-004, pages list/create/settings, builder, `/{siteSlug}/{pageSlug}` | `/api/storefront/pages*`, `storefront.pages.*` commands and events, `storefront_page_revisions` | Phase 2 | TEST-011, TEST-017, TEST-018, TEST-019 | AC-006, AC-010 |
| REQ-007 | J-004, builder | json-render adapter, preview registry, rich-text markup | Phase 2 | TEST-012, TEST-015, TEST-016, TEST-018 | AC-007 |
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

### Extension-surface traceability (Phase 2)

| Surface | Requirement | Reference capability → exact file | Phase | Own test | Classification |
|---|---|---|---|---|---|
| `storefront/data/entities.ts` (page additions, `StorefrontPageRevision`) + migration | REQ-006 | `data.entities` / `data.migrations` → `src/modules/example/data/entities.ts`, `src/modules/example/migrations/Migration20251030150038.ts` | 2 | TEST-011 | emitted-example |
| `storefront/commands/pages.ts` | REQ-006 | `commands.write` → `src/modules/example/commands/todos.ts` | 2 | TEST-017 | emitted-example |
| `storefront/api/pages/route.ts` (`makeCrudRoute`) | REQ-006 | `api.crud-route` → `src/modules/example/api/todos/route.ts` | 2 | TEST-011 | emitted-example |
| `storefront/api/pages/[id]/{publish,rollback,revisions}/route.ts` | REQ-006 | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 2 | TEST-011 | emitted-example |
| `storefront/acl.ts`, `setup.ts`, `events.ts`, `i18n/*.json` (Phase 2 additions) | REQ-006 | `module.acl-features`, `module.setup-role-features`, `events.typed-definitions`, `module.i18n-catalogs` → `src/modules/example/{acl,setup,events}.ts`, `i18n/en.json` | 2 | TEST-011 | emitted-example |
| `storefront/backend/storefront/pages/page.tsx` | REQ-006 | `ui.list-table` → `src/modules/example/components/TodosTable.tsx` | 2 | TEST-018 | emitted-example |
| `storefront/backend/storefront/pages/{create,[id]}/page.tsx` | REQ-006 | `ui.form-edit` → `src/modules/example/components/TodoForm.tsx` | 2 | TEST-018 | emitted-example |
| `storefront/backend/storefront/pages/[id]/builder/page.tsx` + `components/builder/**` | REQ-007 | approved custom canvas (no example row); installed reference `@open-mercato/core` workflows visual editor | 2 | TEST-015, TEST-016, TEST-018 | approved-exception |
| `storefront/frontend/[siteSlug]/[pageSlug]/page.tsx` | REQ-006 | `ui.frontend-page` → `src/modules/example/frontend/example.tsx` | 2 | TEST-011, TEST-012 | emitted-example |

The reference module is source-present and unregistered; nothing above is behavior the app already has until `storefront` is enabled.

## Rollout, Migration, and Rollback

- **Migration:** one additive migration creates the three tables; reviewed from `yarn db:generate` and applied with `yarn db:migrate` (the owner approved applying Phase 1 migrations in this delivery). No existing table changes.
- **Seed/backfill:** new tenants via `onTenantCreated`; existing tenants via `yarn mercato storefront ensure-sites` (idempotent; safe to re-run).
- **Phase 2 migration:** additive (nullable columns, new table, backfill of revision 1 for already-published pages); applied to the local development database for verification under the owner's go-ahead for Phase 2. Existing tenants receive the new `storefront.pages.*` grants with `yarn mercato auth sync-role-acls`.
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
| json-render leaks into a public bundle (Phase 2) | Buyers download a client renderer | imports confined to `components/builder/**` client components; TEST-012 scans public chunks with a positive control | Low |
| json-render 0.x API changes on upgrade (Phase 2) | Builder breaks | exact pin; the adapter is the only seam (TEST-015) | Medium until 1.0 |
| Unbounded revisions (Phase 2) | Table growth (≤ 64 KB per revision; publish/rollback are not rate-limited) | only staff with `storefront.pages.publish` can append; 30-page cap; paginated reads; retention policy deferred (P2-Q11) | Low at launch scale |

## Acceptance Criteria

- [x] **AC-001** — A merchant who completes self-service signup has exactly one site, one theme and one published home page; re-running `ensure-sites` changes nothing.
- [x] **AC-002** — From `/backend/storefront/brand` a merchant saves name, description, logo, eight colours, font pair, radius and density; invalid values show field errors; a stale save returns a conflict without overwriting.
- [x] **AC-003** — `GET /{siteSlug}` returns server-rendered HTML whose scoped CSS custom properties, title, description, canonical, Open Graph and JSON-LD come from that site; no client JSON renderer is shipped.
- [~] **AC-004** — Every malicious or oversize spec in TEST-001 is rejected on save and on render; the public page never renders a partially valid spec. *(Phase 1: rejected by the validator, on seed and on render; save-time validation ships with page saves in Phase 2.)*
- [x] **AC-005** — Tenant B can read none of tenant A's site, theme, pages or media through any staff or public route; foreign ids answer 404. *(A foreign `tenantId` in a request body is refused earlier by the platform with 403 "Not authorized to target this tenant" — the same answer for any id, so nothing about existence leaks.)*
- [ ] **AC-006** — Publish creates an immutable, numbered revision from the saved draft; rollback appends a copy of an earlier revision and resets the draft to it; drafts are never public; a page is served at `/{siteSlug}/{pageSlug}` only while published.
- [ ] **AC-007** — In the builder a merchant adds (from the json-render catalog), edits, reorders and removes sections with a live preview, by pointer and by keyboard; edits round-trip through draft save and publish; public routes ship no `@json-render/*` code.
- [ ] **AC-010** — Page slugs follow the grammar, are unique per site, avoid reserved words and freeze after the first publish; a store holds at most 30 pages; the home page cannot be deleted.
- [ ] **AC-008** — Media and commerce blocks render only the site's tenant data.
- [ ] **AC-009** — Each store exposes per-page SEO, a sitemap of published pages and a robots policy; publishing refreshes them.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`; `.ai/guides/{architecture,contracts,backend-ui,spec-delivery}.md`; `om-module-scaffold` + blueprints; module facts for portal, directory, customer_accounts, attachments, onboarding; installed core/shared/onboarding/auth `AGENTS.md`; `json-render-*` skills |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Requirement Traceability + Extension-surface traceability |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-003 map to Phase 1 and J-004 to Phase 2; each phase has its own tests and exit gate |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts (CrudForm custom-field exception recorded) |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Phases |

Verdict: **Ready for implementation** (Phase 1 approved by the owner's brief and verified; Phase 2 detailed and reviewed on 2026-10-22 and ready once the owner confirms the plan, its dependencies and its migration; Phases 3–4 are approved individually later).

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

### Phase 2 detail pass (2026-10-22)

The Phase 2 contracts were written in a second `om-spec-writing --autonomous` pass and reviewed by a fresh-context reviewer that received only this file's path. Its verdict was **scope cohesion PASS** (pages, publishing, builder and the public page route form one authoring capability), but **readiness FAIL**. All findings were resolved in this document:

- **High — title/SEO go-live contradiction.** Resolved by P2-Q13: title and SEO description are draft fields, published through revisions; the public route reads the published revision.
- **High — missing state contracts for the list, create and settings routes.** Resolved: the per-route contract table and the create/settings mockup.
- **High — undo could break the slug freeze or the page cap.** Resolved: undo rules in the update and delete rows.
- **Medium — list/document props in the inspector; client-safe preview components.** Resolved by P2-Q14 and TEST-015.
- **Medium — entity-id and site-slug contradictions.** Resolved: generated ids are the frozen surface; no site-slug edit in Phases 1–2.
- **Medium — untested behaviour and missing AC ids.** Resolved: TEST-011/018 cases added, AC ids named in the phase and the status table.
- **Medium — event payloads, revisions errors, strict schemas, query index.** Resolved: payloads, 401/403, strict request schemas, no `indexer`.
- **Medium — rollback replacing unpublished work.** Kept with a warning in the confirmation and marked ⚠ for owner confirmation (P2-Q4).
- **Medium — revision growth.** Recorded as a risk (P2-Q11).
- **Low items.** Stale text and the Phase 4 overlap corrected.
- **Migration.** The owner is asked explicitly before it is applied (AGENTS.md).

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
| Q1 | Split into several specs? | product owner | no | One spec, four phases; roadmap Phases 5–6 and translations/webfonts as follow-up specs — autonomous default, 2026-10-22 |
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

## Implementation Status

Source doc: .ai/specs/2026-10-22-storefront-builder.md

**Phase 1 execution plan** (om-implement-spec; confirmation: the owner's brief of 2026-10-22 selects and approves "Phase 1 only", including applying its migration).

- **Goal:** every new tenant gets a live, branded home page at `/{siteSlug}` that the merchant re-brands in `/backend/storefront/brand`.
- **Scope:** Phase 1; AC-001…AC-005; module `storefront` (new); call sites `src/modules.ts`, `setupInitialTenant` → `onTenantCreated`, `/api/storefront/brand`, `/api/storefront/media/*`, `/backend/storefront`, `/backend/storefront/brand`, `/{siteSlug}`.
- **Non-goals:** Phase 2 pages/revisions/builder, Phases 3–4, follow-up specs; no new npm dependencies.
- **Phase execution:** slices (a) module shell + data + validators [om-module-scaffold, om-data-model-design; refs `module.*`, `data.*`]; (b) catalog + validator + renderer [contracts guide; json-render-* skills for schema shape]; (c) seeding + CLI [`module.setup-role-features`, `module.cli-command`]; (d) brand command + routes + media route [`commands.write`, `api.custom-route`, installed `directory/api/organization-branding/route.ts`]; (e) admin UI [om-backend-ui-design; reference `/backend/directory/branding`]; (f) public page [`ui.frontend-page`]. Oracles: TEST-001…TEST-010. Validation: `yarn generate`, `yarn db:generate` probe, `yarn typecheck`, `yarn lint`, `yarn test`, two-tenant API/browser checks.
- **Risks:** React 19 metadata hoisting under the catch-all; `onTenantCreated` errors inside `setupInitialTenant`; route specificity for `/{siteSlug}`.

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — Brand foundation and published home page | done | none | AC-001…AC-005 | `yarn generate && yarn typecheck && yarn test` + two-tenant checks | two fresh tenants, wizard, public page, isolation |
| Phase 2 — Page authoring | in_progress | Phase 1 (verified) | AC-004 (save/publish), AC-005, AC-006, AC-007, AC-010 | `yarn generate && yarn typecheck && yarn test` + `TC-STOREFRONT-002` + two-tenant checks | builder round trip; drafts never public; no json-render on public routes; isolation; AC-010 rules; UI states |
| Phase 3 — Media and commerce blocks | pending | Phase 2 | AC-008 | — | — |
| Phase 4 — SEO and indexability | pending | Phase 2 | AC-009 | — | — |

### Phase 1 progress

- [x] (a) module shell + data + validators: `src/modules/storefront/{index,acl,setup}.ts`, `data/{entities,validators}.ts`, `lib/{theme,slug}.ts`, `i18n/en.json`, `src/modules.ts` (`enabledModules.push`), migration `Migration20261022035801_storefront.ts` (+ 4 partial unique indexes, re-probe "no changes", applied); TEST-002/003/004 — `yarn generate` exit 0; `yarn db:generate` (storefront only); `yarn jest src/modules/storefront` 19 passed
- [x] (b) catalog + validator + renderer: `lib/blocks/{schemas,catalog,pageSpec,defaultHome}.ts`, `lib/{structuredData,storefrontCss,publicSite}.ts`, `components/public/{blocks,registry,StorefrontView}.tsx`; TEST-001 (malicious specs incl. `$state`/`$cond`/`$t`, `className`/`style`/`dangerouslySetInnerHTML`/`ref`, unsafe hrefs, caps, prototype keys) and TEST-004 (scoped CSS vars, text-only rendering, JSON-LD escaping, head tags) — `yarn jest src/modules/storefront` 53 passed
- [x] (c) seeding + CLI: `lib/seeding.ts` (`ensureStorefrontSite`, idempotent, repairs a missing theme/home, slug race → re-check), `setup.ts` `onTenantCreated` (logs, never fails signup), `events.ts`, `cli.ts` `ensure-sites [--tenant]` — `yarn generate` exit 0, `yarn typecheck` exit 0; `yarn mercato storefront ensure-sites` → `created /suqna-platform`, re-run → `existing`, bad `--tenant` rejected; rows verified (site + theme v1 + published `index` with 4 sections). TEST-009 runs in the two-tenant E2E
- [x] (d) brand command + routes + media route: `commands/brand.ts` (`storefront.brand.update`, aggregate lock on the site row, logo must be a raster attachment of the same org, undo via `extractUndoPayload`, cross-scope undo → 404), `api/brand/route.ts` (GET/PUT, mutation guards, `{ error, fieldErrors }` keyed by path), `api/media/[siteSlug]/[attachmentId]/route.ts` (public; serves only the live site's referenced logo; everything else 404), `api/openapi.ts`, `lib/{fieldErrors,media}.ts`; TEST-005 (6 cases) + field-error tests — live: GET 200, invalid 422 with `name`/`tokens.colors.*`/`tenantId`/`css` field errors, stale version 409, foreign logo 422, anonymous 401, unreferenced media 404
- [x] (e) admin UI: `backend/storefront/page.tsx` (+meta, `store` icon, `storefront.view`), `backend/storefront/brand/page.tsx` (+meta, `storefront.brand.manage`, nav-hidden), `components/{StorefrontOverview,BrandWizard,brandForm}.tsx`; CrudForm with four step groups + `StepIndicator`, `ColorPicker`, presets, live contrast hints (`role=status`), `SegmentedControl`, `ImageUpload` → `POST /api/attachments`; i18n en/de/es/pl/ko (104 keys each) — browser check: overview, Edit brand gated by feature-check, server field errors on save
- [x] (f) public page: `frontend/[siteSlug]/page.tsx` (+meta `requireAuth: false`), `lib/publicMetadata.ts`; per-request `cache()` load; spec re-validated on render (invalid → unavailable page, `noindex`, error log); title/description/canonical/OG through Next metadata via a static `generateMetadata` read by the frontend catch-all (divergence recorded in docs/UPSTREAM_DIVERGENCES.md) — live: `/suqna-platform` 200 with one `<title>`, one canonical, OG set, `--sf-color-primary` = saved value, JSON-LD, no `json-render`; `/Suqna-Platform` 308 → canonical; unknown slug 404
- [x] (g) payment policy (deliverable 5): `src/modules/payment_policy/{index,setup,cli}.ts`, `lib/policy.ts` (+3 unit tests); `seedDefaults` after `sales` deactivates non-manual providers and strips provider settings; `yarn mercato payment_policy enforce` — platform tenant: `card (stripe)` cleaned, re-run "nothing to change"; fresh tenants: `card|stripe|inactive|no settings`, COD and bank transfer active
- [x] (h) verification: two fresh self-service signups (Atlas Coffee, Bloom Florist) through `/onboarding` with captured email; TEST-009 seeded site/theme/published home for both; TEST-010 wizard in Chromium (logo upload 200, Midnight preset, radius/spacing, save 200 with lock header, success flash; two tabs → 200 then 409 with the shared conflict bar); TEST-008 `/atlas-coffee` 200 with A's `--sf-color-*`, one `<title>`, canonical, description, OG incl. `og:image`, JSON-LD, logo 200 `image/png`, no `json-render`, phone width checked; TEST-006 employee GET 200 / PUT 403; TEST-007 17/17 isolation checks (B sees only B, A's logo via B's slug 404, B's unreferenced upload 404, attachments API lists none of A's files, A palette absent from B's page, scope smuggling refused); `TC-STOREFRONT-001.spec.ts` 4/4 against the dev server
- [x] (i) review (`om-code-review` + `.ai/review-checklist.md`): fixed — brand route moved to the registry mutation-guard contract (`runRouteMutationGuards`, `modifiedPayload` merged and revalidated), version re-checked under a row lock inside the write transaction (+regression test), contrast refinement skips pairs with an invalid colour (+test), duplicate HEX input removed; existing tenants needed `auth sync-role-acls` (documented)
- Gates (final): `yarn generate` ✅, `yarn typecheck` ✅, `yarn lint` ✅ (0 errors; remaining warnings are scaffold files), `yarn ds:check` ✅, `yarn test` ✅ 7 suites / 69 tests, `yarn build` ✅ (needs the dev server stopped on a 15 GB sandbox: with both running, Next's type-check worker exits silently), `yarn db:generate` probe no changes

### Phase 2 progress

**Phase 2 execution plan** (om-implement-spec; confirmation: the owner approved on 2026-10-22 — plan + `@json-render/core@0.21.0`/`@json-render/react@0.21.0` in the admin builder only, applying the Phase 2 migration to the local development database after SQL review, and the ⚠ defaults P2-Q1 (reserved page slugs) and P2-Q4 (rollback replaces unpublished draft changes)).

- **Goal:** merchants author pages in a json-render builder, publish immutable revisions and roll back; buyers see `/{siteSlug}/{pageSlug}`.
- **Scope:** Phase 2; AC-004 (save/publish), AC-005, AC-006, AC-007, AC-010; module `storefront`; call sites `/api/storefront/pages*`, `/backend/storefront/pages*`, `/{siteSlug}/{pageSlug}`, the Phase 1 seeding function and public home route.
- **Non-goals:** Phases 3–4 (media/commerce blocks, sitemap/robots/caching), navigation menus, autosave, revision retention.
- **Phase execution:** slices (a) data + migration + backfill [om-data-model-design]; (b) commands [om-module-scaffold, `commands.write`]; (c) routes + ACL/setup/events [`api.crud-route`, `api.custom-route`]; (d) public multi-page route [`ui.frontend-page`]; (e) pages list/create/settings UI [om-backend-ui-design]; (f) json-render adapter + rich-text markup + editor-field map [json-render-core/react skills]; (g) builder [om-backend-ui-design, workflows visual editor reference]; (h) TEST-012/019, gates, `om-code-review`. Oracles: TEST-001 (ext), TEST-011, TEST-012, TEST-015…TEST-019.
- **Risks:** json-render 0.x API surface; preview CSS isolation inside the admin; `makeCrudRoute` + command mapping for draft specs.

- [x] (a) data + migration: `data/entities.ts` (`draft_spec`, `draft_updated_at`, `published_revision_id`; `StorefrontPageRevision`), `migrations/Migration20261022133705_storefront.ts` (generated SQL reviewed — storefront only — plus idempotent backfill of revision 1 and a `down()` that drops the table), `lib/seeding.ts` (home page + revision 1 written together), `lib/slug.ts` (`RESERVED_PAGE_SLUGS`, `pageSlugIssue`, `suggestPageSlug`); deps `@json-render/core@0.21.0`, `@json-render/react@0.21.0` (exact; single zod instance) — `yarn db:generate` → one storefront migration; `yarn db:migrate` (approved) → applied; backfill verified (platform home → revision 1, spec equal); re-probe `storefront: no changes`; `yarn jest src/modules/storefront/lib` 56 passed; `yarn typecheck` clean
- [x] (b) page commands: `commands/pages.ts` (`storefront.pages.{create,update,delete,publish,rollback}`; site row lock for the cap, page row lock + version re-check for every write, strict inputs, spec issues → 422 with paths, undo with slug-freeze/slug-taken/cap rules, events after commit), `lib/{commandScope,pages}.ts`, `lib/blocks/starterPage.ts`, `data/validators.ts` (page schemas), `events.ts` (5 page events); brand command moved onto the shared scope helpers — TEST-017 `yarn jest src/modules/storefront/commands` 17 passed (10 page + 7 brand); `yarn typecheck` clean
- [x] (c) routes + ACL: `api/pages/route.ts` (makeCrudRoute list/create/update/delete; list pinned to the store organization; specs projected only for `?id=`), `api/pages/[id]/{publish,rollback,revisions}/route.ts`, `lib/{routeContext,pageActionRoute}.ts`, `api/openapi.ts` (page schemas), `acl.ts` (`storefront.pages.manage`, `storefront.pages.publish`); `lib/commandScope.ts` `resolveStoreOrganizationId` re-reads the session's home organization because the CRUD factory blanks `auth.orgId` for an "all organizations" selection (same tenant + allowed-set guards as `resolveSingleOrganizationIdOrDeny`) — `yarn generate` exit 0; `yarn mercato auth sync-role-acls`; `yarn jest src/modules/storefront` 78 passed
- [x] (d) public routing: `lib/publicSite.ts` (`resolvePublicStorefrontPage`), `lib/publicPageLoader.tsx` (per-request memoised load, 308 to canonical paths, live revision title/SEO), `frontend/[siteSlug]/page.tsx`, `frontend/[siteSlug]/[pageSlug]/{page.tsx,page.meta.ts}` — TEST-011 `TC-STOREFRONT-002` 3 passed (`--retries=0`), `TC-STOREFRONT-001` still 4 passed
- [x] (e) staff pages list/create/settings: `backend/storefront/pages/{page,create/page,[id]/page}.tsx` (+ `page.meta.ts`, nav "Pages"), `components/pages/{PagesTable,PageForm,pageClient}.tsx`, `components/useStorefrontPermissions.ts` (wildcard-aware feature check shared with the overview); `PageListItem` moved to `lib/pages.ts` — `yarn generate` exit 0; `yarn typecheck` clean; `eslint src/modules/storefront` clean
- [x] (f) json-render adapter: `components/builder/{catalog.ts,BuilderPreview.tsx,blockEditors.ts,richTextMarkup.ts}`; `StorefrontFrame` extracted from `StorefrontView` so the preview reuses the public chrome — TEST-015 + TEST-016 `yarn jest src/modules/storefront/components` 20 passed
- [ ] IN FLIGHT: (g) builder page — files: none yet; last command: not run; remaining: slices g–h, i18n, docs

## Changelog

| Date | Change |
|---|---|
| 2026-10-22 | Skeleton with open questions Q1–Q10 |
| 2026-10-22 | Questions resolved under autonomous defaults; problem, goals, scope filled |
| 2026-10-22 | Research, design and implementation breakdown |
| 2026-10-22 | Review: scope split (custom domains, AI, translations, webfonts → follow-up specs), pages + builder merged, edge cases added; status Ready for implementation (Phase 1) |
| 2026-10-22 | Phase 1 implemented and verified (ledger above); keyboard-submit wording corrected; implementation decisions I1–I7 in `docs/DECISIONS.md` |
| 2026-10-22 | Phase 2 detail pass (`om-spec-writing --autonomous`): defaults P2-Q1…P2-Q12, page/revision data model, per-route contracts, pages list/create/settings/builder UI with mockups and states, edge cases, TEST-011/012/015…019, AC-010 |
