/**
 * Buyer pages read right to left (shopping-journey spec REQ-001). Kept apart
 * from `shopLocale.ts`, which loads dictionaries on the server only, because
 * the store frame also renders inside the client-side builder preview.
 */
export const SHOP_DIRECTION = 'rtl' as const
