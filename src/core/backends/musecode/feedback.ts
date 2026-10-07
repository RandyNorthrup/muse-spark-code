import * as z from 'zod/mini'
import { UI_TEXT } from '../../../shared/constants'
import { redactSecrets } from '../../../shared/redact'

// These are client-selected parameters from SDK 1.4.2, not a guessed server
// receipt. The receipt reader is injected until its served frame is available.
export const feedbackClassificationSchema = z.enum(['bug', 'badResult', 'goodResult', 'other'])
export type FeedbackClassification = z.infer<typeof feedbackClassificationSchema>

const feedbackRequestSchema = z
  .object({
    sessionId: z.string().check(z.minLength(1)),
    classification: feedbackClassificationSchema,
    note: z.string(),
    withFiles: z.boolean(),
    attachSessionRecord: z.boolean(),
  })
  .check(
    z.refine((request) => request.classification !== 'bug' || request.note.trim().length > 0),
    z.refine(
      (request) =>
        !request.attachSessionRecord ||
        (request.withFiles &&
          (request.classification === 'bug' || request.classification === 'badResult')),
    ),
  )
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>

/** A captured-frame zod reader must validate the receipt and return its exact outcome. */
export interface FeedbackOutcomeReader {
  parseOutcome(receipt: unknown): string
  /** Read registered literals inside the host; never send them to the webview. */
  readonly secretLiterals?: () => readonly string[]
}

export interface FeedbackSubmitPort {
  /** The host scrubs registered literals; the shared detector also runs locally. */
  readonly scrubNote?: (note: string) => Promise<string>
  submit(request: FeedbackRequest): Promise<string>
}

/** The preview and dispatch share the same credential detector. */
export async function scrubMuseFeedbackNote(
  note: string,
  port: FeedbackSubmitPort,
): Promise<string> {
  return redactSecrets(z.string().parse((await port.scrubNote?.(note)) ?? note))
}

/** Validate the user's choices; omitted disclosure choices always mean false. */
export async function submitMuseFeedback(
  input: {
    readonly sessionId: string
    readonly classification: FeedbackClassification
    readonly note: string
    readonly withFiles?: boolean
    readonly attachSessionRecord?: boolean
  },
  port: FeedbackSubmitPort,
  previewedNote?: string,
): Promise<string> {
  const request = feedbackRequestSchema.parse({
    ...input,
    withFiles: input.withFiles ?? false,
    attachSessionRecord: input.attachSessionRecord ?? false,
  })
  request.note = await scrubMuseFeedbackNote(request.note, port)
  if (previewedNote !== undefined && request.note !== previewedNote) {
    throw new Error(UI_TEXT.feedbackFailed)
  }
  return z.string().parse(await port.submit(request))
}
