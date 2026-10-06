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
import type { JudgeEntryHandle } from '../../core/judge/entries'
import { type JudgeQuestion } from '../../core/judge/judge'
import { selectTechnique, type ModelJudgeCapability } from '../../core/judge/techniques'
import { JUDGE_MIN_CACHED_PREFIX_TOKENS } from '../../shared/constants'
import type {
  ModelApiJudgeSource,
  ModelApiJudgeTransport,
} from '../../core/judge/same/modelApiSource'
export type {
  ModelApiJudgeSource,
  ModelApiJudgeTransport,
  ModelApiSideResponse,
} from '../../core/judge/same/modelApiSource'
import {
  commitSettledAnswers,
  judgeHeldAction,
  type PlannedJudgeBatch,
  type SameJudgeRunnerDeps,
} from '../../core/judge/same/batches'
import { settleBatch } from '../../core/judge/same/answers'
import { planSideRequest } from '../../core/judge/same/sideRequest'
import { judgeDistributionAnswerSchema, judgeNoulAnswerSchema } from '../../shared/sideCallSchemas'
import {
  sideCallBody,
  structuredSideCall,
  type StructuredOutputDeps,
} from '../../core/backends/modelapi/structuredOutput'

export interface ModelApiJudgeDeps extends SameJudgeRunnerDeps, StructuredOutputDeps {
  readonly source: ModelApiJudgeSource
  readonly transport: ModelApiJudgeTransport
  /** Secret redaction (redactSecrets): redaction runs before anything remote. */
  readonly redact: (text: string) => string
  /**
   * The model's captured capability (D77). Uncaptured models get stated
   * confidence until they are: the default refuses logprobs, so phase 1
   * always states (Muse Spark refuses while reasoning; lane 2e captures).
   */
  readonly capability?: ModelJudgeCapability | undefined
  readonly minPrefixTokens?: number | undefined
}

/** One held action to judge: its latch entry plus the judged state. */
export interface ModelApiJudgeJob {
  /** Lane J's exact-action entry key (lane U created the entry). */
  readonly entryKey: JudgeEntryHandle
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

export class ModelApiSameJudge {
  private readonly minPrefixTokens: number

  public constructor(private readonly deps: ModelApiJudgeDeps) {
    this.minPrefixTokens = deps.minPrefixTokens ?? JUDGE_MIN_CACHED_PREFIX_TOKENS
  }

  /** One job's batches, bound to their background runs. */
  private batchRunner(job: ModelApiJudgeJob) {
    return (
      batch: PlannedJudgeBatch,
      tuning: { advisoryThreshold: number },
      signal: AbortSignal,
    ): Promise<void> => this.runBatch(job, batch, signal, tuning)
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
    batch: PlannedJudgeBatch,
    signal: AbortSignal,
    tuning: { advisoryThreshold: number },
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
    const canReusePrefix =
      planned.mode === 'shared-prefix' && main.tools.every((tool) => tool.type === 'function')
    const body = canReusePrefix ? planned.body : this.standaloneBody(main, tail)
    let reservedCostUsd: number | undefined
    let settledCostUsd: number | undefined
    let replyText: string
    try {
      const question = batch.questions[0]
      const schema =
        question?.kind === 'noul'
          ? judgeNoulAnswerSchema
          : judgeDistributionAnswerSchema(question?.options?.length ?? 0)
      replyText = await structuredSideCall({
        formats: this.deps.sideCallFormats?.(this.deps.modelId),
        name: 'judge_answer',
        schema: schema.transform((answer) => JSON.stringify(answer)),
        signal,
        fallback: (text) => text,
        request: async (attempt) => {
          const formatted = sideCallBody(body, attempt, this.deps.forceSideCallTool)
          const request =
            attempt.mode === 'forced_tool'
              ? {
                  ...formatted,
                  prompt_cache_key: this.deps.source.keyPrefix({
                    model: formatted.model,
                    instructions: formatted.instructions,
                    tools: formatted.tools,
                  }),
                }
              : formatted
          const response = await this.deps.transport.send(request, signal)
          if (response.reservedCostUsd !== undefined)
            reservedCostUsd = (reservedCostUsd ?? 0) + response.reservedCostUsd
          if (response.settledCostUsd !== undefined)
            settledCostUsd = (settledCostUsd ?? 0) + response.settledCostUsd
          return response.text
        },
      })
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
      replyText,
      model: this.deps.modelId,
      advisoryThreshold: tuning.advisoryThreshold,
      reservedCostUsd: reservedCostUsd ?? job.reservedCostUsd,
      settledCostUsd: settledCostUsd ?? job.settledCostUsd,
    })
    commitSettledAnswers({
      entries: this.deps.entries,
      cache: this.deps.cache,
      entryKey: job.entryKey,
      model: this.deps.modelId,
      settled,
      onFailure: settleFailed,
    })
  }

  /**
   * Judge one held action: settle from the cache when judged before, else
   * send each kind's batch in the background and return at once. Never
   * rejects, never waits on the caller.
   */
  public judge(job: ModelApiJudgeJob): void {
    judgeHeldAction({
      runner: this.deps,
      entryKey: job.entryKey,
      stateText: job.stateText,
      questions: job.questions,
      runBatch: this.batchRunner(job),
    })
  }
}
