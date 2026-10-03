// The Auto reviewer (M78, PLAN.md D49): an opt-in, paid (D48), read-only
// model call that judges one risky request in Auto that no rule settled,
// as Codex's auto-review does. It sees the user's latest message, the
// turn's earlier calls and the request, all marked as data, and no tools;
// it answers ALLOW or ASK with a reason.
//
// Its reach is the engine's to limit (permissions.ts): it is asked only
// about an ask nothing settled, so it can never allow a forbid, an ask
// rule, a profile's ask, a protected write, a paid call or a child task.
// It can turn that ask into an allow, and nothing else: a decline, an
// answer that cannot be read, a failed call and a tripped breaker all
// leave the question to the user.

import {
  AUTO_REVIEWER_BREAKER_CONSECUTIVE,
  AUTO_REVIEWER_BREAKER_WINDOW,
  AUTO_REVIEWER_BREAKER_WINDOW_LIMIT,
  AUTO_REVIEWER_REASON_MAX_CHARS,
  AUTO_REVIEWER_RECENT_CALL_MAX_CHARS,
  AUTO_REVIEWER_TEXT_MAX_CHARS,
  MODEL_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'

/** What the reviewer is shown. */
export interface ReviewRequest {
  /** The user's latest message, as they typed it; undefined when there is none. */
  readonly userRequest: string | undefined
  /** The turn's earlier calls, oldest first: each tool and its arguments. */
  readonly recentCalls: readonly { readonly tool: string; readonly args: string }[]
  readonly tool: string
  /** The command line, or the call's arguments. */
  readonly action: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
}

/** The reviewer's answer: ALLOW or ASK, and why. */
export interface ReviewAnswer {
  readonly decision: 'allow' | 'ask'
  readonly reason: string
}

const ELLIPSIS = '…'
const ANSWER = /^\s*(ALLOW|ASK)\s*[:\-–—]\s*(.*)$/i
const ALLOW_WORD = 'allow'
const NONE = '(none)'

function clipped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}${ELLIPSIS}` : text
}

/** The reviewer's one input message: every part of it data, fenced and labelled. */
export function reviewerInput(request: ReviewRequest): string {
  const calls =
    request.recentCalls.length === 0
      ? NONE
      : request.recentCalls
          .map((call) => clipped(`${call.tool} ${call.args}`, AUTO_REVIEWER_RECENT_CALL_MAX_CHARS))
          .join('\n')
  return fill(MODEL_TEXT.autoReviewerRequest, {
    userRequest: clipped(request.userRequest ?? NONE, AUTO_REVIEWER_TEXT_MAX_CHARS),
    recentCalls: calls,
    tool: request.tool,
    action: clipped(request.action, AUTO_REVIEWER_TEXT_MAX_CHARS),
    workspace: request.workspaceRoot,
    platform: request.platform,
  })
}

/**
 * The reviewer's reply read strictly: its first non-empty line must be
 * `ALLOW: reason` or `ASK: reason`. Anything else is not an answer.
 */
export function parseReviewerAnswer(text: string): ReviewAnswer | undefined {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')
  const match = line === undefined ? null : ANSWER.exec(line)
  if (match === null) {
    return undefined
  }
  const [, word = '', reason = ''] = match
  if (reason.trim() === '') {
    return undefined
  }
  return {
    decision: word.toLowerCase() === ALLOW_WORD ? 'allow' : 'ask',
    reason: clipped(reason.trim(), AUTO_REVIEWER_REASON_MAX_CHARS),
  }
}

/**
 * The circuit breaker: after too many declines or failures, in a row or in
 * the last window of reviews, the reviewer is not asked again until the
 * user sends the next message (Codex: 3 in a row, 10 of the last 50).
 */
export class ReviewBreaker {
  private consecutive = 0
  private readonly recent: boolean[] = []
  private isOpen = false

  public get isTripped(): boolean {
    return this.isOpen
  }

  /** Records one review; true when this one tripped the breaker. */
  public record(isAllowed: boolean): boolean {
    this.recent.push(isAllowed)
    if (this.recent.length > AUTO_REVIEWER_BREAKER_WINDOW) {
      this.recent.shift()
    }
    this.consecutive = isAllowed ? 0 : this.consecutive + 1
    const declined = this.recent.filter((allowed) => !allowed).length
    if (
      !this.isOpen &&
      (this.consecutive >= AUTO_REVIEWER_BREAKER_CONSECUTIVE ||
        declined >= AUTO_REVIEWER_BREAKER_WINDOW_LIMIT)
    ) {
      this.isOpen = true
      return true
    }
    return false
  }

  /** A new message from the user: the reviewer may answer again. */
  public reset(): void {
    this.consecutive = 0
    this.recent.length = 0
    this.isOpen = false
  }
}
