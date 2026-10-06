// Which approvals and questions a Muse Code session has put on screen
// (PLAN.md D26). The host announces a live prompt twice, as the
// `approval/requested` / `userInput/requested` notification and as its
// `approval/request` / `userInput/request` server-request mirror, and again
// after every `session/resume` (the re-issued server request), while a
// decision the host acknowledged as terminal can still be followed by one
// trailing stage update (the SDK facade's #37538 note). The ledger lets one
// card through per prompt and per stage, none once the approval closed, and
// keeps the open ones so a surface that starts listening late sees them too.
//
// It also holds the decisions sent: one per stage (a second one for the
// same stage is never sent, whichever card or surface it comes from), so a
// Stop knows which approvals are part decided (MuseSession.cancel).

import type { AgentEvent, RequirementRef } from '../../../shared/agentEvents'
import { questionSettlementOutcome } from './mapNotification'

type ApprovalRequested = Extract<AgentEvent, { type: 'approvalRequested' }>
type ApprovalUpdated = Extract<AgentEvent, { type: 'approvalUpdated' }>
type QuestionRequested = Extract<AgentEvent, { type: 'questionRequested' }>

function stageKey(requirementId: RequirementRef): string {
  return `${requirementId.approvalId}\u{0}${String(requirementId.sourceIndex)}`
}

/** The stage's own "Always allow" label, when the subject lists stages. */
function prefixLabel(approval: ApprovalRequested, sourceIndex: number): string | undefined {
  return approval.subject.stages?.find((stage) => stage.requirementId.sourceIndex === sourceIndex)
    ?.suggestedPrefix?.label
}

export class PromptLedger {
  /** Open approvals as their card now reads (the request with its latest stage). */
  private readonly approvals = new Map<string, ApprovalRequested>()
  private readonly questions = new Map<string, QuestionRequested>()
  private readonly deferredQuestions = new Set<string>()
  /** Approvals the host closed: on our terminal decision, or `alreadyTerminal`. */
  private readonly closed = new Set<string>()
  /** Stages a decision was sent for (in flight or accepted), by `stageKey`. */
  private readonly decided = new Set<string>()

  /** An approval request arriving: new, the next stage of one shown, or a repeat. */
  private requested(event: ApprovalRequested): AgentEvent | undefined {
    if (this.closed.has(event.approvalId)) {
      return undefined
    }
    const shown = this.approvals.get(event.approvalId)
    this.approvals.set(event.approvalId, event)
    if (shown === undefined) {
      return event
    }
    if (stageKey(shown.requirementId) === stageKey(event.requirementId)) {
      return undefined
    }
    // A re-issued request for the next stage refreshes the card already shown.
    return {
      type: 'approvalUpdated',
      approvalId: event.approvalId,
      requirementId: event.requirementId,
      subject: event.subject,
      availableChoices: event.availableChoices,
    }
  }

  private updated(event: ApprovalUpdated): AgentEvent | undefined {
    if (this.closed.has(event.approvalId)) {
      return undefined
    }
    const shown = this.approvals.get(event.approvalId)
    if (shown !== undefined) {
      this.approvals.set(event.approvalId, {
        ...shown,
        requirementId: event.requirementId,
        subject: event.subject,
        availableChoices: event.availableChoices,
      })
    }
    return event
  }

  private forget(approvalId: string): void {
    this.approvals.delete(approvalId)
    for (const key of this.decided) {
      if (key.startsWith(`${approvalId}\u{0}`)) {
        this.decided.delete(key)
      }
    }
  }

  /** The host closed this approval; any later stage for it is stale. */
  public close(approvalId: string): void {
    this.closed.add(approvalId)
  }

  public isClosed(approvalId: string): boolean {
    return this.closed.has(approvalId)
  }

  /** An open approval as its card reads now (its current stage and choices); undefined when none. */
  public pending(approvalId: string): ApprovalRequested | undefined {
    return this.closed.has(approvalId) ? undefined : this.approvals.get(approvalId)
  }

  /** Whether a decision was already sent for this stage. */
  public isDecided(requirementId: RequirementRef): boolean {
    return this.decided.has(stageKey(requirementId))
  }

  public markDecided(requirementId: RequirementRef): void {
    this.decided.add(stageKey(requirementId))
  }

  /** The decision did not apply (the host still waits on this stage): it may be made again. */
  public unmarkDecided(requirementId: RequirementRef): void {
    this.decided.delete(stageKey(requirementId))
  }

  /**
   * The card moved to the stage a stale refusal named (MSP's
   * `currentRequirementId`), when Muse Code announces none itself: after an
   * "Always allow" rule, 1.4.2 can resolve the stage it shows by that rule
   * and wait on the next one without an `approval/updated` (captured
   * 2026-10-02). A choice tied to the old stage's rule takes the new stage's
   * label, or goes when that stage suggests no rule. The update is admitted
   * like the host's own (`admit`), which moves the ledger with the card.
   */
  public advanceTo(requirementId: RequirementRef): ApprovalUpdated | undefined {
    const shown = this.approvals.get(requirementId.approvalId)
    if (
      shown === undefined ||
      this.closed.has(requirementId.approvalId) ||
      stageKey(shown.requirementId) === stageKey(requirementId)
    ) {
      return undefined
    }
    const oldLabel = prefixLabel(shown, shown.requirementId.sourceIndex)
    const newLabel = prefixLabel(shown, requirementId.sourceIndex)
    const availableChoices = shown.availableChoices.flatMap((choice) => {
      const isStageRule =
        oldLabel !== undefined && (choice.label === oldLabel || choice.rulePreview === oldLabel)
      if (!isStageRule) {
        return [choice]
      }
      return newLabel === undefined ? [] : [{ ...choice, label: newLabel, rulePreview: newLabel }]
    })
    return {
      type: 'approvalUpdated',
      approvalId: requirementId.approvalId,
      requirementId,
      subject: shown.subject,
      availableChoices,
    }
  }

  /**
   * Open approvals with a stage already decided and the current one not:
   * stopping the turn under one of them leaves Muse Code 1.4.2 unable to run
   * the session again (the `approvalReplay` fault), so a Stop rejects them
   * first.
   */
  public partlyDecided(): readonly ApprovalRequested[] {
    const decidedApprovals = new Set<string>()
    for (const key of this.decided) {
      decidedApprovals.add(key.slice(0, key.indexOf('\u{0}')))
    }
    const waiting: ApprovalRequested[] = []
    for (const approval of this.approvals.values()) {
      if (
        decidedApprovals.has(approval.approvalId) &&
        !this.closed.has(approval.approvalId) &&
        !this.decided.has(stageKey(approval.requirementId))
      ) {
        waiting.push(approval)
      }
    }
    return waiting
  }

  /** The event to show for one arriving from the host, or undefined for a repeat. */
  public admit(event: AgentEvent): AgentEvent | undefined {
    switch (event.type) {
      case 'approvalRequested': {
        return this.requested(event)
      }
      case 'approvalUpdated': {
        return this.updated(event)
      }
      case 'approvalResolved': {
        this.forget(event.approvalId)
        this.closed.delete(event.approvalId)
        return event
      }
      case 'questionRequested': {
        if (this.questions.has(event.userInputId)) {
          return undefined
        }
        this.questions.set(event.userInputId, event)
        return event
      }
      case 'questionSettled': {
        this.questions.delete(event.userInputId)
        const outcome = questionSettlementOutcome(
          event.outcome,
          this.deferredQuestions.delete(event.userInputId),
        )
        return { ...event, outcome }
      }
      default: {
        return event
      }
    }
  }

  /** Reserve the id before dispatch: settlement may precede its command acknowledgement. */
  public markQuestionDeferred(userInputId: string): boolean {
    if (!this.questions.has(userInputId) || this.deferredQuestions.has(userInputId)) return false
    this.deferredQuestions.add(userInputId)
    return true
  }

  /** A proven command refusal admits no deferral. */
  public unmarkQuestionDeferred(userInputId: string): void {
    this.deferredQuestions.delete(userInputId)
  }

  /** The prompts still waiting, as a surface that starts listening now should see them. */
  public open(): readonly AgentEvent[] {
    const waiting: AgentEvent[] = []
    for (const approval of this.approvals.values()) {
      if (!this.closed.has(approval.approvalId)) {
        waiting.push(approval)
      }
    }
    return [...waiting, ...this.questions.values()]
  }
}
