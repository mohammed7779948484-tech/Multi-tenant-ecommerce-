export const metadata = {
  requireAuth: true,
  requireFeatures: ['storefront.view'],
  pageTitle: 'Page builder',
  pageTitleKey: 'storefront.builder.title',
  pageGroup: 'Storefront',
  pageGroupKey: 'storefront.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Storefront', labelKey: 'storefront.nav.group', href: '/backend/storefront' },
    { label: 'Pages', labelKey: 'storefront.nav.pages', href: '/backend/storefront/pages' },
    { label: 'Builder', labelKey: 'storefront.builder.breadcrumb' },
  ],
}

export default metadata
