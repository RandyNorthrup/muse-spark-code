// The Auto reviewer on Muse Code (M90, PLAN.md D69). Under `muse serve`, Muse
// Code's Auto (`onRequest`) skips only the commands it classifies as simple
// and safe: it has no approval judge there, and the protocol cannot choose
// one. So in Auto, before an approval Muse Code raised reaches the user, the
// panel asks this reviewer: M78's reviewer (autoReviewer.ts: its rubric, its
// input with every part marked as data, its strict answer and its breaker),
// run as one turn of a hidden side session in the same `muse serve`, on the
// user's subscription.
//
// The side session runs in Plan mode (`denyUnmatched`), thinking off, on
// the conversation's model, in an empty folder of
// the extension's own outside every workspace, so History never lists it
// and is not given workspace files, rules or skills. Plan can still apply
// always-allow rules: any item other than message/reasoning cancels the
// review and leaves the card, but an allowed command may run before cancel.
// It is started on
// the first review, and again after Muse Code restarts or closes it, for
// another model, and after MUSE_CODE_REVIEWER_TURNS_PER_SESSION reviews
// (each review is history the next one reads). One review at a time per
// window, in the order they were asked.
//
// A review's answer is the first line of the turn's first reply, read
// strictly: ALLOW or ASK with a reason. Only ALLOW lets the caller allow the
// approval once. An ASK, a reply that cannot be read, no reply within
// MUSE_CODE_REVIEW_TIMEOUT_MS, a failure, a side session still busy with an
// earlier turn, and a tripped breaker all leave the approval to the user.
// The verdict text is never executed. What follows a review (the allow-once
// answer, the card and its note) is reviewedApprovals.ts.

import { mkdir } from 'node:fs/promises'
import type { AgentHost, AgentSession, TurnSubmission } from '../../core/agent/agentBackend'
import {
  parseReviewerAnswer,
  type ReviewAnswer,
  ReviewBreaker,
  reviewerInput,
  type ReviewRequest,
} from '../../core/backends/modelapi/autoReviewer'
import { FifoLimiter } from '../../core/fifoLimiter'
import type { CoreLogger } from '../../core/logging'
import { unlessAborted, withDeadline } from '../../core/timeouts'
import type { AgentEvent } from '../../shared/agentEvents'
import {
  MODEL_TEXT,
  MUSE_CODE_REVIEW_TIMEOUT_MS,
  MUSE_CODE_REVIEWER_TURNS_PER_SESSION,
  THINKING_OFF_EFFORT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { mspApprovalMode } from '../../shared/permissionModes'
import { ReviewedApprovals, type ReviewedApprovalsDeps } from './reviewedApprovals'

/** One approval to review. */
export interface MuseCodeReviewJob {
  /** The host the conversation's session lives on: the side session joins it. */
  readonly host: AgentHost
  /** The conversation's model: the side session runs on it. */
  readonly modelId: string
  readonly request: ReviewRequest
  /** Aborted once the approval no longer waits on this review. */
  readonly signal: AbortSignal
}

/** Why a review left the approval to the user. */
export type ReviewAskCause = 'declined' | 'unreadable' | 'failed' | 'paused'

export type MuseCodeReviewOutcome =
  | { readonly decision: 'allow'; readonly reason: string; readonly hasTripped: boolean }
  | {
      readonly decision: 'ask'
      readonly cause: ReviewAskCause
      /** The reviewer's own reason, when it gave one. */
      readonly reason: string | undefined
      /** This review tripped the breaker: no review until the user's next message. */
      readonly hasTripped: boolean
    }

export interface MuseCodeReviewerDeps {
  /** The empty folder the side session runs in, made when missing. */
  readonly root: string
  readonly log: CoreLogger
  /** Told each side session's id as it starts: no History lists it. */
  readonly onSideSession: (sessionId: string) => void
  /** A failure as the log may name it (never the CLI's own words). */
  readonly describeFailure: (error: unknown) => string
  /** MUSE_CODE_REVIEW_TIMEOUT_MS, unless a test shortens it. */
  readonly timeoutMs?: number
}

/** The side session and what its turns said. */
interface SideSession {
  readonly host: AgentHost
  readonly session: AgentSession
  readonly modelId: string
  reviews: number
  /** Each turn's first completed reply. */
  readonly replies: Map<string, string>
  /** How each turn ended. */
  readonly endings: Map<string, string>
  /** The turn the latest review sent. */
  lastTurnId: string | undefined
  /** Muse Code exited or closed the session. */
  isGone: boolean
  /** Woken on every event. */
  readonly wakers: Set<() => void>
  /** Stops listening to the session and its host. */
  readonly unsubscribe: (() => void)[]
}

const AGENT_MESSAGE = 'agentMessage'
const COMPLETED = 'completed'
// What a review turn carries without the reviewer acting (the 2026-10-03
// capture): the review prompt's own echo, Muse Code's reminder agents (they
// run in child sessions of their own after every turn), thinking, and the
// reply. Any other item is the side session doing something, and fails closed.
const REVIEW_TURN_ITEM_KINDS: ReadonlySet<string> = new Set([
  'userMessage',
  'reminderChild',
  'reasoning',
  AGENT_MESSAGE,
])
const STARTED_DISPOSITION = 'started'
const PLAN_MODE = 'plan'

interface SlotReview {
  readonly answer: ReviewAnswer | 'failed' | 'unreadable' | 'paused'
  readonly hasTripped: boolean
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

export class MuseCodeReviewer {
  private side: SideSession | undefined
  private readonly slots = new FifoLimiter(1)
  private readonly timeoutMs: number
  private isDisposed = false
  private hasNoticed = false

  public constructor(private readonly deps: MuseCodeReviewerDeps) {
    this.timeoutMs = deps.timeoutMs ?? MUSE_CODE_REVIEW_TIMEOUT_MS
  }

  private async review(
    job: MuseCodeReviewJob,
    breaker: ReviewBreaker,
  ): Promise<MuseCodeReviewOutcome> {
    if (breaker.isTripped) {
      return { decision: 'ask', cause: 'paused', reason: undefined, hasTripped: false }
    }
    let reviewed: SlotReview
    try {
      reviewed = await this.slots.run<SlotReview>(
        async () => {
          if (breaker.isTripped) {
            return { answer: 'paused', hasTripped: false }
          }
          let result: ReviewAnswer | 'failed' | 'unreadable'
          try {
            result = await this.ask(job)
          } catch (error: unknown) {
            this.deps.log.warn(
              `The Auto reviewer could not review; the user decides: ${this.deps.describeFailure(error)}`,
            )
            result = 'failed'
          }
          return {
            answer: result,
            hasTripped:
              !job.signal.aborted &&
              breaker.record(typeof result !== 'string' && result.decision === 'allow'),
          }
        },
        () => !job.signal.aborted && !this.isDisposed,
        () => new Error('the approval no longer waits on its review'),
      )
    } catch (error: unknown) {
      if (!job.signal.aborted && !this.isDisposed) {
        this.deps.log.warn(
          `The Auto reviewer could not review; the user decides: ${this.deps.describeFailure(error)}`,
        )
      }
      reviewed = { answer: 'failed', hasTripped: false }
    }
    if (job.signal.aborted) {
      // Nobody waits on it any more: it counts for nothing.
      return { decision: 'ask', cause: 'failed', reason: undefined, hasTripped: false }
    }
    const { answer, hasTripped } = reviewed
    if (hasTripped) {
      this.deps.log.warn('The Auto reviewer stopped until the next message: its breaker tripped')
    }
    if (typeof answer === 'string') {
      return { decision: 'ask', cause: answer, reason: undefined, hasTripped }
    }
    return answer.decision === 'allow'
      ? { decision: 'allow', reason: answer.reason, hasTripped }
      : { decision: 'ask', cause: 'declined', reason: answer.reason, hasTripped }
  }

  /** Re-read mutable cancellation/window state after every startup await. */
  private isWanted(job: MuseCodeReviewJob, deadline: number): boolean {
    return !job.signal.aborted && !this.isDisposed && remaining(deadline) > 0
  }

  /** One review in its slot: the side session, the turn and its reply's first line. */
  private async ask(job: MuseCodeReviewJob): Promise<ReviewAnswer | 'failed' | 'unreadable'> {
    const deadline = Date.now() + this.timeoutMs
    const side = await this.sideFor(job, deadline)
    if (side === undefined || !this.isWanted(job, deadline)) {
      if (side !== undefined) {
        this.drop(side, 'the approval stopped waiting')
      }
      return 'failed'
    }
    const text = fill(MODEL_TEXT.museCodeReviewerTurn, {
      instructions: MODEL_TEXT.autoReviewerInstructions,
      request: reviewerInput(job.request),
    })
    let submission: TurnSubmission
    try {
      submission = await withDeadline(
        side.session.sendTurn([{ type: 'text', text }]),
        remaining(deadline),
        'the review turn was not taken in time',
      )
    } catch (error: unknown) {
      // It may still be taken: the session is let go with its turn stopped.
      this.drop(side, 'its turn was not taken', true)
      throw error
    }
    side.reviews += 1
    side.lastTurnId = submission.turnId
    if (submission.disposition !== STARTED_DISPOSITION) {
      this.drop(side, `its turn was ${submission.disposition}, not started`)
      return 'failed'
    }
    const { turnId } = submission
    const reply = await this.until(
      side,
      () => {
        const ending = side.endings.get(turnId)
        if (ending === undefined) {
          return
        }
        return ending === COMPLETED ? (side.replies.get(turnId) ?? null) : null
      },
      deadline,
      job.signal,
    )
    if (reply === undefined) {
      if (!job.signal.aborted && !side.isGone) {
        this.drop(side, 'no reply in time')
      }
      return 'failed'
    }
    if (reply === null) {
      this.deps.log.warn(
        `The Auto reviewer's turn ended ${side.endings.get(turnId) ?? ''} without a reply`,
      )
      return 'failed'
    }
    return parseReviewerAnswer(reply) ?? 'unreadable'
  }

  /**
   * The side session for this review: the one there is, once the turn the
   * last review sent has ended (its reply comes first, and Muse Code's own
   * reminders finish after it), or a new one.
   */
  private async sideFor(
    job: MuseCodeReviewJob,
    deadline: number,
  ): Promise<SideSession | undefined> {
    const current = this.side
    if (current === undefined) {
      return await this.start(job, deadline)
    }
    const reason = this.staleReason(current, job)
    if (reason !== undefined) {
      this.drop(current, reason)
      return await this.start(job, deadline)
    }
    const last = current.lastTurnId
    const hasEnded =
      last === undefined ||
      current.endings.has(last) ||
      (await this.until(
        current,
        () => current.endings.has(last) || undefined,
        deadline,
        job.signal,
      )) === true
    if (current.isGone) {
      this.drop(current, 'Muse Code closed it')
      return await this.start(job, deadline)
    }
    if (hasEnded) {
      return current
    }
    if (!job.signal.aborted) {
      this.drop(current, 'still busy with the last review')
    }
    return undefined
  }

  private staleReason(side: SideSession, job: MuseCodeReviewJob): string | undefined {
    if (side.isGone) {
      return 'Muse Code closed it'
    }
    if (side.host !== job.host) {
      return 'Muse Code restarted'
    }
    if (side.modelId !== job.modelId) {
      return 'the conversation runs on another model'
    }
    return side.reviews >= MUSE_CODE_REVIEWER_TURNS_PER_SESSION
      ? 'it reached its review count'
      : undefined
  }

  private async start(job: MuseCodeReviewJob, deadline: number): Promise<SideSession | undefined> {
    await mkdir(this.deps.root, { recursive: true })
    if (!this.isWanted(job, deadline)) {
      return undefined
    }
    const starting = job.host.startSession({
      workspaceRoot: this.deps.root,
      modelId: job.modelId,
      approvalMode: mspApprovalMode(PLAN_MODE),
    })
    let session: AgentSession
    try {
      session = await withDeadline(
        starting,
        remaining(deadline),
        'the side session did not start in time',
      )
    } catch (error: unknown) {
      // One that starts late is let go at once.
      void starting
        .then((late) => {
          late.dispose()
        })
        .catch((error: unknown) => {
          this.deps.log.info(
            `The Auto reviewer's side session did not start: ${this.deps.describeFailure(error)}`,
          )
        })
      throw error
    }
    this.deps.onSideSession(session.sessionId)
    const side: SideSession = {
      host: job.host,
      session,
      modelId: job.modelId,
      reviews: 0,
      replies: new Map(),
      endings: new Map(),
      lastTurnId: undefined,
      isGone: false,
      wakers: new Set(),
      unsubscribe: [],
    }
    const wake = () => {
      for (const waker of side.wakers) {
        waker()
      }
    }
    side.unsubscribe.push(
      session.onEvent((event) => {
        this.hear(side, event)
        wake()
      }),
      job.host.onExit(() => {
        side.isGone = true
        wake()
      }),
      job.host.onSessionListEvent((event) => {
        if (event.type !== 'closed' || event.sessionId !== session.sessionId) {
          return
        }
        side.isGone = true
        wake()
      }),
    )
    this.side = side
    if (!this.isWanted(job, deadline)) {
      this.drop(side, 'the approval stopped waiting')
      return undefined
    }
    try {
      await unlessAborted(
        withDeadline(
          session.setReasoningEffort(THINKING_OFF_EFFORT),
          remaining(deadline),
          'the review effort was not set in time',
        ),
        job.signal,
      )
    } catch (error: unknown) {
      this.drop(side, 'its reasoning effort could not be set')
      throw error
    }
    if (!this.isWanted(job, deadline) || this.staleReason(side, job) !== undefined) {
      this.drop(side, 'the approval stopped waiting')
      return undefined
    }
    this.deps.log.info(
      `The Auto reviewer's side session ${session.sessionId} started on ${job.modelId}`,
    )
    return side
  }

  private hear(side: SideSession, event: AgentEvent): void {
    if (
      ['itemStarted', 'itemUpdated', 'itemCompleted'].includes(event.type) &&
      'item' in event &&
      !REVIEW_TURN_ITEM_KINDS.has(event.item.kind)
    ) {
      this.drop(side, 'its review used a tool', true)
      side.isGone = true
      return
    }
    if (event.type === 'turnCompleted') {
      side.endings.set(event.turnId, event.terminal)
      return
    }
    if (
      event.type === 'itemCompleted' &&
      event.item.kind === AGENT_MESSAGE &&
      event.item.status === COMPLETED &&
      event.item.turnId !== undefined &&
      !side.replies.has(event.item.turnId)
    ) {
      side.replies.set(event.item.turnId, event.item.text ?? '')
    }
  }

  /**
   * What `check` finds, once it finds it; undefined when the deadline
   * passes, the approval stops waiting or the side session is gone first.
   */
  private until<T>(
    side: SideSession,
    check: () => T | undefined,
    deadline: number,
    signal: AbortSignal,
  ): Promise<T | undefined> {
    return new Promise((resolve) => {
      let isSettled = false
      const finish = (value: T | undefined) => {
        if (isSettled) {
          return
        }
        isSettled = true
        clearTimeout(timer)
        side.wakers.delete(look)
        signal.removeEventListener('abort', stop)
        resolve(value)
      }
      const look = () => {
        if (side.isGone) {
          finish(undefined)
          return
        }
        const found = check()
        if (found !== undefined) {
          finish(found)
        }
      }
      const stop = () => {
        finish(undefined)
      }
      const timer = setTimeout(stop, remaining(deadline))
      side.wakers.add(look)
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) {
        stop()
      }
      look()
    })
  }

  /** Lets a side session go: a turn it may still run stopped first. */
  private drop(side: SideSession, reason: string, isPossiblyRunning = false): void {
    if (this.side === side) {
      this.side = undefined
    }
    for (const unsubscribe of side.unsubscribe) {
      unsubscribe()
    }
    this.deps.log.info(
      `The Auto reviewer's side session ${side.session.sessionId} is let go: ${reason}`,
    )
    const last = side.lastTurnId
    const isRunning = isPossiblyRunning || (last !== undefined && !side.endings.has(last))
    if (!isRunning || side.isGone) {
      side.session.dispose()
      return
    }
    void side.session
      .cancel()
      .catch((error: unknown) => {
        this.deps.log.warn(
          `Stopping the Auto reviewer's side turn failed: ${this.deps.describeFailure(error)}`,
        )
      })
      .finally(() => {
        side.session.dispose()
      })
  }

  /**
   * One conversation's approvals: its own breaker; the side session and the
   * queue are the window's, and so is the notice of its first review.
   */
  public conversation(deps: ReviewedApprovalsDeps): ReviewedApprovals {
    return new ReviewedApprovals(
      deps,
      new ReviewBreaker(),
      (job, breaker) => this.review(job, breaker),
      () => {
        const isFirst = !this.hasNoticed
        this.hasNoticed = true
        return isFirst
      },
    )
  }

  /** The window closed: the side session goes with it. */
  public dispose(): void {
    this.isDisposed = true
    if (this.side !== undefined) {
      this.drop(this.side, 'the window closed')
    }
  }
}
