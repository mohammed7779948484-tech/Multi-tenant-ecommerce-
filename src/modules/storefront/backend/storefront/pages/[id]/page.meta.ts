export const metadata = {
  requireAuth: true,
  requireFeatures: ['storefront.pages.manage'],
  pageTitle: 'Page settings',
  pageTitleKey: 'storefront.pages.settings.titleLoading',
  pageGroup: 'Storefront',
  pageGroupKey: 'storefront.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Storefront', labelKey: 'storefront.nav.group', href: '/backend/storefront' },
    { label: 'Pages', labelKey: 'storefront.nav.pages', href: '/backend/storefront/pages' },
    { label: 'Settings', labelKey: 'storefront.pages.actions.settings' },
  ],
}

export default metadata
