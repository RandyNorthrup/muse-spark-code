// M125 lane R (D107): the effort rule table. Effort is only ever
// lowered, and only this module's explicit rules lower it; anything
// else misses, so an unrecognised request keeps today's effort. The
// wiring maps `lower` onto the level below the configured one from the
// model's own capability record. Pure and synchronous.
export interface EffortInput {
  /** The person's request text. */
  readonly request: string
  /** Files the turn touched so far. */
  readonly filesTouched: number
}

export type EffortVerdict = { readonly decision: 'lower' } | { readonly decision: 'miss' }

interface EffortRule {
  readonly match: RegExp
  readonly maxFiles: number
}

// Narrowly mechanical requests on a few files: formatting, lint and
// renames. Nothing here names a level: lowering is relative to the
// configured effort on the model's own scale.
const EFFORT_RULES: readonly EffortRule[] = [
  { match: /^\s*format\b/i, maxFiles: 3 },
  { match: /^\s*(fix|clear)\b[^.?!]*\blint\b/i, maxFiles: 3 },
  { match: /^\s*rename\b/i, maxFiles: 3 },
  { match: /^\s*sort\b[^.?!]*\bimports\b/i, maxFiles: 3 },
]

/** Lower the effort for a narrowly mechanical request, else miss. */
export function ruleEffort(input: EffortInput): EffortVerdict {
  const rule = EFFORT_RULES.find((candidate) => candidate.match.test(input.request))
  return {
    decision: rule === undefined || input.filesTouched > rule.maxFiles ? 'miss' : 'lower',
  }
}
