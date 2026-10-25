import { describe, expect, it } from '@jest/globals'
import {
  DEFAULT_THEME_TOKENS,
  THEME_PRESETS,
  buildThemeCssVariables,
  contrastRatio,
  readThemeTokens,
  themeTokensSchema,
} from '../theme'

const SITE_ID = '3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a'

function withColors(colors: Partial<typeof DEFAULT_THEME_TOKENS.colors>) {
  return { ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, ...colors } }
}

describe('TEST-002 theme tokens', () => {
  it('accepts the defaults and every preset', () => {
    expect(themeTokensSchema.safeParse(DEFAULT_THEME_TOKENS).success).toBe(true)
    for (const colors of Object.values(THEME_PRESETS)) {
      expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME_TOKENS, colors }).success).toBe(true)
    }
  })

  it('normalises upper-case HEX to lower case', () => {
    const parsed = themeTokensSchema.parse(withColors({ accent: '#AABBCC' }))
    expect(parsed.colors.accent).toBe('#aabbcc')
  })

  it.each(['red', '#fff', '#12345g', 'url(javascript:alert(1))', '#123456;}body{display:none', ''])(
    'rejects colour value %p with a field path',
    (value) => {
      const result = themeTokensSchema.safeParse(withColors({ primary: value }))
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['colors', 'primary'])
    },
  )

  it('rejects unknown fonts, radius, density and extra keys', () => {
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME_TOKENS, fonts: { heading: 'Comic Sans', body: 'system-sans' } }).success).toBe(false)
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME_TOKENS, radius: 'xl' }).success).toBe(false)
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME_TOKENS, density: 'cosy' }).success).toBe(false)
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME_TOKENS, css: 'body{}' }).success).toBe(false)
    expect(
      themeTokensSchema.safeParse({ ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, extra: '#000000' } }).success,
    ).toBe(false)
  })

  it('enforces the 3:1 contrast floor for text/background and onPrimary/primary', () => {
    const lowText = themeTokensSchema.safeParse(withColors({ text: '#eeeeee', background: '#ffffff' }))
    expect(lowText.success).toBe(false)
    if (!lowText.success) expect(lowText.error.issues[0]?.path).toEqual(['colors', 'text'])
    const lowButton = themeTokensSchema.safeParse(withColors({ primary: '#ffff00', onPrimary: '#ffffff' }))
    expect(lowButton.success).toBe(false)
    if (!lowButton.success) expect(lowButton.error.issues[0]?.path).toEqual(['colors', 'onPrimary'])
  })

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('falls back field by field when stored tokens no longer validate', () => {
    const tokens = readThemeTokens({ version: 1, colors: { primary: '#123456', text: 'nope' }, radius: 'lg' })
    expect(tokens.colors.primary).toBe('#123456')
    expect(tokens.colors.text).toBe(DEFAULT_THEME_TOKENS.colors.text)
    expect(tokens.radius).toBe('lg')
    expect(readThemeTokens('garbage')).toEqual(DEFAULT_THEME_TOKENS)
  })
})

describe('TEST-004 theme CSS emission', () => {
  it('emits only --sf-* declarations scoped to the site', () => {
    const css = buildThemeCssVariables(SITE_ID, withColors({ primary: '#AA0000' }))
    expect(css.startsWith(`[data-sf-site="${SITE_ID}"]{`)).toBe(true)
    expect(css).toContain('--sf-color-primary:#aa0000')
    const declarations = css.slice(css.indexOf('{') + 1, -1).split(';')
    for (const declaration of declarations) expect(declaration.startsWith('--sf-')).toBe(true)
    expect(css).not.toMatch(/<|>|url\(|expression|@import/i)
  })

  it('refuses a scope id that is not a UUID', () => {
    expect(() => buildThemeCssVariables('"]{}body{', DEFAULT_THEME_TOKENS)).toThrow()
  })
})

describe('contrast refinement with an invalid colour', () => {
  it('reports only the invalid colour, not a contrast error on its pair', () => {
    const parsed = themeTokensSchema.safeParse({
      ...DEFAULT_THEME_TOKENS,
      colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#12' },
    })
    expect(parsed.success).toBe(false)
    const paths = parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`)
    expect(paths).toEqual(['colors.primary:storefront.validation.hexColor'])
  })
})
