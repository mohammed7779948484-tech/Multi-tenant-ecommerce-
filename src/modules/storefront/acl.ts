export const features = [
  { id: 'storefront.view', title: 'View storefront', module: 'storefront' },
  {
    id: 'storefront.brand.manage',
    title: 'Manage storefront brand',
    module: 'storefront',
    dependsOn: ['storefront.view'],
  },
  {
    id: 'storefront.pages.manage',
    title: 'Create, edit and delete storefront pages',
    module: 'storefront',
    dependsOn: ['storefront.view'],
  },
  {
    id: 'storefront.pages.publish',
    title: 'Publish and roll back storefront pages',
    module: 'storefront',
    dependsOn: ['storefront.pages.manage'],
  },
]

export default features
