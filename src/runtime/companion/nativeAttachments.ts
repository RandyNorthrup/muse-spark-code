// E3's validated MHP attachment-method projection. M104 lane 0 supplies the
// outer RPC envelope and native bridges; no browser reads a native file here.
import * as z from 'zod/mini'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MEDIA_ID_MAX_CHARS,
  MEDIA_PATH_TOKEN_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { companionMediaUploadSchema, screenRecordingOptionsSchema } from '../../shared/media'
import type { ScreenRecordingOptions } from '../../core/media/record/driver'

const token = z.string().check(z.minLength(1), z.maxLength(MEDIA_PATH_TOKEN_MAX_CHARS))
const id = z.string().check(z.minLength(1), z.maxLength(MEDIA_ID_MAX_CHARS))
const requestSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('attachments/pick'), params: z.strictObject({}) }),
  z.strictObject({
    method: z.literal('attachments/attach'),
    params: z.strictObject({ pathToken: token }),
  }),
  z.strictObject({ method: z.literal('attachments/remove'), params: z.strictObject({ id }) }),
  z.strictObject({ method: z.literal('attachments/record'), params: screenRecordingOptionsSchema }),
])
const resultSchema = z.strictObject({
  attachments: z.array(companionMediaUploadSchema).check(z.maxLength(MAX_ATTACHMENTS_PER_MESSAGE)),
})

export interface NativeAttachmentPort {
  /** Native chooser/drop issues confined tokens; implementation streams and gates each source. */
  readonly pick: () => Promise<unknown>
  readonly attach: (pathToken: string) => Promise<unknown>
  readonly remove: (id: string) => Promise<unknown>
  /** Native helper must preview Attach/Discard before returning an attachment token. */
  readonly record: (options: ScreenRecordingOptions) => Promise<unknown>
}

export interface NativeAttachmentContext {
  readonly isCurrent: () => boolean
  /** A bridge-owned user gesture; a JSON field cannot manufacture it. */
  readonly isInteractiveUser: () => boolean
}

/** One serialized owner per panel; stale picker/recorder replies never reach a new session. */
export function nativeAttachments(
  port: NativeAttachmentPort,
  context: NativeAttachmentContext,
): (
  request: unknown,
) => Promise<
  | { readonly ok: true; readonly value: z.infer<typeof resultSchema> }
  | { readonly ok: false; readonly reason: string }
> {
  let tail = Promise.resolve()
  return async (raw) => {
    const request = requestSchema.safeParse(raw)
    if (!request.success) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
    if (!context.isCurrent()) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
    if (!context.isInteractiveUser()) return { ok: false, reason: UI_TEXT.media.recordingUserOnly }
    const execute = async () => {
      if (!context.isCurrent()) throw new Error(UI_TEXT.attachmentUnreadable)
      if (!context.isInteractiveUser()) throw new Error(UI_TEXT.media.recordingUserOnly)
      let value: unknown
      switch (request.data.method) {
        case 'attachments/pick': {
          value = await port.pick()
          break
        }
        case 'attachments/attach': {
          value = await port.attach(request.data.params.pathToken)
          break
        }
        case 'attachments/remove': {
          value = await port.remove(request.data.params.id)
          break
        }
        case 'attachments/record': {
          value = await port.record(request.data.params)
          break
        }
      }
      if (!context.isCurrent()) throw new Error(UI_TEXT.attachmentUnreadable)
      return resultSchema.parse(value)
    }
    const previous = tail
    const pending = (async () => {
      await previous
      return await execute()
    })()
    tail = (async () => {
      try {
        await pending
      } catch {
        /* A failed operation releases the next queued user action. */
      }
    })()

    try {
      return { ok: true, value: await pending }
    } catch {
      return { ok: false, reason: UI_TEXT.attachmentUnreadable }
    }
  }
}
