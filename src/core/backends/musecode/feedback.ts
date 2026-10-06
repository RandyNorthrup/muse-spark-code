import * as z from 'zod/mini'

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
}

export interface FeedbackSubmitPort {
  submit(request: FeedbackRequest): Promise<string>
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
): Promise<string> {
  const request = feedbackRequestSchema.parse({
    ...input,
    withFiles: input.withFiles ?? false,
    attachSessionRecord: input.attachSessionRecord ?? false,
  })
  return z.string().parse(await port.submit(request))
}
