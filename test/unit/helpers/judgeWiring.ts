import { createJudgeFeatures } from '../../../src/runtime/judge/judgeEntry'
import { EN } from '../../../src/shared/l10n/en'
import { Usd } from '../../../src/shared/usd'
import type { JudgeAdoptionContext } from '../../../src/core/judge/adoption'
import type { JudgeCascadeSide } from '../../../src/core/judge/cascade'
import {
  calibrationPartitions,
  type CalibrationDataset,
  type CalibrationLimits,
  type CalibrationProfile,
} from '../../../src/core/judge/calibration/schema'
import { reportCalibration } from '../../../src/core/judge/calibration/report'
import type { JudgeModeContext } from '../../../src/core/judge/resolve'
import type { JudgeCapability, JudgeRequest } from '../../../src/core/judge/schema'
import {
  resolveModelCapabilities,
  type ModelCapabilityRecord,
} from '../../../src/core/providers/capabilityRecord'

export const wiringLimits: CalibrationLimits = {
  maxSamples: 1000,
  maxIdentifierLength: 128,
  maxBins: 10,
  isotonicMinimumLabels: 200,
  probabilityEpsilon: 1e-9,
  maxIterations: 50,
  convergenceTolerance: 1e-6,
  regularization: 1e-3,
  weightFloor: 1e-3,
}

/** Fabricated independent-labelled artifacts exercise validation, never product evidence. */
export function wiringFixture(evaluationCount = 2) {
  const makeSide = (source: 'same' | 'separate') => {
    const model = source === 'same' ? 'chosen' : 'separate-model'
    const capability = {
      source,
      providerId: 'fixture-provider',
      model,
      modelVersion: 'v1',
      endpoint: 'fixture://offline',
      captureId: 'fixture-capture',
      logprobs: { kind: 'refused' as const },
      stated: true,
      systemone: false,
      reasoningForced: false,
      cache: true,
      contextWindowTokens: 32_000,
      minOutputTokens: 1,
    }
    const identity = {
      ...capability,
      technique: 'stated',
      family: 'risk.destructive',
      promptVersion: 'prompt-1',
      criteriaVersion: 'criteria-1',
      fitVersion: 'fit-1',
    }
    const dataset: CalibrationDataset = {
      identity: {
        source,
        providerId: capability.providerId,
        model,
        modelVersion: 'v1',
        endpoint: capability.endpoint,
        technique: identity.technique,
        family: identity.family,
        promptVersion: identity.promptVersion,
        criteriaVersion: identity.criteriaVersion,
        fitVersion: identity.fitVersion,
      },
      evidence: 'independent',
      samples: (['fit', 'tuning', 'evaluation'] as const).flatMap((split) =>
        Array.from({ length: split === 'evaluation' ? evaluationCount : 2 }, (_, index) => ({
          id: `${split}-${String(index)}`,
          labelId: `${split}-label-${String(index)}`,
          taskGroup: `${split}-task`,
          repositoryGroup: `${split}-repo`,
          split,
          probability: index % 2 === 0 ? 0.9 : 0.1,
          label: index % 2 === 0 ? (1 as const) : (0 as const),
          labelSource: 'm75' as const,
        })),
      ),
    }
    const raw: CalibrationProfile = {
      version: 1,
      identity: dataset.identity,
      evidence: 'independent',
      epsilon: 1e-9,
      fit: { method: 'platt', slope: 1, intercept: 0 },
      combinationWeight: 1,
      partitions: calibrationPartitions(dataset.samples),
    }
    const reported = reportCalibration(raw, dataset, 1, wiringLimits)
    if (reported.status !== 'reported') throw new Error(reported.reason)
    const calls: { request: JudgeRequest; signal: AbortSignal }[] = []
    const zero = Usd.from(0).toAmount()
    const run: JudgeCascadeSide['run'] = (request, signal) => {
      calls.push({ request, signal })
      return Promise.resolve({
        reservedCostUsd: zero,
        settledCostUsd: zero,
        uncertainCostUsd: zero,
        outcome: {
          outcome: 'answered',
          result: {
            model,
            answers: Object.fromEntries(
              Object.keys(request.questions).map((id) => [
                id,
                { type: 'noul', noul: 0.8, probabilities: { true: 0.8, false: 0.2 } },
              ]),
            ),
            muse: Object.fromEntries(
              Object.keys(request.questions).map((id) => [
                id,
                {
                  source,
                  model,
                  technique: 'stated',
                  label: 'uncalibrated',
                  confidence: 0.2,
                  partial: false,
                },
              ]),
            ),
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      })
    }
    return {
      side: {
        capability,
        profile: reported.profile,
        fitVersion: 'fit-1',
        limits: wiringLimits,
        // The fixture side answers with stated confidence, so its own
        // selector's technique is `stated`.
        technique: 'stated' as const,
        run,
        // Every dispatch the assembly made, in order; the suites assert
        // counts and requests here instead of on a stand-in.
        calls,
      },
      profile: reported.profile,
      dataset,
    }
  }
  const same = makeSide('same')
  const separate = makeSide('separate')
  const record = {
    same: { profile: same.profile, dataset: same.dataset },
    separate: { profile: separate.profile, dataset: separate.dataset },
    rows: same.dataset.samples
      .filter((sample) => sample.split === 'evaluation')
      .map((sample) => {
        const arm = {
          ready: true,
          caution: sample.label === 1,
          probability: sample.probability,
          latencyMs: 1,
          costUsd: 0,
        }
        return {
          id: sample.id,
          labelId: sample.labelId,
          taskGroup: sample.taskGroup,
          repositoryGroup: sample.repositoryGroup,
          labelSource: 'm75' as const,
          label: sample.label === 1,
          same: arm,
          separate: arm,
          both: arm,
        }
      }),
  }
  const adoption = {
    check: (record: unknown, context: JudgeAdoptionContext) =>
      createJudgeFeatures({ uiText: EN, uiLocale: 'en' }).hasJudgeAdoptionEvidence(record, context),
    record,
    context: {
      providerId: 'fixture-provider',
      modelId: 'chosen',
      limits: wiringLimits,
      sameProfile: same.profile,
      separateProfile: separate.profile,
    },
  }
  const context: JudgeModeContext = {
    engine: 'auto',
    paidConsent: 'not-required',
    readyRate: undefined,
    minReadyRate: 0.5,
    sourceAvailable: true,
    providerId: 'fixture-provider',
    modelId: 'chosen',
    confidential: false,
    endpoint: 'fixture://offline',
    profileId: 'fit-1',
    ownerId: 'owner-1',
    turn: 'turn-1',
    separate: { available: true, verified: true, profilesReady: true, adoption },
  }
  const options = {
    family: 'risk.destructive',
    promptVersion: 'prompt-1',
    criteriaVersion: 'criteria-1',
    highStakes: true,
  }
  return { same: same.side, separate: separate.side, adoption, context, options }
}

/** The surface context every fixture binding is requested under. */
export const FIXTURE_BINDING_CONTEXT = {
  providerId: 'fixture-provider',
  modelId: 'chosen',
  endpoint: 'fixture://offline',
  profileId: 'fit-1',
  ownerId: 'owner-1',
  turn: 'turn-1',
  confidential: false,
  sourceAvailable: true,
  paidConsent: 'not-required' as const,
  readyRate: undefined,
  minReadyRate: 0.5,
}

/**
A captured M95 record for a fixture side: logprobs refused, a structured
`json_schema` output recorded. `chooseByoTechnique` reads it as `stated`,
which is what the fixture sides run. Fixture data, never product evidence.
*/
export function statedRecord(capability: JudgeCapability): ModelCapabilityRecord {
  const source = { kind: 'capture' as const, ref: 'fixture-capture' }
  return resolveModelCapabilities(
    { provider: capability.providerId, nativeModel: capability.model, format: 'chat' },
    [
      {
        source,
        fields: {
          logprobs: { state: 'no', source },
          output: { formats: { state: 'yes', value: ['text', 'json_schema'], source } },
        },
      },
    ],
  )
}
