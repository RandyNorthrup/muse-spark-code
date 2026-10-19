// MONEY017D / D85.2: the Responses media codec over the captured wire.
// Every shape below comes from the owner-authorized captures in
// `docs/research/m105-captures/` (see `docs/certification/m105-captures.md`):
// - `input_video` with `file_id`, plus `fps` when explicit (round 3 V12d
//   default, V12f `fps: 1`, V13f2 `fps: 2`; round 1/2 file-id turns);
// - `input_image` with `file_id` and `detail` (round 3 I13/I12 at every
//   level), or an inline `data:` URI (round 1/2 inline turns);
// - `input_file` with `file_id` (round 1 U6b) or inline `file_data` (the
//   established document pipeline);
// - `input_audio` with `file_id` was accepted by the count path (round 1
//   U7) but ignored on a real turn, so this codec never emits audio: sound
//   is routed to transcription (D85.5), never sent unheard.
// Inline image/document parts pass through untouched, so the established
// pipeline's bytes never change; only the encoded size is measured.
import { MODEL_API_MODEL_TEXT, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import { storedMediaPartSchema, type StoredMediaPart } from '../../shared/media'
import type { ResponsesMediaCodec } from '../backends/modelapi/codecs/responses'
import type { InputContentPart } from '../backends/modelapi/schemas'
import type { UploadedMediaRef } from '../../shared/media'

function metadata(media: StoredMediaPart): { name: string; duration: string; size: string } {
  return {
    name: media.name,
    duration:
      'durationSeconds' in media.info && media.info.durationSeconds !== null
        ? formatUnit(media.info.durationSeconds, 'second')
        : UI_TEXT.media.durationUnknown,
    size: formatBytes(media.info.sizeBytes),
  }
}

/** Character length of an established inline payload, the budget's measure. */
function inlineChars(inline: InputContentPart): number {
  if (inline.type === 'input_image' && 'image_url' in inline) return inline.image_url.length
  if (inline.type === 'input_file' && 'file_data' in inline) return inline.file_data.length
  throw new Error('Only images and documents replay inline')
}

function encodedFileId(file: UploadedMediaRef): string {
  if (!/^file-[A-Za-z0-9_-]+$/u.test(file.fileId)) throw new Error('Invalid upload receipt')
  return file.fileId
}

const MAX_MISSING_FILE_ERROR_DEPTH = 5

function isFileNotFound(error: unknown, fileIds: readonly string[]): boolean {
  const seen = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || depth > MAX_MISSING_FILE_ERROR_DEPTH) return
    if (typeof value === 'string') {
      if (value.includes('file_not_found')) seen.add('file_not_found')
      for (const id of fileIds) if (value.includes(id)) seen.add(id)
      return
    }
    if (typeof value !== 'object') return
    if (value instanceof Error) {
      visit(value.message, depth + 1)
      visit(value.cause, depth + 1)
      return
    }
    for (const entry of Object.values(value)) visit(entry, depth + 1)
  }
  visit(error, 0)
  return seen.has('file_not_found') && fileIds.some((id) => seen.has(id))
}

export const responsesMediaCodec: ResponsesMediaCodec = {
  metadataText: (media) => fill(UI_TEXT.media.replayMetadata, metadata(media)),

  omittedText: (media, model, reason) =>
    reason === 'source'
      ? fill(UI_TEXT.media.uploadExpired, { name: media.name })
      : fill(MODEL_API_MODEL_TEXT.mediaLeftOut, {
          reason:
            reason === 'files'
              ? UI_TEXT.media.filesReadOnly
              : fill(UI_TEXT.media.formatUnsupported, {
                  model: model.modelName,
                  format: media.info.mediaType,
                }),
        }),

  encodeInline: (media, inline, _model) => {
    storedMediaPartSchema.parse(media)
    if (
      (media.info.kind !== 'image' && media.info.kind !== 'document') ||
      (media.info.kind === 'image' && inline.type !== 'input_image') ||
      (media.info.kind === 'document' && inline.type !== 'input_file')
    )
      throw new Error('Only images and documents replay inline')
    return { part: inline, encodedChars: inlineChars(inline) }
  },

  encodeUploaded: (media, model) => {
    const parsed = storedMediaPartSchema.parse(media)
    if (parsed.file?.provider !== model.provider) throw new Error('Media upload provider mismatch')
    const fileId = encodedFileId(parsed.file)
    switch (parsed.info.kind) {
      case 'video': {
        // Round 3 V12f/V13f2: explicit fps rides along; the default omits it.
        return {
          type: 'input_video',
          file_id: fileId,
          ...(parsed.fps !== undefined && { fps: parsed.fps }),
        }
      }
      case 'image': {
        // Round 3 I13/I12: detail rides along at every level and bills the
        // same; `auto` is the replay's, since detail never changes usage.
        return { type: 'input_image', file_id: fileId, detail: 'auto' }
      }
      case 'document': {
        // Round 1 U6b: `input_file` carries a `file_id` without bytes.
        return { type: 'input_file', file_id: fileId }
      }
      case 'audio':
      case 'text': {
        // U7: `input_audio` is accepted and silently ignored, so emitting it
        // would bill an unheard part. Sound routes to transcription (D85.5).
        throw new Error('Audio never replays by file id')
      }
    }
  },

  isMissingFile: (error, fileIds) => isFileNotFound(error, fileIds),
}
