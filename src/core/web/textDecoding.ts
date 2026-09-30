// Bytes as text in a named encoding, as the Encoding standard decodes them
// (M69, PLAN.md D49), for web fetch's text and HTML pages alike. Node's
// TextDecoder (full ICU in Node and in VS Code's Electron) covers the
// standard's encodings but two, which it rejects on Node 20 or everywhere:
// `x-user-defined` (a fixed table: bytes 0x80 to 0xFF to U+F780 to U+F7FF)
// and `replacement` (ISO-2022-KR, HZ, ISO-2022-CN: a single U+FFFD), both
// decoded here as the standard defines them. Any other encoding a runtime
// cannot decode is an error (UndecodableText), never read as UTF-8.

import { Buffer } from 'node:buffer'
import { TextDecoder, TextEncoder } from 'node:util'

const USER_DEFINED = 'x-user-defined'
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
const ASCII_END = 0x80
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
