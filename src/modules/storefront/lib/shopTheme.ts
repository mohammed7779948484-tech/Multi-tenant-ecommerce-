import { buildThemeCssVariables, readThemeTokens, type ThemeRadius } from './theme'

/**
 * Theme bridge for buyer pages (shopping-journey spec, UI contracts → Theme bridge).
 *
 * The shared UI primitives (shadcn-based `@open-mercato/ui`) read semantic CSS
 * variables (`--primary`, `--background`, `--ring`, …) through Tailwind's
 * `@theme inline` block, so they resolve on the element that uses them. Setting
 * those variables from the merchant's validated tokens inside the store root
 * themes every control. Store pages also set them on `<body>` (selected with
 * `:has()`), so dialogs, sheets and popovers, which portal into `<body>`, wear
 * the same theme and direction. The builder preview carries no `.sf-shop` class,
 * so the admin page around it is never restyled.
 *
 * Every value is either a code constant or a `var(--sf-*)` reference to a token
 * that `buildThemeCssVariables` has already validated; no merchant text reaches
 * the stylesheet.
 */

// shadcn controls round with `rounded-md` (= --radius − 2px), so each value is the
// store's own radius + 2px. `full` stays a soft 1.25rem: cards and sheets also read
// --radius, and a 9999px value would turn them into circles.
const RADIUS_BRIDGE: Record<ThemeRadius, string> = {
  none: '0px',
  sm: '0.375rem',
  md: '0.625rem',
  lg: '1rem',
  full: '1.25rem',
}

const mix = (a: string, share: number, b: string) => `color-mix(in srgb,var(${a}) ${share}%,var(${b}))`

/** Semantic variables of the shared primitives, mapped onto the store's `--sf-*` tokens. */
export function shopBridgeDeclarations(radius: ThemeRadius): string[] {
  return [
    '--background:var(--sf-color-background)',
    '--foreground:var(--sf-color-text)',
    '--card:var(--sf-color-surface)',
    '--card-foreground:var(--sf-color-text)',
    '--popover:var(--sf-color-background)',
    '--popover-foreground:var(--sf-color-text)',
    '--primary:var(--sf-color-primary)',
    '--primary-foreground:var(--sf-color-on-primary)',
    `--primary-hover:${mix('--sf-color-primary', 85, '--sf-color-text')}`,
    '--secondary:var(--sf-color-surface)',
    '--secondary-foreground:var(--sf-color-text)',
    `--muted:${mix('--sf-color-surface', 70, '--sf-color-border')}`,
    '--muted-foreground:var(--sf-color-muted-text)',
    `--accent:${mix('--sf-color-primary', 10, '--sf-color-background')}`,
    '--accent-foreground:var(--sf-color-text)',
    '--border:var(--sf-color-border)',
    '--input:var(--sf-color-border)',
    '--ring:var(--sf-color-accent)',
    '--accent-indigo:var(--sf-color-primary)',
    '--accent-indigo-foreground:var(--sf-color-on-primary)',
    '--focus-ring-inner:var(--sf-color-background)',
    '--focus-ring-outer:color-mix(in srgb,var(--sf-color-accent) 45%,transparent)',
    `--bg-disabled:${mix('--sf-color-border', 50, '--sf-color-background')}`,
    `--text-disabled:${mix('--sf-color-muted-text', 70, '--sf-color-background')}`,
    '--border-disabled:var(--sf-color-border)',
    `--radius:${RADIUS_BRIDGE[radius]}`,
  ]
}

/**
 * Full theme stylesheet of a public store page: the `--sf-*` tokens plus the
 * bridge, on the store root and on `<body>` while that store is on the page.
 */
export function buildShopThemeCss(siteId: string, raw: unknown): string {
  const tokenRule = buildThemeCssVariables(siteId, raw)
  const id = siteId.toLowerCase()
  const declarations = tokenRule.slice(tokenRule.indexOf('{') + 1, -1)
  const bridge = shopBridgeDeclarations(readThemeTokens(raw).radius).join(';')
  const scope = `[data-sf-site="${id}"],body:has(.sf-shop[data-sf-site="${id}"])`
  const page = `body:has(.sf-shop[data-sf-site="${id}"]){direction:rtl;color-scheme:light;background:var(--sf-color-background);color:var(--sf-color-text);font-family:var(--sf-font-body)}`
  return `${scope}{${declarations};${bridge}}${page}`
}
