// MONEY017D / D85.1: Meta's captured media capabilities. Every row comes
// from the owner-authorized captures in `docs/research/m105-captures/`
// (`docs/certification/m105-captures.md`), never from model-name heuristics
// or vendor documentation alone:
// - 1.3 takes mp4 and mov, and does not hear a soundtrack (U4); 1.2 takes
//   both and hears it. `input_audio` is accepted and silently ignored on
//   both (U7), so standalone audio stays unsupported here: sound routes to
//   transcription (D85.5), never to an unheard part.
// - `fps: 1` and `fps: 2` were accepted and billed (U17b V13f2, V12f);
//   higher values were not tried, so the range ends at 2.
// - 600 seconds is the longest measured turn (U17b R05/R06/R14/R15).
// - Images are measured at 3000x2000 (U17b I13/I12); documents have no page
//   bill and stay refused under a cap by the estimator.
// - Uploads carry the bracket-form `expires_after` and delete cleanly (U6);
//   the provider pool is 100 GiB (D85.2).
// A model with no captures (1.1, standard tiers) resolves to unknown
// support, which the gate refuses with a named reason (D85.1).
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  BYTES_PER_MIB,
  IMAGE_MEDIA_TYPES,
} from '../../shared/constants'
import type { MediaModelCapabilities } from './modalityGate'

const UPLOAD_MAX_BYTES = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
const VIDEO_FORMATS = ['video/mp4', 'video/quicktime'] as const
const CONTRIBUTOR_MODELS = ['muse-spark-1.2-contributor', 'muse-spark-1.3-contributor'] as const

function captured(modelId: (typeof CONTRIBUTOR_MODELS)[number]): MediaModelCapabilities {
  const hearsSoundtrack = modelId === 'muse-spark-1.2-contributor' ? 'yes' : 'no'
  return {
    modelId,
    modelName: modelId,
    provider: 'meta',
    files: 'yes',
    modalities: {
      image: {
        support: 'yes',
        formats: [...IMAGE_MEDIA_TYPES],
        inlineMaxBytes: MAX_IMAGE_BYTES,
        uploadMaxBytes: UPLOAD_MAX_BYTES,
      },
      document: {
        support: 'yes',
        formats: ['application/pdf'],
        inlineMaxBytes: MAX_DOCUMENT_BYTES,
        uploadMaxBytes: UPLOAD_MAX_BYTES,
      },
      video: {
        support: 'yes',
        formats: [...VIDEO_FORMATS],
        uploadMaxBytes: UPLOAD_MAX_BYTES,
        maxDurationSeconds: 600,
        fps: { min: 1, max: 2 },
        hearsSoundtrack,
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
  const found = (CONTRIBUTOR_MODELS as readonly string[]).find((known) => known === modelId)
  return found === undefined
    ? unknown(modelId)
    : captured(found as (typeof CONTRIBUTOR_MODELS)[number])
}
