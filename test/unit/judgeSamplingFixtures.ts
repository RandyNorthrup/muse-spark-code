import { vi } from 'vitest'
import type {
  JudgeTechniqueCall,
  JudgeTechniqueDependencies,
  JudgeTechniqueReceipt,
} from '../../src/core/judge/sampling'
import type {
  JudgeOutcome,
  JudgeRequest,
  JudgeResult,
  JevAnswer,
} from '../../src/core/judge/schema'

export const samplingRequest: JudgeRequest = {
  state: { command: 'synthetic command', context: ['complete', 'state'] },
  questions: { risk: { type: 'noul', instructions: 'Can it destroy data?' } },
}

export function fixtureResult(request: JudgeRequest, values: readonly number[]): JudgeResult {
  const answers: Record<string, JevAnswer> = {}
  const muse: JudgeResult['muse'] = {}
  for (const [index, [id, question]] of Object.entries(request.questions).entries()) {
    const value = values[index] ?? 1
    if (question.type === 'noul') {
      answers[id] = { type: 'noul', noul: value, probabilities: { true: value, false: 1 - value } }
    } else {
      const keys =
        question.type === 'choice'
          ? Object.keys(question.criteria)
          : question.criteria.map((_, level) => String(level))
      const probabilities = Object.fromEntries(
        keys.map((key, level) => [key, level === value ? 1 : 0]),
      )
      answers[id] =
        question.type === 'choice'
          ? { type: 'choice', choice: keys[value] ?? '', confidence: 1, probabilities }
          : {
              type: 'score',
              score: value,
              confidence: 1,
              probabilities,
              legend: Object.fromEntries(
                question.criteria.map((label, level) => [String(level), label]),
              ),
            }
    }
    muse[id] = {
      source: 'same',
      model: 'fixture-model',
      technique: 'stated',
      label: 'uncalibrated',
      confidence: 1,
      partial: false,
    }
  }
  return { model: 'fixture-model', answers, muse, usage: { input_tokens: 40, output_tokens: 1 } }
}

/** This is a fake admission ledger, never a durability or provider-wire receipt. */
export function techniqueFixture(technique: 'sampling' | 'contrastive' = 'sampling') {
  const identity = {
    source: 'same',
    providerId: 'fixture-provider',
    model: 'fixture-model',
    modelVersion: 'v1',
    endpoint: 'https://fixture.invalid/v1',
  } as const
  const claims: {
    id: number
    reserved: number
    settled: number
    uncertain: number
    sent: boolean
  }[] = []
  const state = {
    consent: true,
    current: true,
    budget: 1,
    inputTokens: 40,
    price: 0.0001,
    answers: [1, 0, 1, 1],
    cached: false,
    cacheMiss: false,
  }
  let sends = 0
  const beforeAdmission = vi.fn(() => Promise.resolve())
  const onDispatch = vi.fn(
    (_request: JudgeRequest, _index: number): Promise<JudgeOutcome | undefined> =>
      Promise.resolve(undefined),
  )
  const deps: JudgeTechniqueDependencies = {
    capability: {
      ...identity,
      captureId: 'synthetic-capture',
      logprobs: { kind: 'refused' },
      stated: true,
      systemone: false,
      reasoningForced: false,
      cache: true,
      contextWindowTokens: 32_000,
      minOutputTokens: 1,
    },
    family: 'risk.destructive',
    promptVersion: 'prompt-1',
    criteriaVersion: 'criteria-1',
    measurement: {
      captureId: 'synthetic-capture',
      receiptId: 'synthetic-adoption-only',
      identity: {
        ...identity,
        technique,
        family: 'risk.destructive',
        promptVersion: 'prompt-1',
        criteriaVersion: 'criteria-1',
        fitVersion: 'measurement-1',
      },
    },
    prepare: vi.fn(
      (request: JudgeRequest, _technique: 'sampling' | 'contrastive', maxOutputTokens: number) => ({
        inputTokens: state.inputTokens,
        maxOutputTokens,
        uncachedCostUsd: state.price,
        dispatch: async () => {
          const index = sends++
          const outcome = await onDispatch(request, index)
          const wasCached = state.cached && !state.cacheMiss
          state.cached = true
          const result = fixtureResult(
            request,
            technique === 'contrastive' ? state.answers : [state.answers[index] ?? 1],
          )
          result.usage['cached_tokens'] = wasCached ? 40 : 0
          return outcome ?? { outcome: 'answered', result }
        },
      }),
    ),
    admission: {
      run: vi.fn(
        async (call: JudgeTechniqueCall, signal: AbortSignal): Promise<JudgeTechniqueReceipt> => {
          await beforeAdmission()
          let refusal: Extract<JudgeOutcome, { outcome: 'no-answer' }>['reason'] | undefined
          if (signal.aborted) refusal = 'cancelled'
          else if (!state.current) refusal = 'profile-mismatch'
          else if (!state.consent) refusal = 'consent-declined'
          else if (state.budget < call.uncachedCostUsd) refusal = 'over-budget'
          if (refusal !== undefined)
            return {
              outcome: { outcome: 'no-answer', reason: refusal },
              reservedCostUsd: 0,
              settledCostUsd: 0,
              uncertainCostUsd: 0,
            }
          state.budget -= call.uncachedCostUsd
          const claim = {
            id: claims.length,
            reserved: call.uncachedCostUsd,
            settled: 0,
            uncertain: 0,
            sent: true,
          }
          claims.push(claim)
          const outcome = await call.dispatch(signal)
          if (outcome.outcome === 'no-answer') claim.uncertain = call.uncachedCostUsd
          else claim.settled = state.cacheMiss ? call.uncachedCostUsd : call.uncachedCostUsd / 2
          return {
            outcome,
            reservedCostUsd: claim.reserved,
            settledCostUsd: claim.settled,
            uncertainCostUsd: claim.uncertain,
          }
        },
      ),
    },
  }
  return { deps, state, claims, beforeAdmission, onDispatch }
}

export function deferred() {
  const pending = Promise.withResolvers<undefined>()
  return {
    promise: pending.promise,
    resolve: () => {
      pending.resolve(undefined)
    },
  }
}
