export const metadata = {
  requireAuth: true,
  requireFeatures: ['storefront.brand.manage'],
  pageTitle: 'Brand',
  pageTitleKey: 'storefront.nav.brand',
  pageGroup: 'Storefront',
  pageGroupKey: 'storefront.nav.group',
  pageOrder: 110,
  navHidden: true,
  breadcrumb: [
    { label: 'Storefront', labelKey: 'storefront.nav.group', href: '/backend/storefront' },
    { label: 'Brand', labelKey: 'storefront.nav.brand' },
  ],
}

export default metadata
