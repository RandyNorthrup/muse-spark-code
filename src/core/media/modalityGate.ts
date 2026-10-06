// M95 binds this projection of its evidence-bearing selected-model record.
// Unknown support never becomes permission to dispatch (PLAN.md D85.1).
import { UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import type { MediaInfo } from '../../shared/media'

type Support = 'yes' | 'no' | 'unknown'

export interface MediaModalityCapability {
  readonly support: Support
  readonly formats: readonly string[]
  readonly inlineMaxBytes?: number
  readonly uploadMaxBytes?: number
  readonly maxDurationSeconds?: number
  readonly fps?: { readonly min: number; readonly max: number }
  readonly hearsSoundtrack?: Support
  readonly hearsStandaloneAudio?: Support
}

/** A verified projection, not a replacement for M95's record or provenance. */
export interface MediaModelCapabilities {
  readonly modelId: string
  readonly modelName: string
  readonly provider: string
  readonly modalities: Readonly<Record<Exclude<MediaInfo['kind'], 'text'>, MediaModalityCapability>>
  readonly files: Support
}

export type MediaGateResult =
  | { readonly ok: true; readonly soundtrackWarning?: string }
  | { readonly ok: false; readonly reason: string }

/** Used both at attachment admission and on every request/model switch. */
export function modalityGate(
  info: MediaInfo,
  model: MediaModelCapabilities,
  fps?: number,
): MediaGateResult {
  if (info.kind === 'text') return { ok: true }
  const capability = model.modalities[info.kind]
  if (capability.support !== 'yes') {
    let template = UI_TEXT.media.formatUnsupported
    if (info.kind === 'video')
      template =
        capability.support === 'unknown'
          ? UI_TEXT.media.videoUnknown
          : UI_TEXT.media.videoUnsupported
    else if (info.kind === 'audio')
      template =
        capability.support === 'unknown'
          ? UI_TEXT.media.audioUnknown
          : UI_TEXT.media.audioUnsupported
    return {
      ok: false,
      reason: fill(template, { model: model.modelName, format: info.mediaType }),
    }
  }
  if (!capability.formats.includes(info.mediaType))
    return {
      ok: false,
      reason: fill(UI_TEXT.media.formatUnsupported, {
        model: model.modelName,
        format: info.mediaType,
      }),
    }
  // U7: accepted input_audio is insufficient evidence that audio is heard.
  if (info.kind === 'audio' && capability.hearsStandaloneAudio !== 'yes')
    return {
      ok: false,
      reason: fill(
        capability.hearsStandaloneAudio === 'no'
          ? UI_TEXT.media.audioUnsupported
          : UI_TEXT.media.audioUnknown,
        { model: model.modelName },
      ),
    }
  const maxBytes = model.files === 'yes' ? capability.uploadMaxBytes : capability.inlineMaxBytes
  if (maxBytes !== undefined && info.sizeBytes > maxBytes)
    return { ok: false, reason: fill(UI_TEXT.media.sizeExceeded, { size: formatBytes(maxBytes) }) }
  if ('durationSeconds' in info && capability.maxDurationSeconds !== undefined) {
    if (info.durationSeconds === null) return { ok: false, reason: UI_TEXT.media.durationUnknown }
    if (info.durationSeconds > capability.maxDurationSeconds)
      return {
        ok: false,
        reason: fill(UI_TEXT.media.durationExceeded, {
          duration: formatUnit(capability.maxDurationSeconds, 'second'),
        }),
      }
  }
  if (
    fps !== undefined &&
    (info.kind !== 'video' ||
      !Number.isFinite(fps) ||
      capability.fps === undefined ||
      fps < capability.fps.min ||
      fps > capability.fps.max)
  )
    return {
      ok: false,
      reason: fill(UI_TEXT.media.formatUnsupported, { model: model.modelName, format: 'fps' }),
    }
  return info.kind === 'video' &&
    info.hasSoundtrack !== false &&
    capability.hearsSoundtrack !== 'yes'
    ? {
        ok: true,
        soundtrackWarning: fill(UI_TEXT.media.soundtrackUnsupported, { model: model.modelName }),
      }
    : { ok: true }
}
