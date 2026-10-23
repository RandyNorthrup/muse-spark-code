// M125 lane R (D107): "done" claims against recognised evidence. The
// check fires only on recognised summaries: a claimed done with a
// recognised failure in the tool stream is unbacked; with clean success
// evidence it is backed. No claim, or no recognised signal either way,
// misses — never a guess. Pure and synchronous.
export interface DoneToolOutput {
  readonly exitCode: number | undefined
  readonly output: string
}

export interface DoneInput {
  /** The reply text that may claim the work is done. */
  readonly replyText: string
  /** The turn's tool outputs, oldest first. */
  readonly toolOutputs: readonly DoneToolOutput[]
}

export type DoneVerdict =
  { readonly decision: 'backed' | 'unbacked' } | { readonly decision: 'miss' }

const DONE_CLAIMS: readonly RegExp[] = [
  /\bdone\b/i,
  /\bcomplet(e|ed|ion)\b/i,
  /\bfinished\b/i,
  /\bready for review\b/i,
  /\ball (tests?|checks?) (pass|passing|green)\b/i,
]

const FAILURE_SUMMARIES: readonly RegExp[] = [
  /\b\d+ failed\b/i,
  /\bfailed\b/i,
  /error TS\d+/,
  /\berror\b/i,
  /traceback/i,
  /\bexception\b/i,
]

const SUCCESS_SUMMARIES: readonly RegExp[] = [
  /\b\d+ passed\b/i,
  /\ball (tests?|checks?) (pass|passing|green)\b/i,
  /\bno errors?\b/i,
  /\bclean\b/i,
]

/** Judge a done claim against the tool stream, or miss. */
export function judgeDoneClaim(input: DoneInput): DoneVerdict {
  if (DONE_CLAIMS.every((pattern) => !pattern.test(input.replyText))) return { decision: 'miss' }
  const outputs = input.toolOutputs.map((entry) => entry.output).join('\n')
  if (FAILURE_SUMMARIES.some((pattern) => pattern.test(outputs))) return { decision: 'unbacked' }
  const hasFailedExit = input.toolOutputs.some(
    (entry) => entry.exitCode !== undefined && entry.exitCode !== 0,
  )
  if (hasFailedExit) return { decision: 'unbacked' }
  if (SUCCESS_SUMMARIES.some((pattern) => pattern.test(outputs))) return { decision: 'backed' }
  const cleanExits = input.toolOutputs.filter((entry) => entry.exitCode === 0)
  return {
    decision:
      input.toolOutputs.length > 0 && cleanExits.length === input.toolOutputs.length
        ? 'backed'
        : 'miss',
  }
}
