import { describe, expect, it } from '@jest/globals'
import { matchVariant, readOptionDefinitions, stablePersonalization, validatePersonalization } from '../productOptions'
import { cartCookieName, hashCartToken, newCartToken } from '../shopCart'

const SCHEMA = {
  options: [
    { code: 'size', label: 'الحجم', inputType: 'select', choices: [{ code: 'small', label: 'صغير' }, { code: 'large', label: 'كبير' }] },
    { code: 'wrap', label: 'لون التغليف', inputType: 'select', choices: [{ code: 'gold', label: 'ذهبي' }, { code: 'green' }] },
    { code: 'recipient', label: 'اسم المهدى إليه', inputType: 'text', isRequired: true },
    { code: 'message', label: 'رسالة', inputType: 'textarea' },
    { code: 'count', label: 'العدد', inputType: 'number' },
    { code: 'bad code!', label: 'x', inputType: 'text' },
    { code: 'empty', label: 'بلا خيارات', inputType: 'select', choices: [] },
    'not an option',
  ],
}

describe('TEST-J04 option schema: axes and personalization', () => {
  it('reads select options as axes and text/textarea/number as fields; malformed entries are skipped', () => {
    const { axes, fields } = readOptionDefinitions(SCHEMA)
    expect(axes.map((axis) => axis.code)).toEqual(['size', 'wrap'])
    expect(axes[1]!.choices).toEqual([{ code: 'gold', label: 'ذهبي' }, { code: 'green', label: 'green' }])
    expect(fields).toEqual([
      { code: 'recipient', label: 'اسم المهدى إليه', inputType: 'text', required: true, maxLength: 200 },
      { code: 'message', label: 'رسالة', inputType: 'textarea', required: false, maxLength: 1000 },
      { code: 'count', label: 'العدد', inputType: 'number', required: false, maxLength: 32 },
    ])
    expect(readOptionDefinitions(null)).toEqual({ axes: [], fields: [] })
  })

  it('matches the variant whose values equal every chosen axis; incomplete or unmade picks match nothing', () => {
    const { axes } = readOptionDefinitions(SCHEMA)
    const variants = [
      { id: 'v1', name: 'صغير ذهبي', values: { size: 'small', wrap: 'gold' } },
      { id: 'v2', name: 'كبير ذهبي', values: { size: 'large', wrap: 'gold' } },
    ]
    expect(matchVariant(axes, variants, { size: 'large', wrap: 'gold' })?.id).toBe('v2')
    expect(matchVariant(axes, variants, { size: 'large', wrap: 'green' })).toBeNull()
    expect(matchVariant(axes, variants, { size: 'large' })).toBeNull()
  })

  it('validates personalization: required, too long, numbers, unknown codes; trims and drops empty optionals', () => {
    const { fields } = readOptionDefinitions(SCHEMA)
    expect(validatePersonalization(fields, { recipient: '  أحمد ', message: '   ', count: 3 })).toEqual({ ok: true, value: { recipient: 'أحمد', count: '3' } })
    expect(validatePersonalization(fields, {})).toEqual({ ok: false, errors: { recipient: 'required' } })
    expect(validatePersonalization(fields, { recipient: 'x'.repeat(201) })).toEqual({ ok: false, errors: { recipient: 'tooLong' } })
    expect(validatePersonalization(fields, { recipient: 'a', count: 'ten' })).toEqual({ ok: false, errors: { count: 'notNumber' } })
    expect(validatePersonalization(fields, { recipient: 'a', price: '1' })).toEqual({ ok: false, errors: { price: 'unknown' } })
  })

  it('identifies a line by its personalization regardless of key order', () => {
    expect(stablePersonalization({ b: '2', a: '1' })).toBe(stablePersonalization({ a: '1', b: '2' }))
    expect(stablePersonalization({ a: '1' })).not.toBe(stablePersonalization({ a: '2' }))
  })
})

describe('TEST-J05 cart token', () => {
  it('is a 256-bit random value; only its SHA-256 is stored; the cookie is per store', () => {
    const one = newCartToken()
    const two = newCartToken()
    expect(one.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(one.token).not.toBe(two.token)
    expect(one.hash).toBe(hashCartToken(one.token))
    expect(one.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(cartCookieName('3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a')).toBe('sf_cart_3f2b2a526a5b')
    expect(cartCookieName('3f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a')).not.toBe(cartCookieName('4f2b2a52-6a5b-4f8a-9c11-2f3e4d5c6b7a'))
  })
})

describe('personalization numbers typed with Arabic digits', () => {
  const { fields } = readOptionDefinitions(SCHEMA)

  it('accepts Arabic-Indic digits and stores them as ASCII, so the same number is the same line', () => {
    const arabic = validatePersonalization(fields, { recipient: 'سارة', count: '١٢٫٥' })
    expect(arabic).toEqual({ ok: true, value: { recipient: 'سارة', count: '12.5' } })
    const latin = validatePersonalization(fields, { recipient: 'سارة', count: '12.5' })
    expect(stablePersonalization((arabic as { value: Record<string, string> }).value)).toBe(stablePersonalization((latin as { value: Record<string, string> }).value))
  })

  it('still refuses text in a number field', () => {
    expect(validatePersonalization(fields, { recipient: 'سارة', count: 'عشرة' })).toEqual({ ok: false, errors: { count: 'notNumber' } })
  })
})
