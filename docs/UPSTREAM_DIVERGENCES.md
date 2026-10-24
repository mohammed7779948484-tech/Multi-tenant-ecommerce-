# Divergences from the upstream scaffold

Files that differ from what `create-mercato-app@0.9.0 --preset classic --agents claude-code`
generated. Each entry says why, where it came from, and what to check when upgrading Open
Mercato (`yarn up '@open-mercato/*'`, `yarn mercato agentic:init --update-harness`, or an
`om-auto-upgrade-*` skill).

## 1. `src/proxy.ts` — custom-domain routing (most important)

- **What:** replaced the template's proxy (which only sets the `x-next-url` header) with the
  proxy of Open Mercato's reference app.
- **Upstream source:** `apps/mercato/src/proxy.ts` in `open-mercato/open-mercato` at tag
  `v0.9.0` (commit `f451ce4c390087f90d5314e002e9d009d5339e08`), copied verbatim. It is still
  identical on `main` as of 2026-10-21.
- **Why:** the 0.9.0 standalone template ships the custom-domain resolver
  (`src/lib/customDomainResolver.ts`, `src/lib/customDomainCache.ts`) but its proxy never calls
  it. Without the reference proxy, a tenant's verified custom domain (managed in
  `/backend/customer_accounts/settings/domain`) would not reach that tenant's pages.
- **Behaviour:** hosts listed in `PLATFORM_DOMAINS` pass through unchanged (same as the
  template). Any other host is resolved through `/api/customer_accounts/domain-resolve`
  (needs `DOMAIN_RESOLVE_SECRET`, `INTERNAL_APP_ORIGIN`); a mapped host is rewritten to
  `/{orgSlug}/portal/...`, an unknown host gets the normal 404, a resolver outage answers 503.
- **On upgrade, review:**
  1. Diff the new template `src/proxy.ts` against the new `apps/mercato/src/proxy.ts`. If the
     template now wires the resolver itself, drop this divergence and take the template file.
  2. Otherwise diff the new reference proxy against ours and take upstream changes.
  3. Check `src/lib/customDomainResolver.ts` exports (`ensureWarmUp`,
     `getSharedCustomDomainRouter`, `isPlatformHost`) still exist, and that
     `@open-mercato/core/modules/customer_accounts/lib/{hostname,secretCompare}` still export
     `tryNormalizeHostname` and `secretEqual`.
  4. Run `yarn typecheck` and request a page with `Host:` set to a platform host and to an
     unmapped host.
- **Planned change:** the storefront custom-domains follow-up spec (roadmap Phase 5) will
  route a store's custom domain `/` to the storefront and `/portal/*` to the portal. That
  change lands here and must be recorded in this section.

## 2. `src/modules.ts` — module set

- **What:** 34 Open Mercato modules plus `ratelimit_probe` and the app modules (`storefront`,
  `payment_policy`) instead of the classic preset's list; the env-gated enterprise block is
  removed.
- **Why:** product module choice (README "Modules") and no commercial modules.
- **On upgrade, review:** new modules in the template's list; new `requires` of enabled
  modules (`yarn generate` fails on a missing dependency); rerun
  `yarn mercato agentic:init --update-harness --tool claude-code` so module fact sheets match.

## 3. `.gitignore` — harness tracked in git

- **What:** `.claude/settings.json`, `.claude/hooks/`, `.claude/skills/` and `.agents/skills/`
  are committed; `.claude/*` local files and `.agents/skills-quarantine/` stay ignored.
- **Why:** cloud sessions start from a fresh clone; untracked skills meant no skills.
- **On upgrade, review:** after `yarn install-skills --update`, commit the refreshed skills
  deliberately and read the diff.

## 4. `.claude/skills/json-render-*` — vendored skills

- **What:** real directories whose `SKILL.md` links to `.agents/skills/json-render-*`.
- **Why:** `install-skills` deletes unknown top-level links in `.claude/skills/`; real
  directories survive (verified).
- **On upgrade, review:** after `yarn install-skills`, confirm
  `ls .claude/skills/json-render-*/SKILL.md` still lists five files.
- **Known doc error (2026-10-23):** `json-render-next/SKILL.md` shows
  `export const { Page, … } = createNextApp(...)`. `@json-render/next` 0.21.1 and 0.21.2 return
  only `{ getPageData, generateMetadata, generateStaticParams }`. The vendored file is left
  unedited (it is refreshed from upstream); check `node_modules/@json-render/*/dist` before
  using any json-render API.

## 5. `tsconfig.json`

- **What:** one extra `include` entry (`.mercato/next/dev/dev/types/**/*.ts`) that `next dev`
  adds on every start.
- **On upgrade, review:** keep whatever `next dev` writes.

## 6. `src/app/(frontend)/[...slug]/page.tsx` — page-provided metadata

- **What:** in the catch-all's `generateMetadata`, a matched route that requires neither staff
  nor customer auth may supply its own metadata: when the loaded page component has a static
  `generateMetadata({ params })`, its result is returned instead of the route's static title.
  Every other route behaves exactly as before. Public routes (no `requireAuth`) also receive the
  query string as a `searchParams` prop and in their `generateMetadata` input; the storefront
  collection page reads `?page=` from it. About 25 lines, marked with comments.
- **Why:** the template only emits `page.meta.ts` titles, so a public page cannot set a
  per-record `<title>`, description, canonical URL or Open Graph tags. Rendering those tags from
  the page body would duplicate the root layout's default title and description. The storefront
  pages (`src/modules/storefront/frontend/[siteSlug]/**/page.tsx`: home, page, product,
  collection) are the only users today. The template's catch-all passes no query string at all.
- **Safety:** the hook is skipped for any route with `requireAuth` or `requireCustomerAuth`,
  because `generateMetadata` runs before the auth gates in the page function.
- **On upgrade, review:** if the template's catch-all gains its own metadata hook, switch the
  storefront page to it and drop this change; otherwise re-apply the block to the new file and
  check that `/{siteSlug}` still renders exactly one `<title>` and one canonical link
  (`TC-STOREFRONT-001` asserts both).

## 7. `jest.config.cjs` — integration specs excluded

- **What:** `/__integration__/` added to `testPathIgnorePatterns`.
- **Why:** the file's own header says Playwright integration specs are excluded from Jest, but
  the pattern was missing, so the first `src/modules/*/__integration__/*.spec.ts` broke `yarn test`.
- **On upgrade, review:** drop the change if the template adds the pattern itself.

## 8. `.ds-check-ignore` — one storefront entry

- **What:** an `inline-style` exemption for the theme swatches in
  `src/modules/storefront/components/StorefrontOverview.tsx`.
- **Why:** each swatch shows the merchant's own validated `#rrggbb` token as data; no design
  token can express it.

## 9. Harness title

- `AGENTS.md` and `.ai/specs/README.md` titles show `Multi-tenant-ecommerce-` because
  `agentic:init` derives the project name from the directory. Left as generated on purpose: a
  hand edit would mark the files user-modified and block future `--update-harness` refreshes.

## 10. Upstream bugs worked around in app code (Open Mercato 0.9.0)

- **CRUD `?ids=` with no valid UUID → SQL `IN ()` (500).** `mergeIdFilter` turns an
  all-invalid list into `id: { $in: [] }`, which the hybrid query engine renders as `in ()`.
  The storefront pages route rejects malformed ids with 400 before the factory runs
  (DECISIONS J14). Other CRUD routes of the app inherit the bug; worth reporting upstream.
- **Reindexing switches list search to search tokens.** Once an entity type has tokens for a
  tenant, `$ilike` filters are answered from the token index, so a module that writes rows
  without queuing index refreshes loses them from search after any reindex. The storefront
  page commands queue refreshes (DECISIONS J13).

## Not divergences

- `.env` is local and git-ignored. Development email capture (`docs/LOCAL_EMAIL.md`) exists
  only there.
