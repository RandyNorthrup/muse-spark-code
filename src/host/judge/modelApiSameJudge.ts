// The same-model judge on the Model API backend (M98 lane S, PLAN.md D77):
// the host adapter that judges one held action without touching the main
// request or session. It reads ModelApiHost's own built (keyed) body through
// the injected source, derives the side request (the cached prefix copied
// exactly, the question at the tail; standalone under redaction), and sends
// it in the background: the judge is never awaited on a user path. A result
// that arrives after its fence has passed finds no entry and is dropped,
// unused; a ready caution settles at the advisory threshold. No model switch:
// the side body keeps the conversation's model. No `vscode` import.

import type { CreateResponseBody, InputItem } from '../../core/backends/modelapi/schemas'
import { type JudgeEntryStore, type JudgeReadyOutcome } from '../../core/judge/entries'
import { type JudgeQuestion } from '../../core/judge/judge'
import { planJudgeBatches } from '../../core/judge/prompt'
import { selectTechnique, type ModelJudgeCapability } from '../../core/judge/techniques'
import {
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_MIN_CACHED_PREFIX_TOKENS,
  JUDGE_REQUEST_TIMEOUT_MS,
} from '../../shared/constants'
import { type CachedPrefix } from '../../core/backends/modelapi/promptCache'
import { settleBatch } from '../../core/judge/same/answers'
import { type JudgeResultCache } from '../../core/judge/same/resultCache'
import { runJudgeInBackground } from '../../core/judge/same/scheduler'
import { planSideRequest } from '../../core/judge/same/sideRequest'
import { judgePromptWording } from '../../core/judge/same/wording'

/** ModelApiHost's own request builder, as the adapter reads it (lane S seam). */
export interface ModelApiJudgeSource {
  /** The host's built, keyed body for the current turn — never modified here. */
  readMainBody(): CreateResponseBody
  /** `promptCacheKey` over a prefix: the side key of a shared prefix. */
  keyPrefix(prefix: CachedPrefix): string
  /**
   * The cached prefix's length in the model's tokens, when the host measured
   * it. Undefined means unmeasured: the side request shares the prefix (real
   * conversations carry thousands of cached tokens; the minimum only saves a
   * standalone send for degenerate short bodies).
   */
  prefixTokens(): number | undefined
}

/** One side request sent, as the transport answers it. */
export interface ModelApiSideResponse {
  readonly text: string
  readonly inputTokens: number
  readonly outputTokens: number
}

/**
 * The `client.streamResponse` call the integration owns (lane U/D wiring):
 * the side body through the conversation's own model and endpoint, answered
 * as text with usage. Failures reject.
 */
export interface ModelApiJudgeTransport {
  send(body: CreateResponseBody, signal: AbortSignal): Promise<ModelApiSideResponse>
}

export interface ModelApiJudgeDeps {
  readonly source: ModelApiJudgeSource
  readonly transport: ModelApiJudgeTransport
  readonly entries: JudgeEntryStore
  readonly cache: JudgeResultCache
  /** Secret redaction (redactSecrets): redaction runs before anything remote. */
  readonly redact: (text: string) => string
  /**
   * The model's captured capability (D77). Uncaptured models get stated
   * confidence until they are: the default refuses logprobs, so phase 1
   * always states (Muse Spark refuses while reasoning; lane 2e captures).
   */
  readonly capability?: ModelJudgeCapability | undefined
  /** The conversation's own model: the side body never names another. */
  readonly modelId: string
  readonly timeoutMs?: number | undefined
  readonly minPrefixTokens?: number | undefined
  readonly advisoryThreshold?: number | undefined
  /**
   * The token joystick lane J's over-context backstop reads: the model's own
   * counter, provided by the wiring.
   */
  readonly measureTokens: (text: string) => number
  readonly onError: (error: unknown) => void
}

/** One held action to judge: its latch entry plus the judged state. */
export interface ModelApiJudgeJob {
  /** Lane J's exact-action entry key (lane U created the entry). */
  readonly entryKey: string
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
  readonly reservedCostUsd?: number | undefined
  readonly settledCostUsd?: number | undefined
}

const JUDGE_TAIL_ROLE = 'user'

function tailMessage(text: string): InputItem {
  return {
    type: 'message',
    role: JUDGE_TAIL_ROLE,
    content: [{ type: 'input_text', text }],
  }
}

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

export class ModelApiSameJudge {
  private readonly timeoutMs: number
  private readonly minPrefixTokens: number
  private readonly advisoryThreshold: number
  private readonly measureTokens: (text: string) => number

  public constructor(private readonly deps: ModelApiJudgeDeps) {
    this.timeoutMs = deps.timeoutMs ?? JUDGE_REQUEST_TIMEOUT_MS
    this.minPrefixTokens = deps.minPrefixTokens ?? JUDGE_MIN_CACHED_PREFIX_TOKENS
    this.advisoryThreshold = deps.advisoryThreshold ?? JUDGE_ADVISORY_THRESHOLD
    this.measureTokens = deps.measureTokens
  }

  private planBatches(job: ModelApiJudgeJob) {
    const wording = judgePromptWording()
    const planned: { questions: JudgeQuestion[]; user: string; questionIds: readonly string[] }[] =
      []
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

  private judgeBatch(
    job: ModelApiJudgeJob,
    batch: { questions: JudgeQuestion[]; user: string; questionIds: readonly string[] },
  ): void {
    runJudgeInBackground(
      async (signal) => {
        await this.runBatch(job, batch, signal)
      },
      { timeoutMs: this.timeoutMs, onError: this.deps.onError },
    )
  }

  private standaloneBody(main: CreateResponseBody, tail: InputItem): CreateResponseBody {
    const body: CreateResponseBody = {
      model: main.model,
      input: [tail],
      instructions: '',
      tools: [],
      tool_choice: 'auto',
      reasoning: main.reasoning,
      stream: true,
      store: false,
      include: main.include,
      max_output_tokens: main.max_output_tokens,
      prompt_cache_key: this.deps.source.keyPrefix({
        model: main.model,
        instructions: '',
        tools: [],
      }),
      prompt_cache_retention: main.prompt_cache_retention,
    }
    return body
  }

  private async runBatch(
    job: ModelApiJudgeJob,
    batch: { questions: JudgeQuestion[]; user: string; questionIds: readonly string[] },
    signal: AbortSignal,
  ): Promise<void> {
    const settleFailed = (): void => {
      this.deps.entries.settle(job.entryKey, 'failed')
    }
    let main: CreateResponseBody
    try {
      main = this.deps.source.readMainBody()
    } catch (error: unknown) {
      settleFailed()
      throw error
    }
    if (main.model !== this.deps.modelId) {
      // No model switch, ever: the side request keeps the conversation's model.
      settleFailed()
      throw new Error('judge main body names another model')
    }
    const tail = tailMessage(batch.user)
    const planned = planSideRequest({
      mainBody: main,
      tail,
      redact: this.deps.redact,
      prefixTokens: this.deps.source.prefixTokens() ?? this.minPrefixTokens,
      minPrefixTokens: this.minPrefixTokens,
    })
    const body = planned.mode === 'shared-prefix' ? planned.body : this.standaloneBody(main, tail)
    let response: ModelApiSideResponse
    try {
      response = await this.deps.transport.send(body, signal)
    } catch (error: unknown) {
      settleFailed()
      throw error
    }
    // Uncaptured models state (D77): the technique reads the injected
    // capability, and phase 1 always lands here.
    const technique = selectTechnique(
      this.deps.capability ?? { logprobs: 'refused' },
      batch.questions[0]?.kind ?? 'noul',
    )
    if (technique !== 'stated') {
      settleFailed()
      throw new Error(`judge technique ${technique} has no captured capability`)
    }
    const settled = settleBatch({
      questions: batch.questions,
      questionIds: batch.questionIds,
      replyText: response.text,
      model: this.deps.modelId,
      advisoryThreshold: this.advisoryThreshold,
      reservedCostUsd: job.reservedCostUsd,
      settledCostUsd: job.settledCostUsd,
    })
    if (settled.status !== 'answered') {
      settleFailed()
      return
    }
    const outcome: JudgeReadyOutcome = settled.outcome
    // A consumed or discarded key settles false: the late result is dropped,
    // and only a live entry's answers reach the memory-only cache.
    if (this.deps.entries.settle(job.entryKey, outcome)) {
      this.deps.cache.set(job.entryKey, {
        outcome,
        model: this.deps.modelId,
        answers: settled.answers,
      })
    }
  }

  /**
   * Judge one held action: settle from the cache when judged before, else
   * send each kind's batch in the background and return at once. Never
   * rejects, never waits on the caller.
   */
  public judge(job: ModelApiJudgeJob): void {
    const cached = this.deps.cache.get(job.entryKey)
    if (cached !== undefined) {
      // A consumed or discarded key settles false: the late result is dropped.
      this.deps.entries.settle(job.entryKey, cached.outcome)
      return
    }
    let batches: { questions: JudgeQuestion[]; user: string; questionIds: readonly string[] }[]
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
