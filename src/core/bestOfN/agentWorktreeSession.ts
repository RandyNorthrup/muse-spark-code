// An agent session as a worktree-confined conversation drives it (M77's
// best-of-N attempts, M96's engine workers): events in, declines out. Backend
// agnostic: it adapts any `AgentSession` to the narrow `WorktreeSession`.

import type { AgentSession } from '../agent/agentBackend'
import {
  type AgentEvent,
  requirementRefSchema,
  type RequirementRef,
} from '../../shared/agentEvents'
import type { WorktreeSession, WorktreeSessionEvent } from './worktreeConversationHost'

/** The session as the core worktree host drives it: events in, declines out. */
export class AgentWorktreeSession implements WorktreeSession {
  private listener: ((event: WorktreeSessionEvent) => void) | undefined
  /** The last agent message's text: a worker's report when it made no `report` call (M96). */
  private lastText: string | undefined

  public constructor(
    private readonly session: AgentSession,
    private readonly onTerminal: () => void,
  ) {}

  public get sessionId(): string {
    return this.session.sessionId
  }

  public setModelCallAllowance(remaining: (() => number) | undefined): void {
    this.session.setModelCallAllowance(remaining)
  }

  public onEvent(listener: (event: WorktreeSessionEvent) => void): () => void {
    this.listener = listener
    return this.session.onEvent((event: AgentEvent) => {
      const target = this.listener
      if (target === undefined) {
        return
      }
      if (
        event.type === 'itemCompleted' &&
        event.item.kind === 'agentMessage' &&
        event.item.text !== undefined
      ) {
        this.lastText = event.item.text
      }
      switch (event.type) {
        case 'turnStarted': {
          target({ type: 'turnStarted', turnId: event.turnId })
          break
        }
        case 'tokenUsage': {
          target({ type: 'modelRequestCompleted' })
          break
        }
        case 'approvalRequested': {
          target({
            type: 'approvalRequested',
            approvalId: event.approvalId,
            requirementId: event.requirementId,
          })
          break
        }
        case 'questionRequested': {
          target({ type: 'questionRequested', userInputId: event.userInputId })
          break
        }
        case 'turnCompleted': {
          target({
            type: 'turnCompleted',
            turnId: event.turnId,
            terminal: event.terminal,
            ...(event.reason !== undefined && { reason: event.reason }),
            ...(event.errorKind !== undefined && { errorKind: event.errorKind }),
            ...(event.retryable !== undefined && { retryable: event.retryable }),
          })
          // Stop goals/background work synchronously before the runner's
          // asynchronous index capture can observe more attempt writes.
          this.onTerminal()
          break
        }
        default: {
          break
        }
      }
    })
  }

  /** The last agent message's text, or undefined before one completes. */
  public lastMessage(): string | undefined {
    return this.lastText
  }

  public async sendTurn(
    parts: readonly [{ readonly type: 'text'; readonly text: string }],
  ): Promise<unknown> {
    return await this.session.sendTurn(parts)
  }

  public async decideApproval(decision: {
    readonly approvalId: string
    readonly choiceId: string
    readonly requirementId: unknown
  }): Promise<void> {
    const requirement = requirementRefSchema.safeParse(decision.requirementId)
    if (!requirement.success) {
      throw new Error('A worktree decline carried no requirement')
    }
    const requirementId: RequirementRef = requirement.data
    await this.session.decideApproval({
      approvalId: decision.approvalId,
      choiceId: decision.choiceId,
      requirementId,
    })
  }

  public async cancelQuestions(userInputId: string): Promise<void> {
    await this.session.cancelQuestions(userInputId)
  }

  public async cancel(): Promise<void> {
    await this.session.cancel()
  }
}
