export const features = [
  { id: 'storefront.view', title: 'View storefront', module: 'storefront' },
  {
    id: 'storefront.brand.manage',
    title: 'Manage storefront brand',
    module: 'storefront',
    dependsOn: ['storefront.view'],
  },
]

export default features
