// Which approvals and questions a Muse Code session has put on screen
// (PLAN.md D26). The host announces a live prompt twice, as the
// `approval/requested` / `userInput/requested` notification and as its
// `approval/request` / `userInput/request` server-request mirror, and again
// after every `session/resume` (the re-issued server request), while a
// decision the host acknowledged as terminal can still be followed by one
// trailing stage update (the SDK facade's #37538 note). The ledger lets one
// card through per prompt and per stage, none once the approval closed, and
// keeps the open ones so a surface that starts listening late sees them too.

import type { AgentEvent } from '../../../shared/agentEvents'

type ApprovalRequested = Extract<AgentEvent, { type: 'approvalRequested' }>
type QuestionRequested = Extract<AgentEvent, { type: 'questionRequested' }>

function stageKey(requirementId: ApprovalRequested['requirementId']): string {
  return `${requirementId.approvalId}\u{0}${String(requirementId.sourceIndex)}`
}

export class PromptLedger {
  /** Open approvals as their card now reads (the request with its latest stage). */
  private readonly approvals = new Map<string, ApprovalRequested>()
  private readonly questions = new Map<string, QuestionRequested>()
  /** Approvals the host closed: on our terminal decision, or `alreadyTerminal`. */
  private readonly closed = new Set<string>()

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

  private updated(event: Extract<AgentEvent, { type: 'approvalUpdated' }>): AgentEvent | undefined {
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

  /** The host closed this approval; any later stage for it is stale. */
  public close(approvalId: string): void {
    this.closed.add(approvalId)
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
        this.approvals.delete(event.approvalId)
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
        return event
      }
      default: {
        return event
      }
    }
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
