/** @jest-environment jsdom */
import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ProductBuyBox, ProductBuyBoxPrice, type BuyBoxProduct } from '../product-buy-box'

const product: BuyBoxProduct = {
  id: 'p1',
  name: 'Gift box',
  price: 1000,
  options: [{ name: 'Size', values: ['S', 'L'] }],
  variants: [
    { id: 'v-s', options: { Size: 'S' }, price: 1200 },
    { id: 'v-l', options: { Size: 'L' }, price: 15, currency: 'USD' },
  ],
}

function price(selection: Record<string, string>) {
  render(
    <I18nProvider locale="en" dict={{}}>
      <ProductBuyBox product={product} currency="YER" locale="en-US" value={selection}>
        <ProductBuyBoxPrice />
      </ProductBuyBox>
    </I18nProvider>,
  )
  return document.querySelector('[data-slot="product-buy-box-price"]')?.textContent ?? ''
}

describe('the buy box shows the selected variant in its own currency', () => {
  it('formats a variant priced in another currency with that currency', () => {
    const text = price({ Size: 'L' })
    expect(text).toContain('$15')
    expect(text).not.toContain('YER')
    screen.getByText(/\$15/)
  })

  it('keeps the box currency for a variant priced in it', () => {
    expect(price({ Size: 'S' })).toContain('YER')
  })
})
