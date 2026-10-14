// One command is asked about once (MUSEPERMS F16): the client's first
// answer to an approval applies to every later stage of that approval and
// to a re-issued approval for the same tool call, and a newer stage never
// opens a second client request while one is still unanswered. Pure: the
// ACP agent (`agent.ts`) sends what these decide.
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk'
import type { ApprovalChoice } from '../shared/agentEvents'
import type { PermissionMode } from '../shared/constants'
import { untrustedStartMode } from '../shared/permissionModes'

/** What the client answered for a tool call: the meaning, never the choice id. */
interface ApprovalAnswer {
  readonly decision: string
  readonly scope: string
}

function answerOf(choice: ApprovalChoice): ApprovalAnswer {
  return { decision: choice.decision, scope: choice.scope }
}

interface ApprovalPrompt {
  readonly approvalId: string
  readonly itemId?: string | undefined
  readonly availableChoices: readonly ApprovalChoice[]
}

/** The choice carrying the remembered answer's meaning, when still offered. */
function matchingChoice(
  available: readonly ApprovalChoice[],
  answer: ApprovalAnswer,
): ApprovalChoice | undefined {
  // Matched by meaning, not by id: the CLI mints new choice ids per stage.
  // Never escalated: an allow-once answer never becomes an allow-always rule.
  return available.find(
    (choice) => choice.decision === answer.decision && choice.scope === answer.scope,
  )
}

/**
 * The choice the client's answer settles on the latest stage: the picked
 * answer's meaning where the latest stage still offers it. Undefined when
 * the client cancelled or the meaning is gone there; the caller then falls
 * back to the denial default (`decidedChoice`), never to a guess.
 */
export function answerChoice(
  response: RequestPermissionResponse | undefined,
  asked: readonly ApprovalChoice[],
  latest: readonly ApprovalChoice[],
): ApprovalChoice | undefined {
  const outcome = response?.outcome
  if (outcome?.outcome !== 'selected') {
    return undefined
  }
  const picked = asked.find((choice) => choice.choiceId === outcome.optionId)
  return picked === undefined ? undefined : matchingChoice(latest, answerOf(picked))
}

/**
 * The mode a loaded or resumed session runs under: the one the client set
 * before (`session/set_mode` survives a later load), else the initial mode,
 * still opening untrusted content in an asking mode.
 */
export function adoptedMode(
  remembered: PermissionMode | undefined,
  initial: PermissionMode,
  isImported: boolean,
): PermissionMode {
  if (remembered !== undefined) {
    return remembered
  }
  return isImported ? untrustedStartMode(initial, initial) : initial
}

/** What the client already answered, so a repeated request is never sent again. */
export class ApprovalAnswers {
  private readonly byApproval = new Map<string, ApprovalAnswer>()
  private readonly byItem = new Map<string, ApprovalAnswer>()
  private readonly claimed = new Set<string>()

  /** The remembered answer's choice in this event, when still offered: decide it, ask nothing. */
  public reuse(event: ApprovalPrompt): ApprovalChoice | undefined {
    const remembered =
      this.byApproval.get(event.approvalId) ??
      (event.itemId === undefined ? undefined : this.byItem.get(event.itemId))
    return remembered === undefined ? undefined : matchingChoice(event.availableChoices, remembered)
  }

  /**
   * Take the single ask turn for an approval; false while one is already
   * open for it. Synchronous, so two events racing for one approval still
   * send one client request.
   */
  public claim(approvalId: string): boolean {
    if (this.claimed.has(approvalId)) {
      return false
    }
    this.claimed.add(approvalId)
    return true
  }

  /** Give the ask turn back; idempotent. */
  public release(approvalId: string): void {
    this.claimed.delete(approvalId)
  }

  /** Keep the client's answer for the approval and its tool call. */
  public remember(approvalId: string, itemId: string, choice: ApprovalChoice): void {
    const answer = answerOf(choice)
    this.byApproval.set(approvalId, answer)
    this.byItem.set(itemId, answer)
  }

  /** The approval settled: its id is free, while its tool call keeps its answer. */
  public resolved(approvalId: string): void {
    this.claimed.delete(approvalId)
    this.byApproval.delete(approvalId)
  }
}
