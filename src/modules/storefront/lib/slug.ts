/**
 * Site slugs are the platform-global public path segment (`/{siteSlug}`).
 * Static platform routes win over the dynamic storefront route by specificity,
 * so any slug equal to one of them would make the store unreachable: those
 * words are reserved. Keep this list in sync with top-level frontend routes
 * after framework upgrades (docs/UPSTREAM_DIVERGENCES.md).
 */
export const RESERVED_SITE_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'backend',
  'login',
  'logout',
  'reset',
  'onboarding',
  'terms',
  'privacy',
  'docs',
  'quote',
  'messages',
  'checkout-demo',
  'portal',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  'assets',
  'static',
  '_next',
  'admin',
  'storefront',
])

export const SITE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/
const MAX_SLUG_LENGTH = 48

export function isValidSiteSlug(value: string): boolean {
  return SITE_SLUG_PATTERN.test(value) && !RESERVED_SITE_SLUGS.has(value)
}

/** Lower-case ASCII slug from free text; may return '' when nothing usable remains. */
export function slugifySiteName(input: string): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  const dashed = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return dashed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '')
}

/** Fallback when a name or organization slug yields nothing usable. */
export function fallbackSiteSlug(organizationId: string): string {
  return `store-${organizationId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`
}

/**
 * Candidate slugs in priority order: the base, then `base-2`, `base-3`, …
 * (trimmed so the suffix still fits), ending with the id-based fallback.
 * The caller tries them against the database; the partial unique index is
 * the final arbiter under concurrency.
 */
export function siteSlugCandidates(base: string, organizationId: string, maxAttempts = 20): string[] {
  const root = slugifySiteName(base)
  const candidates: string[] = []
  if (root && isValidSiteSlug(root)) candidates.push(root)
  if (root) {
    for (let n = 2; candidates.length < maxAttempts && n <= maxAttempts + 1; n += 1) {
      const suffix = `-${n}`
      const trimmed = root.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')
      const candidate = `${trimmed}${suffix}`
      if (isValidSiteSlug(candidate)) candidates.push(candidate)
    }
  }
  candidates.push(fallbackSiteSlug(organizationId))
  return candidates
}

/** The home page's fixed slug; served at `/{siteSlug}` rather than `/{siteSlug}/index`. */
export const HOME_PAGE_SLUG_VALUE = 'index'

/**
 * Page slugs live under the store (`/{siteSlug}/{pageSlug}`). `portal` is
 * reserved because `/{orgSlug}/portal` wins by route specificity whenever a
 * site slug equals its organization slug (the seeded default); commerce words
 * are the shop's own routes (shopping-journey spec: search, collections,
 * products, cart, checkout, orders). `yarn mercato storefront reserved-slugs`
 * lists existing pages whose slug a later release reserved.
 */
export const RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set([
  HOME_PAGE_SLUG_VALUE,
  'portal',
  'api',
  'cart',
  'checkout',
  'orders',
  'account',
  'search',
  'products',
  'collections',
  'media',
  'assets',
  'sitemap.xml',
  'robots.txt',
])

export type PageSlugIssue = 'slugInvalid' | 'slugReserved'

/** Why a merchant-chosen page slug is unusable, or `null` when it is fine. Uniqueness is checked by the command. */
export function pageSlugIssue(value: string): PageSlugIssue | null {
  if (!SITE_SLUG_PATTERN.test(value)) return 'slugInvalid'
  if (RESERVED_PAGE_SLUGS.has(value)) return 'slugReserved'
  return null
}

/** Suggests a page slug from a title (the create form pre-fills it until edited). */
export function suggestPageSlug(title: string): string {
  const base = slugifySiteName(title)
  if (!base) return ''
  return RESERVED_PAGE_SLUGS.has(base) ? `${base}-page` : base
}
