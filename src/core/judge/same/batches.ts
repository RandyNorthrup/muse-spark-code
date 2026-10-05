// One judge batch per question kind, planned and committed the same way on
// both backends (M98 lane S, PLAN.md D77): questions split by kind (one batch
// shares one stated response, which carries a single answer shape), never the
// state, and a settled outcome commits to the latch entry and the
// memory-only cache only while the entry stands — a result that arrives
// after its fence has passed is dropped, never cached. Pure glue over lane
// J; no `vscode` import.

import {
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_REQUEST_TIMEOUT_MS,
} from '../../../shared/constants'
import { type JudgeEntryStore } from '../entries'
import { type JudgeQuestion } from '../judge'
import { planJudgeBatches } from '../prompt'
import { runJudgeInBackground } from './scheduler'
import { type BatchSettleFailure, type BatchSettleResult } from './answers'
import { type CachedJudgeOutcome, type JudgeResultCache } from './resultCache'
import { judgePromptWording } from './wording'

/** The runner both adapters share: entries, cache, model, limits, reporter. */
export interface SameJudgeRunnerDeps {
  readonly entries: JudgeEntryStore
  readonly cache: JudgeResultCache
  /** The conversation's own model: no backend ever names another. */
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

/** What the runner reads with defaults applied. */
export interface ResolvedRunnerTuning {
  readonly timeoutMs: number
  readonly advisoryThreshold: number
  readonly measureTokens: (text: string) => number
}

/** Lane 0's runner defaults, read once per adapter. */
export function resolveRunnerTuning(deps: SameJudgeRunnerDeps): ResolvedRunnerTuning {
  return {
    timeoutMs: deps.timeoutMs ?? JUDGE_REQUEST_TIMEOUT_MS,
    advisoryThreshold: deps.advisoryThreshold ?? JUDGE_ADVISORY_THRESHOLD,
    measureTokens: deps.measureTokens,
  }
}

/** One planned batch: its questions, their prompt text, and their ids. */
export interface PlannedJudgeBatch {
  readonly questions: JudgeQuestion[]
  readonly user: string
  readonly questionIds: readonly string[]
}

/** Questions of one kind, in first-seen order. */
export function groupQuestionsByKind(questions: readonly JudgeQuestion[]): JudgeQuestion[][] {
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

export interface PlanKindBatchesInputs {
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
  readonly contextTokenLimit?: number | undefined
  readonly measureTokens: (text: string) => number
}

/**
 * Plan one batch per question kind over the full state: each batch carries
 * the whole state, only questions split, and an over-context state refuses
 * loudly instead of trimming. Throws on a refusal or a planner bug: the
 * caller settles `failed`.
 */
export function planKindBatches(inputs: PlanKindBatchesInputs): PlannedJudgeBatch[] {
  const wording = judgePromptWording()
  const planned: PlannedJudgeBatch[] = []
  for (const group of groupQuestionsByKind(inputs.questions)) {
    const plan = planJudgeBatches({
      stateText: inputs.stateText,
      questions: group,
      wording,
      maxQuestionsPerBatch: group.length,
      contextTokenLimit: inputs.contextTokenLimit ?? JUDGE_MAX_STATE_TOKENS,
      measureTokens: inputs.measureTokens,
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

/**
 * Plan one held action's batches over its full state: each batch carries the
 * whole state, only questions split. A refusal throws: the caller settles
 * `failed`.
 */
export function planJobBatches(
  job: { readonly stateText: string; readonly questions: readonly JudgeQuestion[] },
  measureTokens: (text: string) => number,
): PlannedJudgeBatch[] {
  return planKindBatches({ stateText: job.stateText, questions: job.questions, measureTokens })
}

/**
 * Launch one batch's background run: never awaited on a user path, reported
 * once through `onError`, aborted past the timeout.
 */
export function launchJudgeBatch(
  run: (signal: AbortSignal) => Promise<void>,
  tuning: { readonly timeoutMs: number },
  onError: (error: unknown) => void,
): void {
  runJudgeInBackground(run, { timeoutMs: tuning.timeoutMs, onError })
}

export interface CommitSettledInputs {
  readonly entries: JudgeEntryStore
  readonly cache: JudgeResultCache
  readonly entryKey: string
  readonly model: string
  readonly settled: BatchSettleResult
  /** Settles `failed` (and usually logs once) when the reply did not parse. */
  readonly onFailure: (failure: BatchSettleFailure) => void
}

/**
 * Commit one answered batch: a reply that did not parse settles `failed`;
 * answers commit to the latch and, only while the entry stands, the cache.
 */
export function commitSettledAnswers(inputs: CommitSettledInputs): void {
  if (inputs.settled.status !== 'answered') {
    inputs.onFailure(inputs.settled.failure)
    return
  }
  commitOutcome({
    entries: inputs.entries,
    cache: inputs.cache,
    entryKey: inputs.entryKey,
    outcome: inputs.settled.outcome,
    model: inputs.model,
    answers: inputs.settled.answers,
  })
}

export interface JudgeHeldActionInputs {
  readonly runner: SameJudgeRunnerDeps
  readonly entryKey: string
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
  /** Runs one batch to its settle; launched in the background per batch. */
  readonly runBatch: (
    batch: PlannedJudgeBatch,
    tuning: ResolvedRunnerTuning,
    signal: AbortSignal,
  ) => Promise<void>
}

/**
 * Judge one held action: settle from the cache when judged before, else plan
 * each kind's batch and launch it in the background. Never rejects, never
 * waits on the caller.
 */
export function judgeHeldAction(inputs: JudgeHeldActionInputs): void {
  const tuning = resolveRunnerTuning(inputs.runner)
  beginJudgeBatches({
    entries: inputs.runner.entries,
    cache: inputs.runner.cache,
    entryKey: inputs.entryKey,
    plan: () =>
      planJobBatches(
        { stateText: inputs.stateText, questions: inputs.questions },
        tuning.measureTokens,
      ),
    launch: (batch) => {
      launchJudgeBatch(
        (signal) => inputs.runBatch(batch, tuning, signal),
        tuning,
        inputs.runner.onError,
      )
    },
    onError: inputs.runner.onError,
  })
}

export interface BeginJudgeBatchesInputs {
  readonly entries: JudgeEntryStore
  readonly cache: JudgeResultCache
  readonly entryKey: string
  /** Plans each kind's batch; throws on a refusal (settles `failed`). */
  readonly plan: () => PlannedJudgeBatch[]
  /** Sends one batch in the background and returns at once. */
  readonly launch: (batch: PlannedJudgeBatch) => void
  readonly onError: (error: unknown) => void
}

/**
 * Begin one held action's batches: settle from the cache when judged before,
 * else plan each kind's batch and launch it in the background. Never rejects,
 * never waits on the caller.
 */
export function beginJudgeBatches(inputs: BeginJudgeBatchesInputs): void {
  const cached = inputs.cache.get(inputs.entryKey)
  if (cached !== undefined) {
    // A consumed or discarded key settles false: the late result is dropped.
    inputs.entries.settle(inputs.entryKey, cached.outcome)
    return
  }
  let batches: PlannedJudgeBatch[]
  try {
    batches = inputs.plan()
  } catch (error: unknown) {
    inputs.entries.settle(inputs.entryKey, 'failed')
    inputs.onError(error)
    return
  }
  for (const batch of batches) {
    inputs.launch(batch)
  }
}

export interface CommitOutcomeInputs {
  readonly entries: JudgeEntryStore
  readonly cache: JudgeResultCache
  readonly entryKey: string
  readonly outcome: CachedJudgeOutcome['outcome']
  readonly model: string
  readonly answers: CachedJudgeOutcome['answers']
}

/**
 * Commit one settled outcome: settle the latch, and cache the answers only
 * while the entry stands. A consumed or discarded key commits nothing, so a
 * late result is dropped, never cached.
 */
export function commitOutcome(inputs: CommitOutcomeInputs): void {
  const wasApplied = inputs.entries.settle(inputs.entryKey, inputs.outcome)
  if (wasApplied) {
    inputs.cache.set(inputs.entryKey, {
      outcome: inputs.outcome,
      model: inputs.model,
      answers: inputs.answers,
    })
  }
}
