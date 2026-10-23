# Suqna

Suqna is a multi-tenant SaaS e-commerce platform. Anyone who signs up gets an
isolated tenant: their own store, admin dashboard, subdomain and/or custom
domain, buyer accounts and data. The platform owner (superadmin) sees every
tenant; tenants never see each other.

Payments follow the local market: **cash on delivery**, or **bank transfer**
where the buyer uploads a receipt image for the merchant to approve. There is
no online payment gateway.

Built on [Open Mercato](https://github.com/open-mercato/open-mercato) **0.9.0**
(stable channel; Next.js 16, React 19, PostgreSQL 17 + pgvector, MikroORM 7,
TypeScript 6, Node 24, Yarn 4). Scaffolded with
`create-mercato-app --preset classic --agents claude-code`.

## Working on this repo with an agent

Read `AGENTS.md` first; every task starts with the `om-help` skill. Specs live
in `.ai/specs/` (template: `.ai/specs/SPEC-000-template.md`). Skills:

- `.agents/skills/` is the canonical skills directory: Open Mercato's local
  skills (linked from `.ai/skills/`), the pinned `open-mercato/skills` set, and
  the vendored json-render skills (`json-render-*`).
- `.claude/skills/` holds the Claude Code entries. The json-render entries are
  real folders whose `SKILL.md` links into `.agents/skills/`, so
  `yarn install-skills` keeps them (it prunes unknown top-level links).
- json-render skills: `json-render-core`, `json-render-react`,
  `json-render-next`, `json-render-shadcn`, `json-render-directives`. See
  `THIRD_PARTY_NOTICES.md`.

Do not edit `node_modules/`, `.mercato/generated/` or `@open-mercato/*`
sources. Customise through `src/modules.ts`, overrides, and app modules in
`src/modules/<id>/`.

## Modules

35 modules are enabled in `src/modules.ts` (34 from Open Mercato plus the
scaffold's test-only `ratelimit_probe`):

| Capability | Modules |
|---|---|
| Tenants, organizations, staff auth, roles and permissions | `auth`, `directory`, `api_keys` |
| Platform plumbing | `configs`, `entities`, `query_index`, `events`, `progress`, `audit_logs`, `attachments`, `dashboards`, `perspectives`, `api_docs`, `dictionaries`, `currencies`, `feature_toggles` |
| Catalogue, customers, orders, inventory | `catalog`, `customers`, `sales`, `wms` |
| Buyer accounts, customer portal, per-tenant custom domains | `customer_accounts`, `portal` |
| Self-service tenant signup and its legal pages | `onboarding`, `content` |
| Translations, search, notifications | `translations`, `search`, `notifications` |
| Automation | `workflows`, `business_rules`, `scheduler` |
| Transactional email | `communication_channels`, `channel_resend`, `integrations`, `messages` |

Why:

- **Payments.** `sales` ships offline providers (`cash-on-delivery`,
  `wire-transfer`). Receipt images go through `attachments`. `payment_gateways`,
  `checkout` and `gateway_stripe` stay off.
- **Dependencies.** Each declared `requires` is satisfied: `sales` needs
  `catalog`, `customers`, `dictionaries`; `wms` needs `catalog`, `sales`,
  `feature_toggles`; `customers` and `communication_channels` need `progress`;
  `portal` needs `customer_accounts`; `entities` needs `query_index`;
  `channel_resend` needs `communication_channels` and `integrations`.
  `communication_channels` also imports the `messages` entities, so `messages`
  is enabled too.
- **Email.** The framework's signup verification, notifications and portal emails
  use the Communications Hub system transport (`communication_channels`;
  `channel_resend` stays installed but unconfigured). The owner's rule is that
  email stays disabled everywhere (`docs/DECISIONS.md` P6), so nothing here may
  depend on a provider.
- **Scheduler.** `customer_accounts` (domain checks) and `workflows` register
  scheduled jobs.
- **Off on purpose** (packages installed, modules disabled): AI assistant and
  inbox ops (need an LLM key), staff/planner/resources, warranty claims, EUDR,
  phone calls, push/mobile channels, documents, data sync and Akeneo/Excel
  import, shipping-carrier integrations, webhooks, telemetry. Enterprise modules
  are never enabled.

`src/proxy.ts` is the framework reference app's proxy (`apps/mercato`, 0.9.0).
It wires custom-domain routing: a verified tenant domain is rewritten to that
organization's `/<orgSlug>/portal`. The 0.9.0 standalone template ships the
resolver in `src/lib/` but does not call it.

## Local setup

Requirements: Node 24, Yarn 4 (`corepack enable`), Docker.

```bash
cp .env.example .env      # then set secrets: JWT_SECRET, AUTH_SECRET, TENANT_DATA_ENCRYPTION_FALLBACK_KEY,
                          # LOOKUP_HASH_PEPPER, DOMAIN_CHECK_SECRET, DOMAIN_RESOLVE_SECRET (openssl rand -hex 32)
                          # and uncomment the three development email lines (docs/LOCAL_EMAIL.md)
docker compose up -d      # PostgreSQL 17 + pgvector, Redis 7, Meilisearch
yarn install
yarn generate             # build .mercato/generated registries
yarn db:migrate
yarn initialize           # superadmin + platform tenant + demo data
yarn dev --no-mcp         # http://localhost:3000/backend, signup at /onboarding
```

`--no-mcp` is needed because the dev runner's MCP sidecar needs the disabled
`ai_assistant` module. Other checks: `yarn typecheck`, `yarn lint`, `yarn test`,
`yarn install-skills --list`, `yarn harness:validate --all`.

Settings that matter in `.env` (beyond `.env.example` defaults):

| Variable | Value / purpose |
|---|---|
| `SELF_SERVICE_ONBOARDING_ENABLED` | `true` — enables `/onboarding` |
| `OM_DISABLE_EMAIL_DELIVERY`, `OM_TEST_MODE`, `OM_TEST_EMAIL_CAPTURE_PATH` | **development only**: email is disabled on purpose and captured to `.mercato/email-capture/outbox.jsonl` (`docs/LOCAL_EMAIL.md`) |
| `SYSTEM_EMAIL_PROVIDER`, `RESEND_API_KEY` (or SES settings), `EMAIL_FROM`, `ADMIN_EMAIL` | **not set, by owner decision** (`docs/DECISIONS.md` P6): email stays disabled in every environment |
| `PLATFORM_DOMAINS`, `PLATFORM_PRIMARY_HOST` | hosts treated as the platform, not a tenant |
| `DOMAIN_CHECK_SECRET`, `DOMAIN_RESOLVE_SECRET`, `INTERNAL_APP_ORIGIN` | custom-domain routing |
| `CUSTOM_DOMAIN_CNAME_TARGET`, `CUSTOM_DOMAIN_A_RECORD_TARGET` | DNS targets shown to tenants |
| `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `MEILISEARCH_MASTER_KEY`, `MEILISEARCH_INDEX_PREFIX` | full-text search |
| `OM_INIT_SUPERADMIN_EMAIL` / `_PASSWORD` (and `OM_INIT_ADMIN_*`, `OM_INIT_EMPLOYEE_*`) | accounts created by `yarn initialize` |

### Cloud sandbox notes

Claude Code cloud sessions start with Node 22 and no Docker daemon. What
worked: install Node 24 from nodejs.org and put it first on `PATH`, start
`dockerd`, and pull images from `mirror.gcr.io` if Docker Hub rate-limits
(tag `mirror.gcr.io/library/redis:7-alpine` as `redis:7-alpine`). If
`registry.yarnpkg.com` returns 503, run
`YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org yarn install`.

## Storefront

Every organization gets a public store at `/<siteSlug>` (the slug comes from the
organization slug), seeded at signup with a default theme and a published home page.
Spec: `.ai/specs/2026-10-22-storefront-builder.md`; decisions: `docs/DECISIONS.md`.

- **Admin:** *Storefront* in the sidebar (`/backend/storefront`) shows the public
  address and theme; **Edit brand** (`/backend/storefront/brand`, feature
  `storefront.brand.manage`) sets the store name, description, logo, eight colours,
  a font pair, corner radius and spacing. Saves go live at once.
- **Public page:** server-rendered by the app's own block registry (no client JSON
  renderer). Title, description, canonical URL, Open Graph and JSON-LD come from the
  brand; the logo is served by `/api/storefront/media/<siteSlug>/<attachmentId>`.
- **Pages (Phase 2):** *Storefront → Pages* (`/backend/storefront/pages`) lists the
  store's pages (up to 30, including the home page). **New page** asks for a title,
  an address (suggested from the title; it can change until the first publish) and
  an optional search description. **Edit content** opens the section builder:
  add sections from the picker (Hero, Rich text, Features, Footer), edit them in
  the side panel, reorder with the arrows or Alt+Up/Down, preview at desktop or
  phone width, **Save draft**, **Publish**. Every publish is kept as a revision;
  **Revisions → Restore** publishes a copy of an older one and replaces the
  current draft. Buyers only ever see the published revision at
  `/<siteSlug>/<pageSlug>`. Features: `storefront.pages.manage` (create, edit,
  delete, save drafts) and `storefront.pages.publish` (publish, restore); admins
  have both through `storefront.*`, employees can only view.
- **Payments:** the `payment_policy` module deactivates gateway payment methods (the
  `stripe` "Credit Card" method that `sales` seeds) for every new tenant. Cash on
  delivery and bank transfer stay active.
- **After deploying to an existing database**, run once:

  ```bash
  yarn mercato storefront ensure-sites      # a store for every organization
  yarn mercato auth sync-role-acls          # storefront.* grants for existing roles
  yarn mercato payment_policy enforce       # deactivate gateway payment methods
  ```

- **Tests:** `yarn test` (unit) and the integration specs in
  `src/modules/storefront/__integration__/` — `TC-STOREFRONT-001` (brand),
  `-002` (page API and public pages), `-003` (pages list and builder in a
  browser), `-004` (public pages load no json-render code)
  (`yarn test:integration:ephemeral`, or
  `npx playwright test --config .ai/qa/tests/playwright.config.ts src/modules/storefront/__integration__`
  against a running app).

## Not working yet

- **Signup without email.** Email stays disabled in every environment (owner
  decision, `docs/DECISIONS.md` P6), but the installed onboarding still confirms
  each signup with an emailed link. Locally the link is read from
  `.mercato/email-capture/outbox.jsonl` (`docs/LOCAL_EMAIL.md`). An email-free
  signup flow is the next spec; until it exists, a deployment cannot onboard tenants.
- **Tenant domains.** Each organization's portal works at `/<orgSlug>/portal`.
  Subdomains and custom domains need real DNS (`CUSTOM_DOMAIN_CNAME_TARGET`,
  for example a wildcard `*.<platform-domain>` record) and TLS at the edge
  (see Open Mercato's Traefik notes).
- **Media and commerce blocks, SEO extras.** Images, product grids, collections
  (spec Phase 3) and sitemap/robots (Phase 4) are not built yet; pages link to
  each other through Hero and Footer links (`/about` resolves under the store).
- **Public page weight.** The app shell (upstream) references every module's admin
  screens, so any public page, the stores included, downloads their client chunks
  (~120 scripts in dev and production). The storefront keeps its own editor code
  off public pages (`docs/DECISIONS.md` J4); trimming the shell is upstream work.
- **Content-Security-Policy.** The app-wide header comes from the upstream proxy
  and still allowlists `js.stripe.com`; nothing loads from it, but it can be
  tightened once the policy is reviewed (`src/proxy.ts`, see
  `docs/UPSTREAM_DIVERGENCES.md` §1).
