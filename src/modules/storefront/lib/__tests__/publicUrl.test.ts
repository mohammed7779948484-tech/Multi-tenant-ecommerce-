import { describe, expect, it, jest } from '@jest/globals'

// Only the URL helper is under test; the ORM-backed lookups in the same file are not loaded.
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization: class {}, Tenant: class {} }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: async () => null }))
jest.mock('../../data/entities', () => ({
  StorefrontPage: class {},
  StorefrontPageRevision: class {},
  StorefrontSite: class {},
  StorefrontTheme: class {},
}))

import { storefrontPublicUrl } from '../publicSite'

describe('storefrontPublicUrl', () => {
  it('builds canonical store URLs from APP_URL without a trailing slash', () => {
    expect(storefrontPublicUrl('atlas', '', { APP_URL: 'https://shops.example.com/', NODE_ENV: 'production' })).toBe('https://shops.example.com/atlas')
    expect(storefrontPublicUrl('atlas', '/about', { APP_URL: 'https://shops.example.com', NODE_ENV: 'production' })).toBe('https://shops.example.com/atlas/about')
  })

  it('fails closed in production when APP_URL is missing instead of publishing localhost canonicals', () => {
    expect(() => storefrontPublicUrl('atlas', '', { NODE_ENV: 'production' })).toThrow(/APP_URL/)
  })

  it('keeps the local default outside production', () => {
    expect(storefrontPublicUrl('atlas', '', { NODE_ENV: 'development' })).toBe('http://localhost:3000/atlas')
    expect(storefrontPublicUrl('atlas', '', { NODE_ENV: 'test' })).toBe('http://localhost:3000/atlas')
  })
})
