import { describe, expect, it } from '@jest/globals'
import { parseTenantArgs } from '../cliArgs'

const TENANT = '11111111-1111-4111-8111-111111111111'

describe('parseTenantArgs', () => {
  it('runs on every tenant only when --tenant is absent', () => {
    expect(parseTenantArgs([])).toEqual({ ok: true, tenantId: null })
  })

  it('accepts a UUID in both flag forms', () => {
    expect(parseTenantArgs(['--tenant', TENANT])).toEqual({ ok: true, tenantId: TENANT })
    expect(parseTenantArgs([`--tenant=${TENANT}`])).toEqual({ ok: true, tenantId: TENANT })
  })

  it('rejects --tenant without a value instead of widening to every tenant', () => {
    expect(parseTenantArgs(['--tenant']).ok).toBe(false)
    expect(parseTenantArgs(['--tenant=']).ok).toBe(false)
  })

  it('rejects a following flag consumed as the value, unknown flags and stray arguments', () => {
    expect(parseTenantArgs(['--tenant', '--verbose']).ok).toBe(false)
    expect(parseTenantArgs(['--verbose']).ok).toBe(false)
    expect(parseTenantArgs([TENANT]).ok).toBe(false)
    expect(parseTenantArgs(['--tenant', 'not-a-uuid'])).toEqual({ ok: false, error: '--tenant must be a UUID' })
  })
})
