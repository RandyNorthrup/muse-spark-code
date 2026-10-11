import { Buffer } from 'node:buffer'
import type { MediaInfo } from '../../../shared/media'

const EBML_ID = 0x1a_45_df_a3
const DOC_TYPE_ID = 0x42_82
const BITS_PER_BYTE = 8
const BYTE_BASE = 256
const ID_MAX_BYTES = 4
const FIRST_SIZE_BIT = 0x80

function vint(
  bytes: Buffer,
  offset: number,
  isId: boolean,
): { value: number; length: number } | undefined {
  const first = bytes[offset]
  if (first === undefined || first === 0) return undefined
  let mask = FIRST_SIZE_BIT
  let length = 1
  while ((first & mask) === 0) {
    mask >>= 1
    length += 1
  }
  if (length > (isId ? ID_MAX_BYTES : BITS_PER_BYTE) || offset + length > bytes.length)
    return undefined
  let value = isId ? first : first & (mask - 1)
  let isUnknown = !isId && value === mask - 1
  for (let at = offset + 1; at < offset + length; at += 1) {
    const byte = bytes.readUInt8(at)
    value = value * BYTE_BASE + byte
    isUnknown &&= byte === BYTE_BASE - 1
  }
  return !isUnknown && Number.isSafeInteger(value) ? { value, length } : undefined
}

/** Only the bounded EBML header's DocType decides WebM versus Matroska. */
export function sniffEbml(
  headBytes: Uint8Array,
  sizeBytes = headBytes.length,
): Extract<MediaInfo, { kind: 'video' }> | undefined {
  const bytes = Buffer.from(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
  const id = vint(bytes, 0, true)
  if (id?.value !== EBML_ID) return undefined
  const size = vint(bytes, id.length, false)
  if (size === undefined) return undefined
  const end = id.length + size.length + size.value
  if (end > bytes.length || end > sizeBytes) return undefined
  let cursor = id.length + size.length
  let docType: string | undefined
  while (cursor < end) {
    const child = vint(bytes, cursor, true)
    if (child === undefined) return undefined
    const length = vint(bytes, cursor + child.length, false)
    if (length === undefined) return undefined
    const body = cursor + child.length + length.length
    if (body + length.value > end) return undefined
    if (child.value === DOC_TYPE_ID) {
      if (docType !== undefined) return undefined
      docType = bytes.toString('latin1', body, body + length.value)
    }
    cursor = body + length.value
  }
  let mediaType: 'video/webm' | 'video/x-matroska' | undefined
  if (docType === 'webm') mediaType = 'video/webm'
  else if (docType === 'matroska') mediaType = 'video/x-matroska'
  return mediaType === undefined
    ? undefined
    : { kind: 'video', mediaType, sizeBytes, durationSeconds: null, hasSoundtrack: null }
}
