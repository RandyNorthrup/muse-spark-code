import {
  MAKER_DIGEST_RADIX,
  MAKER_REVIEW_ASCII_END,
  MAKER_REVIEW_BATCH_MS,
  MAKER_REVIEW_CONTROL_BASE,
  MAKER_REVIEW_CONTROL_END,
  MAKER_REVIEW_LF_BYTE,
  MAKER_REVIEW_UTF8_FOUR,
  MAKER_REVIEW_UTF8_THREE,
  MAKER_REVIEW_UTF8_TWO,
  MAKER_REVIEW_YIELD_BYTES,
} from '../../shared/constants'

export interface PayloadRow {
  readonly text: string
  readonly line: number
}
export interface CanonicalPayload {
  readonly rows: readonly PayloadRow[]
  readonly lineCount: number
  readonly digest: string
  readonly byteLength: number
}

/** These are exactly the UTF-8 or decoded hexadecimal bytes the host rehashes. */
export function outgoingPayloadBytes(content: string, encoding: 'text' | 'hex'): Uint8Array {
  if (encoding === 'text') return new TextEncoder().encode(content)
  if (!/^(?:[a-f0-9]{2})*$/.test(content)) throw new Error('makerPayloadEncoding')
  const bytes = new Uint8Array(content.length / 2)
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(content.slice(index * 2, index * 2 + 2), MAKER_DIGEST_RADIX)
  return bytes
}

const escapeByte = (byte: number) =>
  String.raw`\x${byte.toString(MAKER_DIGEST_RADIX).padStart(2, '0')}`

/** A single reversible display spelling; literal backslashes/pictures are escaped too. */
function tokenAt(
  bytes: Uint8Array,
  offset: number,
): { text: string; size: number; newline: boolean } {
  const byte = bytes[offset] ?? 0
  const character = String.fromCodePoint(byte)
  if (byte < MAKER_REVIEW_CONTROL_END)
    return {
      text: String.fromCodePoint(MAKER_REVIEW_CONTROL_BASE + byte),
      size: 1,
      newline:
        character === '\n' || (character === '\r' && bytes[offset + 1] !== MAKER_REVIEW_LF_BYTE),
    }
  if (byte < MAKER_REVIEW_ASCII_END)
    return { text: character === '\\' ? '\\\\' : character, size: 1, newline: false }
  const size = byte >= MAKER_REVIEW_UTF8_FOUR ? 2 * 2 : 2 + Number(byte >= MAKER_REVIEW_UTF8_THREE)
  if (byte >= MAKER_REVIEW_UTF8_TWO && offset + size <= bytes.length) {
    const sequence = bytes.subarray(offset, offset + size)
    try {
      // Keep BOMs as characters so the hidden-character escape accounts for their bytes.
      const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(sequence)
      // Marks are escaped even after a base: their bytes never disappear in a composed glyph.
      return {
        text: /[\p{C}\p{M}\p{Z}\u{2400}-\u{2426}]/u.test(text)
          ? [...sequence].map((value) => escapeByte(value)).join('')
          : text,
        size,
        newline: false,
      }
    } catch {
      // An invalid UTF-8 sequence is displayed byte by byte, without replacement characters.
    }
  }
  return { text: escapeByte(byte), size: 1, newline: false }
}

/** Preparation yields before expensive work and after bounded batches; it never mounts rows. */
export async function canonicalPayload(
  bytes: Uint8Array,
  width: number,
  measure: (character: string) => number,
  signal: AbortSignal,
): Promise<CanonicalPayload> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  signal.throwIfAborted()
  const digestPromise = crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  const rows: PayloadRow[] = []
  let text = ''
  let rowWidth = 0
  let line = 1
  let started = performance.now()
  let processed = 0
  const flush = () => {
    rows.push({ text, line })
    text = ''
    rowWidth = 0
  }
  for (let offset = 0; offset < bytes.length;) {
    const token = tokenAt(bytes, offset)
    for (const character of token.text) {
      const characterWidth = measure(character)
      if (characterWidth > width) throw new Error('makerPayloadWidth')
      if (text !== '' && rowWidth + characterWidth > width) flush()
      text += character
      rowWidth += characterWidth
    }
    offset += token.size
    processed += token.size
    if (token.newline) {
      flush()
      line += 1
    }
    if (!(processed >= MAKER_REVIEW_YIELD_BYTES)) {
      continue
    }

    processed = 0
    if (!(performance.now() - started >= MAKER_REVIEW_BATCH_MS)) {
      continue
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    signal.throwIfAborted()
    started = performance.now()
  }
  if (text !== '' || rows.length === 0) flush()
  const digest = [...new Uint8Array(await digestPromise)]
    .map((byte) => byte.toString(MAKER_DIGEST_RADIX).padStart(2, '0'))
    .join('')
  signal.throwIfAborted()
  return {
    rows,
    lineCount: bytes.length === 0 ? 0 : (rows.at(-1)?.line ?? 0),
    digest,
    byteLength: bytes.length,
  }
}
