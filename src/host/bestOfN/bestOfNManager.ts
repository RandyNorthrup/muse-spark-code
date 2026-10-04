// Best-of-N's host side (M77, PLAN.md D49): each attempt runs a Model API
// conversation of its own, rooted in its worktree, through the core
// `WorktreeConversationHost` (the ceiling, the declines, the confinement)
// and the core `BestOfNRunner` (the one popup, the fan-out, the take).
//
// An attempt's host is built for its worktree and nothing else: no durable
// session store, no schedules, no MCP servers, no hooks, no memory and no
// paid tools. Its turns bill the Model API key like any Model API turn; a
// nested paid use is refused by the host itself, so no popup can interrupt
// the run, and the subscription never pays (Muse Code never runs attempts).

import { randomUUID } from 'node:crypto'
import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import type { ResponseAttemptGuard } from '../../core/backends/modelapi/client'
import type { OwnedSessionBudgetScope } from '../../core/backends/modelapi/sessionBudget'
import type { BestOfNCoordinator } from '../../core/bestOfN/bestOfNCoordinator'
import { confineWorkspacePath } from '../../core/workspacePath'
import { isProtectedPath } from '../../core/protectedPaths'
import { pathModule } from '../../core/workspaceRoot'
import {
  BestOfNRunner,
  type BestOfNAttemptDriver,
  type BestOfNAttemptStart,
  type BestOfNGitGuard,
  type BestOfNRunnerDeps,
  type BestOfNStart,
} from '../../core/bestOfN/bestOfNRunner'
import {
  WorktreeConversationHost,
  type WorktreeSession,
  type WorktreeSessionEvent,
} from '../../core/bestOfN/worktreeConversationHost'
import {
  type AgentEvent,
  requirementRefSchema,
  type RequirementRef,
} from '../../shared/agentEvents'
import type { BestOfNRun } from '../../shared/bestOfN'
import type { SubagentUsage } from '../../shared/paid'
import type { Logger } from '../logger'

export interface BestOfNManagerDeps extends Pick<
  BestOfNRunnerDeps,
  'isBestOfNOn' | 'allowsPaidUse' | 'notePaidUse' | 'noteAttemptRequest' | 'noteAttemptUsage'
> {
  readonly coordinator: BestOfNCoordinator
  readonly getAccountId: () => Promise<string | undefined>
  readonly getBudgetScope?: () => Promise<OwnedSessionBudgetScope | undefined>
  readonly hasDirtyEditors: () => boolean
  readonly contextId: () => string
  readonly openWorktree: (absolutePath: string) => Promise<void>
  /** Tests supply deterministic branch names; production uses randomUUID. */
  readonly newRunId?: () => string
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs?: number,
    input?: string,
    beforeRun?: BestOfNGitGuard,
  ) => Promise<string>
  readonly repositoryRoot: () => string | undefined
  readonly platform: NodeJS.Platform
  /** A Model API host rooted in the worktree, with no store or tools beyond files. */
  readonly buildAttemptHost: (
    worktreeRoot: string,
    admitRequest: ResponseAttemptGuard,
    noteUsage: (modelId: string, usage: SubagentUsage) => void,
    budgetScope: OwnedSessionBudgetScope | undefined,
  ) => Promise<AgentHost>
  /** The attempt conversations' model: the originating surface's. */
  readonly modelId: () => string
  /** The originating conversation's wire approval mode. */
  readonly wireApprovalMode: () => string
  readonly isTrusted: () => boolean
  /** The file system's canonical read, for the worktree confinement. */
  readonly realPath: (absolutePath: string) => Promise<string>
  readonly onUpdate: (run: BestOfNRun) => void
  readonly log: Logger
}

const ABORT_CHOICE_ID = 'abort'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pathIdentity(path: string, platform: NodeJS.Platform): string {
  const absolute = pathModule(platform).resolve(path)
  return platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** The session as the core worktree host drives it: events in, declines out. */
class AttemptSession implements WorktreeSession {
  private listener: ((event: WorktreeSessionEvent) => void) | undefined

  public constructor(
    private readonly session: AgentSession,
    private readonly onTerminal: () => void,
  ) {}

  public get sessionId(): string {
    return this.session.sessionId
  }

  public onEvent(listener: (event: WorktreeSessionEvent) => void): () => void {
    this.listener = listener
    return this.session.onEvent((event: AgentEvent) => {
      const target = this.listener
      if (target === undefined) {
        return
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
      throw new Error('A best-of-N decline carried no requirement')
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

/** One attempt's driver: the conversation runs; the runner hears its events. */
class AttemptDriver implements BestOfNAttemptDriver {
  private host: AgentHost | undefined
  private session: AgentSession | undefined
  private requestsMade = 0
  private ceilingReached = false
  private isDisposed = false
  private startedSessionId: string | undefined
  private closing: Promise<void> | undefined

  public constructor(
    private readonly attempt: BestOfNAttemptStart,
    private readonly deps: BestOfNManagerDeps,
  ) {}

  private shutdown(): void {
    const { session, host } = this
    this.session = undefined
    this.host = undefined
    try {
      if (host === undefined) session?.dispose()
      else
        void session?.cancel().catch(() => {
          this.deps.log.warn('A best-of-N attempt cancellation settled elsewhere')
        })
    } catch {
      this.deps.log.warn('A best-of-N attempt session was already gone')
    }
    if (host === undefined) {
      return
    }

    this.closing = host.close()
    void this.closing.catch(() => {
      this.deps.log.warn('A best-of-N attempt host was already gone')
    })
  }

  private async runConversation(): Promise<void> {
    const session = this.session
    if (session === undefined) {
      throw new Error('A best-of-N attempt has no session to run')
    }
    const conversation = new WorktreeConversationHost({
      worktreeRoot: this.attempt.worktreePath,
      platform: this.deps.platform,
      io: { realPath: this.deps.realPath },
      requestCeiling: this.attempt.requestCeilingPerAttempt,
      admissionCounts: () => ({
        requestsMade: this.requestsMade,
        ceilingReached: this.ceilingReached,
      }),
      session: new AttemptSession(session, () => {
        this.shutdown()
      }),
      declineChoiceId: ABORT_CHOICE_ID,
      onProgress: (progress) => {
        if (progress.type === 'requestCompleted') {
          this.attempt.onEvent({
            type: 'requestCompleted',
            requestsMade: progress.requestsMade,
          })
        } else {
          this.attempt.onEvent({ type: 'approvalDenied' })
        }
      },
      log: this.deps.log,
    })
    try {
      const outcome = await conversation.run(this.attempt.prompt, this.deps.isTrusted())
      await this.closing
      this.attempt.onEvent({
        type: 'completed',
        requestsMade: outcome.requestsMade,
        ceilingReached: outcome.ceilingReached,
        approvalsDenied: outcome.approvalsDenied,
        terminal: outcome.terminal,
        ...(outcome.reason !== undefined && { reason: outcome.reason }),
      })
    } catch (error: unknown) {
      this.attempt.onEvent({ type: 'failed', reason: describe(error) })
    }
  }

  public get sessionId(): string | undefined {
    return this.startedSessionId
  }

  /**
   * Starts the session, then runs its conversation in the background: the
   * runner marks the attempt running once this resolves, while the turn
   * itself finishes through `onEvent`.
   */
  public async start(): Promise<void> {
    try {
      this.attempt.signal.throwIfAborted()
      const host = await this.deps.buildAttemptHost(
        this.attempt.worktreePath,
        Object.assign(
          (keyDigest: string | undefined) => {
            this.attempt.signal.throwIfAborted()
            try {
              this.attempt.admitRequest(keyDigest)
            } catch (error: unknown) {
              this.ceilingReached = this.requestsMade >= this.attempt.requestCeilingPerAttempt
              throw error
            }
          },
          {
            onRequestStarted: () => {
              this.attempt.admitRequest.onRequestStarted?.()
              this.requestsMade += 1
            },
          },
        ),
        (modelId, usage) => {
          if (!this.isDisposed && !this.attempt.signal.aborted)
            this.attempt.noteUsage(modelId, usage)
        },
        this.attempt.budgetScope,
      )
      this.host = host
      if (this.isDisposed) {
        throw new Error('A best-of-N attempt was disposed while starting')
      }
      this.attempt.signal.throwIfAborted()
      const session = await host.startSession({
        workspaceRoot: this.attempt.worktreePath,
        modelId: this.attempt.modelId,
        approvalMode: this.attempt.approvalMode,
      })
      this.session = session
      this.startedSessionId = session.sessionId
      this.attempt.signal.throwIfAborted()
    } catch (error: unknown) {
      this.shutdown()
      throw error
    }
    void this.runConversation().catch((error: unknown) => {
      this.deps.log.warn(`A best-of-N attempt never ran: ${describe(error)}`)
      this.shutdown()
      this.attempt.onEvent({ type: 'failed', reason: describe(error) })
    })
  }

  public async cancel(): Promise<void> {
    await this.session?.cancel()
  }

  public dispose(): void {
    this.isDisposed = true
    this.shutdown()
  }
}

/**
 * The window's best-of-N runs: one live run at a time, driven through the
 * core runner, with attempt conversations on worktree-rooted Model API
 * hosts. The controller posts every `onUpdate` run to its surface.
 */
export class BestOfNManager {
  private readonly runner: BestOfNRunner
  private backendKind: 'museCode' | 'modelApi' = 'modelApi'

  public constructor(private readonly deps: BestOfNManagerDeps) {
    const runnerDeps: BestOfNRunnerDeps = {
      newRunId: deps.newRunId ?? (() => `bon-${randomUUID()}`),
      coordinator: deps.coordinator,
      openAttempt: async (attemptId, runId) => {
        await this.open(attemptId, runId)
      },
      getAccountId: deps.getAccountId,
      ...(deps.getBudgetScope !== undefined && { getBudgetScope: deps.getBudgetScope }),
      hasDirtyEditors: deps.hasDirtyEditors,
      validatePaths: async (root, files) => {
        for (const file of files) {
          if (file.includes('\0') || file.startsWith(':') || file.includes('\\')) {
            throw new Error('A best-of-N snapshot contained an unsafe Git path')
          }
          const path = await confineWorkspacePath(root, file, deps.platform, {
            realPath: deps.realPath,
          })
          if (
            !path.ok ||
            isProtectedPath(path.relative) ||
            isProtectedPath(path.canonical) ||
            path.relative !== path.canonical
          ) {
            throw new Error('A best-of-N snapshot cannot apply to a protected or linked path')
          }
        }
      },
      validateWorktree: async (root) => {
        const real = await deps.realPath(root)
        if (pathIdentity(real, deps.platform) !== pathIdentity(root, deps.platform)) {
          throw new Error('A best-of-N worktree was retargeted through a link')
        }
      },
      realPath: deps.realPath,
      isTrusted: deps.isTrusted,
      backendKind: () => this.backendKind,
      isBestOfNOn: deps.isBestOfNOn,
      allowsPaidUse: deps.allowsPaidUse,
      notePaidUse: deps.notePaidUse,
      ...(deps.noteAttemptRequest !== undefined && { noteAttemptRequest: deps.noteAttemptRequest }),
      ...(deps.noteAttemptUsage !== undefined && { noteAttemptUsage: deps.noteAttemptUsage }),
      runGit: (args, cwd, input, beforeRun) => deps.runGit(args, cwd, undefined, input, beforeRun),
      repositoryRoot: deps.repositoryRoot,
      platform: deps.platform,
      startAttempt: async (start) => {
        const driver = new AttemptDriver(start, this.deps)
        await driver.start()
        return driver
      },
      onUpdate: deps.onUpdate,
      log: deps.log,
    }
    this.runner = new BestOfNRunner(runnerDeps)
  }

  /** Starts a run on the given backend; anything but the Model API is refused. */
  public async start(
    request: Omit<BestOfNStart, 'modelId' | 'approvalMode' | 'isCurrent'>,
    backendKind: 'museCode' | 'modelApi',
  ): Promise<BestOfNRun> {
    this.backendKind = backendKind
    const contextId = this.deps.contextId()
    const modelId = this.deps.modelId()
    const approvalMode = this.deps.wireApprovalMode()
    return await this.runner.start({
      ...request,
      modelId,
      approvalMode,
      isCurrent: () =>
        this.deps.contextId() === contextId &&
        this.deps.modelId() === modelId &&
        this.deps.wireApprovalMode() === approvalMode,
    })
  }

  public async take(
    attemptId: string,
    runId?: string,
    beginWorkspaceEdits?: Parameters<BestOfNRunner['take']>[2],
  ): Promise<BestOfNRun> {
    return await this.runner.take(attemptId, runId, beginWorkspaceEdits)
  }

  public async cancel(runId?: string): Promise<BestOfNRun> {
    return await this.runner.cancel(runId)
  }

  public async open(attemptId: string, runId: string): Promise<void> {
    const root = await this.runner.worktreePathOf(attemptId, runId)
    const real = await this.deps.realPath(root)
    if (pathIdentity(real, this.deps.platform) !== pathIdentity(root, this.deps.platform)) {
      throw new Error('A best-of-N worktree was retargeted through a link')
    }
    await this.runner.worktreePathOf(attemptId, runId)
    await this.deps.openWorktree(root)
  }

  public dispose(): void {
    this.runner.dispose()
  }
}
