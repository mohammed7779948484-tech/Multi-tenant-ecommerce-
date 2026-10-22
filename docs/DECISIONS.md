# Decisions

The constraints this project rests on. Each was decided by the product owner unless marked
*engineering*. Future work follows them instead of re-asking; changing one is a deliberate
decision recorded here with a date. Detailed design lives in
`.ai/specs/2026-10-22-storefront-builder.md`.

## Platform

| # | Decision | Why |
|---|---|---|
| P1 | Suqna is a multi-tenant SaaS: every signup gets an isolated tenant (own store, admin, buyers, data); the platform owner sees everything. | Shopify-style model. |
| P2 | Built on Open Mercato **0.9.0** (stable channel), scaffolded with `create-mercato-app`; app code only in `src/modules/<id>/`, `src/modules.ts` and documented app files. Never edit `node_modules`, `.mercato/generated` or `@open-mercato/*` sources. | Upgrades stay possible; the agent harness stays authoritative. |
| P3 | No enterprise/commercial modules; the env switch that could enable them was removed from `src/modules.ts`. | Licensing. |
| P4 | Payments are **cash on delivery** or **bank transfer with a receipt image** approved by the merchant. No payment gateway, checkout or gateway modules; card methods seeded by `sales` are disabled for every new tenant by the `payment_policy` module. | Market reality; no external gateway integration. |
| P5 | Strict tenant isolation: every query is scoped by the trusted `tenant_id` (and `organization_id`); a cross-tenant id answers **404**, never 403-with-existence. | A 403 confirms the record exists. |
| P6 | Email is **disabled in local development** and captured to a file (`docs/LOCAL_EMAIL.md`). A deployment must configure Resend or SES; without a provider, tenants cannot sign up. *engineering* | Signup must be testable without a provider account, and the disabled state must never reach production. |
| P7 | The Claude Code harness (`.claude/`, `.agents/skills/`) is committed, including the vendored json-render skills. *engineering* | Every fresh clone or cloud session starts with the same rules and skills. |

## Storefront architecture

| # | Decision | Why |
|---|---|---|
| S1 | The public storefront renders **server-side with our own block registry**. `@json-render/react` or any client JSON renderer never ships to public pages. | SEO and Core Web Vitals are product requirements. |
| S2 | `json-render` lives in the **admin editor only**: section picking, live preview, later AI generation. | Its catalog-constrained specs are ideal for editing and AI; buyers do not need the runtime. |
| S3 | The block catalog is ours: a Zod schema plus an SSR-safe React component per block (Hero, RichText, Image, Gallery, ProductGrid, CollectionList, Features, Footer). Schemas are server-safe and separate from components. | Validation runs in APIs, setup hooks and CLI without React. |
| S4 | Page spec shape is `{ root, elements }` (json-render compatible), stored as **JSONB**; **our schema is the source of truth**. | Compatible with the editor and AI; validated by us. |
| S5 | Theme = **tokens**: eight HEX colours, a font pair, a radius and a density, emitted as CSS custom properties inside a scoped wrapper. **No merchant CSS, class names or inline styles, ever.** | Brand freedom without a code-injection surface. |
| S6 | Pages have `draft` and `published`; publishing writes an **immutable revision**; rollback restores a revision; the public site serves only the published revision. | Safe editing and an undo story merchants understand. |
| S7 | Buyer identity is **tenant-scoped** (per-tenant unique email, host-only session cookie). Never a shared cross-tenant identity or a platform-wide cookie. | Isolation; reuses `customer_accounts` as installed. |
| S8 | **One canonical host per store**: the platform path today, a verified custom domain once bound; the non-canonical host redirects instead of duplicating content. | Duplicate content hurts SEO and confuses buyers. |
| S9 | Pages are indexable: per-page title/description, canonical, Open Graph, JSON-LD, plus a per-store `sitemap.xml` and `robots.txt`. | Organic discovery is the merchant's main channel. |
| S10 | Reuse, don't rebuild: `onboarding`, `portal`, `customer_accounts` (buyers, `domain_mappings`), `catalog`, `attachments`, `translations`, `audit_logs`. AI is a later, flag-gated phase behind `ai_assistant`; nothing earlier depends on it. | Less code, fewer divergences from the framework. |

## Storefront security (non-negotiable)

| # | Rule | Why |
|---|---|---|
| X1 | Validate the spec **on save, on publish and on render**; unknown block types or props are rejected, never rendered best-effort. | A stored spec is untrusted input every time it is read. |
| X2 | No merchant-controlled `className`, `style`, `dangerouslySetInnerHTML`, `ref` or raw HTML. Text props render as text; RichText is a structured document (bold, italic, lists, links), not HTML. | Removes the HTML/CSS injection class entirely. |
| X3 | `href`/`src` through an allowlist: `https:` or site-relative only; images by **attachment id**, served through a site-scoped route. No `javascript:`/`data:`. | Script and data-URL injection. |
| X4 | Caps: 64 KB spec, 40 sections per page, 30 pages per store, 200 characters per text field unless a block allows more — with readable field-level errors. | Performance and abuse limits. |

## Defaults chosen by the owner

| # | Default | Notes |
|---|---|---|
| O1 | Store served at its **platform path** at launch (`/{siteSlug}`); custom-domain binding available. | Path shape is an autonomous default awaiting confirmation (spec Q2). |
| O2 | RichText is limited rich text (bold/italic/lists/links), sanitised. | Implemented as a structured document, so there is no HTML to sanitise. |
| O3 | Store slug frozen after first publish. | |
| O4 | Fonts self-hosted. | Phase 1 uses system font stacks (nothing fetched from third parties); webfont files arrive in a follow-up. |
| O5 | New stores publish immediately. | The seeded home page is published at signup. |

## Open items needing the owner

- Spec Q2 (public path `/{siteSlug}`) and Q4 (theme saves go live immediately) are marked ⚠ in the spec.
- Real email provider before any deployment; DNS for custom domains; release channel (stable 0.9.0 today).
