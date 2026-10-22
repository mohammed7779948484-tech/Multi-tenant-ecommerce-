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

## 5. `tsconfig.json`

- **What:** one extra `include` entry (`.mercato/next/dev/dev/types/**/*.ts`) that `next dev`
  adds on every start.
- **On upgrade, review:** keep whatever `next dev` writes.

## 6. Harness title

- `AGENTS.md` and `.ai/specs/README.md` titles show `Multi-tenant-ecommerce-` because
  `agentic:init` derives the project name from the directory. Left as generated on purpose: a
  hand edit would mark the files user-modified and block future `--update-harness` refreshes.

## Not divergences

- `.env` is local and git-ignored. Development email capture (`docs/LOCAL_EMAIL.md`) exists
  only there.
