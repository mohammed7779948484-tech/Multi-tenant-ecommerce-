import { describe, expect, it, jest } from '@jest/globals'
import { buildDefaultHomeSpec } from '../blocks/defaultHome'

/** A published page without its live revision must never expose the working-copy title (fail closed). */

const resolveMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({ fork: () => ({}) }) }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: async () => ({ 'storefront.shop.navHome': 'الرئيسية' }),
}))
jest.mock('../shopNav', () => ({
  loadStorePageLinks: async () => [{ href: '/shop/faq', label: 'Questions' }],
}))
jest.mock('../catalogData', () => ({
  loadSectionData: async () => ({}),
  storeCatalogLinks: () => ({}),
}))
jest.mock('../publicSite', () => ({
  HOME_PAGE_SLUG: 'index',
  resolvePublicStorefrontPage: (...args: unknown[]) => resolveMock(...args),
  storefrontMediaPath: () => '/media',
  storefrontPublicUrl: (slug: string, path = '') => `http://localhost:3000/${slug}${path}`,
}))

import { loadStorefrontPage } from '../publicPageLoader'

const site = { id: 's1', slug: 'shop', name: 'Shop', tenantId: 't1', organizationId: 'o1', description: null, logoAttachmentId: null, defaultLocale: 'ar' }

function resolved(page: Record<string, unknown>, revision: Record<string, unknown> | null) {
  return { site, tokens: {}, organizationSlug: null, page: { siteId: 's1', ...page }, revision }
}

describe('public page loader', () => {
  it('serves the unavailable page when a published page has no revision pointer', async () => {
    resolveMock.mockResolvedValueOnce(
      resolved({ id: 'p1', slug: 'about', title: 'Unpublished working title', publishedSpec: buildDefaultHomeSpec({ storeName: 'Shop' }), publishedRevisionId: null }, null),
    )
    const loaded = await loadStorefrontPage('shop', 'about')
    expect(loaded.kind).toBe('unavailable')
    expect(JSON.stringify(loaded)).not.toContain('Unpublished working title')
  })

  it('uses the live revision title when the revision is present', async () => {
    resolveMock.mockResolvedValueOnce(
      resolved(
        { id: 'p2', slug: 'faq', title: 'Working title', publishedSpec: buildDefaultHomeSpec({ storeName: 'Shop' }), publishedRevisionId: 'r1' },
        { id: 'r1', title: 'Live title', seoDescription: null },
      ),
    )
    const loaded = await loadStorefrontPage('shop', 'faq')
    expect(loaded.kind).toBe('ok')
    if (loaded.kind === 'ok') expect(loaded.view.head.title).toBe('Live title')
  })

  it('builds the Arabic shell: home and categories links first, no shell footer when the page has its own Footer', async () => {
    resolveMock.mockResolvedValueOnce(
      resolved(
        { id: 'p3', slug: 'faq', title: 'Working title', publishedSpec: buildDefaultHomeSpec({ storeName: 'Shop' }), publishedRevisionId: 'r1' },
        { id: 'r1', title: 'Live title', seoDescription: null },
      ),
    )
    const loaded = await loadStorefrontPage('shop', 'faq')
    if (loaded.kind !== 'ok') throw new Error(`expected ok, got ${loaded.kind}`)
    expect(loaded.view.shell.locale).toBe('ar')
    expect(loaded.view.head.locale).toBe('ar')
    expect(loaded.view.shell.links).toEqual([
      { href: '/shop', label: 'الرئيسية' },
      { href: '/shop/collections', label: expect.any(String) },
      { href: '/shop/faq', label: 'Questions' },
    ])
    expect(loaded.view.shell.footer).toBe(false)
  })
})
