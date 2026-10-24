import type { z } from 'zod'

export type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string

const MESSAGE_KEY_PREFIX = 'storefront.validation.'

/**
 * Turns Zod issues into `{ [dottedPath]: message }` for CrudForm. Validators
 * carry `storefront.validation.*` keys as messages so every error is localised;
 * anything else (an unknown key, a wrong type) gets a generic localised message
 * instead of Zod's English text. The first issue per path wins.
 */
export function zodIssuesToFieldErrors(issues: readonly z.core.$ZodIssue[], translate: Translate): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const path = [...issue.path, key].map(String).join('.')
        fieldErrors[path] ??= translate('storefront.validation.unknownField', 'This field is not allowed.')
      }
      continue
    }
    const path = issue.path.map(String).join('.') || '_form'
    if (fieldErrors[path]) continue
    fieldErrors[path] = issue.message.startsWith(MESSAGE_KEY_PREFIX)
      ? translate(issue.message, issue.message)
      : translate('storefront.validation.invalidValue', 'Enter a valid value.')
  }
  return fieldErrors
}
