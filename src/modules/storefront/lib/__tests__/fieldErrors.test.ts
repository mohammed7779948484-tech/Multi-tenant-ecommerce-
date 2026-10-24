import { describe, expect, it } from '@jest/globals'
import { brandUpdateSchema } from '../../data/validators'
import { DEFAULT_THEME_TOKENS } from '../theme'
import { zodIssuesToFieldErrors } from '../fieldErrors'
import { isStorefrontLogoMimeType } from '../media'

const translate = (key: string) => `t:${key}`

describe('zodIssuesToFieldErrors', () => {
  it('keys errors by dotted path and localises validator message keys', () => {
    const parsed = brandUpdateSchema.safeParse({
      name: '',
      tokens: { ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: 'red' } },
    })
    expect(parsed.success).toBe(false)
    const errors = zodIssuesToFieldErrors(parsed.success ? [] : parsed.error.issues, translate)
    expect(errors).toMatchObject({
      name: 't:storefront.validation.nameRequired',
      'tokens.colors.primary': 't:storefront.validation.hexColor',
    })
  })

  it('reports unknown keys (scope smuggling, raw CSS) as not allowed', () => {
    const parsed = brandUpdateSchema.safeParse({
      name: 'Store',
      tokens: DEFAULT_THEME_TOKENS,
      tenantId: '00000000-0000-0000-0000-000000000000',
      css: 'body{}',
    })
    const errors = zodIssuesToFieldErrors(parsed.success ? [] : parsed.error.issues, translate)
    expect(errors).toEqual({ tenantId: 't:storefront.validation.unknownField', css: 't:storefront.validation.unknownField' })
  })

  it('falls back to a generic localised message for type errors', () => {
    const parsed = brandUpdateSchema.safeParse({ name: 'Store', tokens: { ...DEFAULT_THEME_TOKENS, radius: 'huge' } })
    const errors = zodIssuesToFieldErrors(parsed.success ? [] : parsed.error.issues, translate)
    expect(errors['tokens.radius']).toBe('t:storefront.validation.invalidValue')
  })
})

describe('isStorefrontLogoMimeType', () => {
  it('allows raster images only', () => {
    expect(isStorefrontLogoMimeType('image/png')).toBe(true)
    expect(isStorefrontLogoMimeType(' IMAGE/JPEG ')).toBe(true)
    expect(isStorefrontLogoMimeType('image/svg+xml')).toBe(false)
    expect(isStorefrontLogoMimeType('text/html')).toBe(false)
    expect(isStorefrontLogoMimeType(null)).toBe(false)
  })
})
