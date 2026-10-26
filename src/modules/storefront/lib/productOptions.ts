/**
 * How a buyer configures a product (shopping-journey spec, Domain Vocabulary):
 * the option schema's `select` options are variant axes, its `text`, `textarea`
 * and `number` options are personalization fields. Pure and client-safe: the
 * product page validates as the buyer types, the cart service validates again
 * on the server with the same rules.
 */

export type PurchaseAxis = { code: string; label: string; choices: Array<{ code: string; label: string }> }

export type PersonalizationField = {
  code: string
  label: string
  inputType: 'text' | 'textarea' | 'number'
  required: boolean
  /** Characters allowed (text 200, textarea 1,000, number 32). */
  maxLength: number
}

export type PurchaseVariantRef = { id: string; name: string; values: Record<string, string> }

export type PersonalizationError = 'required' | 'tooLong' | 'notNumber' | 'unknown'

const MAX_LENGTH: Record<PersonalizationField['inputType'], number> = { text: 200, textarea: 1000, number: 32 }
const CODE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Axes and personalization fields of an option schema; anything malformed is skipped, never trusted. */
export function readOptionDefinitions(schema: unknown): { axes: PurchaseAxis[]; fields: PersonalizationField[] } {
  const options = asRecord(schema)?.options
  const axes: PurchaseAxis[] = []
  const fields: PersonalizationField[] = []
  if (!Array.isArray(options)) return { axes, fields }
  for (const raw of options) {
    const option = asRecord(raw)
    const code = typeof option?.code === 'string' ? option.code : ''
    if (!option || !CODE.test(code)) continue
    const label = typeof option.label === 'string' && option.label.trim() ? option.label.trim() : code
    if (option.inputType === 'select') {
      const choices = (Array.isArray(option.choices) ? option.choices : [])
        .map((choice) => asRecord(choice))
        .filter((choice): choice is Record<string, unknown> => Boolean(choice && typeof choice.code === 'string' && CODE.test(choice.code)))
        .map((choice) => ({ code: choice.code as string, label: typeof choice.label === 'string' && choice.label.trim() ? choice.label.trim() : (choice.code as string) }))
      if (choices.length) axes.push({ code, label, choices })
    } else if (option.inputType === 'text' || option.inputType === 'textarea' || option.inputType === 'number') {
      fields.push({ code, label, inputType: option.inputType, required: option.isRequired === true, maxLength: MAX_LENGTH[option.inputType] })
    }
  }
  return { axes, fields }
}

/** The variant whose option values equal the chosen choice for every axis, or `null`. */
export function matchVariant<T extends PurchaseVariantRef>(axes: PurchaseAxis[], variants: T[], selection: Record<string, string>): T | null {
  if (axes.some((axis) => !selection[axis.code])) return null
  return variants.find((variant) => axes.every((axis) => variant.values[axis.code] === selection[axis.code])) ?? null
}

/**
 * Trimmed personalization values, or a field error per code. Unknown codes are
 * refused; empty optional values are dropped; numbers must be finite.
 */
export function validatePersonalization(
  fields: PersonalizationField[],
  input: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; errors: Record<string, PersonalizationError> } {
  const raw = asRecord(input) ?? {}
  const errors: Record<string, PersonalizationError> = {}
  const value: Record<string, string> = {}
  const known = new Map(fields.map((field) => [field.code, field]))
  for (const key of Object.keys(raw)) if (!known.has(key)) errors[key] = 'unknown'
  for (const field of fields) {
    const given = raw[field.code]
    const text = typeof given === 'string' ? given.trim() : typeof given === 'number' ? String(given) : ''
    if (!text) {
      if (field.required) errors[field.code] = 'required'
      continue
    }
    if (text.length > field.maxLength) errors[field.code] = 'tooLong'
    else if (field.inputType === 'number' && !Number.isFinite(Number(text))) errors[field.code] = 'notNumber'
    else value[field.code] = text
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value }
}

/** Personalization in a stable order: the identity of a cart line (with product and variant). */
export function stablePersonalization(value: Record<string, string>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]))
}
