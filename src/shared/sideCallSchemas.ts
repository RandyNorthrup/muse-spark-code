// M106 contracts for answers the harness asks models to produce. These are
// our output formats, not inferred service response shapes. Each consumer
// validates the decoded JSON, repairs once, then takes its existing text path.
import * as z from 'zod/mini'
import {
  AUTO_REVIEWER_REASON_MAX_CHARS,
  COMMIT_SUBJECT_MAX_CHARS,
  HOOK_OUTPUT_MAX_BYTES,
} from './constants'

const nonblankText = z.string().check(z.regex(/\S/))

export const reviewerAnswerSchema = z.strictObject({
  decision: z.enum(['allow', 'ask']),
  reason: nonblankText.check(z.maxLength(AUTO_REVIEWER_REASON_MAX_CHARS)),
})

// Stated confidence uses percentage points, exactly as M98's text parser.
const percentage = z.number().check(z.gte(0), z.lte(100))
export const judgeNoulAnswerSchema = z.strictObject({
  answer: z.enum(['yes', 'no']),
  confidence: percentage,
})

/** Choice/score batches have the caller's exact option count, in call order. */
export function judgeDistributionAnswerSchema(optionCount: number) {
  if (!Number.isSafeInteger(optionCount) || optionCount < 1) {
    throw new RangeError('a judge distribution needs a positive option count')
  }
  return z.strictObject({
    probabilities: z
      .array(percentage)
      .check(z.length(optionCount))
      .check(z.refine((values) => values.some((value) => value > 0))),
  })
}

// Canonical hook data: lane O1 maps continue/context to today's event-specific
// hook answer and block to its refusal. This contract cannot grant permission,
// update a tool's input or change the guarded settle. Null means absent data.
export const hookDecisionSchema = z
  .strictObject({
    decision: z.enum(['continue', 'block']),
    reason: z.nullable(nonblankText.check(z.maxLength(HOOK_OUTPUT_MAX_BYTES))),
    additionalContext: z.nullable(nonblankText.check(z.maxLength(HOOK_OUTPUT_MAX_BYTES))),
  })
  .check(
    z.refine((answer) =>
      answer.decision === 'block' ? answer.reason !== null : answer.reason === null,
    ),
  )

export const commitDraftSchema = z.strictObject({ message: nonblankText })
export const pullRequestDraftSchema = z.strictObject({
  title: nonblankText.check(z.maxLength(COMMIT_SUBJECT_MAX_CHARS)),
  body: z.string(),
})

// M101 C1's compactionPrompt names these six sections. Only model prose
// belongs here: exact todos, file paths and keptEntries stay host-owned.
export const compactionSummarySchema = z.strictObject({
  goal: nonblankText,
  constraints: nonblankText,
  progress: nonblankText,
  decisions: nonblankText,
  nextSteps: nonblankText,
  criticalContext: nonblankText,
})
