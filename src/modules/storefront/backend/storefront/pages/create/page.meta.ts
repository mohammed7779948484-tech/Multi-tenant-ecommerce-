export const metadata = {
  requireAuth: true,
  requireFeatures: ['storefront.pages.manage'],
  pageTitle: 'New page',
  pageTitleKey: 'storefront.pages.create.title',
  pageGroup: 'Storefront',
  pageGroupKey: 'storefront.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Storefront', labelKey: 'storefront.nav.group', href: '/backend/storefront' },
    { label: 'Pages', labelKey: 'storefront.nav.pages', href: '/backend/storefront/pages' },
    { label: 'New page', labelKey: 'storefront.pages.create.title' },
  ],
}

export default metadata
