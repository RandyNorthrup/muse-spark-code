// One conversation rooted in one worktree (M77, PLAN.md D49): every path
// resolves inside the worktree, every model request counts against the
// attempt's ceiling, and nothing asks the user, because no surface can.
//
// Best-of-N drives its attempts through this; M71 reuses it for its
// conversation in a worktree. The inner session is backend-agnostic (the
// narrow `WorktreeSession` surface): the host adapts its `AgentSession` to
// it, mapping the backend's per-request signal to `modelRequestCompleted`.
//
// No `vscode` here: the host injects the session and the file-system read.

import {
  BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT,
  BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT,
} from '../../shared/constants'
import type { CoreLogger } from '../logging'
import { confineWorkspacePath, type RealPathIo } from '../workspacePath'

/** The events the host forwards from its session while the turn runs. */
/** One model request finished (the Model API: one `tokenUsage` emission). */
export type WorktreeSessionEvent =
  | { readonly type: 'turnStarted'; readonly turnId: string }
  | {
      readonly type: 'turnCompleted'
      readonly turnId: string
      readonly terminal: string
      readonly reason?: string
    }
  | { readonly type: 'modelRequestCompleted' }
  | {
      readonly type: 'approvalRequested'
      readonly approvalId: string
      readonly requirementId: unknown
    }
  | { readonly type: 'questionRequested'; readonly userInputId: string }

export interface WorktreeApprovalDecision {
  readonly approvalId: string
  readonly choiceId: string
  readonly requirementId: unknown
}

/** The narrow session surface an attempt needs: any backend adapts to it. */
export interface WorktreeSession {
  readonly sessionId: string
  onEvent(listener: (event: WorktreeSessionEvent) => void): () => void
  sendTurn(parts: readonly [{ readonly type: 'text'; readonly text: string }]): Promise<unknown>
  decideApproval(decision: WorktreeApprovalDecision): Promise<void>
  cancelQuestions(userInputId: string): Promise<void>
  cancel(): Promise<void>
}

/** What one attempt did: the run records it on the attempt. */
export interface WorktreeAttemptOutcome {
  readonly turnId: string
  readonly terminal: string
  readonly reason?: string
  readonly requestsMade: number
  /** True when the ceiling, not the model, ended the attempt. */
  readonly ceilingReached: boolean
  /** Approval cards and questions declined: no surface could ask. */
  readonly approvalsDenied: number
}

/** Live progress while the turn runs; the final totals come with the outcome. */
export type WorktreeProgressEvent =
  | { readonly type: 'requestCompleted'; readonly requestsMade: number }
  | { readonly type: 'approvalDenied' }

export interface WorktreeConversationDeps {
  /** The attempt's worktree folder: every path must stay inside it. */
  readonly worktreeRoot: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  /** The attempt's request ceiling, inside the best-of-N bounds. */
  readonly requestCeiling: number
  readonly session: WorktreeSession
  /** The choice id that declines an approval on this backend (`abort`). */
  readonly declineChoiceId: string
  readonly onProgress?: (event: WorktreeProgressEvent) => void
  /** Best-of-N counts admitted HTTP tries, not token-usage replies. */
  readonly admissionCounts?: () => {
    readonly requestsMade: number
    readonly ceilingReached: boolean
  }
  readonly log: CoreLogger
}

/** The workspace is untrusted: git and the shell are forbidden (D13, D24). */
export class WorktreeUntrustedError extends Error {
  public constructor() {
    super('A worktree conversation needs a trusted workspace')
    this.name = 'WorktreeUntrustedError'
  }
}

/** A path the conversation named that leaves its worktree. */
export class WorktreeConfinementError extends Error {
  public constructor(readonly path: string) {
    super(`Refused path outside the worktree: ${path}`)
    this.name = 'WorktreeConfinementError'
  }
}

/** The ceiling is outside the best-of-N bounds: the run never starts. */
export class WorktreeCeilingError extends Error {
  public constructor(readonly ceiling: number) {
    super(`Refused best-of-N request ceiling ${String(ceiling)}`)
    this.name = 'WorktreeCeilingError'
  }
}

const noListener = (): void => undefined

/**
 * A conversation confined to its worktree. `requireTrusted` throws in
 * Restricted Mode before anything runs; `run` sends the prompt, declines
 * every approval and question (counted), and cancels the turn once the
 * ceiling's requests have completed.
 */
export class WorktreeConversationHost {
  public constructor(private readonly deps: WorktreeConversationDeps) {}

  private ceiling(): number {
    const { requestCeiling } = this.deps
    if (
      !Number.isSafeInteger(requestCeiling) ||
      requestCeiling < BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT ||
      requestCeiling > BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT
    ) {
      throw new WorktreeCeilingError(requestCeiling)
    }
    return requestCeiling
  }

  /** Throws in Restricted Mode: worktrees need git (M77, D49). */
  public requireTrusted(isTrusted: boolean): void {
    if (!isTrusted) {
      throw new WorktreeUntrustedError()
    }
  }

  /** The absolute path, or a `WorktreeConfinementError` when it escapes. */
  public async resolvePath(candidate: string): Promise<string> {
    const confined = await confineWorkspacePath(
      this.deps.worktreeRoot,
      candidate,
      this.deps.platform,
      this.deps.io,
    )
    if (!confined.ok) {
      throw new WorktreeConfinementError(candidate)
    }
    return confined.absolute
  }

  public async run(prompt: string, isTrusted: boolean): Promise<WorktreeAttemptOutcome> {
    this.requireTrusted(isTrusted)
    const ceiling = this.ceiling()
    const { session, log } = this.deps
    let requestsMade = 0
    let approvalsDenied = 0
    let isCeilingReached = false
    const noticed: Promise<unknown>[] = []
    // A decline can race the backend settling the prompt itself (D26):
    // the outcome stands either way, and the race is logged, not thrown.
    const settle = (work: Promise<unknown>, what: string): void => {
      noticed.push(
        (async () => {
          try {
            await work
          } catch {
            // Fixed words only: a backend's refusal can carry its own text.
            log.warn(`A worktree conversation's ${what} settled elsewhere`)
          }
        })(),
      )
    }
    let stopListening: () => void = noListener
    const done = new Promise<WorktreeAttemptOutcome>((resolve) => {
      stopListening = session.onEvent((event) => {
        switch (event.type) {
          case 'turnStarted': {
            break
          }
          case 'modelRequestCompleted': {
            if (this.deps.admissionCounts !== undefined) {
              break
            }
            requestsMade += 1
            this.deps.onProgress?.({ type: 'requestCompleted', requestsMade })
            if (!isCeilingReached && requestsMade >= ceiling) {
              isCeilingReached = true
              settle(session.cancel(), 'ceiling cancel')
            }
            break
          }
          case 'approvalRequested': {
            approvalsDenied += 1
            this.deps.onProgress?.({ type: 'approvalDenied' })
            settle(
              session.decideApproval({
                approvalId: event.approvalId,
                choiceId: this.deps.declineChoiceId,
                requirementId: event.requirementId,
              }),
              `decline of approval ${event.approvalId}`,
            )
            break
          }
          case 'questionRequested': {
            approvalsDenied += 1
            this.deps.onProgress?.({ type: 'approvalDenied' })
            settle(session.cancelQuestions(event.userInputId), 'question decline')
            break
          }
          case 'turnCompleted': {
            stopListening()
            resolve({
              turnId: event.turnId,
              terminal: event.terminal,
              ...(event.reason !== undefined && { reason: event.reason }),
              ...(this.deps.admissionCounts?.() ?? {
                requestsMade,
                ceilingReached: isCeilingReached,
              }),
              approvalsDenied,
            })
            break
          }
        }
      })
    })
    try {
      await session.sendTurn([{ type: 'text', text: prompt }])
    } catch (error: unknown) {
      stopListening()
      throw error
    }
    const outcome = await done
    await Promise.all(noticed)
    if (outcome.turnId === '') {
      throw new Error('The worktree conversation ended without a turn')
    }
    return outcome
  }
}
