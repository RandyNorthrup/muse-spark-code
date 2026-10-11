// M105 lane W: the VS Code host's media providers. Activation carries only
// these small factories; the attach port, the preview command and the
// platform drivers load lazily from dist/media.js and dist/screenRecord.js.
// Images and documents keep their established pipeline; video and audio bind
// to the window's attached-media registry on models whose captured record
// takes them (lane V seam 1), and refuse with the gate's reason elsewhere.
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import {
  BYTES_PER_MIB,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  type MEDIA_AUDIO_ACTION_OPTIONS,
} from '../../shared/constants'
import type { MediaModelCapabilities } from '../../core/media/modalityGate'
import { reopeningSource, type AttachedMedia } from '../../core/media/attachedMedia'
import { MediaContributorConsent } from '../../core/media/contributorConsent'
import type { MediaLimits } from '../../core/media/limits'
import { isProtectedPath } from '../../core/protectedPaths'
import { isPrivateFileName } from '../../shared/privateFiles'
import type { MediaAttachDeps } from './mediaAttach'
import { isRecordingTempPath } from './recordingLatest'

export interface MediaHostSettings {
  readonly mediaMaxUploadMiB: number
  readonly screenRecordingMaxSeconds: number
  readonly mediaAudioAction: (typeof MEDIA_AUDIO_ACTION_OPTIONS)[number]
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
 * and document formats are what the request builder encodes today. Video,
 * audio and Files stay unknown here; the attach bundle overlays the captured
 * record (`mediaEntry.ts`), which activation never carries.
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
 * the session; capabilities project established behavior and the captured
 * record, and limits read the settings. Images and documents keep their
 * established pipeline; this port sniffs video and audio only. Binding
 * registers the approved source, its digest and a fresh token with the
 * window's attached-media registry, which the session's media service
 * resolves (lane V seam 1); every later read reopens through `open`.
 */
export function createMediaAttachDeps(
  settings: () => MediaHostSettings,
  open: MediaHostOpen['open'],
  binding: {
    readonly attached: Pick<AttachedMedia, 'register' | 'release' | 'releaseOwner'>
    /** D85.7's question, as the editor's own modal. */
    readonly askContributor?: ConstructorParameters<typeof MediaContributorConsent>[0]
    readonly transcribesSound?: MediaAttachDeps['transcribesSound']
  },
): MediaAttachDeps {
  // One consent per port: its conversation key is the port's generation.
  const consent =
    binding.askContributor === undefined
      ? undefined
      : new MediaContributorConsent(binding.askContributor)
  // This port's registrations are its own: a new conversation lets them go.
  const owner = randomUUID()
  return {
    newToken: () => randomUUID(),
    open,
    capabilities: (modelId) => projectMediaCapabilities(modelId),
    limits: () => mediaLimitsFromSettings(settings()),
    bind: (file, info, sha256) => {
      const part = binding.attached.register(
        randomUUID(),
        { name: file.name, info, sha256 },
        reopeningSource(() => open(file)),
        owner,
      )
      return {
        part: () => part,
        release: () => {
          binding.attached.release(part.token)
        },
      }
    },
    release: () => {
      binding.attached.releaseOwner(owner)
    },
    ...(consent !== undefined && {
      chooseContributor: (request) => consent.choose(request),
    }),
    ...(binding.transcribesSound !== undefined && { transcribesSound: binding.transcribesSound }),
  }
}

export interface MediaSourceOpenDeps {
  /** Workspace confinement; undefined or a throw refuses the file. */
  readonly canonicalRelativePath: (
    fsPath: string,
  ) => Promise<{ readonly canonical: string; readonly checkedAbsolute: string } | undefined>
  /**
   * The host's recording temp root. Recorder-produced files under it skip
   * workspace confinement (the driver made them); everything else is
   * confined. Windows separators normalize before the prefix check.
   */
  readonly recordingTempRoot: string
}

/**
 * The attach port's source opener: confinement, protected/private recheck
 * and file identity on every open. No handle is a refusal; an IO failure
 * throws the read failure. The fd pins the file between the sniff reads.
 */
export function createMediaSourceOpen(deps: MediaSourceOpenDeps): MediaAttachDeps['open'] {
  return async (file) => {
    let absolute: string
    if (isRecordingTempPath(deps.recordingTempRoot, file.fsPath)) {
      absolute = file.fsPath
    } else {
      let checked: Awaited<ReturnType<MediaSourceOpenDeps['canonicalRelativePath']>>
      try {
        checked = await deps.canonicalRelativePath(file.fsPath)
      } catch {
        return
      }
      if (
        checked === undefined ||
        isProtectedPath(checked.canonical) ||
        isPrivateFileName(checked.canonical)
      ) {
        return
      }
      absolute = checked.checkedAbsolute
    }
    // A link, a directory or a file that is already gone refuses before any
    // handle exists; only a handle that later fails reads as unreadable.
    let meta: Awaited<ReturnType<typeof lstat>>
    try {
      meta = await lstat(absolute)
    } catch {
      return
    }
    if (!meta.isFile() || meta.isSymbolicLink()) return
    const handle = await open(absolute, 'r')
    let stat: Awaited<ReturnType<FileHandle['stat']>>
    try {
      stat = await handle.stat()
    } catch (error: unknown) {
      await handle.close()
      throw error
    }
    return {
      source: {
        sizeBytes: stat.size,
        read: async (offset, length) => {
          const chunk = Buffer.alloc(length)
          const { bytesRead } = await handle.read(chunk, 0, length, offset)
          return chunk.subarray(0, bytesRead)
        },
      },
      close: () => handle.close(),
    }
  }
}
