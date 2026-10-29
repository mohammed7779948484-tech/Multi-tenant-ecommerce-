import { describe, expect, it } from '@jest/globals'
import { noteText, proofAllowed, sniffReceiptType } from '../shopProof'

describe('TEST-J09 receipt and note helpers', () => {
  it('recognizes a receipt by its bytes, never by its name', () => {
    expect(sniffReceiptType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg')
    expect(sniffReceiptType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png')
    expect(sniffReceiptType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp')
    expect(sniffReceiptType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf')
    expect(sniffReceiptType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffReceiptType(Buffer.from('GIF89a'))).toBeNull()
    expect(sniffReceiptType(Buffer.alloc(0))).toBeNull()
  })

  it('writes buyer text into a Markdown note as plain text on one line', () => {
    expect(noteText('[اضغط](https://evil.example)\n# عنوان')).toBe('\\[اضغط\\]\\(https\\://evil\\.example\\) \\# عنوان')
    expect(noteText('  TRX-123  ')).toBe('TRX\\-123')
    // Markdown shows an escaped character as itself: the tag reads as text, never as HTML.
    expect(noteText('<img src=x onerror=alert(1)>')).toBe('\\<img src=x onerror=alert\\(1\\)\\>')
  })

  it('takes a proof only for an unsettled bank-transfer order', () => {
    expect(proofAllowed({ providerKey: 'wire-transfer' }, 'pending')).toBe('ok')
    expect(proofAllowed({ providerKey: 'wire-transfer' }, null)).toBe('ok')
    expect(proofAllowed({ providerKey: 'wire-transfer' }, 'received')).toBe('settled')
    expect(proofAllowed({ providerKey: 'cash-on-delivery' }, 'pending')).toBe('notTransfer')
    expect(proofAllowed(null, 'pending')).toBe('notTransfer')
  })
})
