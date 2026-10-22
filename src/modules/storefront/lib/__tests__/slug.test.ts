import { describe, expect, it } from '@jest/globals'
import { RESERVED_SITE_SLUGS, SITE_SLUG_PATTERN, isValidSiteSlug, siteSlugCandidates, slugifySiteName } from '../slug'

const ORG_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

describe('TEST-003 site slugs', () => {
  it('slugifies names to lower-case ASCII', () => {
    expect(slugifySiteName('Café Délice & Co.')).toBe('cafe-delice-co')
    expect(slugifySiteName('  --Hello--World--  ')).toBe('hello-world')
    expect(slugifySiteName('🛍️🛍️')).toBe('')
    expect(slugifySiteName('x'.repeat(100)).length).toBeLessThanOrEqual(48)
  })

  it('never offers a reserved or invalid slug', () => {
    for (const reserved of RESERVED_SITE_SLUGS) {
      const candidates = siteSlugCandidates(reserved, ORG_ID)
      expect(candidates).not.toContain(reserved)
      for (const candidate of candidates) expect(SITE_SLUG_PATTERN.test(candidate)).toBe(true)
    }
  })

  it('suffixes deterministically and ends with the id-based fallback', () => {
    const candidates = siteSlugCandidates('Acme Store', ORG_ID, 4)
    expect(candidates.slice(0, 4)).toEqual(['acme-store', 'acme-store-2', 'acme-store-3', 'acme-store-4'])
    expect(candidates[candidates.length - 1]).toBe('store-9a8b7c6d')
  })

  it('falls back when the name yields nothing usable', () => {
    expect(siteSlugCandidates('🛍️', ORG_ID)).toEqual(['store-9a8b7c6d'])
  })

  it('keeps suffixed long slugs within the length limit', () => {
    for (const candidate of siteSlugCandidates('a'.repeat(60), ORG_ID)) {
      expect(candidate.length).toBeLessThanOrEqual(48)
      expect(isValidSiteSlug(candidate)).toBe(true)
    }
  })
})
