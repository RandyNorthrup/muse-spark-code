import { describe, expect, it } from 'vitest'
import { decodeContextText } from '../../src/core/context/contextFiles'

describe('decodeContextText', () => {
  it('reads valid UTF-8 text', () => {
    expect(decodeContextText(new TextEncoder().encode('rules apply'))).toEqual({
      ok: true,
      text: 'rules apply',
    })
  })

  it('refuses bytes no encoding shapes, naming the encoding', () => {
    expect(decodeContextText(new Uint8Array([0x66, 0xff]))).toEqual({
      ok: false,
      reason: 'is not valid UTF-8 text',
    })
  })

  it('refuses an odd-length UTF-16BE body that breaks the byte swap', () => {
    expect(decodeContextText(new Uint8Array([0xfe, 0xff, 0x41]))).toEqual({
      ok: false,
      reason: 'is not valid UTF-16BE text',
    })
  })

  it('refuses text holding NUL characters', () => {
    expect(decodeContextText(new TextEncoder().encode('a\0b'))).toEqual({
      ok: false,
      reason: expect.stringContaining('NUL'),
    })
  })
})
