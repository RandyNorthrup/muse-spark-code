/**
 * One question over a turn's outcome: may this turn's reply be used as the
 * answer to what was asked? Only a turn that completed WITHOUT a limit
 * yields its reply; anything else (a capped turn, a cancellation, a failure,
 * a missing reply) yields a typed unusable result. Every consumer that turns
 * a reply into a decision, a draft, a review, a verdict, a landed change or
 * a "done" mark goes through here, so a capped turn's "what is done / what
 * remains" summary is never read as a result. The wire keeps `terminal:
 * 'completed'` with `errorKind: 'max_turn_requests'` for a capped turn (the
 * ACP `stopReason` and the exec result contracts read those); in-process,
 * the reply of a capped turn is reachable only through this union.
 */
export interface TurnReplyOutcome {
  readonly terminal?: string | undefined
  readonly errorKind?: string | undefined
}

export type UsableReply<T> =
  | { readonly usable: true; readonly reply: T }
  | { readonly usable: false; readonly capped: boolean }

export function usableReply<T>(outcome: TurnReplyOutcome, reply: T | undefined): UsableReply<T> {
  if (reply === undefined || outcome.terminal !== 'completed')
    return { usable: false, capped: false }
  return outcome.errorKind === 'max_turn_requests'
    ? { usable: false, capped: true }
    : { usable: true, reply }
}

/**
 * The reply when the turn completed without a limit, else undefined. The
 * two Git drafts share this so the capped-never-a-draft read is one line.
 */
export function replyIfUsable<T>(outcome: TurnReplyOutcome, reply: T | undefined): T | undefined {
  const usable = usableReply(outcome, reply)
  return usable.usable ? usable.reply : undefined
}
