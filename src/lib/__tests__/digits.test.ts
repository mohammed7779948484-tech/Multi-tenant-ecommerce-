import { describe, expect, it } from '@jest/globals'
import { digitsOnly, toLatinDigits } from '../digits'

describe('Arabic keyboard digits', () => {
  it('converts Arabic-Indic and Extended Arabic-Indic digits and separators to ASCII', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(toLatinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
    expect(toLatinDigits('١٬٢٥٠٫٥')).toBe('1250.5')
    expect(toLatinDigits('abc 12')).toBe('abc 12')
  })

  it('keeps only digits for a quantity, whatever the keyboard', () => {
    expect(digitsOnly('٣')).toBe('3')
    expect(digitsOnly('1٢x')).toBe('12')
    expect(digitsOnly('')).toBe('')
  })
})
