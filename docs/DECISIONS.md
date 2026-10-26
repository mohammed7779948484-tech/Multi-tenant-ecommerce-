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
| P6 | Email stays **disabled, in production too**: no Resend, no SES, no other provider, no verification codes. Signup must complete with no email round-trip at all. *owner, 2026-10-23* | **Not met yet.** The installed `onboarding` module verifies every signup by an emailed link; development works around it with a capture file (`docs/LOCAL_EMAIL.md`). Replacing that flow is the next spec (open item below). Supersedes the engineering note of 2026-10-22 that "a deployment must configure Resend or SES", which contradicted the owner. |
| P7 | The Claude Code harness (`.claude/`, `.agents/skills/`) is committed, including the vendored json-render skills. *engineering* | Every fresh clone or cloud session starts with the same rules and skills. |

## Storefront architecture

| # | Decision | Why |
|---|---|---|
| S1 | Buyer pages are rendered by the storefront's own **Server Component** registry. No client-side spec renderer (`@json-render/react` `Renderer`, `@json-render/next` `PageRenderer`) ships to buyers. *owner, 2026-10-23 (spec Q11)* | **Performance, not markup.** A client renderer uses React context and hooks, so every section's code ships to the browser and the whole page hydrates, while our sections are static content. Next 16 prerenders client components to HTML too, so crawlers would see the same markup; SEO is affected only through Core Web Vitals, which is the same performance cost. TEST-012 enforces the rule (no client spec renderer in public scripts); it is a presence check, not a byte budget. |
| S2 | json-render is the storefront's **vocabulary**. The block catalog is adapted with `defineCatalog` and drives the builder (picker, live preview) and, later, AI generation through `catalog.prompt()` on the server. `@json-render/core` is React-free and may run in server code. Our strict schemas stay the only validator. `@json-render/next` `createNextApp` is not used. *owner, 2026-10-23 (Q11)* | Verified in `node_modules`: core imports only `zod`, and a Node probe with React blocked runs it. `catalog.validate()` in 0.21 checks element types but not props, so it cannot be the gate. `createNextApp` returns no `Page` in 0.21.1/0.21.2, despite its docs. |

> **Correction (2026-10-23).** The 2026-10-22 versions of S1 and S2 said json-render must never reach a public page "for SEO" and were listed as owner decisions. They were a reviewer's recommendation, and the SEO reason was imprecise. The evidence and the corrected rule are in the spec's *Revision 2026-10-23*.
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

## Decisions made while implementing Phase 1 (2026-10-22)

| ID | Decision | Why |
|---|---|---|
| I1 | The `payment_policy` app module deactivates gateway methods instead of deleting them, and strips their provider settings. It runs in `seedDefaults` after `sales` (it `requires` sales and is registered after it); `yarn mercato payment_policy enforce [--tenant]` applies it to existing tenants. | `sales` re-seeds a method only when its code is missing, so a deleted card method would come back on the next seed run; an inactive row stays inactive. The seed's example `pk_test`/`sk_test` values are removed. |
| I2 | Allowed payment provider keys: `cash-on-delivery`, `wire-transfer`, or none (manual). Everything else is deactivated. | An allowlist also covers gateways a future package might seed. |
| I3 | Store pages get title, description, canonical and Open Graph tags through Next metadata, supplied by a static `generateMetadata` on the page component and read by the frontend catch-all. | One tag of each kind per document; see `docs/UPSTREAM_DIVERGENCES.md` §6. |
| I4 | In Phase 1 the home page title is the brand's store name, not the seeded page row's title. | A rename in the wizard shows at once; per-page titles arrive with page authoring (Phase 2). The seeded hero text is page content and is edited in Phase 2. |
| I5 | Brand saves lock on the site row: `prepare` checks the version, and `execute` re-checks it under `SELECT … FOR UPDATE` inside the write transaction. | Two saves that both passed `prepare` cannot both commit; the second gets 409. |
| I6 | The logo route serves only the live store's current logo (raster types; no SVG); any other attachment id, store or state answers the same 404. | No existence leak; merchant uploads stay private unless referenced. |
| I7 | Existing tenants need `yarn mercato auth sync-role-acls` after deploying the storefront module (new tenants get the grants at signup). | Role ACLs are seeded at tenant creation only; the platform tenant predates the module. |

## Decisions made while implementing Phase 2 (2026-10-22)

| ID | Decision | Why |
|---|---|---|
| J1 | Page routes and commands act on one store: the selected organization, or — for an "all organizations" selection — the caller's home organization, but only while the effective tenant is still the caller's and that organization is in the caller's allowed set (`lib/commandScope.ts`). The session is re-read from the request because the CRUD factory replaces `auth.orgId` with the (empty) selection. | A super-admin switched into another tenant must select an organization (400) instead of pairing a foreign organization with that tenant. Since the review this is the single rule for every storefront route (J9). |
| J2 | CRUD route bodies pass through to the commands, which parse with strict schemas and answer 422 with field errors (unknown keys included). A body that names a `tenantId` is refused earlier by the framework with 403, with the same answer for any tenant id. | The factory's own schema failures are a generic 400 with no field mapping. |
| J3 | `GET /api/storefront/pages?id=<foreign or unknown id>` answers 200 with no rows (CRUD list semantics); every single-record route (update, delete, publish, rollback, revisions) answers 404. The settings form and builder treat an empty result as "not found". | Neither answer reveals whether the id exists in another tenant. |
| J4 | The builder loads json-render on demand (`React.lazy` around the preview); no other builder file imports it, and the section picker reads the block catalog (TEST-015 pins it to the json-render catalog). | The upstream app shell references every module's admin pages, so statically imported client code is preloaded on public routes too (observed in dev and production). TEST-012 (`TC-STOREFRONT-004`) checks public pages with a positive control on the builder. |
| J5 | Restoring a revision closes the revisions drawer before the confirmation opens; Cancel reopens it. | The drawer is modal: a confirmation on top of it sat outside its focus trap and was hidden from screen readers. |
| J6 | Rich-text markup (spec P2-Q9) details: `\*`, `\[`, `\]`, `\\`, `\-` escape; a `*` followed by a space is a plain star; an unclosed `**`/`*` is a field error; whitespace between two links joins the first link's text (blank text nodes are invalid in the stored document). | Lossless round trip for everything the editor produces; no surprising formatting for "5 * 3". |
| J7 | The phone preview uses the design-system width `max-w-sm` (24rem, 384 px) instead of the spec's 390 px. | `yarn ds:check` rejects arbitrary Tailwind values. |
| J8 | Two-tenant isolation for pages (TEST-019) is proven with fresh signups driven through the real onboarding form (scratch scripts, not committed); committed integration tests run in the superadmin's organization. | Tenant signup depends on the local email capture flow, which the shared test runner does not provide. |

| J9 | `resolveStoreOrganization` (`lib/commandScope.ts`) is the only rule for picking the store: CRUD routes, commands, and the custom brand/publish/rollback/revisions routes all call it. Replaces the earlier `resolveSingleOrganizationIdOrDeny` use in `lib/routeContext.ts`. | Review finding: that helper falls back to the home organization without checking the caller's allowed organizations, so two routes families followed different rules. |
| J10 | Accepted: with "all organizations" selected, the CRUD factory gives mutation guards a null organization while the command writes to the resolved store. | Framework behaviour; no storefront guard depends on it. Selecting the organization avoids it. |
| J11 | `GET /api/storefront/pages` has CRUD exports turned off. | A full export bypasses `buildFilters`, which pins the list to the store's organization. Pages are not an export surface in the spec. |
| J12 | Public pages fail closed: a published page whose live revision row is missing, or a live store without its home page, renders the neutral unavailable page (logged), never the working copy. | Review finding; drafts (spec, title, SEO description) must never reach buyers. |

## Decisions made while correcting Phase 2 (2026-10-23)

| ID | Decision | Why |
|---|---|---|
| J13 | Page commands refresh the page's query-index entry after every write (`PAGE_INDEXER`), and the CRUD route declares `indexer`. | Any reindex (`mercato init`, `query_index reindex`) indexes pages. From then on the list search reads search tokens, so pages written afterwards were missing from the search. Found on a freshly initialised database. |
| J14 | `GET /api/storefront/pages?ids=` rejects a non-UUID entry with 400; the CRUD factory applies the id filter. | In Open Mercato 0.9.0 an `ids` list with no valid UUID becomes `id IN ()` in SQL and fails with 500 (upstream bug; also listed in `docs/UPSTREAM_DIVERGENCES.md`). |
| J15 | Custom staff routes give commands an `auth` whose tenant and organization are the ones the route resolved (like the CRUD factory's scoped auth). | A super-admin working in another tenant through the switcher got a 404 from brand/publish/rollback commands that looked in the session tenant. |
| J16 | The builder's leave guard keeps a same-URL duplicate history entry while the draft is dirty. Back lands on the builder's own entry, the dialog asks, and Leave steps past it. | The App Router handles `popstate` itself; without the duplicate, Back unmounted the builder (and the draft) before the question could be answered. |
| J17 | The payment policy writes through the installed `sales.payment-methods.update` command with a system context. | Audit log, undo and events for every policy change, the same path as an admin's edit. |
| J18 | Operator CLIs parse flags with Node's `util.parseArgs` (strict). | A bare `--tenant` used to mean "every tenant". |

## Decisions made while implementing Phase 3 (2026-10-23 – 2026-10-24)

| ID | Decision | Why |
|---|---|---|
| K1 | Store data for sections is read on the server by scalar id from the installed catalog entities (`findWithDecryption`, pinned to the site's tenant and organization). Prices come from `catalogPricingService.resolvePriceMany` over the product's and its variants' rows, exactly as the catalog products API does; no "From" label. | The catalog module forbids reimplementing pricing. The spec's earlier "product rows first, else lowest variant price" wording was corrected. |
| K2 | A product, category or product image is public only while a published section of that store shows it; everything else answers 404, including the same id under another store's slug. | "Active in the back office" is not "for sale in this store"; drafts and unpublished items never leak. |
| K3 | Product and collection pages run through the existing frontend catch-all, which now also passes the query string to public pages (`?page=`). | One routing seam; the change is small, limited to routes without auth, and recorded in `docs/UPSTREAM_DIVERGENCES.md` section 6. |
| K4 | A collection page reads at most the first 1,000 category assignments (about 40 pages of 24). Collection cards take their cover from the category's whole tree. | Bounded queries on growing data. Products often sit only in leaf categories, so a parent card had no cover. |
| K5 | The builder preview gets commerce data from `POST /api/storefront/preview-data` (same loader as the public render, without the published condition) and looks it up by the section's validated props. | json-render passes components their props only; keying by props needs no change to the spec format. The endpoint still answers keyed by section id, as the contract says. |
| K6 | Product and category pickers use the catalog's own staff APIs through the shared `LookupSelect` and `TagsInput`; saved product names are fetched one id at a time (at most 12). | The products API filters by a single `id`; no new endpoint for labels. A 403 shows an inline message instead of options. |
| K7 | Two templates: **Classic shop** (home, About, Questions, Contact) and **Simple showcase** (home, Contact). Copy mentions only cash on delivery and bank transfer, has no testimonials, and the contact page carries placeholder opening hours for the merchant to edit. | Owner payment policy; no invented reviews; drafts only, so placeholders never go live unreviewed. |
| K8 | `storefront.templates.apply` is logged against the home page; undo goes through the platform's last-operation banner and refuses with 409 (nothing reverted) once any written page's `updated_at` differs. | Partial undo would leave a half template. |
| K9 | The template dialog closes before the replace-draft confirmation opens (and reopens on Cancel); its Cmd/Ctrl+Enter stops propagation. | The shared confirmation listens on `window`: the same key press confirmed it unseen, and inside the modal dialog its buttons could not be clicked. |
| K10 | Image fields read the field's current value when an upload finishes. | Alt text typed during an upload was overwritten (found by `TC-STOREFRONT-006`). |
| K11 | Storefront locale files use flat keys only. | 3a had added nested objects beside flat keys; the loader merges both, and one key existed twice with different text. |
| K12 | Media route: visibility is decided before any cache or storage read; resizing uses `sharp` with `limitInputPixels`, fixed widths (320–1920), never upscales, and serves GIFs as uploaded. | No image is served or cached for anyone the rule does not allow; bounded CPU and memory per request. |

**Accepted risk (review minor):** applying a template requires only `storefront.pages.manage`, and the draft names the organization's top-level categories. Default roles grant that feature to admins only, who also hold `catalog.*`. Revisit if custom roles get page management without catalog access.

## Decisions for the buyer journey (2026-10-25)

Specs: `.ai/specs/2026-10-25-storefront-shopping-journey.md` (S-1…S-14) and `.ai/specs/2026-10-25-storefront-buyer-accounts.md` (A-1…A-5). The remaining storefront-builder editor work, including Phase 4, is deferred (revision in `.ai/specs/2026-10-22-storefront-builder.md`).

| ID | Decision | Why |
|---|---|---|
| L1 | In the shop, a product or category is public when it is active and not deleted in the store's organization. This supersedes K2 for browsing, search, cart and checkout; commerce sections keep working. | Search and browsing need the whole catalog; `isActive` is the merchant's existing control. ⚠ Owner confirmation requested. |
| L2 | Buyer pages are Arabic and right-to-left only, through an app-registered `ar` locale; dashboards keep their languages. | Owner brief; the framework's locale registry supports app locales without patching. |
| L3 | Buyer UI is built from shadcn/ui components in `src/components/ui`, themed per store by a scoped variable bridge from the theme tokens, with portals inside the store root. | Owner requirement; `@open-mercato/ui` carries the admin design tokens. |
| L4 | Buyer orders are created through the installed `sales.orders.create` command with a system context pinned to the store; totals come from `salesCalculationService`. | One order model; the merchant works orders in the sales admin. |
| L5 | Delivery is priced by a registered sales shipping provider (`suqna-yemen-zones`) whose rates live in the shipping method's settings, keyed by OCHA P-codes. | Reuses the sales provider registry and admin; merchant UI is deferred. |
| L6 | Guests reach an order only with a random access token (hashed at rest, cookie plus link); there is no lookup by phone. | Phones are unverified (no SMS, P6). |
| L7 | Buyer accounts are installed `customer_accounts` users with a non-routable `.invalid` login identifier and an app-owned phone binding; no verification. ⚠ Owner confirmation requested. | P6 forbids email; avoids a parallel auth system. |
| L8 | The store header no longer links to the customer portal sign-in. Buyer sign-in returns with buyer accounts (companion spec). | The portal is the installed B2B customer portal in the dashboard language, not part of the Arabic buyer journey. |
| L9 | Public store pages hide the platform notice bars (demo notice, cookie notice). A per-store privacy page and notice are a follow-up. ⚠ Owner confirmation requested. | They speak for the platform, in the dashboard language, and link to the platform's own policy pages; store pages set only essential cookies. |
| L10 | New stores seed their default home page in Arabic; existing stores keep their content. Merchant text takes its direction per paragraph from its first letter (`unicode-bidi: plaintext`). | Buyer pages are Arabic; merchants still write some English (brand names, product names), which must not render with punctuation on the wrong side. |
| L11 | `ar` is declared on the framework's locale type registry only. It is not registered at runtime (`registerLocales`), so it stays out of the dashboards' language switcher; buyer pages load the Arabic dictionary directly. Amends L2's "app-registered". | Dashboard localization is out of scope. |
| L12 | shadcn components come from the official registry with `components.json` set to `rtl: true` (logical classes). `button` and `card` were already in `src/components/ui` and are reused; `sheet`, `badge`, `separator` and `skeleton` were added with the CLI (which adds the `radix-ui` package). Portalled components mount in the store root through `src/components/ui/portal-container.tsx`. | One component family; RTL from the registry instead of hand-patched classes. |
| L13 | The shop's public catalog is every active, non-deleted product and category of the store's organization (spec S-2). It supersedes K2 for the shop: product pages, collection pages, search and product images on the media route follow it; the merchant's sections still show only what they pick. | Search and browse need the whole catalog; `isActive` is the merchant's existing control (⚠ Q-002: widens visibility compared with K2). |
| L14 | E-commerce blocks come from the ecomcn registry (`@ecomcn`, registered in `components.json`, installed with the shadcn CLI and `rtl: true`) into `src/components/ecomcn`, adapted in place: text through `useT` (keys `ecomcn.*` in the storefront dictionaries), Arabic plural counts, server-formatted prices, RTL arrow keys and Embla direction, no checkout button without a checkout action. Registry styling is baselined in `.ds-check-ignore`. | Reuse proven buy box, filters, cart sheet and gallery instead of rebuilding them. |
| L15 | Buyer prices are formatted once on the server with `ar-YE` (Arabic-Indic digits) and passed to client blocks as text where the HTML is server-rendered. | Hydration never depends on the browser's ICU data matching the server's. |
| L16 | Search narrows by text, the collection and the category filter in SQL, reading only the columns the filters need for at most 2,000 matching products (newest first); prices, stock, price range, sort and paging run over that set, and cards load their remaining columns for the shown page only. Beyond the cap the page says so. (Amended 2026-10-26: the first version read 500 candidates before the category filter, so a category of older products could come up empty.) | Prices come from the pricing engine, not a column; most stores are well inside the cap. |
| L17 | The add-to-cart button is not disabled while an option or a required personalization field is missing: it names the missing step and, when pressed, takes the buyer there (ecomcn pattern). Removing a cart line folds into an Undo bar for a few seconds instead of asking for confirmation. | Explains why rather than greying out; undo is faster than a dialog and as safe. |
| L18 | Cart writes are commands (`storefront.cart.*`) dispatched with a system context pinned to the store, not undoable and not written to the audit log; `storefront.cart.updated` carries ids only. | Buyer self-service on scratch state; the audit log is for staff actions. |
| L19 | Store close buttons and other shared-control labels use storefront-owned keys (`ecomcn.*`, `storefront.shop.*`), never `ui.*` keys: the app's English dictionary is merged after module shards and would override an Arabic `ui.*` value. | Arabic everywhere on buyer pages without touching the app dictionary. |
| L20 | Checkout is built from the ecomcn checkout blocks (address form, checkout stepper, delivery options, payment selector, order confirmation), adapted in place: Arabic through `useT`, server-formatted prices, a district list that follows the chosen governorate. Searchable selects are the shadcn `combobox` the address form ships with (built on `@base-ui/react`, a new dependency), not `command` + `popover`; the blocks keep their own state, so React Hook Form is not added (spec S-14 superseded). Fields are validated in the browser with the shared Yemen helpers and again on the server by strict Zod bodies. | Reuse the blocks instead of rebuilding them; one validation source per side, no second form library. |
| L21 | A guest's order token is derived from the cart token (HMAC-SHA-256), so a repeated submit of the same cart returns the same link without the server keeping the token; only its SHA-256 is stored. The order cookie is one per order (`sf_ord_<site>_<order hash>`), path `/`, 90 days (the spec said one per store at `/{site}`): path `/` lets the order API read it, one per order keeps earlier orders reachable. | Idempotent placement with a stable link; no token at rest. |
| L22 | Placement claims the cart (`placing`) in a short transaction, creates the order through `sales.orders.create` outside any storefront transaction, then records the access row and marks the cart `converted`. A second submit waits for the first and returns its order; a claim older than two minutes can be taken over. A cart being placed refuses edits (409). | Running the sales command inside our transaction delayed its commit past its own event handlers (the workflow engine looked for an instance that was not visible yet). |
| L23 | The destination travels in the order's shipping-method snapshot (`metadata.destination`), so the sales admin recalculates the same delivery charge. Line personalization is copied verbatim to the order line's `comment` (shown in the sales admin) and to `configuration.storefront.personalization`. The installed sales module does not encrypt order lines; buyer personalization on orders follows that. ⚠ Owner/engineering confirmation requested if personalization must be encrypted on orders too. | The merchant must read the personalization to fulfil the order. |
| L24 | The buyer's subtotal is the sum of the line totals. The sales engine's `subtotal*Amount` is a running total that already includes delivery and fees, so it is not shown as a subtotal. | Show items, delivery, fees and total without counting delivery twice. |
| L25 | `yarn mercato storefront shop-fixtures --tenant <id>` creates a Yemen-zones delivery method with sample rates (named and described as development data) for every store of the tenant, through `sales.shipping-methods.create`. It never touches payment methods; bank transfer stays hidden until a merchant replaces the seeded example instructions. | Local checkout works without inventing merchant data. |
| L26 | Buyer orders are created with a system context and no user. Installed workflows run as the user who triggered them, so a workflow step that updates a record (`UPDATE_ENTITY`) fails on buyer orders: the sales module's own order-approval workflow logs a failed "Set Order to Pending Approval" step (it continues, and buyer orders are already placed as `pending_approval`). No staff identity is borrowed for buyers. ⚠ If merchants need record-updating workflows on buyer orders, a dedicated storefront system user is an owner decision. | A buyer is not a staff user; borrowing one would mis-attribute audit entries and permissions. |

## Open items needing the owner

- Spec Q2 (public path `/{siteSlug}`) and Q4 (theme saves go live immediately) are marked ⚠ in the spec.
- **Buyer accounts without email** are specified in `2026-10-25-storefront-buyer-accounts.md` (L7).
- **Confirm L1** (whole active catalog is public in the shop), **L7** (buyer accounts without phone verification) and **L9** (no platform cookie/demo notice on store pages).
- **Merchant signup without email (P6).** Signup must complete with no email at all, in production too, while the installed onboarding sends a verification link. Next session: a spec for an email-free signup (for example, an app-owned signup route that provisions directly, with abuse controls replacing the email check), reviewed against `onboarding` and `auth` before code.
- **Workflows on buyer orders (L26):** decide whether buyer orders should run record-updating workflows as a dedicated storefront system user.
- **Personalization on orders (L23):** order lines are not encrypted by the installed sales module; decide whether buyer personalization needs encryption on orders too.
- **Prices for anonymous buyers.** Store pages price as an anonymous buyer (no channel, customer or group). Price rows limited to a sales channel or customer group do not show, so a product priced only per channel shows no price (the seeded example products, for instance). Decide whether stores should price through a default channel.
- DNS for custom domains; release channel (stable 0.9.0 today).
- Public page weight (J4): every public page downloads all modules' admin chunks through the upstream app shell; worth raising upstream or trimming the shell before launch. (Unrelated to json-render: S1 keeps our own renderer off the client, but the shell still preloads admin code.)
