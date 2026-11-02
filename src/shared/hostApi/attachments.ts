// M105 delivery d (D85): MHP's `attachments/*` boundary, shared by the
// method registry and E3's adapter so the two can never drift. The native
// host calls; the runtime answers. No bytes cross: tokens and paths in,
// upload rows or a reason out.
import * as z from 'zod/mini'
import { MEDIA_ID_MAX_CHARS, MEDIA_PATH_TOKEN_MAX_CHARS } from '../constants'
import { companionMediaUploadSchema } from '../media'

export const attachmentsPickParamsSchema = z.strictObject({})

export const attachmentsAttachParamsSchema = z.strictObject({
  pathToken: z.string().check(z.minLength(1), z.maxLength(MEDIA_PATH_TOKEN_MAX_CHARS)),
})

export const attachmentsRemoveParamsSchema = z.strictObject({
  id: z.string().check(z.minLength(1), z.maxLength(MEDIA_ID_MAX_CHARS)),
})

export { screenRecordingOptionsSchema as attachmentsRecordParamsSchema } from '../media'

/** The adapter's answer, as MHP carries it: uploads, or the user's reason. */
export const attachmentsResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({ attachments: z.array(companionMediaUploadSchema) }),
  }),
  z.strictObject({ ok: z.literal(false), reason: z.string() }),
])
export type AttachmentsResult = z.infer<typeof attachmentsResultSchema>
