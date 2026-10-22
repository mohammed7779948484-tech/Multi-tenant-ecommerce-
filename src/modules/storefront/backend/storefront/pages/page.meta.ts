export const metadata = {
  requireAuth: true,
  requireFeatures: ['storefront.view'],
  pageTitle: 'Pages',
  pageTitleKey: 'storefront.nav.pages',
  pageGroup: 'Storefront',
  pageGroupKey: 'storefront.nav.group',
  pageOrder: 120,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Storefront', labelKey: 'storefront.nav.group', href: '/backend/storefront' },
    { label: 'Pages', labelKey: 'storefront.nav.pages' },
  ],
}

export default metadata
