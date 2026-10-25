import { describe, expect, it } from '@jest/globals'
import { hasMalformedEscape } from '../malformedEscape'

describe('hasMalformedEscape', () => {
  it.each(['/shop/products/%E0%A4%A', '/%zz', '/shop/%', '/a/%E0%A4'])('flags %p', (path) => {
    expect(hasMalformedEscape(path)).toBe(true)
  })

  it.each(['/', '/shop', '/shop/products/%D9%82%D9%87%D9%88%D8%A9', '/shop/a%20b', '/backend/storefront'])('accepts %p', (path) => {
    expect(hasMalformedEscape(path)).toBe(false)
  })
})
