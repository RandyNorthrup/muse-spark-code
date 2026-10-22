import * as z from 'zod/mini'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'

export { feedbackClassificationSchema, submitMuseFeedback } from './feedbackRequest'
export type { FeedbackRequest, FeedbackSubmitPort } from './feedbackRequest'

/** A captured-frame zod reader must validate the receipt and return its exact outcome. */
export interface FeedbackOutcomeReader {
  parseOutcome(receipt: unknown): string
  /** Read registered literals inside the host; never send them to the webview. */
  readonly secretLiterals?: () => readonly string[]
}

// Native reader for the Muse Code `feedback/submit` receipt, written from
// the captured 1.4.4 note-only upload frame
// (test/fixtures/m106/msp-1.4.4-host-feedback.json, id 5): `outcome`
// `uploaded` with no session record attached. The receipt's identifiers stay
// in the host: only the resolved line is returned, never the bundle path,
// the cause, or the tracing notes. A record-attached receipt has no captured
// frame, so it refuses with the upstream request instead of reporting an
// uncertified disclosure. Only `uploaded` resolves: every other outcome in
// the SDK's FeedbackSubmitOutcome taxonomy refuses with its own sentence, so
// the dialog reports what actually happened instead of a false success; an
// outcome outside that taxonomy refuses with the unrecognized-outcome line.
const feedbackReceiptSchema = z.looseObject({
  outcome: z.string().check(z.minLength(1)),
  sessionRecordAttached: z.optional(z.boolean()),
})

/** The sentence for a receipt outcome that is not a proven upload. */
function nonUploadOutcomeText(outcome: string): string {
  switch (outcome) {
    case 'recorded': {
      return UI_TEXT.feedbackRecorded
    }
    case 'acceptedWithoutReceipt': {
      return UI_TEXT.feedbackAcceptedWithoutReceipt
    }
    case 'trackingFailed': {
      return UI_TEXT.feedbackTrackingFailed
    }
    case 'trackingUncertain': {
      return UI_TEXT.feedbackTrackingUncertain
    }
    case 'dark': {
      return UI_TEXT.feedbackDark
    }
    case 'disabled': {
      return UI_TEXT.feedbackDisabled
    }
    case 'noCredential': {
      return UI_TEXT.feedbackNoCredential
    }
    case 'authRejected': {
      return UI_TEXT.feedbackAuthRejected
    }
    case 'rateLimited': {
      return UI_TEXT.feedbackRateLimited
    }
    case 'failed': {
      return UI_TEXT.feedbackFailed
    }
    default: {
      return fill(UI_TEXT.feedbackUnknownOutcome, { outcome })
    }
  }
}

/** Validate one captured receipt; throw on malformed or uncertified receipts. */
export function parseFeedbackOutcome(receipt: unknown): string {
  const parsed = feedbackReceiptSchema.parse(receipt)
  if (parsed.sessionRecordAttached === true) {
    throw new Error(UI_TEXT.feedbackRecordUnsupported)
  }
  if (parsed.outcome === 'uploaded') {
    return UI_TEXT.feedbackUploaded
  }
  throw new Error(nonUploadOutcomeText(parsed.outcome))
}

/** The captured-frame feedback reader to bind at the host constructions. */
export const NATIVE_FEEDBACK_READER: FeedbackOutcomeReader = {
  parseOutcome: parseFeedbackOutcome,
}
