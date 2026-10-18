import { Buffer } from 'node:buffer'
import type { MediaInfo } from '../../../shared/media'

const RIFF_HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8
const UINT32_BYTES = 4
const FMT_MIN_BYTES = 16
const FORMAT_OFFSET = 0
const CHANNELS_OFFSET = 2
const SAMPLE_RATE_OFFSET = 4
const BYTE_RATE_OFFSET = 8
const BLOCK_ALIGN_OFFSET = 12
const BITS_PER_SAMPLE_OFFSET = 14
const IEEE_FLOAT_FORMAT = 3

function riffEnd(bytes: Buffer, sizeBytes: number): number | undefined {
  if (
    bytes.length < RIFF_HEADER_BYTES ||
    bytes.toString('latin1', 0, UINT32_BYTES) !== 'RIFF' ||
    bytes.toString('latin1', CHUNK_HEADER_BYTES, RIFF_HEADER_BYTES) !== 'WAVE'
  )
    return undefined
  const end = bytes.readUInt32LE(UINT32_BYTES) + CHUNK_HEADER_BYTES
  return end < RIFF_HEADER_BYTES || end > sizeBytes ? undefined : end
}

function riffChunk(bytes: Buffer, cursor: number) {
  const type = bytes.toString('latin1', cursor, cursor + UINT32_BYTES)
  const length = bytes.readUInt32LE(cursor + UINT32_BYTES)
  const body = cursor + CHUNK_HEADER_BYTES
  return { type, length, body, next: body + length + (length % 2) }
}

/** The `fmt ` facts a last-mile contract check needs (format, channels, rate, depth). */
export interface WavFormat {
  readonly format: number
  readonly channels: number
  readonly sampleRate: number
  readonly bitsPerSample: number
}

/** First `fmt ` chunk of a RIFF/WAVE; undefined when the header is unreadable. */
export function readWavFormat(
  headBytes: Uint8Array,
  sizeBytes = headBytes.length,
): WavFormat | undefined {
  const bytes = Buffer.from(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
  const end = riffEnd(bytes, sizeBytes)
  if (end === undefined) return undefined
  let cursor = RIFF_HEADER_BYTES
  while (cursor < end) {
    if (cursor + CHUNK_HEADER_BYTES > end) return undefined
    if (cursor + CHUNK_HEADER_BYTES > bytes.length) return undefined
    const { type, length, body, next } = riffChunk(bytes, cursor)
    if (next > end) return undefined
    if (type === 'fmt ') {
      if (length < FMT_MIN_BYTES || body + FMT_MIN_BYTES > bytes.length) return undefined
      return {
        format: bytes.readUInt16LE(body + FORMAT_OFFSET),
        channels: bytes.readUInt16LE(body + CHANNELS_OFFSET),
        sampleRate: bytes.readUInt32LE(body + SAMPLE_RATE_OFFSET),
        bitsPerSample: bytes.readUInt16LE(body + BITS_PER_SAMPLE_OFFSET),
      }
    }
    cursor = next
  }
  return undefined
}

/** RIFF/WAVE; duration is exact only for PCM/IEEE float with a readable data size. */
export function sniffRiff(
  headBytes: Uint8Array,
  sizeBytes = headBytes.length,
): Extract<MediaInfo, { kind: 'audio' }> | undefined {
  const bytes = Buffer.from(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
  const end = riffEnd(bytes, sizeBytes)
  if (end === undefined) return undefined
  let cursor = RIFF_HEADER_BYTES
  let rate: number | undefined
  let blockAlign = 0
  let dataBytes: number | undefined
  while (cursor < end) {
    if (cursor + CHUNK_HEADER_BYTES > end) return undefined
    if (cursor + CHUNK_HEADER_BYTES > bytes.length) break
    const { type, length, body, next } = riffChunk(bytes, cursor)
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
