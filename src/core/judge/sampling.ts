import * as z from 'zod/mini'
import { JUDGE_MAX_STATE_TOKENS, JUDGE_QUESTION_MAX } from '../../shared/constants'
import { type UsdAmount, Usd, nonnegativeUsdSchema, sumUsd } from '../../shared/usd'
import { entropyConfidence } from './math'
import {
  judgeCapabilitySchema,
  judgeOutcomeSchema,
  judgeProfileIdentitySchema,
  judgeRequestSchema,
  type JudgeCapability,
  type JudgeOutcome,
  type JudgeProfileIdentity,
  type JudgeQuestion,
  type JudgeRequest,
  type JevAnswer,
} from './schema'

type Technique = 'sampling' | 'contrastive'

/** Prepared by the captured source, measuring the complete provider request. */
export interface JudgeTechniqueCall {
  readonly inputTokens: number
  readonly maxOutputTokens: number
  /** Full input at its uncached/write worst-case rate, plus maximum output. */
  readonly uncachedCostUsd: UsdAmount
  readonly dispatch: (signal: AbortSignal) => Promise<JudgeOutcome>
}

const costSchema = nonnegativeUsdSchema
const receiptSchema = z.strictObject({
  outcome: judgeOutcomeSchema,
  reservedCostUsd: costSchema,
  settledCostUsd: costSchema,
  uncertainCostUsd: costSchema,
})
export type JudgeTechniqueReceipt = z.infer<typeof receiptSchema>

/** No production fallback: assembly must inject lane A/D78 admission. */
export interface JudgeTechniqueDependencies {
  readonly capability: JudgeCapability
  readonly family: string
  readonly promptVersion: string
  readonly criteriaVersion: string
  /** An adoption receipt, not a calibration profile or permission. */
  readonly measurement?:
    | {
        readonly captureId: string
        readonly receiptId: string
        readonly identity: JudgeProfileIdentity
      }
    | undefined
  readonly prepare: (
    request: JudgeRequest,
    technique: Technique,
    maxOutputTokens: number,
  ) => JudgeTechniqueCall
  readonly admission: {
    /**
    Rebind current source/consent/confidentiality after waits; durably reserve
    this call before dispatch, settle once, refund only known non-sends and
    retain uncertain liability. Each invocation is a NEW attempt/claim.
    */
    readonly run: (call: JudgeTechniqueCall, signal: AbortSignal) => Promise<JudgeTechniqueReceipt>
  }
}

export function techniqueRefusal(
  reason: Extract<JudgeOutcome, { outcome: 'no-answer' }>['reason'],
): JudgeOutcome {
  return { outcome: 'no-answer', reason }
}

/** Evidence binds to the exact source, family, framing and technique. */
export function techniqueEligibility(
  deps: JudgeTechniqueDependencies,
  technique: Technique,
): JudgeOutcome | undefined {
  if (!judgeCapabilitySchema.safeParse(deps.capability).success)
    return techniqueRefusal('capability-unavailable')
  const measurement = deps.measurement
  if (measurement === undefined || measurement.receiptId.length === 0)
    return techniqueRefusal('source-untested')
  if (!judgeProfileIdentitySchema.safeParse(measurement.identity).success)
    return techniqueRefusal('profile-mismatch')
  const expected = {
    source: deps.capability.source,
    providerId: deps.capability.providerId,
    model: deps.capability.model,
    modelVersion: deps.capability.modelVersion,
    endpoint: deps.capability.endpoint,
    technique,
    family: deps.family,
    promptVersion: deps.promptVersion,
    criteriaVersion: deps.criteriaVersion,
  }
  return measurement.captureId !== deps.capability.captureId ||
    Object.entries(expected).some(
      ([key, value]) => Reflect.get(measurement.identity, key) !== value,
    )
    ? techniqueRefusal('profile-mismatch')
    : undefined
}

export function prepareTechniqueCall(
  request: JudgeRequest,
  technique: Technique,
  outputTokens: number,
  deps: JudgeTechniqueDependencies,
): JudgeTechniqueCall | JudgeOutcome {
  if (request.model !== undefined && request.model !== deps.capability.model)
    return techniqueRefusal('capability-unavailable')
  const call = deps.prepare(request, technique, outputTokens)
  if (
    !Number.isSafeInteger(call.inputTokens) ||
    call.inputTokens < 0 ||
    call.maxOutputTokens !== outputTokens
  )
    return techniqueRefusal('engine-failure')
  if (
    call.inputTokens + outputTokens >
    Math.min(deps.capability.contextWindowTokens, JUDGE_MAX_STATE_TOKENS)
  )
    return techniqueRefusal('over-context')
  // Malformed or negative money fails closed: the call is unpriced, never free.
  return nonnegativeUsdSchema.safeParse(call.uncachedCostUsd).success
    ? call
    : techniqueRefusal('unpriced')
}

export async function runTechniqueCall(
  call: JudgeTechniqueCall,
  signal: AbortSignal,
  deps: JudgeTechniqueDependencies,
): Promise<JudgeTechniqueReceipt> {
  const isAborted = (): boolean => signal.aborted
  if (isAborted())
    return {
      outcome: techniqueRefusal('cancelled'),
      reservedCostUsd: Usd.from(0).toAmount(),
      settledCostUsd: Usd.from(0).toAmount(),
      uncertainCostUsd: Usd.from(0).toAmount(),
    }
  const receipt = receiptSchema.parse(await deps.admission.run(call, signal))
  return isAborted() ? { ...receipt, outcome: techniqueRefusal('cancelled') } : receipt
}

/** Exact keys and bounded, normalized masses; no partial/top-1 distribution. */
function alternativeKeys(question: JudgeQuestion): string[] {
  switch (question.type) {
    case 'noul': {
      return ['true', 'false']
    }
    case 'choice': {
      return Object.keys(question.criteria)
    }
    case 'score': {
      return question.criteria.map((_, index) => String(index))
    }
  }
}

export function techniqueProbabilities(
  question: JudgeQuestion,
  answer: JevAnswer,
): number[] | undefined {
  if (answer.type !== question.type) return undefined
  const keys = alternativeKeys(question)
  if (Object.keys(answer.probabilities).length !== keys.length) return undefined
  const masses = new Map(Object.entries(answer.probabilities))
  const probabilities = keys.map((key) => masses.get(key))
  if (
    probabilities.some(
      (value) => value === undefined || !Number.isFinite(value) || value < 0 || value > 1,
    )
  )
    return undefined
  const values = probabilities.filter((value) => value !== undefined)
  if (
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) >
    Number.EPSILON * JUDGE_QUESTION_MAX
  )
    return undefined
  if (answer.type === 'noul' && answer.noul !== values[0]) return undefined
  if (
    answer.type === 'choice' &&
    probabilities[keys.indexOf(answer.choice)] !== Math.max(...values)
  )
    return undefined
  return answer.type === 'score' &&
    Math.abs(answer.score - values.reduce((sum, value, index) => sum + value * index, 0)) >
      Number.EPSILON * JUDGE_QUESTION_MAX
    ? undefined
    : values
}

export function techniqueResult(
  request: JudgeRequest,
  distributions: ReadonlyMap<string, readonly number[]>,
  technique: Technique,
  deps: JudgeTechniqueDependencies,
  receipts: readonly JudgeTechniqueReceipt[],
): JudgeOutcome {
  const result = {
    model: deps.capability.model,
    answers: {},
    muse: {},
    usage: { input_tokens: 0, output_tokens: 0 },
  }
  const answers: Record<string, JevAnswer> = {}
  const muse: Extract<JudgeOutcome, { outcome: 'answered' }>['result']['muse'] = {}
  const costs = {
    reservedCostUsd: sumUsd(...receipts.map((receipt) => receipt.reservedCostUsd)),
    settledCostUsd: sumUsd(...receipts.map((receipt) => receipt.settledCostUsd)),
    uncertainCostUsd: sumUsd(...receipts.map((receipt) => receipt.uncertainCostUsd)),
  }
  for (const receipt of receipts) {
    if (receipt.outcome.outcome !== 'answered') {
      continue
    }

    result.usage.input_tokens += receipt.outcome.result.usage.input_tokens
    result.usage.output_tokens += receipt.outcome.result.usage.output_tokens
  }
  for (const [id, question] of Object.entries(request.questions)) {
    const values = distributions.get(id)
    if (values === undefined) return techniqueRefusal('engine-failure')
    const confidence = entropyConfidence(values)
    const keys = alternativeKeys(question)
    const probabilities = Object.fromEntries(keys.map((key, index) => [key, values[index] ?? 0]))
    if (question.type === 'noul') {
      answers[id] = {
        type: 'noul',
        noul: values[0] ?? 0,
        probabilities: { true: values[0] ?? 0, false: values[1] ?? 0 },
      }
    } else if (question.type === 'choice') {
      let winner = 0
      for (let index = 1; index < values.length; index += 1)
        if ((values[index] ?? 0) > (values[winner] ?? 0)) winner = index
      answers[id] = { type: 'choice', choice: keys[winner] ?? '', confidence, probabilities }
    } else {
      answers[id] = {
        type: 'score',
        score: values.reduce((sum, value, index) => sum + value * index, 0),
        confidence,
        probabilities,
        legend: Object.fromEntries(question.criteria.map((label, index) => [String(index), label])),
      }
    }
    muse[id] = {
      source: deps.capability.source,
      model: deps.capability.model,
      technique,
      label: 'uncalibrated',
      partial: technique === 'sampling' && values.includes(0),
      confidence,
      ...costs,
    }
  }
  return judgeOutcomeSchema.parse({ outcome: 'answered', result: { ...result, answers, muse } })
}

export interface JudgeSamplingOptions {
  /** Sampling is never automatically selected, including high-stakes families. */
  readonly optedIn: boolean
  readonly sampleCount: number
  readonly maxAttemptsPerSample: number
  readonly cold: boolean
  readonly highStakes: boolean
}

/** One cold sample writes the prefix; the remaining k−1 samples run in parallel. */
export async function sampleJudge(
  request: JudgeRequest,
  options: JudgeSamplingOptions,
  deps: JudgeTechniqueDependencies,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  if (!options.optedIn) return techniqueRefusal('explicit-off')
  const eligibility = techniqueEligibility(deps, 'sampling')
  if (eligibility !== undefined) return eligibility
  if (deps.capability.reasoningForced || (!deps.capability.cache && !options.highStakes))
    return techniqueRefusal('capability-unavailable')
  if (
    [options.sampleCount, options.maxAttemptsPerSample].some(
      (count) => !(Number.isSafeInteger(count) && count >= 1 && count <= JUDGE_QUESTION_MAX),
    ) ||
    options.sampleCount < 2
  )
    return techniqueRefusal('engine-failure')
  const parsed = judgeRequestSchema.safeParse(request)
  if (!parsed.success) return techniqueRefusal('engine-failure')
  const plans: { id: string; question: JudgeQuestion; call: JudgeTechniqueCall }[] = []
  try {
    for (const [id, question] of Object.entries(parsed.data.questions)) {
      const call = prepareTechniqueCall(
        { ...parsed.data, questions: { [id]: question } },
        'sampling',
        deps.capability.minOutputTokens,
        deps,
      )
      if ('outcome' in call) return call
      plans.push({ id, question, call })
    }
  } catch {
    return techniqueRefusal('engine-failure')
  }
  const receipts: JudgeTechniqueReceipt[] = []
  const distributions = new Map<string, number[]>()
  try {
    for (const { id, question, call } of plans) {
      const sample = async (): Promise<number[] | JudgeOutcome> => {
        try {
          for (let attempt = 0; attempt < options.maxAttemptsPerSample; attempt += 1) {
            const receipt = await runTechniqueCall(call, signal, deps)
            receipts.push(receipt)
            const outcome = receipt.outcome
            if (outcome.outcome === 'no-answer') {
              if (
                ['engine-failure', 'timeout'].includes(outcome.reason) &&
                attempt + 1 < options.maxAttemptsPerSample
              )
                continue
              return outcome
            }
            const answer = outcome.result.answers[id]
            const meta = outcome.result.muse[id]
            if (
              answer === undefined ||
              outcome.result.model !== deps.capability.model ||
              Object.keys(outcome.result.answers).length !== 1 ||
              meta?.source !== deps.capability.source ||
              meta.model !== deps.capability.model ||
              meta.partial ||
              meta.technique === 'top1'
            )
              return techniqueRefusal('engine-failure')
            const values = techniqueProbabilities(question, answer)
            return values === undefined || values.some((value) => value !== 0 && value !== 1)
              ? techniqueRefusal('engine-failure')
              : values
          }
          return techniqueRefusal('engine-failure')
        } catch {
          return techniqueRefusal(signal.aborted ? 'cancelled' : 'engine-failure')
        }
      }
      const samples: (number[] | JudgeOutcome)[] = []
      if (options.cold && deps.capability.cache) {
        const first = await sample()
        if (!Array.isArray(first)) return first
        samples.push(first)
      }
      samples.push(
        ...(await Promise.all(
          Array.from({ length: options.sampleCount - samples.length }, sample),
        )),
      )
      const failed = samples.find((value) => !Array.isArray(value))
      if (failed !== undefined && !Array.isArray(failed)) return failed
      const values = samples.filter((value) => Array.isArray(value))
      distributions.set(
        id,
        (values[0] ?? []).map(
          (_, index) =>
            values.reduce((sum, value) => sum + (value[index] ?? 0), 0) / options.sampleCount,
        ),
      )
    }
    return techniqueResult(parsed.data, distributions, 'sampling', deps, receipts)
  } catch {
    return techniqueRefusal(signal.aborted ? 'cancelled' : 'engine-failure')
  }
}
