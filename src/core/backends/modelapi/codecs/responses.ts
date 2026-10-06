// M95's Responses codec and raw U5/U6 request bodies are absent on this base.
// Integration must bind captured encoders; no speculative wire shape is shipped.
import type { InputContentPart } from '../schemas'
import type { StoredMediaPart } from '../../../media/replayMedia'
import type { MediaModelCapabilities } from '../../../media/modalityGate'
import type { UploadedMediaRef } from '../../../../shared/media'

export interface ResponsesMediaCodec {
  /** English model-facing templates from the codec's declared MODEL_TEXT block. */
  metadataText(media: StoredMediaPart): string
  omittedText(
    media: StoredMediaPart,
    model: MediaModelCapabilities,
    reason: 'modality' | 'files',
  ): string
  /** Validate the captured output shape. Uploaded parts encode only file_id, never inline bytes. */
  encodeInline(
    media: StoredMediaPart,
    inline: InputContentPart,
    model: MediaModelCapabilities,
  ): { readonly part: InputContentPart; readonly encodedChars: number }
  /** The encoder never receives the original inline part after upload. */
  encodeUploaded(
    media: StoredMediaPart & { readonly file: UploadedMediaRef },
    model: MediaModelCapabilities,
  ): InputContentPart
  /** A captured, file-specific missing-upload failure; a generic HTTP 404 is insufficient. */
  isMissingFile(error: unknown, fileIds: readonly string[]): boolean
}
