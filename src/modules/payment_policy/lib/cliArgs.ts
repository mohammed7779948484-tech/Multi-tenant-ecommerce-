import { parseArgs } from 'node:util'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TenantArgs = { ok: true; tenantId: string | null } | { ok: false; error: string }

/**
 * Parses `[--tenant <uuid>]` with Node's built-in `util.parseArgs` (strict).
 * A `--tenant` without a value, a value that looks like another flag, an
 * unknown flag or a stray argument is an error — never "every tenant".
 */
export function parseTenantArgs(argv: string[]): TenantArgs {
  let tenant: string | undefined
  try {
    tenant = parseArgs({ args: argv, options: { tenant: { type: 'string' } }, strict: true, allowPositionals: false }).values.tenant
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0]! : String(err) }
  }
  if (tenant === undefined) return { ok: true, tenantId: null }
  if (!UUID_PATTERN.test(tenant)) return { ok: false, error: '--tenant must be a UUID' }
  return { ok: true, tenantId: tenant }
}
