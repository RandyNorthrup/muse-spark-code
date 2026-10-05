// A prompt/agent hook's model call on Muse Code (M91, PLAN.md D70, lane H):
// one turn of a hidden side session on the subscription, like M90's
// reviewer, with a notice saying so. Plan mode, thinking off, on the
// conversation's model, in an empty folder of the extension's own outside
// every workspace, so History never lists it. One session per window,
// reused while its host and model match. Any tool use ends the run:
// the answer is text only, parsed by the caller like a command's.

import { mkdir } from 'node:fs/promises'
import type { AgentHost, AgentSession, TurnSubmission } from '../../core/agent/agentBackend'
import { FifoLimiter } from '../../core/fifoLimiter'
import type { CoreLogger } from '../../core/logging'
import { withDeadline } from '../../core/timeouts'
import type { AgentEvent } from '../../shared/agentEvents'
import { THINKING_OFF_EFFORT, UI_TEXT } from '../../shared/constants'
import { mspApprovalMode } from '../../shared/permissionModes'

/** One hook turn on Muse Code. */
export interface MuseCodeHookModelJob {
  /** The host the conversation's session lives on: the side session joins it. */
  readonly host: AgentHost
  /** The conversation's model: the side session runs on it. */
  readonly modelId: string
  readonly kind: 'prompt' | 'agent'
  readonly system: string
  readonly user: string
  /** The hook's own timeout: the turn never outlives it. */
  readonly timeoutMs: number
  /** Aborted when the hooked run no longer waits on this turn. */
  readonly signal: AbortSignal
}

export interface MuseCodeHookModelDeps {
  /** The empty folder the side session runs in, made when missing. */
  readonly root: string
  readonly log: CoreLogger
  /** Told each side session's id as it starts: no History lists it. */
  readonly onSideSession: (sessionId: string) => void
  /** A failure as the log may name it (never the CLI's own words). */
  readonly describeFailure: (error: unknown) => string
  /** The notice in the main conversation when the first hook turn runs. */
  readonly notify: (text: string) => void
}

const AGENT_MESSAGE = 'agentMessage'
const COMPLETED = 'completed'
// What a hook turn carries without acting (M90's capture): the prompt's own
// echo, reminders, thinking, and the reply. Any other item is the side
// session doing something, and fails closed.
const HOOK_TURN_ITEM_KINDS: ReadonlySet<string> = new Set([
  'userMessage',
  'reminderChild',
  'reasoning',
  AGENT_MESSAGE,
])
const STARTED_DISPOSITION = 'started'
const PLAN_MODE = 'plan'

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

/** The prompt/agent hook turns on Muse Code, one at a time per window. */
export class MuseCodeHookModels {
  private readonly slots = new FifoLimiter(1)
  private hasNoticed = false
  private isDisposed = false
  private readonly closed = new AbortController()
  private side:
    | { readonly host: AgentHost; readonly modelId: string; readonly session: AgentSession }
    | undefined

  public constructor(private readonly deps: MuseCodeHookModelDeps) {}

  private isWanted(job: MuseCodeHookModelJob): boolean {
    return !job.signal.aborted && !this.isDisposed
  }

  private async ask(job: MuseCodeHookModelJob): Promise<string | undefined> {
    const deadline = Date.now() + job.timeoutMs
    const session = await this.start(job, deadline)
    if (session === undefined || !this.isWanted(job) || remaining(deadline) <= 0) {
      if (session !== undefined) {
        this.drop(session, 'the hooked run stopped waiting')
      }
      return undefined
    }
    let submission: TurnSubmission
    const early: AgentEvent[] = []
    const unbuffer = session.onEvent((event) => {
      early.push(event)
    })
    try {
      submission = await withDeadline(
        session.sendTurn([{ type: 'text', text: `${job.system}\n\n${job.user}` }]),
        remaining(deadline),
        'the hook turn was not taken in time',
      )
    } catch (error: unknown) {
      unbuffer()
      // It may still be taken: the session is let go with its turn stopped.
      this.drop(session, 'its turn was not taken', true)
      throw error
    }
    if (submission.disposition !== STARTED_DISPOSITION) {
      unbuffer()
      this.drop(session, `its turn was ${submission.disposition}, not started`)
      return undefined
    }
    const waiting = this.until(session, submission.turnId, deadline, job.signal, early)
    unbuffer()
    const text = await waiting
    if (text === undefined) {
      if (job.signal.aborted) {
        this.drop(session, 'the hooked run stopped waiting', true)
      } else {
        this.drop(session, 'no reply in time', true)
      }
      return undefined
    }
    return text
  }

  private async start(
    job: MuseCodeHookModelJob,
    deadline: number,
  ): Promise<AgentSession | undefined> {
    const side = this.side
    if (side !== undefined) {
      if (side.host === job.host && side.modelId === job.modelId) return side.session
      this.drop(side.session, 'its host or model changed')
    }
    await mkdir(this.deps.root, { recursive: true })
    if (!this.isWanted(job) || remaining(deadline) <= 0) {
      return undefined
    }
    let wasExpired = false
    const create = async () => {
      const session = await job.host.startSession({
        workspaceRoot: this.deps.root,
        modelId: job.modelId,
        approvalMode: mspApprovalMode(PLAN_MODE),
      })
      if (wasExpired || !this.isWanted(job)) session.dispose()
      return session
    }
    const starting = create()
    let session: AgentSession
    try {
      session = await withDeadline(
        starting,
        remaining(deadline),
        'the side session did not start in time',
      )
    } catch (error: unknown) {
      wasExpired = true
      throw error
    }
    this.deps.onSideSession(session.sessionId)
    if (!this.isWanted(job) || remaining(deadline) <= 0) {
      session.dispose()
      return undefined
    }
    try {
      await withDeadline(
        session.setReasoningEffort(THINKING_OFF_EFFORT),
        remaining(deadline),
        'the hook effort was not set in time',
      )
    } catch (error: unknown) {
      session.dispose()
      throw error
    }
    this.deps.log.info(`A hook's side session ${session.sessionId} started on ${job.modelId}`)
    this.side = { host: job.host, modelId: job.modelId, session }
    return session
  }

  /** The turn's reply text, once its turn ends; undefined when it cannot answer. */
  private until(
    session: AgentSession,
    turnId: string,
    deadline: number,
    signal: AbortSignal,
    early: readonly AgentEvent[],
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const replies = new Map<string, string>()
      let ending: string | undefined
      let isUsedTool = false
      let isSettled = false
      const finish = (value: string | undefined) => {
        if (isSettled) {
          return
        }
        isSettled = true
        clearTimeout(timer)
        unsubscribe()
        signal.removeEventListener('abort', stop)
        resolve(isUsedTool ? undefined : value)
      }
      const stop = () => {
        finish(undefined)
      }
      const look = () => {
        if (ending !== undefined) {
          finish(ending === COMPLETED ? replies.get(turnId) : undefined)
        }
      }
      const hear = (event: AgentEvent) => {
        if (
          ['itemStarted', 'itemUpdated', 'itemCompleted'].includes(event.type) &&
          'item' in event &&
          !HOOK_TURN_ITEM_KINDS.has(event.item.kind)
        ) {
          isUsedTool = true
          finish(undefined)
          return
        }
        if (event.type === 'turnCompleted' && event.turnId === turnId) {
          ending = event.terminal
          look()
          return
        }
        if (
          event.type === 'itemCompleted' &&
          event.item.kind === AGENT_MESSAGE &&
          event.item.status === COMPLETED &&
          event.item.turnId === turnId &&
          !replies.has(turnId)
        ) {
          replies.set(turnId, event.item.text ?? '')
        }
      }
      const timer = setTimeout(stop, remaining(deadline))
      const unsubscribe = session.onEvent(hear)
      signal.addEventListener('abort', stop, { once: true })
      for (const event of early) hear(event)
      if (signal.aborted) {
        stop()
      }
    })
  }

  /** Lets a side session go: a turn it may still run stopped first. */
  private drop(session: AgentSession, reason: string, isPossiblyRunning = false): void {
    if (this.side?.session === session) this.side = undefined
    this.deps.log.info(`A hook's side session ${session.sessionId} is let go: ${reason}`)
    if (!isPossiblyRunning) {
      session.dispose()
      return
    }
    void session
      .cancel()
      .catch((error: unknown) => {
        this.deps.log.warn(
          `Stopping a hook's side turn failed: ${this.deps.describeFailure(error)}`,
        )
      })
      .finally(() => {
        session.dispose()
      })
  }

  /**
   * One turn of a hidden side session: the turn's reply text, or undefined
   * when the hook must fail (no reply in time, a tool was used, the turn or
   * the session ended first). Failed turns discard the session.
   */
  public async runHookModelTurn(job: MuseCodeHookModelJob): Promise<string | undefined> {
    if (!this.isWanted(job)) return undefined
    job = { ...job, signal: AbortSignal.any([job.signal, this.closed.signal]) }
    try {
      return await this.slots.run(
        async () => {
          if (!this.isWanted(job)) {
            return
          }
          if (!this.hasNoticed) {
            this.hasNoticed = true
            this.deps.notify(UI_TEXT.hookModelMuseCodeNotice)
          }
          try {
            return await this.ask(job)
          } catch (error: unknown) {
            if (!job.signal.aborted && !this.isDisposed) {
              this.deps.log.warn(
                `A hook could not ask the model; the hook fails: ${this.deps.describeFailure(error)}`,
              )
            }
            return
          }
        },
        () => !job.signal.aborted && !this.isDisposed,
        () => new Error('the hooked run no longer waits on its hook turn'),
      )
    } catch {
      return undefined
    }
  }

  /** The window closed: queued turns end, and running ones are let go. */
  public dispose(): void {
    this.isDisposed = true
    this.closed.abort()
    if (this.side !== undefined) this.drop(this.side.session, 'the window closed', true)
  }
}
