// E3's validated MHP attachment-method projection. M104 lane 0 supplies the
// outer RPC envelope and native bridges; no browser reads a native file here.
import * as z from 'zod/mini'
import { errorNameForLog } from '../../core/logging'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import {
  attachmentsAttachParamsSchema,
  attachmentsPickParamsSchema,
  attachmentsRecordParamsSchema,
  attachmentsRemoveParamsSchema,
  type AttachmentsResult,
} from '../../shared/hostApi/attachments'
import { companionMediaUploadSchema } from '../../shared/media'
import type { ScreenRecordingOptions } from '../../core/media/record/driver'

const requestSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('attachments/pick'), params: attachmentsPickParamsSchema }),
  z.strictObject({
    method: z.literal('attachments/attach'),
    params: attachmentsAttachParamsSchema,
  }),
  z.strictObject({
    method: z.literal('attachments/remove'),
    params: attachmentsRemoveParamsSchema,
  }),
  z.strictObject({
    method: z.literal('attachments/record'),
    params: attachmentsRecordParamsSchema,
  }),
])
const resultSchema = z.strictObject({
  // D121: no attach count of ours — the native side lists any number.
  attachments: z.array(companionMediaUploadSchema),
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

/**
A port's explicit refusal, with the words the user reads. The dispatch
preserves these reasons; every other thrown failure still refuses with
the generic unreadable text, never its own words.
*/
export class NativeAttachmentRefusal extends Error {
  public constructor(reason: string) {
    super(reason)
    this.name = 'NativeAttachmentRefusal'
  }
}

/** One serialized owner per panel; stale picker/recorder replies never reach a new session. */
export function nativeAttachments(
  port: NativeAttachmentPort,
  context: NativeAttachmentContext,
  log?: Logger,
): (request: unknown) => Promise<AttachmentsResult> {
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
    } catch (error: unknown) {
      if (error instanceof NativeAttachmentRefusal) return { ok: false, reason: error.message }
      log?.error(`NATIVE_ATTACHMENT_FAILED: ${errorNameForLog(error)}`)
      return { ok: false, reason: UI_TEXT.attachmentUnreadable }
    }
  }
}
