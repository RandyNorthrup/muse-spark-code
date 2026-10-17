import type {
  MediaModelCapabilities,
  MediaModalityCapability,
} from '../../../../src/core/media/modalityGate'
import type { StoredMediaPart } from '../../../../src/core/media/replayMedia'
import type { MediaInfo, UploadedMediaRef } from '../../../../src/shared/media'

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

export function mediaByteSource(name: string, mime: string, bytes: Uint8Array) {
  const chunk = Promise.resolve(bytes)
  return {
    name,
    mime,
    bytes: bytes.length,
    open: async function* () {
      yield await chunk
    },
  }
}
