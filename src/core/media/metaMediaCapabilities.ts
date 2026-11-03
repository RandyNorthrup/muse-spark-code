// MONEY017D / D85.1: Meta's captured media capabilities for the light
// attach path, built from the same capture evidence the selected
// model's capability record carries (`metaMediaEvidence`, read by
// `metaCapabilityRecord`): 1.3 takes mp4 and mov and does not hear a
// soundtrack (U4); 1.2 takes both and hears it; `input_audio` is
// silently ignored on both (U7), so standalone audio stays 'no' and
// sound routes to transcription (D85.5). At prepare time the session
// replay projects the selected model's own record over this table
// (`recordMediaCapabilities`). Images are measured at 3000x2000
// (U17b I13/I12); documents have no page bill and stay refused under
// a cap by the estimator. Uploads carry the bracket-form
// `expires_after` and delete cleanly (U6); the provider pool is
// 100 GiB (D85.2). A model with no captures (1.1, standard tiers)
// resolves to unknown support, which the gate refuses with a named
// reason (D85.1).
import {
  META_DOCUMENT_MAX_BYTES,
  META_IMAGE_MAX_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  BYTES_PER_MIB,
  IMAGE_MEDIA_TYPES,
} from '../../shared/constants'
import type { MediaModelCapabilities } from './modalityGate'
import { metaMediaCapture } from './metaMediaEvidence'

const UPLOAD_MAX_BYTES = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB

function captured(modelId: string): MediaModelCapabilities {
  const capture = metaMediaCapture(modelId)
  if (capture === undefined) throw new Error('Media capability model mismatch')
  return {
    modelId,
    modelName: modelId,
    provider: 'meta',
    files: 'yes',
    modalities: {
      image: {
        support: 'yes',
        formats: [...IMAGE_MEDIA_TYPES],
        // D121: Meta's documented inline maxima (dev.meta.ai/docs, read
        // 2026-10-19), not product limits — the gate enforces the model's
        // own record.
        inlineMaxBytes: META_IMAGE_MAX_BYTES,
        uploadMaxBytes: UPLOAD_MAX_BYTES,
      },
      document: {
        support: 'yes',
        formats: ['application/pdf'],
        inlineMaxBytes: META_DOCUMENT_MAX_BYTES,
        uploadMaxBytes: UPLOAD_MAX_BYTES,
      },
      video: {
        support: 'yes',
        formats: [...capture.videoFormats],
        uploadMaxBytes: UPLOAD_MAX_BYTES,
        maxDurationSeconds: capture.maxDurationSeconds,
        fps: { ...capture.fps },
        hearsSoundtrack: capture.hearsSoundtrack ? 'yes' : 'no',
      },
      audio: {
        support: 'no',
        formats: [],
        hearsStandaloneAudio: 'no',
      },
    },
  }
}

function unknown(modelId: string): MediaModelCapabilities {
  const unsupported = { support: 'unknown' as const, formats: [] as readonly string[] }
  return {
    modelId,
    modelName: modelId,
    provider: 'meta',
    files: 'unknown',
    modalities: {
      image: unsupported,
      document: unsupported,
      video: unsupported,
      audio: unsupported,
    },
  }
}

/** The captured rows, or unknown support (refused with a reason) elsewhere. */
export function metaMediaCapabilities(modelId: string): MediaModelCapabilities {
  return metaMediaCapture(modelId) === undefined ? unknown(modelId) : captured(modelId)
}
