// ISO-BMFF metadata only: follow declared box boundaries, never decode frames
// or search an mdat payload for a plausible-looking moov.
import { Buffer } from 'node:buffer'
import type { MediaInfo } from '../../../shared/media'

type IsoInfo = Extract<MediaInfo, { kind: 'video' | 'audio' }>
const BOX_HEADER_BYTES = 8
const LARGE_BOX_HEADER_BYTES = 16
const FOURCC_BYTES = 4
const FIXED_POINT_SCALE = 65_536
const UNKNOWN_DURATION_V0 = 0xff_ff_ff_ffn
const UNKNOWN_DURATION_V1 = 0xff_ff_ff_ff_ff_ff_ff_ffn
const ZERO_TICKS = 0n
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
])
const MVHD_V0_TIMESCALE = 12
const MVHD_V1_TIMESCALE = 20
const TKHD_V0_WIDTH = 76
const TKHD_V1_WIDTH = 88
const HDLR_TYPE_OFFSET = 8

interface Box {
  readonly type: string
  readonly start: number
  readonly body: number
  readonly end: number
}

function boxAt(bytes: Buffer, start: number, end: number): Box | undefined {
  if (start + BOX_HEADER_BYTES > bytes.length) return undefined
  const shortSize = bytes.readUInt32BE(start)
  const header = shortSize === 1 ? LARGE_BOX_HEADER_BYTES : BOX_HEADER_BYTES
  if (start + header > bytes.length) return undefined
  const size = shortSize === 1 ? Number(bytes.readBigUInt64BE(start + BOX_HEADER_BYTES)) : shortSize
  const boxEnd = size === 0 ? end : start + size
  if (!Number.isSafeInteger(boxEnd) || boxEnd < start + header || boxEnd > end) return undefined
  return {
    type: bytes.toString('latin1', start + FOURCC_BYTES, start + BOX_HEADER_BYTES),
    start,
    body: start + header,
    end: boxEnd,
  }
}

function children(bytes: Buffer, start: number, end: number): readonly Box[] | undefined {
  const boxes: Box[] = []
  let cursor = start
  while (cursor < end) {
    const box = boxAt(bytes, cursor, end)
    if (box === undefined) return undefined
    boxes.push(box)
    cursor = box.end
  }
  return boxes
}

function duration(bytes: Buffer): number | null {
  const version = bytes[0]
  if (version !== 0 && version !== 1) return null
  const at = version === 0 ? MVHD_V0_TIMESCALE : MVHD_V1_TIMESCALE
  const durationBytes = version === 0 ? FOURCC_BYTES : BOX_HEADER_BYTES
  if (bytes.length < at + FOURCC_BYTES + durationBytes) return null
  const scale = bytes.readUInt32BE(at)
  const ticks =
    version === 0
      ? BigInt(bytes.readUInt32BE(at + FOURCC_BYTES))
      : bytes.readBigUInt64BE(at + FOURCC_BYTES)
  return scale === 0 ||
    ticks === ZERO_TICKS ||
    ticks === (version === 0 ? UNKNOWN_DURATION_V0 : UNKNOWN_DURATION_V1) ||
    ticks > BigInt(Number.MAX_SAFE_INTEGER)
    ? null
    : Number(ticks) / scale
}

function dimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const version = bytes[0]
  if (version !== 0 && version !== 1) return undefined
  const at = version === 0 ? TKHD_V0_WIDTH : TKHD_V1_WIDTH
  if (bytes.length < at + BOX_HEADER_BYTES) return undefined
  const width = Math.floor(bytes.readUInt32BE(at) / FIXED_POINT_SCALE)
  const height = Math.floor(bytes.readUInt32BE(at + FOURCC_BYTES) / FIXED_POINT_SCALE)
  return width > 0 && height > 0 ? { width, height } : undefined
}

function movieInfo(bytes: Buffer):
  | {
      durationSeconds: number | null
      hasSoundtrack: boolean
      hasVideo: boolean
      width?: number
      height?: number
    }
  | undefined {
  const boxes = children(bytes, 0, bytes.length)
  if (boxes === undefined) return undefined
  let durationSeconds: number | null = null
  let hasSoundtrack = false
  let hasVideo = false
  let size: { width: number; height: number } | undefined
  for (const box of boxes) {
    if (box.type === 'mvhd') durationSeconds = duration(bytes.subarray(box.body, box.end))
    if (box.type !== 'trak') continue
    const track = children(bytes, box.body, box.end)
    if (track === undefined) return undefined
    let handler: string | undefined
    for (const child of track) {
      if (child.type !== 'mdia') continue
      const media = children(bytes, child.body, child.end)
      if (media === undefined) return undefined
      const hdlr = media.find((item) => item.type === 'hdlr')
      if (hdlr !== undefined && hdlr.end - hdlr.body >= HDLR_TYPE_OFFSET + FOURCC_BYTES) {
        handler = bytes.toString(
          'latin1',
          hdlr.body + HDLR_TYPE_OFFSET,
          hdlr.body + HDLR_TYPE_OFFSET + FOURCC_BYTES,
        )
      }
    }
    if (handler === undefined) return undefined
    if (handler === 'soun') hasSoundtrack = true
    if (handler !== 'vide') continue
    hasVideo = true
    const tkhd = track.find((item) => item.type === 'tkhd')
    if (tkhd !== undefined) size = dimensions(bytes.subarray(tkhd.body, tkhd.end)) ?? size
  }
  return { durationSeconds, hasSoundtrack, hasVideo, ...size }
}

/** Head and disjoint tail windows, already bounded by the caller. */
export function sniffIsoBmff(
  headBytes: Uint8Array,
  sizeBytes = headBytes.length,
  tailBytes: Uint8Array = new Uint8Array(),
): IsoInfo | undefined {
  const head = Buffer.from(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
  const tail = Buffer.from(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength)
  const first = boxAt(head, 0, sizeBytes)
  if (
    first?.type !== 'ftyp' ||
    first.end > head.length ||
    first.end - first.body < BOX_HEADER_BYTES ||
    (first.end - first.body) % FOURCC_BYTES !== 0
  )
    return undefined
  const major = head.toString('latin1', first.body, first.body + FOURCC_BYTES)
  const brands = [major]
  for (let at = first.body + BOX_HEADER_BYTES; at < first.end; at += FOURCC_BYTES)
    brands.push(head.toString('latin1', at, at + FOURCC_BYTES))
  let mediaType: 'audio/mp4' | 'video/quicktime' | 'video/mp4' | undefined
  if (major === 'M4A ') mediaType = 'audio/mp4'
  else if (brands.includes('qt  ')) mediaType = 'video/quicktime'
  else if (brands.some((brand) => MP4_BRANDS.has(brand))) mediaType = 'video/mp4'
  if (mediaType === undefined) return undefined
  let metadata: ReturnType<typeof movieInfo>
  let cursor = first.end
  const tailStart = sizeBytes - tail.length
  while (cursor < sizeBytes) {
    if (cursor + BOX_HEADER_BYTES > sizeBytes) return undefined
    const window = cursor < head.length ? head : tail
    const origin = cursor < head.length ? 0 : tailStart
    if (cursor < origin || cursor + BOX_HEADER_BYTES > origin + window.length) break
    const box = boxAt(window, cursor - origin, sizeBytes - origin)
    if (box === undefined) return undefined
    if (box.type === 'moov' && box.end <= window.length) {
      metadata = movieInfo(window.subarray(box.body, box.end))
      if (metadata === undefined) return undefined
    }
    cursor = box.end + origin
  }
  if (metadata === undefined || (!metadata.hasVideo && !metadata.hasSoundtrack)) return undefined
  const durationSeconds = metadata.durationSeconds
  return metadata.hasVideo
    ? {
        kind: 'video',
        mediaType: mediaType === 'video/quicktime' ? mediaType : 'video/mp4',
        sizeBytes,
        durationSeconds,
        hasSoundtrack: metadata.hasSoundtrack,
        ...(metadata.width !== undefined && { width: metadata.width, height: metadata.height }),
      }
    : { kind: 'audio', mediaType: 'audio/mp4', sizeBytes, durationSeconds }
}
