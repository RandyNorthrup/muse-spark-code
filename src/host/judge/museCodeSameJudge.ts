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
import { type JudgeEntryStore, type JudgeReadyOutcome } from '../../core/judge/entries'
import { type JudgeQuestion } from '../../core/judge/judge'
import { planJudgeBatches } from '../../core/judge/prompt'
import type { AgentEvent } from '../../shared/agentEvents'
import {
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_REQUEST_TIMEOUT_MS,
  THINKING_OFF_EFFORT,
} from '../../shared/constants'
import { checkStandingAllowRules } from '../../core/judge/same/allowRules'
import { settleBatch } from '../../core/judge/same/answers'
import { type JudgeResultCache } from '../../core/judge/same/resultCache'
import { runJudgeInBackground } from '../../core/judge/same/scheduler'
import { isJudgeTurnItemAllowed, judgeSessionOptions } from '../../core/judge/same/sessionSpec'
import { judgePromptWording, judgeStandaloneTurn } from '../../core/judge/same/wording'

export interface MuseCodeJudgeDeps {
  /** `host.startSession`: the side session joins the conversation's host. */
  readonly startSession: (options: StartSessionOptions) => Promise<AgentSession>
  /** The CLI's user-level settings text, undefined when the file is missing. */
  readonly readSettingsText: () => string | undefined
  /** A new empty temporary folder per batch; the session's workspace root. */
  readonly makeTempRoot: () => Promise<string>
  /** Removes the batch's folder after, even on failure. */
  readonly removeTempRoot: (root: string) => Promise<void>
  readonly entries: JudgeEntryStore
  readonly cache: JudgeResultCache
  /** Told each side session's id as it starts: no History lists it. */
  readonly onSideSession: (sessionId: string) => void
  /** A failure as the log may name it (never the CLI's own words). */
  readonly describeFailure: (error: unknown) => string
  readonly logInfo: (message: string) => void
  readonly logWarn: (message: string) => void
  /** The conversation's own model: the side session never names another. */
  readonly modelId: string
  readonly timeoutMs?: number | undefined
  readonly advisoryThreshold?: number | undefined
  /**
   * The token joystick lane J's over-context backstop reads: the model's own
   * counter, provided by the wiring.
   */
  readonly measureTokens: (text: string) => number
  readonly onError: (error: unknown) => void
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

function groupByKind(questions: readonly JudgeQuestion[]): JudgeQuestion[][] {
  const groups: JudgeQuestion[][] = []
  for (const question of questions) {
    const group = groups.find((candidate) => candidate[0]?.kind === question.kind)
    if (group === undefined) {
      groups.push([question])
    } else {
      group.push(question)
    }
  }
  return groups
}

interface BatchTurn {
  readonly questions: JudgeQuestion[]
  readonly user: string
  readonly questionIds: readonly string[]
}

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
  private readonly timeoutMs: number
  private readonly advisoryThreshold: number
  private readonly measureTokens: (text: string) => number

  public constructor(private readonly deps: MuseCodeJudgeDeps) {
    this.timeoutMs = deps.timeoutMs ?? JUDGE_REQUEST_TIMEOUT_MS
    this.advisoryThreshold = deps.advisoryThreshold ?? JUDGE_ADVISORY_THRESHOLD
    this.measureTokens = deps.measureTokens
  }

  private planBatches(job: MuseCodeJudgeJob): BatchTurn[] {
    const wording = judgePromptWording()
    const planned: BatchTurn[] = []
    for (const group of groupByKind(job.questions)) {
      // One batch shares one stated response, which carries a single answer
      // shape: questions split by kind, never the state.
      const plan = planJudgeBatches({
        stateText: job.stateText,
        questions: group,
        wording,
        maxQuestionsPerBatch: group.length,
        contextTokenLimit: JUDGE_MAX_STATE_TOKENS,
        measureTokens: this.measureTokens,
      })
      if (plan.refused !== undefined) {
        throw new Error(`judge batch refused: ${plan.refused}`)
      }
      for (const batch of plan.batches) {
        const questions = batch.questionIds.map((id) => {
          const question = group.find((candidate) => candidate.id === id)
          if (question === undefined) {
            throw new Error('judge batch planned an unknown question')
          }
          return question
        })
        planned.push({ questions, user: batch.user, questionIds: batch.questionIds })
      }
    }
    return planned
  }

  private judgeBatch(job: MuseCodeJudgeJob, batch: BatchTurn): void {
    runJudgeInBackground(
      async (signal) => {
        await this.runBatch(job, batch, signal)
      },
      { timeoutMs: this.timeoutMs, onError: this.deps.onError },
    )
  }

  private async runBatch(
    job: MuseCodeJudgeJob,
    batch: BatchTurn,
    signal: AbortSignal,
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
          advisoryThreshold: this.advisoryThreshold,
        })
        if (settled.status !== 'answered') {
          failed(`its reply did not parse: ${settled.failure}`)
          return
        }
        const outcome: JudgeReadyOutcome = settled.outcome
        // A consumed or discarded key settles false: the late result is
        // dropped, and only a live entry's answers reach the memory-only cache.
        if (this.deps.entries.settle(job.entryKey, outcome)) {
          this.deps.cache.set(job.entryKey, {
            outcome,
            model: this.deps.modelId,
            answers: settled.answers,
          })
        }
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
    const cached = this.deps.cache.get(job.entryKey)
    if (cached !== undefined) {
      // A consumed or discarded key settles false: the late result is dropped.
      this.deps.entries.settle(job.entryKey, cached.outcome)
      return
    }
    const allowed = checkStandingAllowRules(this.deps.readSettingsText())
    if (!allowed.allowed) {
      this.deps.entries.settle(job.entryKey, 'failed')
      this.deps.logInfo(`The Muse Code judge stays off: ${allowed.reason}`)
      return
    }
    let batches: BatchTurn[]
    try {
      batches = this.planBatches(job)
    } catch (error: unknown) {
      this.deps.entries.settle(job.entryKey, 'failed')
      this.deps.onError(error)
      return
    }
    for (const batch of batches) {
      this.judgeBatch(job, batch)
    }
  }
}
