import { describe, expect, it } from '@jest/globals'
import { buildShopThemeCss, shopBridgeDeclarations } from '../shopTheme'
import { DEFAULT_THEME_TOKENS } from '../theme'
import en from '../../i18n/en.json'
import ar from '../../i18n/ar.json'

const SITE_ID = '3F2B2A52-6A5B-4F8A-9C11-2F3E4D5C6B7A'

describe('TEST-J01 theme bridge', () => {
  it('maps every shadcn semantic variable onto the store tokens or a code constant', () => {
    for (const declaration of shopBridgeDeclarations('md')) {
      const [name, value] = declaration.split(/:(.*)/s)
      expect(name).toMatch(/^--[a-z-]+$/)
      // Only references to validated --sf-* tokens, colour-mix of them, or fixed lengths.
      expect(value).toMatch(/^(var\(--sf-[a-z-]+\)|color-mix\(in srgb,var\(--sf-[a-z-]+\) \d+%,(var\(--sf-[a-z-]+\)|transparent)\)|\d+(\.\d+)?(px|rem))$/)
    }
    const names = shopBridgeDeclarations('md').map((declaration) => declaration.split(':')[0])
    for (const required of ['--background', '--foreground', '--primary', '--primary-foreground', '--border', '--input', '--ring', '--accent', '--muted-foreground', '--radius']) {
      expect(names).toContain(required)
    }
  })

  it('scopes the theme to one store root and to <body> only while that public store is shown', () => {
    const css = buildShopThemeCss(SITE_ID, { ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#123abc' } })
    const id = SITE_ID.toLowerCase()
    expect(css.startsWith(`[data-sf-site="${id}"],body:has(.sf-shop[data-sf-site="${id}"]){`)).toBe(true)
    expect(css).toContain('--sf-color-primary:#123abc')
    expect(css).toContain('--primary:var(--sf-color-primary)')
    expect(css).toContain(`body:has(.sf-shop[data-sf-site="${id}"]){direction:rtl;`)
    // No selector that could reach the admin page or another store.
    expect(css).not.toMatch(/(^|})\s*(:root|html|body)\s*\{/)
  })

  it('falls back to the default tokens for invalid input instead of emitting it', () => {
    const css = buildShopThemeCss(SITE_ID, { colors: { primary: 'red;}body{display:none' } })
    expect(css).not.toContain('display:none')
    expect(css).toContain(`--sf-color-primary:${DEFAULT_THEME_TOKENS.colors.primary}`)
  })
})

describe('TEST-J01 Arabic dictionary completeness', () => {
  const english = en as Record<string, string>
  const arabic = ar as Record<string, string>
  const buyerKeys = Object.keys(english).filter((key) => key.startsWith('storefront.public.') || key.startsWith('storefront.shop.'))
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

  it('has an Arabic value for every buyer-facing key', () => {
    expect(buyerKeys.length).toBeGreaterThan(0)
    for (const key of buyerKeys) {
      expect(typeof arabic[key]).toBe('string')
      expect(arabic[key].trim()).not.toBe('')
      expect(arabic[key]).toMatch(/[؀-ۿ]/)
    }
  })

  it('keeps the same placeholders as English', () => {
    for (const key of buyerKeys) expect(placeholders(arabic[key])).toEqual(placeholders(english[key]))
  })

  it('carries no keys that English lacks', () => {
    for (const key of Object.keys(arabic)) expect(english[key]).toBeDefined()
  })
})
