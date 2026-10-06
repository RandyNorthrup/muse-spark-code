// The findings a review ends with (M70, PLAN.md D49): one fenced block tagged
// `muse-review` holding `{"findings": [...]}`, which the review prompt asks
// for on both backends. The format is the extension's own, not a wire shape
// of Muse Code or Meta; what the model wrote is still parsed like any
// boundary input, and a block that does not parse stays a code block. No
// `vscode`, Node or DOM imports: the webview renders the list.

import * as z from 'zod/mini'
import {
  REVIEW_FINDING_PATH_MAX_CHARS,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  REVIEW_FINDINGS_MAX,
  REVIEW_SEVERITIES,
  type ReviewSeverity,
  PLAYBOOK_RESOLUTIONS,
} from './constants'

const textSchema = z.string().check(z.trim(), z.maxLength(REVIEW_FINDING_TEXT_MAX_CHARS))
const lineSchema = z.int().check(z.gte(1))

const findingSchema = z.object({
  file: z.string().check(z.trim(), z.minLength(1), z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS)),
  line: z.optional(lineSchema),
  endLine: z.optional(lineSchema),
  // Any word the model chose: a known one is named in the display language,
  // another is shown as it came (AGENTS.md rule 13's spirit).
  severity: z.optional(textSchema),
  title: textSchema.check(z.minLength(1)),
  detail: z.optional(textSchema),
  // Unknown classes are preserved like severities; policy counts them only
  // under the module until a reviewer supplies a known class (D96.2).
  class: z.optional(textSchema.check(z.minLength(1))),
})

const resolutionSchema = z.strictObject({
  // The policy assigns this id to a prior finding, not the model's array index.
  findingId: textSchema.check(z.minLength(1)),
  outcome: z.enum(PLAYBOOK_RESOLUTIONS),
  reason: textSchema.check(z.minLength(1)),
})

const findingsSchema = z.object({
  findings: z.array(findingSchema).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  coverage: z.optional(
    z.array(textSchema.check(z.minLength(1))).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  ),
  resolution: z.optional(z.array(resolutionSchema).check(z.maxLength(REVIEW_FINDINGS_MAX))),
})

export type ReviewFinding = z.infer<typeof findingSchema>
export type ReviewBlock = z.infer<typeof findingsSchema>
export type ReviewResolution = z.infer<typeof resolutionSchema>

/** The additive M116 block; old M70 blocks remain valid without metadata. */
export function parseReviewBlock(json: string): ReviewBlock | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  const result = findingsSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/** The block's findings; undefined when it is not JSON of the review's shape. */
export function parseReviewFindings(json: string): readonly ReviewFinding[] | undefined {
  return parseReviewBlock(json)?.findings
}

/** A severity the list names in words; undefined for one the model made up. */
export function knownSeverity(severity: string | undefined): ReviewSeverity | undefined {
  const lower = severity?.toLowerCase()
  return REVIEW_SEVERITIES.find((known) => known === lower)
}
