// Bytes as text in a named encoding, as the Encoding standard decodes them
// (M69, PLAN.md D49), for web fetch's text and HTML pages alike. Node's
// TextDecoder (full ICU in Node and in VS Code's Electron) covers the
// standard's encodings but two, which it rejects on Node 20 or everywhere:
// `x-user-defined` (a fixed table: bytes 0x80 to 0xFF to U+F780 to U+F7FF)
// and `replacement` (ISO-2022-KR, HZ, ISO-2022-CN: a single U+FFFD), both
// decoded here as the standard defines them; and it gets one wrong,
// `windows-1252`, which Node 20.18 (VS Code 1.99's) decodes as ISO-8859-1,
// so that table is applied here on every Node. Any other encoding a runtime
// cannot decode is an error (UndecodableText), never read as UTF-8.

import { Buffer } from 'node:buffer'
import { TextDecoder, TextEncoder } from 'node:util'

const ASCII_END = 0x80
const USER_DEFINED = 'x-user-defined'
const WINDOWS_1252 = 'windows-1252'
// windows-1252's bytes 0x80 to 0x9F as the Encoding standard's index has them
// (the euro sign, the curly quotes, the dashes); the five bytes it leaves
// unassigned (0x81, 0x8D, 0x8F, 0x90, 0x9D) are their own C1 controls. The
// rest of the encoding is ISO-8859-1: each byte its own code point.
const WINDOWS_1252_C1 =
  '\u{20AC}\u{81}\u{201A}\u{192}\u{201E}\u{2026}\u{2020}\u{2021}\u{2C6}\u{2030}\u{160}\u{2039}\u{152}\u{8D}\u{17D}\u{8F}' +
  '\u{90}\u{2018}\u{2019}\u{201C}\u{201D}\u{2022}\u{2013}\u{2014}\u{2DC}\u{2122}\u{161}\u{203A}\u{153}\u{9D}\u{17E}\u{178}'
const C1_CONTROLS = /[\u{80}-\u{9F}]/gu
// Each C1 control an ISO-8859-1 read leaves, to the character the standard puts at that byte.
const WINDOWS_1252_FIXES = new Map<string, string>(
  Array.from(WINDOWS_1252_C1, (mapped, index) => [String.fromCodePoint(ASCII_END + index), mapped]),
)
const REPLACEMENT = 'replacement'
// The labels of the `replacement` encoding.
const REPLACEMENT_LABELS = new Set([
  'csiso2022kr',
  'hz-gb-2312',
  'iso-2022-cn',
  'iso-2022-cn-ext',
  'iso-2022-kr',
  REPLACEMENT,
])
const REPLACEMENT_CHARACTER = '\u{FFFD}'
// x-user-defined maps byte 0x80 + n to U+F780 + n.
const USER_DEFINED_BASE = 0xf7_80
// String.fromCodePoint takes this many code points at a time comfortably.
const CHUNK = 0x80_00

/** The page is in an encoding this runtime has no decoder for. */
export class UndecodableText extends Error {
  public constructor(public readonly encoding: string) {
    super(`no decoder for ${encoding}`)
    this.name = 'UndecodableText'
  }
}

/** The Encoding standard's name for a label, lower case; undefined for one it does not know. */
export function encodingOf(label: string): string | undefined {
  const name = label.trim().toLowerCase()
  if (name === USER_DEFINED) {
    return USER_DEFINED
  }
  if (REPLACEMENT_LABELS.has(name)) {
    return REPLACEMENT
  }
  try {
    return new TextDecoder(name).encoding
  } catch {
    return undefined
  }
}

function decodeUserDefined(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const units = Array.from(bytes.subarray(start, start + CHUNK), (byte) =>
      byte < ASCII_END ? byte : USER_DEFINED_BASE + byte - ASCII_END,
    )
    parts.push(String.fromCodePoint(...units))
  }
  return parts.join('')
}

function decodeWindows1252(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString('latin1')
    .replaceAll(C1_CONTROLS, (control) => WINDOWS_1252_FIXES.get(control) ?? control)
}

/**
 * The bytes as text in `encoding` (a name from encodingOf); throws
 * UndecodableText when this runtime has no decoder for it.
 */
export function decodeIn(bytes: Uint8Array, encoding: string): string {
  if (encoding === REPLACEMENT) {
    return bytes.byteLength === 0 ? '' : REPLACEMENT_CHARACTER
  }
  if (encoding === USER_DEFINED) {
    return decodeUserDefined(bytes)
  }
  if (encoding === WINDOWS_1252) {
    return decodeWindows1252(bytes)
  }
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(encoding)
  } catch {
    throw new UndecodableText(encoding)
  }
  return decoder.decode(bytes)
}

// The byte order marks: U+FEFF as each encoding writes it.
const BOM = '\u{FEFF}'
const UTF_8_BOM = new TextEncoder().encode(BOM)
const UTF_16LE_BOM = new Uint8Array(Buffer.from(BOM, 'utf16le'))
const UTF_16BE_BOM = UTF_16LE_BOM.toReversed()

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

/** The encoding the bytes' byte order mark names, if they start with one. */
export function bomEncodingOf(bytes: Uint8Array): string | undefined {
  if (hasPrefix(bytes, UTF_8_BOM)) {
    return new TextDecoder().encoding
  }
  if (hasPrefix(bytes, UTF_16BE_BOM)) {
    return encodingOf('utf-16be')
  }
  return hasPrefix(bytes, UTF_16LE_BOM) ? encodingOf('utf-16le') : undefined
}

/** The Encoding standard's "decode": a byte order mark decides first, then `encoding`. */
export function decodeWithBom(bytes: Uint8Array, encoding: string): string {
  return decodeIn(bytes, bomEncodingOf(bytes) ?? encoding)
}
