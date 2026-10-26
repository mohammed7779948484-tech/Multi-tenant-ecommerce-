# Third-party notices

## json-render agent skills

The following agent skills are vendored from
[vercel-labs/json-render](https://github.com/vercel-labs/json-render) at commit
`72568f990e5502c4d3115691facb8ca928a5c9fc`, directory `skills/`:

| Vendored path | Upstream path |
|---|---|
| `.agents/skills/json-render-core/SKILL.md` | `skills/core/SKILL.md` |
| `.agents/skills/json-render-react/SKILL.md` | `skills/react/SKILL.md` |
| `.agents/skills/json-render-next/SKILL.md` | `skills/next/SKILL.md` |
| `.agents/skills/json-render-shadcn/SKILL.md` | `skills/shadcn/SKILL.md` |
| `.agents/skills/json-render-directives/SKILL.md` | `skills/directives/SKILL.md` |

Licensed under the Apache License, Version 2.0 — full text in
[`third_party/licenses/json-render-LICENSE.txt`](third_party/licenses/json-render-LICENSE.txt).

Changes made to each file: the frontmatter `name` was namespaced
(`core` → `json-render-core`, and so on) and a one-line HTML comment stating the
source and that change was added below the frontmatter. The skill bodies are
otherwise unmodified.

## ecomcn storefront blocks

The following files were installed with the shadcn CLI from the ecomcn registry
(`@ecomcn` in `components.json`, `https://ecomcn.vercel.app/r/{name}.json`;
source [its-Inbarajan/ecomcn](https://github.com/its-Inbarajan/ecomcn)) on
2026-10-25 and 2026-10-26:

| Vendored path | Registry item |
|---|---|
| `src/components/ecomcn/cart-line-item.tsx` | `cart-line-item` |
| `src/components/ecomcn/cart-sheet.tsx` | `cart-sheet` |
| `src/components/ecomcn/category-rail.tsx` | `category-rail` |
| `src/components/ecomcn/empty-results.tsx` | `empty-results` |
| `src/components/ecomcn/filter-panel.tsx` | `filter-panel` |
| `src/components/ecomcn/filter-sheet.tsx` | `filter-sheet` |
| `src/components/ecomcn/price-tag.tsx` | `price-tag` |
| `src/components/ecomcn/product-buy-box.tsx` | `product-buy-box` |
| `src/components/ecomcn/product-card.tsx` | `product-card` |
| `src/components/ecomcn/product-gallery.tsx` | `product-gallery` |
| `src/components/ecomcn/product-grid.tsx` | `product-grid` |
| `src/components/ecomcn/sort-toolbar.tsx` | `sort-toolbar` |
| `src/components/ecomcn/variant-swatches.tsx` | `variant-swatches` |
| `src/components/ecomcn/address-form.tsx` | `address-form` |
| `src/lib/address-format.ts` | `address-form` |
| `src/components/ecomcn/checkout-stepper.tsx` | `checkout-stepper` |
| `src/components/ecomcn/delivery-options.tsx` | `delivery-options` |
| `src/components/ecomcn/payment-selector.tsx` | `payment-selector` |
| `src/components/ecomcn/order-confirmation.tsx` | `order-confirmation` |
| `src/hooks/use-filter-params.ts` | `filter-panel` |
| `src/lib/filter-params.ts` | `filter-panel` |

Copyright (c) 2026 ecomcn contributors. Licensed under the MIT License — full
text in [`third_party/licenses/ecomcn-LICENSE.txt`](third_party/licenses/ecomcn-LICENSE.txt).

Changes made: user-facing strings go through the app's translation hook
(`useT`, keys `ecomcn.*`) with Arabic dictionaries; layouts use logical
(right-to-left safe) properties; prices arrive formatted by the server; numeric
inputs accept Arabic-Indic digits; the buy box shows a variant's own currency
and takes a prerequisite step (personalization); the cart sheet has an error
state; the cart line keeps a typed quantity until the cart settles; the
address form chooses a city from a list that follows the region (Yemen's
districts of a governorate); delivery options take server-formatted prices and
optional transit days; the order confirmation takes a money formatter, a fees
row and a total label.

## Yemen administrative divisions (OCHA COD-AB)

`src/modules/storefront/lib/yemen/regions.json` holds the governorates and
districts of Yemen (P-codes, Arabic and English names) from the OCHA Common
Operational Dataset — Yemen administrative boundaries (COD-AB), version v01,
valid on 2019-11-22, published by OCHA on the Humanitarian Data Exchange:
https://data.humdata.org/dataset/cod-ab-yem

Licensed under Creative Commons Attribution for Intergovernmental Organisations
(CC BY-IGO 3.0). Changes made: only the governorate and district tables were
kept (codes and names); geometry, centroids and other columns were dropped.
