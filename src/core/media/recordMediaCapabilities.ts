// D85.1: the media gate's view of the selected model's evidence-bearing
// capability record (M95). A modality is a capability of the selected
// model, never of a vendor: every row below is read off the record's own
// evidence, and a modality the record does not know stays `unknown`,
// which the gate refuses with a named reason before anything is sent.
import type { ModelCapabilityRecord } from '../providers/capabilityRecord'
import type { MediaModelCapabilities, MediaModalityCapability } from './modalityGate'

type Support = MediaModalityCapability['support']

function supportOf(state: 'yes' | 'no' | 'unknown'): Support {
  return state
}

/** The one document kind the media pipeline carries; the record's pdf row speaks for it. */
const PDF_MEDIA_TYPE = 'application/pdf'

/**
Project one selected model's record for the modality gate. `modelId` is
the ref the session selected (what the gate names in its refusals); the
record's identity names its provider and native model. `uploadMaxBytes`
is the caller's fallback per-file upload bound for a record whose Files
evidence states none (Meta documents none; the person's media setting
supplies the production value).
*/
export function mediaCapabilitiesFromRecord(
  record: ModelCapabilityRecord,
  modelId: string,
  uploadMaxBytes?: number,
): MediaModelCapabilities {
  const { modalities, files } = record
  const filesMax = files.upload.state === 'yes' ? files.upload.value.maxBytes : undefined
  const uploadBound = filesMax ?? uploadMaxBytes
  const image: MediaModalityCapability =
    modalities.image.state === 'yes'
      ? {
          support: 'yes',
          formats: modalities.image.value.mimes,
          ...(modalities.image.value.maxBytes !== undefined && {
            inlineMaxBytes: modalities.image.value.maxBytes,
          }),
          ...(uploadBound !== undefined && { uploadMaxBytes: uploadBound }),
        }
      : { support: supportOf(modalities.image.state), formats: [] }
  const document: MediaModalityCapability =
    modalities.pdf.state === 'yes'
      ? {
          support: 'yes',
          formats: [PDF_MEDIA_TYPE],
          ...(modalities.pdf.value.maxBytes !== undefined && {
            inlineMaxBytes: modalities.pdf.value.maxBytes,
          }),
          ...(uploadBound !== undefined && { uploadMaxBytes: uploadBound }),
        }
      : { support: supportOf(modalities.pdf.state), formats: [] }
  const videoUploadBound =
    modalities.video.state === 'yes' ? (modalities.video.value.maxBytes ?? uploadBound) : undefined
  const video: MediaModalityCapability =
    modalities.video.state === 'yes'
      ? {
          support: 'yes',
          formats: modalities.video.value.mimes,
          ...(videoUploadBound !== undefined && { uploadMaxBytes: videoUploadBound }),
          ...(modalities.video.value.maxDurationSeconds !== undefined && {
            maxDurationSeconds: modalities.video.value.maxDurationSeconds,
          }),
          ...(modalities.video.value.fps !== undefined && { fps: modalities.video.value.fps }),
          hearsSoundtrack: supportOf(modalities.video.value.hearsSoundtrack.state),
        }
      : { support: supportOf(modalities.video.state), formats: [] }
  // The record's audio flag is the hearing evidence itself: 'yes' means
  // the model hears standalone audio (U7: accepted-but-ignored is 'no').
  const audio: MediaModalityCapability = {
    support: supportOf(modalities.audio.state),
    formats: [],
    hearsStandaloneAudio: supportOf(modalities.audio.state),
  }
  return {
    modelId,
    modelName: modelId,
    provider: record.identity.provider,
    modalities: { image, document, video, audio },
    files: supportOf(files.upload.state),
  }
}
