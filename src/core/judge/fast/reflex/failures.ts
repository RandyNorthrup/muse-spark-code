// M125 lane R (D107): failures the tool stream recognised but the reply
// does not mention. Only recognised failure summaries count: an
// unrecognised output misses, never guesses. The reply acknowledges a
// failure by naming it or by owning failure words. Pure and synchronous.
export interface FailureInput {
  /** The tool's merged output text. */
  readonly toolOutput: string
  /** The tool's exit code when the tool reports one. */
  readonly exitCode: number | undefined
  /** The reply text that should mention the failure. */
  readonly replyText: string
}

export type FailureVerdict =
  | { readonly decision: 'unmentioned'; readonly marker: string }
  | { readonly decision: 'mentioned' }
  | { readonly decision: 'miss' }

const FAILURE_SUMMARIES: readonly RegExp[] = [
  /\b\d+ failed\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /error TS\d+/,
  /\berror\b/i,
  /traceback/i,
  /\bexception\b/i,
]

const REPLY_ACKNOWLEDGEMENTS: readonly RegExp[] = [
  /fail/i,
  /error/i,
  /broke/i,
  /did not (pass|work|succeed)/i,
  /does not (pass|work)/i,
  /still (red|failing|broken)/i,
]

/** Find a recognised failure the reply leaves unmentioned, else miss. */
export function findUnmentionedFailure(input: FailureInput): FailureVerdict {
  const summary = FAILURE_SUMMARIES.find((pattern) => pattern.test(input.toolOutput))
  const hasFailedExit = input.exitCode !== undefined && input.exitCode !== 0
  if (summary === undefined && !hasFailedExit) return { decision: 'miss' }
  return REPLY_ACKNOWLEDGEMENTS.some((pattern) => pattern.test(input.replyText))
    ? { decision: 'mentioned' }
    : { decision: 'unmentioned', marker: summary?.source ?? `exit ${String(input.exitCode)}` }
}
