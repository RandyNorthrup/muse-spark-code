// The approvals one conversation hands the Auto reviewer on Muse Code (M90,
// PLAN.md D69). The panel holds a request Muse Code raised in Auto (its card
// is not shown) and hands it here; this decides what follows:
//
// - ALLOW, with the approval still the reviewer's to answer (Auto, the
//   setting on, the same session): its allow-once choice, never an "always"
//   one. Muse Code asks for each command of a script in turn, and the
//   reviewer judged the whole line, so each later stage of the same line is
//   allowed once too. The transcript then names the reviewer and its reason.
// - Anything else (ASK, an unreadable reply, a timeout, a failure, the
//   breaker): the card, with what the review left on it.
// - Settled meanwhile (a Stop, another client), or the conversation gone:
//   nothing is shown. Auto left meanwhile: the card, at once.

import {
  type AgentHost,
  type AgentSession,
  isMuseCodeFaultError,
  isPromptSettledError,
} from '../../core/agent/agentBackend'
import { allowOnceChoice } from '../../core/agent/approvalRules'
import type { ReviewBreaker, ReviewRequest } from '../../core/backends/modelapi/autoReviewer'
import type { CoreLogger } from '../../core/logging'
import type { AgentEvent, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { MuseCodeReviewJob, MuseCodeReviewOutcome } from './museCodeReviewer'

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>

/** What the conversation lets the reviewer do with its approvals. */
export interface ReviewedApprovalsDeps {
  /** Shows a held approval as its card, with what the review left on it. */
  readonly showCard: (event: ApprovalRequest, note: string | undefined) => void
  readonly notice: (level: 'info' | 'warning', text: string) => void
  /** Whether the reviewer may still answer it: Auto, the setting on, the same session. */
  readonly mayAllow: (event: ApprovalRequest) => boolean
  readonly log: CoreLogger
  /** A failure as the log may name it (never the CLI's own words). */
  readonly describeFailure: (error: unknown) => string
}

/** One approval to review: where it is answered, and what the reviewer is shown. */
export interface ReviewHold {
  readonly session: AgentSession
  readonly host: () => Promise<AgentHost>
  readonly modelId: string
  readonly request: ReviewRequest
}

/** The window's reviewer: one review in its queue, with this conversation's breaker. */
export type ReviewOne = (
  job: MuseCodeReviewJob,
  breaker: ReviewBreaker,
) => Promise<MuseCodeReviewOutcome>

interface Held {
  event: ApprovalRequest
  readonly stop: AbortController
}

interface Allowance {
  readonly reason: string
  readonly session: AgentSession
  readonly event: ApprovalRequest
}

const APPROVED_DECISION = 'approved'

/** A verdict covers this action, not a replacement subject or tool. */
function isSameSubject(left: ApprovalSubject, right: ApprovalSubject): boolean {
  return (
    left.kind === right.kind &&
    left.command === right.command &&
    left.path === right.path &&
    left.host === right.host &&
    left.toolName === right.toolName
  )
}

/** What the card says when the review left the approval to the user (M78's words). */
function reviewNote(outcome: Extract<MuseCodeReviewOutcome, { decision: 'ask' }>): string {
  switch (outcome.cause) {
    case 'declined': {
      return fill(UI_TEXT.autoReviewAsked, { reason: outcome.reason ?? '' })
    }
    case 'unreadable': {
      return UI_TEXT.autoReviewerUnreadable
    }
    case 'paused': {
      return UI_TEXT.autoReviewerPaused
    }
    case 'failed': {
      return UI_TEXT.autoReviewerFailed
    }
  }
}

export class ReviewedApprovals {
  private readonly held = new Map<string, Held>()
  private readonly allowed = new Map<string, Allowance>()

  public constructor(
    private readonly deps: ReviewedApprovalsDeps,
    private readonly breaker: ReviewBreaker,
    private readonly reviewOne: ReviewOne,
    /** True for the window's first review: its notice. */
    private readonly isFirstReview: () => boolean,
  ) {}

  private async judge(event: ApprovalRequest, hold: ReviewHold): Promise<void> {
    const held: Held = { event, stop: new AbortController() }
    this.held.set(event.approvalId, held)
    this.deps.log.info(`Approval ${event.approvalId} goes to the Auto reviewer first`)
    if (this.isFirstReview()) {
      this.deps.notice('info', UI_TEXT.museCodeReviewerNotice)
    }
    let outcome: MuseCodeReviewOutcome
    try {
      outcome = await this.reviewOne(
        {
          host: await hold.host(),
          modelId: hold.modelId,
          request: hold.request,
          signal: held.stop.signal,
        },
        this.breaker,
      )
    } catch (error: unknown) {
      this.deps.log.warn(
        `The Auto reviewer could not be asked; the user decides: ${this.deps.describeFailure(error)}`,
      )
      outcome = { decision: 'ask', cause: 'failed', reason: undefined, hasTripped: false }
    }
    // Settled, shown or forgotten meanwhile: nothing more to do.
    if (this.held.get(event.approvalId) !== held) {
      return
    }
    this.held.delete(event.approvalId)
    if (outcome.hasTripped) {
      this.deps.notice('warning', UI_TEXT.autoReviewerTripped)
    }
    this.deps.log.info(
      `Approval ${event.approvalId}: the Auto reviewer ${outcome.decision === 'allow' ? 'allows it' : `leaves it to the user (${outcome.cause})`}`,
    )
    if (outcome.decision === 'ask') {
      this.deps.showCard(held.event, reviewNote(outcome))
    } else if (this.deps.mayAllow(held.event)) {
      await this.allow(hold.session, held.event, outcome.reason)
    } else {
      this.deps.showCard(held.event, undefined)
    }
  }

  /** The reviewer's ALLOW on a stage: its allow-once choice, never an "always" one. */
  private async allow(
    session: AgentSession,
    event: ApprovalRequest,
    reason: string,
  ): Promise<void> {
    const choice = allowOnceChoice(event)
    if (choice === undefined) {
      this.allowed.delete(event.approvalId)
      this.deps.showCard(event, undefined)
      return
    }
    const allowance: Allowance = { reason, session, event }
    this.allowed.set(event.approvalId, allowance)
    this.deps.log.info(
      `Approval ${event.approvalId} stage ${String(event.requirementId.sourceIndex)} answered by the Auto reviewer: ${choice.choiceId}`,
    )
    try {
      await session.decideApproval({
        approvalId: event.approvalId,
        choiceId: choice.choiceId,
        requirementId: event.requirementId,
      })
    } catch (error: unknown) {
      if (isPromptSettledError(error) || isMuseCodeFaultError(error)) {
        // Settled meanwhile, or applied all the same (#29): the host's events follow.
        this.deps.log.info(
          `The Auto reviewer's answer to ${event.approvalId}: ${this.deps.describeFailure(error)}`,
        )
        return
      }
      this.deps.log.warn(
        `The Auto reviewer's answer could not be sent: ${this.deps.describeFailure(error)}`,
      )
      if (this.allowed.get(event.approvalId) === allowance) {
        this.allowed.delete(event.approvalId)
        this.deps.showCard(event, UI_TEXT.autoReviewerFailed)
      }
    }
  }

  /** An approval goes to the reviewer; the panel shows nothing of it until the review ends. */
  public hold(event: ApprovalRequest, hold: ReviewHold): void {
    void this.judge(event, hold)
  }

  /**
   * A stage update: a held approval takes it for its answer, and a line the
   * reviewer allowed gets the stage allowed once too (while the line is the
   * same and still the reviewer's). False for an approval it never had.
   */
  public updated(event: Extract<AgentEvent, { type: 'approvalUpdated' }>): boolean {
    const stage = {
      requirementId: event.requirementId,
      subject: event.subject,
      availableChoices: event.availableChoices,
    }
    const held = this.held.get(event.approvalId)
    if (held !== undefined) {
      const isSame = isSameSubject(held.event.subject, event.subject)
      held.event = { ...held.event, ...stage }
      if (!isSame) {
        held.stop.abort()
        this.held.delete(event.approvalId)
        this.deps.showCard(held.event, undefined)
      }
      return true
    }
    const allowance = this.allowed.get(event.approvalId)
    if (allowance === undefined) {
      return false
    }
    const next = { ...allowance.event, ...stage }
    if (!isSameSubject(allowance.event.subject, next.subject) || !this.deps.mayAllow(next)) {
      this.allowed.delete(event.approvalId)
      this.deps.showCard(next, undefined)
      return true
    }
    void this.allow(allowance.session, next, allowance.reason)
    return true
  }

  /**
   * The approval settled: a review still running for it stops, and the
   * transcript's reason when the reviewer allowed it, else undefined.
   */
  public resolved(event: Extract<AgentEvent, { type: 'approvalResolved' }>): string | undefined {
    this.held.get(event.approvalId)?.stop.abort()
    this.held.delete(event.approvalId)
    const allowance = this.allowed.get(event.approvalId)
    this.allowed.delete(event.approvalId)
    return allowance !== undefined && event.decision === APPROVED_DECISION
      ? fill(UI_TEXT.autoReviewAllowed, { reason: allowance.reason })
      : undefined
  }

  /** Auto was left: every approval the reviewer still judges is the user's now. */
  public release(): void {
    for (const held of this.held.values()) {
      held.stop.abort()
      this.deps.showCard(held.event, undefined)
    }
    this.held.clear()
  }

  /** The user sent a message: the reviewer may answer again. */
  public reset(): void {
    this.release()
    this.allowed.clear()
    this.breaker.reset()
  }

  /** The conversation left the panel: its reviews stop and nothing more is shown. */
  public forget(): void {
    for (const held of this.held.values()) {
      held.stop.abort()
    }
    this.held.clear()
    this.allowed.clear()
  }
}
