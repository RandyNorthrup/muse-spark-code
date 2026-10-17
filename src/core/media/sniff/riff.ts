import { Buffer } from 'node:buffer'
import type { MediaInfo } from '../../../shared/media'

const RIFF_HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8
const UINT32_BYTES = 4
const FMT_MIN_BYTES = 16
const BYTE_RATE_OFFSET = 8
const BLOCK_ALIGN_OFFSET = 12
const IEEE_FLOAT_FORMAT = 3

/** RIFF/WAVE; duration is exact only for PCM/IEEE float with a readable data size. */
export function sniffRiff(
  headBytes: Uint8Array,
  sizeBytes = headBytes.length,
): Extract<MediaInfo, { kind: 'audio' }> | undefined {
  const bytes = Buffer.from(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
  if (
    bytes.length < RIFF_HEADER_BYTES ||
    bytes.toString('latin1', 0, UINT32_BYTES) !== 'RIFF' ||
    bytes.toString('latin1', CHUNK_HEADER_BYTES, RIFF_HEADER_BYTES) !== 'WAVE'
  )
    return undefined
  const end = bytes.readUInt32LE(UINT32_BYTES) + CHUNK_HEADER_BYTES
  if (end < RIFF_HEADER_BYTES || end > sizeBytes) return undefined
  let cursor = RIFF_HEADER_BYTES
  let rate: number | undefined
  let blockAlign = 0
  let dataBytes: number | undefined
  while (cursor < end) {
    if (cursor + CHUNK_HEADER_BYTES > end) return undefined
    if (cursor + CHUNK_HEADER_BYTES > bytes.length) break
    const type = bytes.toString('latin1', cursor, cursor + UINT32_BYTES)
    const length = bytes.readUInt32LE(cursor + UINT32_BYTES)
    const body = cursor + CHUNK_HEADER_BYTES
    const next = body + length + (length % 2)
    if (next > end) return undefined
    if (type === 'fmt ') {
      if (length < FMT_MIN_BYTES) return undefined
      if (body + FMT_MIN_BYTES > bytes.length) break
      const format = bytes.readUInt16LE(body)
      blockAlign = bytes.readUInt16LE(body + BLOCK_ALIGN_OFFSET)
      const byteRate = bytes.readUInt32LE(body + BYTE_RATE_OFFSET)
      if (byteRate === 0 || blockAlign === 0) return undefined
      if (format === 1 || format === IEEE_FLOAT_FORMAT) rate = byteRate
    } else if (type === 'data') dataBytes = (dataBytes ?? 0) + length
    cursor = next
  }
  const durationSeconds =
    rate !== undefined && dataBytes !== undefined && dataBytes > 0 && dataBytes % blockAlign === 0
      ? dataBytes / rate
      : null
  return { kind: 'audio', mediaType: 'audio/wav', sizeBytes, durationSeconds }
}
