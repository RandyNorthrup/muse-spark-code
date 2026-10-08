// Portable M105 metadata and UI contracts (PLAN.md D85). No provider wire,
// file bytes, keys or host APIs belong here. Unknown duration/sound stays null.
import * as z from 'zod/mini'
import { legacyUsdSchema } from './usdSchema'
import {
  MEDIA_AUDIO_ACTIONS,
  MEDIA_CONTRIBUTOR_CHOICES,
  MEDIA_ID_MAX_CHARS,
  MEDIA_NAME_MAX_CHARS,
  MEDIA_PATH_TOKEN_MAX_CHARS,
  MEDIA_SHA256_PATTERN,
  SCREEN_RECORDING_MAX_SECONDS,
  SCREEN_RECORDING_MIN_SECONDS,
} from './constants'

const count = z.int().check(z.gte(0))
const positiveCount = z.int().check(z.gt(0))
const positive = z.number().check(z.gt(0))
const id = z.string().check(z.minLength(1), z.maxLength(MEDIA_ID_MAX_CHARS))
const name = z.string().check(z.minLength(1), z.maxLength(MEDIA_NAME_MAX_CHARS))
const dimensions = { width: z.optional(positiveCount), height: z.optional(positiveCount) }
const size = { sizeBytes: count }

export const mediaInfoSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('image'),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon']),
    ...size,
    ...dimensions,
  }),
  z.strictObject({
    kind: z.literal('document'),
    mediaType: z.literal('application/pdf'),
    ...size,
    pageCount: z.optional(positiveCount),
  }),
  z.strictObject({ kind: z.literal('text'), mediaType: z.literal('text/plain'), ...size }),
  z.strictObject({
    kind: z.literal('video'),
    mediaType: z.enum(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']),
    ...size,
    ...dimensions,
    durationSeconds: z.nullable(positive),
    hasSoundtrack: z.nullable(z.boolean()),
  }),
  z.strictObject({
    kind: z.literal('audio'),
    mediaType: z.enum(['audio/wav', 'audio/mpeg', 'audio/mp4']),
    ...size,
    durationSeconds: z.nullable(positive),
  }),
])
export type MediaInfo = z.infer<typeof mediaInfoSchema>

/** Provider-local upload metadata. Expiry is required; no source bytes survive. */
export const uploadedMediaRefSchema = z.strictObject({
  fileId: id,
  provider: id,
  expiresAt: positiveCount,
  sha256: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
  bytes: count,
  name,
  mime: z.string().check(z.minLength(1), z.maxLength(MEDIA_NAME_MAX_CHARS)),
})
export type UploadedMediaRef = z.infer<typeof uploadedMediaRefSchema>

/** A chip's estimate is never presented as reported usage. Prices are USD. */
export const mediaEstimateSchema = z
  .strictObject({
    estimatedInputTokens: count,
    upperBoundInputTokens: count,
    standardCostUsd: legacyUsdSchema,
    contributorCostUsd: z.optional(legacyUsdSchema),
  })
  .check(z.refine((value) => value.upperBoundInputTokens >= value.estimatedInputTokens))

export const mediaUploadStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('pending') }),
  z
    .strictObject({ status: z.literal('uploading'), uploadedBytes: count, totalBytes: count })
    .check(z.refine((value) => value.uploadedBytes <= value.totalBytes)),
  z.strictObject({ status: z.literal('uploaded'), file: uploadedMediaRefSchema }),
  z.strictObject({ status: z.literal('failed'), reason: name }),
  z.strictObject({ status: z.literal('stopped') }),
])
export type MediaUploadState = z.infer<typeof mediaUploadStateSchema>

/** Optional region on an existing attachment chip; old summaries stay identical. */
export const mediaChipSchema = z.strictObject({
  info: mediaInfoSchema,
  upload: z.optional(mediaUploadStateSchema),
  estimate: z.optional(mediaEstimateSchema),
  isScreenRecording: z.optional(z.boolean()),
  audioAction: z.optional(z.enum(MEDIA_AUDIO_ACTIONS)),
})
export type MediaChip = z.infer<typeof mediaChipSchema>

/** An opaque host-issued path/URI token. The receiver still confines the read. */
export const mediaAttachmentRequestSchema = z.strictObject({
  type: z.literal('attachMedia'),
  requestId: id,
  pathToken: z.string().check(z.minLength(1), z.maxLength(MEDIA_PATH_TOKEN_MAX_CHARS)),
  attachmentEpoch: z.optional(count),
})

export const mediaAttachmentActionSchema = z.strictObject({
  type: z.literal('mediaAttachmentAction'),
  id,
  action: z.enum(MEDIA_AUDIO_ACTIONS),
})

/** Durable per-part media record: metadata plus its provider upload refs. */
export const storedMediaPartSchema = z
  .strictObject({
    name,
    info: mediaInfoSchema,
    sha256: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
    fps: z.optional(z.number().check(z.gt(0))),
    isScreenRecording: z.optional(z.boolean()),
    file: z.optional(uploadedMediaRefSchema),
    files: z.optional(z.array(uploadedMediaRefSchema)),
    delivered: z.optional(z.literal(true)),
  })
  .check(
    z.refine((part) => {
      const files = [...(part.files ?? []), ...(part.file === undefined ? [] : [part.file])]
      return (
        new Set((part.files ?? []).map((file) => file.provider)).size ===
          (part.files?.length ?? 0) &&
        files.every(
          (file) =>
            file.sha256 === part.sha256 &&
            file.bytes === part.info.sizeBytes &&
            file.mime === part.info.mediaType,
        )
      )
    }),
  )
export type StoredMediaPart = z.infer<typeof storedMediaPartSchema>
export const storedReplayMediaSchema = z.strictObject({
  index: z.int().check(z.gte(0)),
  media: storedMediaPartSchema,
})

export const mediaContributorChoiceSchema = z.strictObject({
  type: z.literal('mediaContributorChoice'),
  id,
  choice: z.enum(MEDIA_CONTRIBUTOR_CHOICES),
})

/** The companion returns a token for a completed guarded upload, never a path. */
export const companionMediaUploadSchema = z.strictObject({
  requestId: id,
  uploadToken: id,
  name,
  info: mediaInfoSchema,
})

export const mediaAttachmentUpdateSchema = z.strictObject({
  type: z.literal('mediaAttachmentUpdate'),
  id,
  media: mediaChipSchema,
  attachmentEpoch: z.optional(count),
})

/** One provider file as the upload ledger caches it (metadata only). */
export const uploadedAccountFileSchema = z.strictObject({
  fileId: z.string(),
  name: z.string(),
  bytes: z.int().check(z.gte(0)),
  expiresAt: z.optional(z.int().check(z.gt(0))),
})
/** The account's uploaded-files report the chat validates before posting it
 * (CAPS017: here, so dist/conversation.js no longer carries the ledger). */
export const uploadedFilesReportSchema = z.strictObject({
  provider: z.string(),
  isReadOnly: z.boolean(),
  poolBytes: z.int().check(z.gt(0)),
  usedBytes: z.int().check(z.gte(0)),
  files: z.array(
    z.strictObject({
      ...uploadedAccountFileSchema.shape,
      ours: z.boolean(),
      sessions: z.array(z.string()),
    }),
  ),
})
export type UploadedFilesReport = z.infer<typeof uploadedFilesReportSchema>

/** No implicit audio selection and no unbounded recording request. */
export const screenRecordingOptionsSchema = z.strictObject({
  maxSeconds: z
    .int()
    .check(z.gte(SCREEN_RECORDING_MIN_SECONDS), z.lte(SCREEN_RECORDING_MAX_SECONDS)),
  microphone: z.boolean(),
  systemAudio: z.boolean(),
})
