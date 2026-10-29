/**
 * Numbers typed on Arabic keyboards. Phones in Yemen often type Arabic-Indic
 * digits (٠١٢٣٤٥٦٧٨٩), Persian keyboards Extended Arabic-Indic ones
 * (۰۱۲۳۴۵۶۷۸۹), with `٫` as the decimal and `٬` as the thousands separator.
 * JavaScript's `\d`, `Number` and `parseInt` know only ASCII digits, so every
 * numeric input converts first. Client-safe and pure.
 */

const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0

/** The text with Arabic-Indic and Extended Arabic-Indic digits as ASCII, `٫` as `.` and `٬` removed. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
}

/** Only the ASCII digits of the text, after converting Arabic ones (quantity steppers). */
export function digitsOnly(text: string): string {
  return toLatinDigits(text).replace(/[^0-9]/g, '')
}
