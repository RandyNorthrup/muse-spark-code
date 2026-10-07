// M105 lane W: the VS Code host's media providers. Activation carries only
// these small factories; the attach port, the preview command and the
// platform drivers load lazily from dist/media.js and dist/screenRecord.js.
// Images and documents keep their established pipeline; video and audio
// refuse with the named upload-binding reason until U6c and the paid
// admission land.
import { randomUUID } from 'node:crypto'
import { BYTES_PER_MIB, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, UI_TEXT } from '../../shared/constants'
import type { MediaModelCapabilities } from '../../core/media/modalityGate'
import type { MediaLimits } from '../../core/media/limits'
import type { MediaAttachDeps } from './mediaAttach'

export interface MediaHostSettings {
  readonly mediaMaxUploadMiB: number
  readonly screenRecordingMaxSeconds: number
}

export function mediaLimitsFromSettings(settings: MediaHostSettings): MediaLimits {
  return {
    maxUploadBytes: settings.mediaMaxUploadMiB * BYTES_PER_MIB,
    maxDurationSeconds: settings.screenRecordingMaxSeconds,
  }
}

/** Established inline formats: what the request builder already encodes. */
const INLINE_IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon']
const INLINE_DOCUMENT_FORMATS = ['application/pdf']

/**
 * Project the selected model from established behavior, never a guess: image
 * and document formats are what the request builder encodes today; video and
 * audio stay unknown until lane V verifies them against live captures.
 */
export function projectMediaCapabilities(modelId: string): MediaModelCapabilities {
  return {
    modelId,
    modelName: modelId,
    provider: 'modelApi',
    modalities: {
      image: {
        support: 'yes',
        formats: INLINE_IMAGE_FORMATS,
        inlineMaxBytes: MAX_IMAGE_BYTES,
      },
      document: {
        support: 'yes',
        formats: INLINE_DOCUMENT_FORMATS,
        inlineMaxBytes: MAX_DOCUMENT_BYTES,
      },
      video: { support: 'unknown', formats: [] },
      audio: { support: 'unknown', formats: [] },
    },
    files: 'unknown',
  }
}

/**
 * E1-picker-filter-binding (M105 W): the picker's media filters as the
 * native dialog takes them. Mutable copies because the dialog owns its
 * options; undefined stays undefined so the no-filter call keeps its shape.
 */
export function dialogFiltersOption(
  filters: Readonly<Record<string, readonly string[]>> | undefined,
): Readonly<Record<string, string[]>> | undefined {
  return filters === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(filters).map(([name, extensions]) => [name, [...extensions]]),
      )
}

export interface MediaHostOpen {
  readonly open: MediaAttachDeps['open']
}

/**
 * Wire the attach port from the host settings. The open hook (confinement,
 * approval, identity) stays with the caller because it owns the dialogs and
 * the session; capabilities project established behavior and limits read the
 * settings. Images and documents keep their established pipeline; this port
 * sniffs video and audio only, and binding them is U6c's upload work, so
 * bind refuses with the named reason until then.
 */
export function createMediaAttachDeps(
  settings: () => MediaHostSettings,
  open: MediaHostOpen['open'],
): MediaAttachDeps {
  return {
    newToken: () => randomUUID(),
    open,
    capabilities: (modelId) => projectMediaCapabilities(modelId),
    limits: () => mediaLimitsFromSettings(settings()),
    bind: () => {
      throw new Error(UI_TEXT.media.uploadStorageUnknown)
    },
  }
}
