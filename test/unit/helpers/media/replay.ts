import { vi } from 'vitest'
import type {
  MediaModelCapabilities,
  MediaModalityCapability,
} from '../../../../src/core/media/modalityGate'
import {
  ReplayMedia,
  type StoredMediaPart,
  type ReplayMediaDeps,
} from '../../../../src/core/media/replayMedia'
import type { MediaInfo, UploadedMediaRef } from '../../../../src/shared/media'
import type { InputContentPart, InputItem } from '../../../../src/core/backends/modelapi/schemas'
import type { StoredReplayItem } from '../../../../src/core/backends/modelapi/sessionStore'
import { MediaBudget } from '../../../../src/core/backends/modelapi/mediaBudget'

export function mediaModel(modelId = 'muse-spark-1.3'): MediaModelCapabilities {
  const common: MediaModalityCapability = {
    support: 'yes',
    formats: [],
    inlineMaxBytes: 50_000_000,
    uploadMaxBytes: 1_000_000_000,
  }
  return {
    modelId,
    modelName: modelId,
    provider: 'meta',
    files: 'yes',
    modalities: {
      image: { ...common, formats: ['image/png', 'image/jpeg'] },
      document: { ...common, formats: ['application/pdf'] },
      video: {
        ...common,
        formats: ['video/mp4', 'video/quicktime'],
        hearsSoundtrack: modelId.includes('1.2') ? 'yes' : 'no',
        fps: { min: 0.1, max: 2 },
      },
      audio: { ...common, formats: ['audio/wav', 'audio/mpeg'], hearsStandaloneAudio: 'no' },
    },
  }
}

/** Synthetic selected records for switching away from a video-capable model. */
export function switchingMediaModel(id: string): MediaModelCapabilities {
  const model = mediaModel(id)
  return id === 'text-only'
    ? { ...model, modalities: { ...model.modalities, video: { support: 'no', formats: [] } } }
    : model
}

export function videoMedia(): StoredMediaPart & { info: Extract<MediaInfo, { kind: 'video' }> } {
  return {
    name: 'clip.mp4',
    sha256: 'a'.repeat(64),
    info: {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: 512_000,
      durationSeconds: 10,
      hasSoundtrack: true,
      width: 320,
      height: 240,
    },
  }
}

export function uploaded(media: StoredMediaPart, fileId = 'file-clip'): UploadedMediaRef {
  return {
    fileId,
    provider: 'meta',
    expiresAt: 2_000_000_000,
    sha256: media.sha256,
    bytes: media.info.sizeBytes,
    name: media.name,
    mime: media.info.mediaType,
  }
}

/** Test-only encoder markers. These are not raw capture bodies or media wire goldens. */
export function replayRig(
  media: StoredMediaPart = videoMedia(),
  overrides: Partial<ReplayMediaDeps> = {},
) {
  const encodeInline = vi.fn((_media: StoredMediaPart, inline: InputContentPart) => {
    let encodedChars = 0
    switch (inline.type) {
      case 'input_image': {
        encodedChars = inline.image_url.length
        break
      }
      case 'input_file': {
        encodedChars = inline.file_data.length
        break
      }
      default: {
        break
      }
    }
    return { part: inline, encodedChars }
  })
  const encodeUploaded = vi.fn(
    (value: StoredMediaPart & { readonly file: UploadedMediaRef }): InputContentPart => ({
      type: 'input_text',
      text: `test-upload:${value.file.fileId}:${value.info.mediaType}:${String(value.fps ?? '')}`,
    }),
  )
  const ensure = vi.fn(() => Promise.resolve(uploaded(media)))
  const chunk = Promise.resolve(new Uint8Array(1))
  const source = vi.fn(() =>
    Promise.resolve({
      name: media.name,
      mime: media.info.mediaType,
      bytes: media.info.sizeBytes,
      open: async function* () {
        yield await chunk
      },
    }),
  )
  const authorize = vi.fn(() => Promise.resolve())
  const deps: ReplayMediaDeps = {
    capabilities: mediaModel,
    codec: {
      encodeInline,
      encodeUploaded,
      metadataText: (value) => `Media: ${value.name}`,
      omittedText: (value, model, reason) =>
        reason === 'source'
          ? `Attachment ${value.name} not available — reattach.`
          : `${value.name} was left out: ${model.modelName} does not take ${value.info.kind}.`,
      isMissingFile: (error) => error === 'missing-file',
    },
    ledger: () => ({ ensure }),
    compactionTail: (entries) => (entries.length === 0 ? [] : [entries.at(-1)!.turnId]),
    attachment: () => media,
    source,
    authorize,
    ...overrides,
  }
  const replay = new ReplayMedia('session', deps)
  const budget = new MediaBudget()
  let inline: InputContentPart = { type: 'input_text', text: 'token' }
  if (media.info.kind === 'image')
    inline = {
      type: 'input_image',
      image_url: `data:${media.info.mediaType};base64,MEDIA_BYTE_CANARY`,
      detail: 'auto',
    }
  else if (media.info.kind === 'document')
    inline = {
      type: 'input_file',
      filename: media.name,
      file_data: 'data:application/pdf;base64,MEDIA_BYTE_CANARY',
    }
  const part = replay.content(
    { type: 'text', text: 'host-issued-token' },
    inline,
    'muse-spark-1.3',
    budget,
  )
  const input: readonly InputItem[] = [{ type: 'message', role: 'user', content: [part] }]
  const entries: readonly StoredReplayItem[] = [{ turnId: 'turn', item: input[0]! }]
  return {
    replay,
    budget,
    input,
    entries,
    ensure,
    source,
    authorize,
    encodeInline,
    encodeUploaded,
    deps,
  }
}
