import { describe, expect, it } from '@jest/globals'
import { fromPreviewWire, toPreviewWire } from '../previewDataWire'
import type { SectionData } from '../sectionDataTypes'

const data: SectionData = {
  products: [
    { id: 'p1', title: 'Dates', subtitle: null, href: '/s/products/p1', image: null, price: { amount: 1500, currencyCode: 'YER', formatted: '١٬٥٠٠ ر.ي.' }, stock: 'low_stock' },
    { id: 'p2', title: 'Honey', subtitle: null, href: '/s/products/p2', image: null, price: null },
  ],
  categories: [{ id: 'c1', name: 'Food', description: null, href: '/s/collections/food', image: null }],
}

describe('preview-data response stays backward compatible', () => {
  it('keeps `price` as the formatted text and adds `priceDetail`', () => {
    const wire = toPreviewWire(data)
    expect(wire.products![0]).toEqual({ id: 'p1', title: 'Dates', subtitle: null, href: '/s/products/p1', image: null, price: '١٬٥٠٠ ر.ي.', priceDetail: data.products![0]!.price })
    expect(wire.products![1]!.price).toBeNull()
    expect(wire.categories).toEqual(data.categories)
  })

  it('reads the structured price back for the builder preview', () => {
    const back = fromPreviewWire(toPreviewWire(data))
    expect(back.products![0]!.price).toEqual(data.products![0]!.price)
    expect(back.products![1]!.price).toBeNull()
  })

  it('still shows the text of a response without `priceDetail`', () => {
    const back = fromPreviewWire({ products: [{ id: 'p1', title: 'Dates', subtitle: null, href: '/x', image: null, price: '10 $' }] })
    expect(back.products![0]!.price?.formatted).toBe('10 $')
  })
})
