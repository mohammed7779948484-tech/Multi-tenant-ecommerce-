/**
 * JSON with object keys sorted, so two equal specs compare equal whatever their
 * key order (Postgres `jsonb` reorders keys; the inspector writes schema order).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current
    return Object.fromEntries(Object.entries(current as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  })
}
