import { Buffer } from 'node:buffer'
import type { MediaInfo } from '../../../shared/media'

const FRAME_HEADER_BYTES = 4
const ID3_HEADER_BYTES = 10
const ID3_SIZE_START = 6
const SYNCHSAFE_BASE = 128
const BYTE_MASK = 0xff
const FRAME_SYNC_MASK = 0xe0
const VERSION_MASK = 0x18
const MPEG1_VERSION = 0x18
const MPEG2_VERSION = 0x10
const RESERVED_VERSION = 0x08
const LAYER_MASK = 0x06
const LAYER_III = 0x02
const BITRATE_SHIFT = 4
const SAMPLE_RATE_SHIFT = 2
const INDEX_MASK = 0x03
// ISO/IEC 11172-3 and 13818-3 layer-III tables, not configurable limits.
const BITRATE_MPEG1: Readonly<Partial<Record<number, number>>> = {
  0: 0,
  1: 32,
  2: 40,
  3: 48,
  4: 56,
  5: 64,
  6: 80,
  7: 96,
  8: 112,
  9: 128,
  10: 160,
  11: 192,
  12: 224,
  13: 256,
  14: 320,
}
const BITRATE_MPEG2: Readonly<Partial<Record<number, number>>> = {
  0: 0,
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
  6: 48,
  7: 56,
  8: 64,
  9: 80,
  10: 96,
  11: 112,
  12: 128,
  13: 144,
  14: 160,
}
const SAMPLE_RATES: Readonly<Partial<Record<number, number>>> = { 0: 44_100, 1: 48_000, 2: 32_000 }
const MPEG1_SAMPLES = 1152
const MPEG2_SAMPLES = 576
const BITS_PER_KILOBIT = 1000
const BITS_PER_BYTE = 8
const CHANNEL_MODE_MASK = 0xc0
const MONO_MODE = 0xc0
const MPEG1_STEREO_SIDE_BYTES = 32
const MPEG1_MONO_SIDE_BYTES = 17
const MPEG2_STEREO_SIDE_BYTES = 17
const MPEG2_MONO_SIDE_BYTES = 9
const XING_FRAMES_FLAG = 1
const VBRI_OFFSET = 36
const VBRI_FRAMES_OFFSET = 14
const XING_MIN_WORDS = 3
const TAG_MAGIC_BYTES = 3
const ID3_VERSION_OFFSET = 3
const ID3_REVISION_OFFSET = 4
const ID3_FLAGS_OFFSET = 5
const ID3_V3 = 3
const ID3_V4 = 4
const ID3_FOOTER_FLAG = 0x10
const MPEG25_RATE_DIVISOR = 4

interface Frame {
  readonly length: number
  readonly seconds: number
  readonly sideBytes: number
  readonly crcBytes: number
}

function frameAt(bytes: Buffer, at: number): Frame | undefined {
  if (at + FRAME_HEADER_BYTES > bytes.length || bytes[at] !== BYTE_MASK) return undefined
  const flags = bytes.readUInt8(at + 1)
  const rateFlags = bytes.readUInt8(at + 2)
  const version = flags & VERSION_MASK
  if (
    version === RESERVED_VERSION ||
    (flags & FRAME_SYNC_MASK) !== FRAME_SYNC_MASK ||
    (flags & LAYER_MASK) !== LAYER_III
  )
    return undefined
  const bitrate = (version === MPEG1_VERSION ? BITRATE_MPEG1 : BITRATE_MPEG2)[
    rateFlags >> BITRATE_SHIFT
  ]
  const baseRate = SAMPLE_RATES[(rateFlags >> SAMPLE_RATE_SHIFT) & INDEX_MASK]
  if (bitrate === undefined || bitrate === 0 || baseRate === undefined) return undefined
  const rateDivisor = version === MPEG2_VERSION ? 2 : MPEG25_RATE_DIVISOR
  const sampleRate = baseRate / (version === MPEG1_VERSION ? 1 : rateDivisor)
  const samples = version === MPEG1_VERSION ? MPEG1_SAMPLES : MPEG2_SAMPLES
  const isMono = (bytes.readUInt8(at + FRAME_HEADER_BYTES - 1) & CHANNEL_MODE_MASK) === MONO_MODE
  let sideBytes = isMono ? MPEG2_MONO_SIDE_BYTES : MPEG2_STEREO_SIDE_BYTES
  if (version === MPEG1_VERSION)
    sideBytes = isMono ? MPEG1_MONO_SIDE_BYTES : MPEG1_STEREO_SIDE_BYTES
  return {
    length:
      Math.floor(((samples / BITS_PER_BYTE) * bitrate * BITS_PER_KILOBIT) / sampleRate) +
      ((rateFlags >> 1) & 1),
    seconds: samples / sampleRate,
    crcBytes: (flags & 1) === 0 ? 2 : 0,
    sideBytes,
  }
}

function frameCount(bytes: Buffer, at: number, frame: Frame): number | undefined {
  const end = Math.min(at + frame.length, bytes.length)
  const xing = at + FRAME_HEADER_BYTES + frame.crcBytes + frame.sideBytes
  if (
    xing + FRAME_HEADER_BYTES * XING_MIN_WORDS <= end &&
    ['Xing', 'Info'].includes(bytes.toString('latin1', xing, xing + FRAME_HEADER_BYTES)) &&
    (bytes.readUInt32BE(xing + FRAME_HEADER_BYTES) & XING_FRAMES_FLAG) !== 0
  )
    return bytes.readUInt32BE(xing + FRAME_HEADER_BYTES * 2)
  const vbri = at + VBRI_OFFSET
  return vbri + VBRI_FRAMES_OFFSET + FRAME_HEADER_BYTES <= end &&
    bytes.toString('latin1', vbri, vbri + FRAME_HEADER_BYTES) === 'VBRI'
    ? bytes.readUInt32BE(vbri + VBRI_FRAMES_OFFSET)
    : undefined
}

/** ID3v2 or validated layer-III frames. Partial streams never get a guessed CBR duration. */
export function sniffMp3(
  headBytes: Uint8Array,
  sizeBytes = headBytes.length,
): Extract<MediaInfo, { kind: 'audio' }> | undefined {
  const bytes = Buffer.from(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
  let at = 0
  if (bytes.toString('latin1', 0, TAG_MAGIC_BYTES) === 'ID3') {
    if (
      bytes.length < ID3_HEADER_BYTES ||
      ![2, ID3_V3, ID3_V4].includes(bytes.readUInt8(ID3_VERSION_OFFSET)) ||
      bytes.readUInt8(ID3_REVISION_OFFSET) === BYTE_MASK
    )
      return undefined
    let tagSize = 0
    for (const byte of bytes.subarray(ID3_SIZE_START, ID3_HEADER_BYTES)) {
      if (byte >= SYNCHSAFE_BASE) return undefined
      tagSize = tagSize * SYNCHSAFE_BASE + byte
    }
    at =
      ID3_HEADER_BYTES +
      tagSize +
      (bytes[ID3_VERSION_OFFSET] === ID3_V4 &&
      (bytes.readUInt8(ID3_FLAGS_OFFSET) & ID3_FOOTER_FLAG) !== 0
        ? ID3_HEADER_BYTES
        : 0)
    if (at + FRAME_HEADER_BYTES > sizeBytes) return undefined
    if (at + FRAME_HEADER_BYTES > bytes.length)
      return { kind: 'audio', mediaType: 'audio/mpeg', sizeBytes, durationSeconds: null }
  }
  const first = frameAt(bytes, at)
  if (first === undefined || at + first.length > sizeBytes) return undefined
  const count = frameCount(bytes, at, first)
  let seconds = 0
  let frames = 0
  while (at < sizeBytes) {
    // An ID3v1 footer is metadata, not an audio frame.
    if (
      sizeBytes - at === SYNCHSAFE_BASE &&
      bytes.toString('latin1', at, at + TAG_MAGIC_BYTES) === 'TAG'
    ) {
      at = sizeBytes
      break
    }
    if (at + FRAME_HEADER_BYTES > bytes.length) break
    const frame = frameAt(bytes, at)
    if (frame === undefined || at + frame.length > sizeBytes) return undefined
    seconds += frame.seconds
    frames += 1
    at += frame.length
  }
  if (at < sizeBytes && bytes.length >= sizeBytes) return undefined
  if (at !== sizeBytes && frames < 2 && at < bytes.length) return undefined
  let durationSeconds = at === sizeBytes && seconds > 0 ? seconds : null
  if (count !== undefined && count > 0) durationSeconds = count * first.seconds
  return {
    kind: 'audio',
    mediaType: 'audio/mpeg',
    sizeBytes,
    durationSeconds,
  }
}
