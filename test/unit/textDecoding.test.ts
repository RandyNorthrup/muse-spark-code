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

  it("decodes windows-1252 by the standard's table, whatever this Node's decoder does", () => {
    // Bytes 0x80 to 0x9F as the Encoding standard's index has them; the five it leaves
    // unassigned (0x81, 0x8D, 0x8F, 0x90, 0x9D) are their own C1 controls. Node 20.18 reads
    // them all as controls.
    const table = '€\u{81}‚ƒ„…†‡ˆ‰Š‹Œ\u{8D}Ž\u{8F}\u{90}‘’“”•–—˜™š›œ\u{9D}žŸ'
    const c1 = Uint8Array.from({ length: table.length }, (_, index) => 0x80 + index)
    expect(decodeIn(c1, 'windows-1252')).toBe(table)
    // The rest is ISO-8859-1: ASCII, then 0xA0 to 0xFF as U+00A0 to U+00FF.
    const latin = Uint8Array.from({ length: 0x60 }, (_, index) => 0xa0 + index)
    expect(decodeIn(latin, 'windows-1252')).toBe(
      String.fromCodePoint(...Array.from(latin, (byte) => byte)),
    )
    expect(decodeIn(new Uint8Array([0x41, 0x7f, 0xe9, 0xff]), 'windows-1252')).toBe('A\u{7F}éÿ')
    expect(decodeIn(new Uint8Array(), 'windows-1252')).toBe('')
  })

  it('decodes a windows-1252 view of a larger buffer, and a long page, from the right bytes', () => {
    const backing = new Uint8Array([0x41, 0x80, 0x93, 0x42])
    expect(decodeIn(backing.subarray(1, 3), 'windows-1252')).toBe('€“')
    const long = decodeIn(new Uint8Array(200_000).fill(0x99), 'windows-1252')
    // Compared as a flag: a 200,000-character diff would be unreadable.
    expect(long === '™'.repeat(200_000)).toBe(true)
  })

  it('reads every label of windows-1252, latin1 and ASCII ones included, by that table', () => {
    for (const label of ['windows-1252', 'latin1', 'iso-8859-1', 'us-ascii', 'cp1252', 'l1']) {
      expect(encodingOf(label), label).toBe('windows-1252')
    }
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
