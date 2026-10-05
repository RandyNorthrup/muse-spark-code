// The same-model judge on Muse Code (M98 lane S, PLAN.md D77): the host
// adapter that judges one held action in a fresh hidden session per batch —
// never M90's reviewer session, never the main session, never a fork or
// resume of it. Before each batch it reads the CLI's user-level settings and
// stays off on standing always-allow rules; it starts `session/start` in the
// same `muse serve` on the conversation's model, in a new empty temporary
// folder deleted after the batch, in Plan mode with no MCP servers, and sends
// the judged text fenced as data in a standalone prompt. M90's item guard
// cancels the session on any tool item: it reacts after the CLI's
// notification, so it cannot prove that no command ran (the narrowed claim).
// The judge runs in the background and is never awaited. No `vscode` import.

import type { AgentSession, StartSessionOptions, TurnPart } from '../../core/agent/agentBackend'
import { type JudgeQuestion } from '../../core/judge/judge'
import type { AgentEvent } from '../../shared/agentEvents'
import { THINKING_OFF_EFFORT } from '../../shared/constants'
import { checkStandingAllowRules } from '../../core/judge/same/allowRules'
import { settleBatch } from '../../core/judge/same/answers'
import {
  commitSettledAnswers,
  judgeHeldAction,
  type PlannedJudgeBatch,
  type SameJudgeRunnerDeps,
} from '../../core/judge/same/batches'
import { isJudgeTurnItemAllowed, judgeSessionOptions } from '../../core/judge/same/sessionSpec'
import { judgeStandaloneTurn } from '../../core/judge/same/wording'

export interface MuseCodeJudgeDeps extends SameJudgeRunnerDeps {
  /** `host.startSession`: the side session joins the conversation's host. */
  readonly startSession: (options: StartSessionOptions) => Promise<AgentSession>
  /** The CLI's user-level settings text, undefined when the file is missing. */
  readonly readSettingsText: () => string | undefined
  /** A new empty temporary folder per batch; the session's workspace root. */
  readonly makeTempRoot: () => Promise<string>
  /** Removes the batch's folder after, even on failure. */
  readonly removeTempRoot: (root: string) => Promise<void>
  /** Told each side session's id as it starts: no History lists it. */
  readonly onSideSession: (sessionId: string) => void
  /** A failure as the log may name it (never the CLI's own words). */
  readonly describeFailure: (error: unknown) => string
  readonly logInfo: (message: string) => void
  readonly logWarn: (message: string) => void
}

/** One held action to judge: its latch entry plus the judged state. */
export interface MuseCodeJudgeJob {
  /** Lane J's exact-action entry key (lane U created the entry). */
  readonly entryKey: string
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
}

const STARTED_DISPOSITION = 'started'
const COMPLETED_TERMINAL = 'completed'
const COMPLETED_STATUS = 'completed'
const AGENT_MESSAGE = 'agentMessage'

/** What one batch turn said: its first completed reply and how it ended. */
interface TrackedTurn {
  reply: string | undefined
  terminal: string | undefined
  /** The M90 item guard tripped: a tool item ran in this turn. */
  tripped: boolean
}

/**
 * Track every turn of the batch session from its start (attached before the
 * turn is sent, so no frame is missed): the first completed reply per turn,
 * each turn's terminal, and the item guard's trip.
 */
function trackBatchTurns(session: AgentSession): {
  readonly turns: Map<string, TrackedTurn>
  readonly stop: () => void
} {
  const turns = new Map<string, TrackedTurn>()
  const at = (turnId: string): TrackedTurn => {
    const known = turns.get(turnId)
    if (known !== undefined) {
      return known
    }
    const fresh: TrackedTurn = { reply: undefined, terminal: undefined, tripped: false }
    turns.set(turnId, fresh)
    return fresh
  }
  const stop = session.onEvent((event: AgentEvent) => {
    if (event.type === 'itemCompleted' && event.item.turnId !== undefined) {
      const tracked = at(event.item.turnId)
      if (!isJudgeTurnItemAllowed(event.item.kind)) {
        tracked.tripped = true
        return
      }
      if (
        tracked.reply === undefined &&
        event.item.kind === AGENT_MESSAGE &&
        event.item.status === COMPLETED_STATUS
      ) {
        tracked.reply = event.item.text ?? ''
      }
      return
    }
    if (event.type === 'turnCompleted') {
      at(event.turnId).terminal = event.terminal
    }
  })
  return { turns, stop }
}

/**
 * The turn's first completed reply, once its turn ends as completed:
 * undefined when the turn tripped the item guard, ended otherwise, or the
 * wait was aborted first.
 */
function awaitBatchReply(
  session: AgentSession,
  turns: Map<string, TrackedTurn>,
  turnId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let isSettled = false
    const finish = (value: string | undefined): void => {
      if (isSettled) {
        return
      }
      isSettled = true
      signal.removeEventListener('abort', stop)
      wake()
      resolve(value)
    }
    const stop = (): void => {
      finish(undefined)
    }
    const look = (): void => {
      const tracked = turns.get(turnId)
      if (tracked === undefined) {
        return
      }
      if (tracked.tripped) {
        finish(undefined)
      } else if (tracked.terminal !== undefined) {
        finish(tracked.terminal === COMPLETED_TERMINAL ? tracked.reply : undefined)
      }
    }
    // The tracker above already holds every frame; this listener only wakes
    // the wait when a later frame lands.
    const wake = session.onEvent(() => {
      look()
    })
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) {
      stop()
      return
    }
    look()
  })
}

export class MuseCodeSameJudge {
  public constructor(private readonly deps: MuseCodeJudgeDeps) {}

  private async runBatch(
    job: MuseCodeJudgeJob,
    batch: PlannedJudgeBatch,
    signal: AbortSignal,
    tuning: { advisoryThreshold: number },
  ): Promise<void> {
    const failed = (why: string): void => {
      this.deps.entries.settle(job.entryKey, 'failed')
      this.deps.logWarn(`The Muse Code judge batch failed: ${why}`)
    }
    // The user-settings allow-rule check runs before each batch: a rule that
    // lands while earlier batches run stops the later ones.
    const allowed = checkStandingAllowRules(this.deps.readSettingsText())
    if (!allowed.allowed) {
      failed(allowed.reason)
      return
    }
    let root: string
    try {
      root = await this.deps.makeTempRoot()
    } catch (error: unknown) {
      // No folder, no session: settle once and let the background runner
      // report the throw once through onError.
      this.deps.entries.settle(job.entryKey, 'failed')
      throw error
    }
    let session: AgentSession | undefined
    try {
      if (signal.aborted) {
        failed('the approval stopped waiting')
        return
      }
      session = await this.deps.startSession(judgeSessionOptions(this.deps.modelId, root))
      this.deps.onSideSession(session.sessionId)
      // Tracked before the turn is sent, so no frame is missed.
      const tracked = trackBatchTurns(session)
      try {
        await session.setReasoningEffort(THINKING_OFF_EFFORT)
        const parts: readonly TurnPart[] = [{ type: 'text', text: judgeStandaloneTurn(batch.user) }]
        const submission = await session.sendTurn(parts)
        if (submission.disposition !== STARTED_DISPOSITION) {
          failed(`its turn was ${submission.disposition}, not started`)
          return
        }
        const reply = await awaitBatchReply(session, tracked.turns, submission.turnId, signal)
        if (reply === undefined) {
          failed('no completed reply in time')
          return
        }
        const settled = settleBatch({
          questions: batch.questions,
          questionIds: batch.questionIds,
          replyText: reply,
          model: this.deps.modelId,
          advisoryThreshold: tuning.advisoryThreshold,
        })
        commitSettledAnswers({
          entries: this.deps.entries,
          cache: this.deps.cache,
          entryKey: job.entryKey,
          model: this.deps.modelId,
          settled,
          onFailure: (failure) => {
            failed(`its reply did not parse: ${failure}`)
          },
        })
      } finally {
        tracked.stop()
      }
    } catch (error: unknown) {
      // Start, effort, send or wait threw: settle once and let the background
      // runner report it once through onError.
      this.deps.entries.settle(job.entryKey, 'failed')
      throw error
    } finally {
      // The batch's folder goes even on failure: an empty temporary folder,
      // deleted after. A turn that may still run is stopped first.
      if (session !== undefined) {
        try {
          await session.cancel()
        } catch {
          // A failing stop still releases the session.
        }
        session.dispose()
      }
      try {
        await this.deps.removeTempRoot(root)
      } catch (error: unknown) {
        this.deps.logWarn(
          `The Muse Code judge could not remove its folder: ${this.deps.describeFailure(error)}`,
        )
      }
    }
  }

  /**
   * Judge one held action: settle from the cache when judged before, stay
   * off on standing always-allow rules, else judge each kind's batch in its
   * own fresh hidden session in the background and return at once. Never
   * rejects, never waits on the caller.
   */
  public judge(job: MuseCodeJudgeJob): void {
    // The user-settings allow-rule check runs before any batch: a rule that
    // lands while earlier batches run stops the later ones at their own check
    // in runBatch.
    const allowed = checkStandingAllowRules(this.deps.readSettingsText())
    if (!allowed.allowed) {
      this.deps.entries.settle(job.entryKey, 'failed')
      this.deps.logInfo(`The Muse Code judge stays off: ${allowed.reason}`)
      return
    }
    judgeHeldAction({
      runner: this.deps,
      entryKey: job.entryKey,
      stateText: job.stateText,
      questions: job.questions,
      runBatch: (batch, tuning, signal) => this.runBatch(job, batch, signal, tuning),
    })
  }
}
