import { z } from 'zod'

/**
 * Theme tokens v1. The only way a merchant styles a storefront: eight HEX
 * colours, a font pair from a closed list, a radius and a density. Every value
 * is validated before it reaches CSS; nothing merchant-typed is ever emitted as
 * a selector, property name, class name or raw declaration.
 */

export const COLOR_TOKEN_KEYS = [
  'background',
  'surface',
  'text',
  'mutedText',
  'primary',
  'onPrimary',
  'accent',
  'border',
] as const
export type ColorTokenKey = (typeof COLOR_TOKEN_KEYS)[number]

/** Curated system font stacks: nothing is fetched from any third party. */
export const FONT_STACKS = {
  'system-sans': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'humanist-sans': '"Segoe UI", "Gill Sans", "Gill Sans MT", Calibri, "Trebuchet MS", sans-serif',
  'geometric-sans': 'Avenir, "Avenir Next", Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif',
  'classic-serif': 'Georgia, Cambria, "Times New Roman", Times, serif',
  'modern-serif': '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
} as const
export const FONT_STACK_IDS = Object.keys(FONT_STACKS) as [keyof typeof FONT_STACKS, ...Array<keyof typeof FONT_STACKS>]
export type FontStackId = keyof typeof FONT_STACKS

export const RADIUS_VALUES = ['none', 'sm', 'md', 'lg', 'full'] as const
export const DENSITY_VALUES = ['compact', 'comfortable', 'spacious'] as const
export type ThemeRadius = (typeof RADIUS_VALUES)[number]
export type ThemeDensity = (typeof DENSITY_VALUES)[number]

const RADIUS_CSS: Record<ThemeRadius, string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  full: '9999px',
}
const DENSITY_CSS: Record<ThemeDensity, string> = {
  compact: '0.75rem',
  comfortable: '1rem',
  spacious: '1.375rem',
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_PATTERN, 'storefront.validation.hexColor')
  .transform((value) => value.toLowerCase())

const colorsSchema = z
  .object({
    background: hexColorSchema,
    surface: hexColorSchema,
    text: hexColorSchema,
    mutedText: hexColorSchema,
    primary: hexColorSchema,
    onPrimary: hexColorSchema,
    accent: hexColorSchema,
    border: hexColorSchema,
  })
  .strict()

export const MIN_CONTRAST = 3
export const RECOMMENDED_CONTRAST = 4.5

export const themeTokensSchema = z
  .object({
    version: z.literal(1),
    colors: colorsSchema,
    fonts: z.object({ heading: z.enum(FONT_STACK_IDS), body: z.enum(FONT_STACK_IDS) }).strict(),
    radius: z.enum(RADIUS_VALUES),
    density: z.enum(DENSITY_VALUES),
  })
  .strict()
  .superRefine((tokens, ctx) => {
    const pairs: Array<[ColorTokenKey, ColorTokenKey]> = [
      ['text', 'background'],
      ['onPrimary', 'primary'],
    ]
    for (const [fg, bg] of pairs) {
      // Refinements also run when a colour already failed its own check; a pair
      // with an invalid member is reported once, by that colour, not as contrast.
      if (!HEX_PATTERN.test(String(tokens.colors?.[fg])) || !HEX_PATTERN.test(String(tokens.colors?.[bg]))) continue
      if (contrastRatio(tokens.colors[fg], tokens.colors[bg]) < MIN_CONTRAST) {
        ctx.addIssue({
          code: 'custom',
          path: ['colors', fg],
          message: 'storefront.validation.contrastTooLow',
        })
      }
    }
  })

export type ThemeTokens = z.infer<typeof themeTokensSchema>

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  version: 1,
  colors: {
    background: '#ffffff',
    surface: '#f6f6f4',
    text: '#1d1d1b',
    mutedText: '#5f5f5a',
    primary: '#1f4e79',
    onPrimary: '#ffffff',
    accent: '#c8902d',
    border: '#e2e2dc',
  },
  fonts: { heading: 'geometric-sans', body: 'system-sans' },
  radius: 'md',
  density: 'comfortable',
}

/** Ready-made palettes offered by the brand wizard (all pass the contrast floor). */
export const THEME_PRESETS: Record<string, ThemeTokens['colors']> = {
  classic: DEFAULT_THEME_TOKENS.colors,
  midnight: {
    background: '#0f1420',
    surface: '#1a2233',
    text: '#f2f4f8',
    mutedText: '#a9b3c4',
    primary: '#e2b23c',
    onPrimary: '#14110a',
    accent: '#5cc8c2',
    border: '#2c374c',
  },
  desert: {
    background: '#fbf6ee',
    surface: '#f2e6d3',
    text: '#3b2a1a',
    mutedText: '#7a6248',
    primary: '#b4532a',
    onPrimary: '#ffffff',
    accent: '#3f7d6e',
    border: '#e3d2b8',
  },
  forest: {
    background: '#f4f7f2',
    surface: '#e6eee1',
    text: '#17261b',
    mutedText: '#4f6353',
    primary: '#2e6b3c',
    onPrimary: '#ffffff',
    accent: '#c26a2e',
    border: '#cfdcc9',
  },
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  if (!HEX_PATTERN.test(a) || !HEX_PATTERN.test(b)) return 1
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Parses stored tokens. A row that no longer validates (for example after a
 * schema change) falls back to defaults field by field, so a page can still
 * render with a readable theme; the wizard surfaces the stored values with
 * field errors for the merchant to fix.
 */
export function readThemeTokens(raw: unknown): ThemeTokens {
  const parsed = themeTokensSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const colorsRaw = (source.colors && typeof source.colors === 'object' ? source.colors : {}) as Record<string, unknown>
  const colors = { ...DEFAULT_THEME_TOKENS.colors }
  for (const key of COLOR_TOKEN_KEYS) {
    const candidate = hexColorSchema.safeParse(colorsRaw[key])
    if (candidate.success) colors[key] = candidate.data
  }
  const fontsRaw = (source.fonts && typeof source.fonts === 'object' ? source.fonts : {}) as Record<string, unknown>
  const heading = z.enum(FONT_STACK_IDS).safeParse(fontsRaw.heading)
  const body = z.enum(FONT_STACK_IDS).safeParse(fontsRaw.body)
  const radius = z.enum(RADIUS_VALUES).safeParse(source.radius)
  const density = z.enum(DENSITY_VALUES).safeParse(source.density)
  const merged: ThemeTokens = {
    version: 1,
    colors,
    fonts: {
      heading: heading.success ? heading.data : DEFAULT_THEME_TOKENS.fonts.heading,
      body: body.success ? body.data : DEFAULT_THEME_TOKENS.fonts.body,
    },
    radius: radius.success ? radius.data : DEFAULT_THEME_TOKENS.radius,
    density: density.success ? density.data : DEFAULT_THEME_TOKENS.density,
  }
  return themeTokensSchema.safeParse(merged).success ? merged : DEFAULT_THEME_TOKENS
}

const CSS_VAR_NAMES: Record<ColorTokenKey, string> = {
  background: '--sf-color-background',
  surface: '--sf-color-surface',
  text: '--sf-color-text',
  mutedText: '--sf-color-muted-text',
  primary: '--sf-color-primary',
  onPrimary: '--sf-color-on-primary',
  accent: '--sf-color-accent',
  border: '--sf-color-border',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Builds the scoped custom-property block for one site. Property names are code
 * constants; values come only from a re-validated token set (HEX regex, enums
 * mapped to fixed CSS strings), so no merchant text can reach the stylesheet.
 */
export function buildThemeCssVariables(siteId: string, raw: unknown): string {
  if (!UUID_PATTERN.test(siteId)) throw new Error('[internal] storefront theme scope id must be a UUID')
  const tokens = themeTokensSchema.parse(readThemeTokens(raw))
  const declarations: string[] = []
  for (const key of COLOR_TOKEN_KEYS) {
    declarations.push(`${CSS_VAR_NAMES[key]}:${tokens.colors[key]}`)
  }
  declarations.push(`--sf-font-heading:${FONT_STACKS[tokens.fonts.heading]}`)
  declarations.push(`--sf-font-body:${FONT_STACKS[tokens.fonts.body]}`)
  declarations.push(`--sf-radius:${RADIUS_CSS[tokens.radius]}`)
  declarations.push(`--sf-space:${DENSITY_CSS[tokens.density]}`)
  return `[data-sf-site="${siteId.toLowerCase()}"]{${declarations.join(';')}}`
}
