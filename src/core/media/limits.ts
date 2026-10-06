import {
  BYTES_PER_MIB,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_SNIFF_MAX_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import { mediaInfoSchema, type MediaInfo } from '../../shared/media'
import { sniffIsoBmff } from './sniff/isoBmff'
import { sniffEbml } from './sniff/ebml'
import { sniffRiff } from './sniff/riff'
import { sniffMp3 } from './sniff/mp3'

export type MediaFileInfo = Extract<MediaInfo, { kind: 'video' | 'audio' }>

/** A confined, host-owned file handle. No whole-file read or path crosses this seam. */
export interface MediaSource {
  readonly sizeBytes: number
  readonly read: (offset: number, length: number) => Promise<Uint8Array>
}

export type SniffMediaResult =
  | { readonly ok: true; readonly info: MediaFileInfo }
  | { readonly ok: false; readonly reason: string }

export interface MediaLimits {
  readonly maxUploadBytes?: number
  readonly maxDurationSeconds?: number
  readonly capped?: boolean
  /** The selected model's captured formats; modality support is M2's separate gate. */
  readonly acceptedMediaTypes?: readonly string[]
  readonly modelName?: string
  /** Set only after the converter probe succeeds. */
  readonly converterAvailable?: boolean
}

export type MediaLimitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly convertToMp4?: true }

const DEFAULT_FORMATS = new Set(['video/mp4', 'video/quicktime', 'audio/wav', 'audio/mpeg'])
const CONVERTIBLE_FORMATS = new Set(['video/webm', 'video/x-matroska', 'audio/mp4'])

function refused(): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason: fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }) }
}

function readLengths(sizeBytes: number): { head: number; tail: number } {
  const head = Math.min(
    sizeBytes,
    sizeBytes <= MEDIA_SNIFF_MAX_BYTES
      ? MEDIA_SNIFF_MAX_BYTES
      : Math.floor(MEDIA_SNIFF_MAX_BYTES / 2),
  )
  return { head, tail: Math.min(sizeBytes - head, MEDIA_SNIFF_MAX_BYTES - head) }
}

function inspect(head: Uint8Array, sizeBytes: number, tail: Uint8Array): MediaFileInfo | undefined {
  const info =
    sniffIsoBmff(head, sizeBytes, tail) ??
    sniffEbml(head, sizeBytes) ??
    sniffRiff(head, sizeBytes) ??
    sniffMp3(head, sizeBytes)
  return info !== undefined && mediaInfoSchema.safeParse(info).success ? info : undefined
}

/** Embedded ACP bytes use the same bounded windows as a streamed file. */
export function sniffMediaBytes(bytes: Uint8Array): MediaFileInfo | undefined {
  const lengths = readLengths(bytes.length)
  return inspect(
    bytes.subarray(0, lengths.head),
    bytes.length,
    bytes.subarray(bytes.length - lengths.tail),
  )
}

/** At most MEDIA_SNIFF_MAX_BYTES in total, divided between head and tail. */
export async function sniffMedia(source: MediaSource): Promise<SniffMediaResult> {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0) return refused()
  const lengths = readLengths(source.sizeBytes)
  try {
    const head = await source.read(0, lengths.head)
    if (head.length !== lengths.head) return refused()
    const tail =
      lengths.tail === 0
        ? new Uint8Array()
        : await source.read(source.sizeBytes - lengths.tail, lengths.tail)
    if (tail.length !== lengths.tail) return refused()
    const info = inspect(head, source.sizeBytes, tail)
    return info === undefined ? refused() : { ok: true, info }
  } catch {
    return refused()
  }
}

/** Size/duration/format admission; no provider or paid request occurs here. */
export function checkMediaLimits(info: MediaFileInfo, limits: MediaLimits = {}): MediaLimitResult {
  const maximum = limits.maxUploadBytes ?? MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    maximum > MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB ||
    (limits.maxDurationSeconds !== undefined &&
      (!Number.isFinite(limits.maxDurationSeconds) || limits.maxDurationSeconds <= 0))
  )
    throw new RangeError('Invalid media limits')
  if (!mediaInfoSchema.safeParse(info).success || info.sizeBytes <= 0)
    return {
      ok: false,
      reason: fill(UI_TEXT.media.attachmentUnknownType, { type: info.mediaType }),
    }
  if (info.sizeBytes > maximum)
    return { ok: false, reason: fill(UI_TEXT.media.sizeExceeded, { size: formatBytes(maximum) }) }
  const canAccept =
    limits.acceptedMediaTypes === undefined
      ? DEFAULT_FORMATS.has(info.mediaType)
      : limits.acceptedMediaTypes.includes(info.mediaType)
  if (!canAccept) {
    const reason =
      limits.modelName === undefined
        ? fill(UI_TEXT.media.attachmentUnknownType, { type: info.mediaType })
        : fill(UI_TEXT.media.formatUnsupported, { model: limits.modelName, format: info.mediaType })
    return {
      ok: false,
      reason,
      ...(limits.converterAvailable === true &&
        CONVERTIBLE_FORMATS.has(info.mediaType) && { convertToMp4: true }),
    }
  }
  if (
    info.durationSeconds === null &&
    (limits.capped === true || limits.maxDurationSeconds !== undefined)
  )
    return {
      ok: false,
      reason:
        limits.capped === true
          ? UI_TEXT.media.cappedDurationUnknown
          : UI_TEXT.media.durationUnknown,
    }
  if (
    limits.maxDurationSeconds !== undefined &&
    info.durationSeconds !== null &&
    info.durationSeconds > limits.maxDurationSeconds
  )
    return {
      ok: false,
      reason: fill(UI_TEXT.media.durationExceeded, {
        duration: formatUnit(limits.maxDurationSeconds, 'second'),
      }),
    }
  return { ok: true }
}
