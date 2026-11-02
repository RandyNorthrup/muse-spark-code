// MONEY017D / D85.1: Meta's captured media capabilities, projected from
// the selected model's capability record (`metaCapabilityRecord`, whose
// video and audio rows carry the capture evidence in
// `docs/certification/m105-captures.md`): 1.3 takes mp4 and mov and does
// not hear a soundtrack (U4); 1.2 takes both and hears it; `input_audio`
// is silently ignored on both (U7), so standalone audio stays 'no' and
// sound routes to transcription (D85.5). Images and documents carry
// Meta's documented inline maxima from the same record. A model with no
// captures (1.1, standard tiers) resolves to unknown support, which the
// gate refuses with a named reason (D85.1) — the record's generic Meta
// image row must not become a media rate for a model nobody measured.
import { MEDIA_MAX_UPLOAD_DEFAULT_MIB, BYTES_PER_MIB } from '../../shared/constants'
import { metaCapabilityRecord } from '../providers/capabilityRecord'
import type { MediaModelCapabilities } from './modalityGate'
import { mediaCapabilitiesFromRecord } from './recordMediaCapabilities'

const UPLOAD_MAX_BYTES = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
const CONTRIBUTOR_MODELS = ['muse-spark-1.2-contributor', 'muse-spark-1.3-contributor'] as const

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
    : mediaCapabilitiesFromRecord(metaCapabilityRecord(modelId), modelId, UPLOAD_MAX_BYTES)
}
