import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  bomEncodingOf,
  decodeIn,
  decodeWithBom,
  encodingOf,
  UndecodableText,
} from '../../src/core/web/textDecoding'

describe('bytes as text, as the Encoding standard decodes them (M69)', () => {
  it('decodes x-user-defined by its table, on any Node (Node 20 has no decoder for it)', () => {
    expect(encodingOf(' X-User-Defined ')).toBe('x-user-defined')
    expect(decodeIn(new Uint8Array([0x41, 0x80, 0xff]), 'x-user-defined')).toBe('A\u{F780}\u{F7FF}')
    // Long pages decode in chunks.
    expect(decodeIn(new Uint8Array(100_000).fill(0x80), 'x-user-defined')).toHaveLength(100_000)
  })

  it('reads every replacement label as one U+FFFD, and nothing as nothing', () => {
    for (const label of [
      'iso-2022-kr',
      'hz-gb-2312',
      'iso-2022-cn',
      'csiso2022kr',
      'replacement',
    ]) {
      expect(encodingOf(label), label).toBe('replacement')
    }
    expect(decodeIn(new Uint8Array([0x41, 0x42]), 'replacement')).toBe('\u{FFFD}')
    expect(decodeIn(new Uint8Array(), 'replacement')).toBe('')
  })

  it('refuses an encoding this runtime has no decoder for, never reading it as UTF-8', () => {
    expect(() => decodeIn(new Uint8Array([0x41]), 'x-no-such-encoding')).toThrow(UndecodableText)
    expect(encodingOf('x-no-such-encoding')).toBeUndefined()
  })

  it('lets a byte order mark decide first', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('é', 'utf8')])
    expect(decodeWithBom(utf8, 'windows-1252')).toBe('é')
    const utf16le = new Uint8Array([0xff, 0xfe, ...Buffer.from('é', 'utf16le')])
    expect(bomEncodingOf(utf16le)).toBe('utf-16le')
    expect(decodeWithBom(utf16le, 'windows-1252')).toBe('é')
    expect(decodeWithBom(new Uint8Array([0xe9]), 'windows-1252')).toBe('é')
  })
})
