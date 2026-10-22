import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isJudgeEngineOn, type JudgeRuntime } from '../../src/core/judge/engine'
import {
  judgeCapabilitySchema,
  judgeLogSummary,
  judgeMuseSchema,
  judgeOutcomeSchema,
  judgeProfileIdentitySchema,
  type JudgeCapability,
  type JudgeOutcome,
  type JudgeProfileIdentity,
  type JudgeResult,
} from '../../src/core/judge/schema'
import { readSettings, toSettingsSnapshot, type SettingsSource } from '../../src/host/settings'
import { warningLogger } from './helpers/collectingLogger'
import {
  JUDGE_CASCADE_CONFIDENCE,
  JUDGE_CLI_DEFAULT_BUDGET_USD,
  JUDGE_EMBED_FALLBACK_CONFIDENCE,
  JUDGE_ENGINES,
  JUDGE_ISOTONIC_MIN_LABELS,
  MACHINE_SCOPED_SETTINGS,
  SETTING_DEFAULTS,
} from '../../src/shared/constants'

function settingSource(values: Record<string, unknown>): SettingsSource {
  return {
    get: (key: string) => values[key],
  }
}

const identity = {
  source: 'separate',
  providerId: 'fixture-provider',
  model: 'fixture-model',
  modelVersion: 'version-1',
  endpoint: 'https://fixture.invalid/v1',
} as const

const capability: JudgeCapability = {
  ...identity,
  captureId: 'synthetic-contract-fixture',
  logprobs: { kind: 'topk', topK: 5 },
  stated: true,
  systemone: false,
  reasoningForced: false,
  cache: true,
  contextWindowTokens: 32_000,
  minOutputTokens: 1,
}

const profile: JudgeProfileIdentity = {
  ...identity,
  technique: 'logprob',
  family: 'risk.destructive',
  promptVersion: 'prompt-1',
  criteriaVersion: 'criteria-1',
  fitVersion: 'fit-1',
}

function withoutField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
}

function result(): JudgeResult {
  return {
    model: identity.model,
    answers: {
      risk: { type: 'noul', noul: 0.8, probabilities: { true: 0.8, false: 0.2 } },
    },
    muse: {
      risk: {
        source: 'separate',
        technique: 'systemone',
        model: identity.model,
        label: 'uncalibrated',
        confidence: 0.28,
        vendorConfidence: 0.9,
        partial: false,
        uncertainCostUsd: '0.001',
        profileId: 'private-profile-id',
      },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  }
}

describe('phase-2 per-model capability contract', () => {
  it('requires the exact source/model/version/endpoint and named capture', () => {
    expect(judgeCapabilitySchema.parse(capability)).toEqual(capability)
    for (const field of Object.keys(capability)) {
      const incomplete = withoutField(capability, field)
      expect(judgeCapabilitySchema.safeParse(incomplete).success, field).toBe(false)
    }
    expect(judgeCapabilitySchema.safeParse({ ...capability, model: '' }).success).toBe(false)
  })

  it('distinguishes captured top-k, top-1, refusals, drops and unknown capabilities', () => {
    for (const kind of ['top1', 'refused', 'dropped', 'unknown']) {
      expect(judgeCapabilitySchema.safeParse({ ...capability, logprobs: { kind } }).success).toBe(
        true,
      )
    }
    for (const topK of [0, -1, 1.5, Infinity, '5']) {
      expect(
        judgeCapabilitySchema.safeParse({ ...capability, logprobs: { kind: 'topk', topK } })
          .success,
      ).toBe(false)
    }
    expect(
      judgeCapabilitySchema.safeParse({ ...capability, logprobs: { kind: 'topk' } }).success,
    ).toBe(false)
    expect(
      judgeCapabilitySchema.safeParse({ ...capability, logprobs: { kind: 'top1', topK: 5 } })
        .success,
    ).toBe(false)
    expect(
      judgeCapabilitySchema.safeParse({ ...capability, providerGuarantee: true }).success,
    ).toBe(false)
    for (const field of ['contextWindowTokens', 'minOutputTokens']) {
      for (const value of [0, -1, 1.5, Infinity, '1']) {
        expect(
          judgeCapabilitySchema.safeParse({ ...capability, [field]: value }).success,
          field,
        ).toBe(false)
      }
    }
  })
})

describe('phase-2 profile identity contract', () => {
  it('requires every binding field and excludes approximate top-1 calibration', () => {
    expect(judgeProfileIdentitySchema.parse(profile)).toEqual(profile)
    for (const field of Object.keys(profile)) {
      const incomplete = withoutField(profile, field)
      expect(judgeProfileIdentitySchema.safeParse(incomplete).success, field).toBe(false)
      expect(judgeProfileIdentitySchema.safeParse({ ...profile, [field]: '' }).success, field).toBe(
        false,
      )
    }
    expect(judgeProfileIdentitySchema.safeParse({ ...profile, technique: 'top1' }).success).toBe(
      false,
    )
    expect(judgeProfileIdentitySchema.safeParse({ ...profile, vendorConfidence: 1 }).success).toBe(
      false,
    )
  })
})

describe('phase-2 request-only runtime contract', () => {
  it('rejects an injected runtime that returns empty success', async () => {
    const runtime: JudgeRuntime = {
      judge: () =>
        Promise.resolve({
          outcome: 'answered',
          result: { ...result(), answers: {}, muse: {} },
        }),
    }
    const request = {
      state: 'synthetic',
      questions: { risk: { type: 'noul', instructions: 'Risk?' } },
    } as const
    const outcome: JudgeOutcome = await runtime.judge(request, new AbortController().signal)
    expect(judgeOutcomeSchema.safeParse(outcome).success).toBe(false)
  })

  it('refuses empty success, unknown reasons and content on a refusal', () => {
    expect(
      judgeOutcomeSchema.safeParse({
        outcome: 'answered',
        result: { ...result(), answers: {}, muse: {} },
      }).success,
    ).toBe(false)
    expect(judgeOutcomeSchema.safeParse({ outcome: 'no-answer' }).success).toBe(false)
    expect(judgeOutcomeSchema.safeParse({ outcome: 'answered' }).success).toBe(false)
    expect(judgeOutcomeSchema.safeParse({ outcome: 'no-answer', reason: 'allow' }).success).toBe(
      false,
    )
    expect(
      judgeOutcomeSchema.safeParse({ outcome: 'no-answer', reason: 'timeout', state: 'private' })
        .success,
    ).toBe(false)
  })

  it('refuses more answers than the common question cap', () => {
    const original = result()
    const ids = Array.from({ length: 65 }, (_, index) => String(index))
    const oversized = {
      ...original,
      answers: Object.fromEntries(ids.map((id) => [id, original.answers['risk']])),
      muse: Object.fromEntries(ids.map((id) => [id, original.muse['risk']])),
    }
    expect(judgeOutcomeSchema.safeParse({ outcome: 'answered', result: oversized }).success).toBe(
      false,
    )
  })

  it('keeps native answers unchanged with phase-2 technique, source and liability metadata', () => {
    for (const technique of ['systemone', 'sampling', 'contrastive', 'cascade', 'embedding']) {
      for (const source of ['separate', 'both']) {
        const original = result()
        const parsed = judgeOutcomeSchema.parse({
          outcome: 'answered',
          result: {
            ...original,
            muse: { risk: { ...original.muse['risk'], source, technique } },
          },
        })
        expect(parsed.outcome).toBe('answered')
        if (parsed.outcome === 'answered') expect(parsed.result.answers).toEqual(original.answers)
      }
    }
    const summary = judgeLogSummary(result())
    expect(summary.muse['risk']?.uncertainCostUsd).toBe('0.001')
    expect(JSON.stringify(summary)).not.toContain('private-profile-id')
    for (const uncertainCostUsd of [-1, Infinity, 0.01, '0.01.2']) {
      expect(
        judgeMuseSchema.safeParse({ ...result().muse['risk'], uncertainCostUsd }).success,
      ).toBe(false)
    }
    expect(judgeMuseSchema.safeParse({ ...result().muse['risk'], profileId: '' }).success).toBe(
      false,
    )
  })
})

describe('phase-2 settings preserve the single-model default', () => {
  it('accepts every engine and a separate identifier as machine-only host settings', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    )
    expect(manifest).toMatchObject({
      contributes: {
        configuration: {
          properties: {
            'museSpark.judge.engine': {
              enum: ['auto', 'same', 'separate', 'both', 'off'],
              default: 'auto',
              scope: 'machine',
            },
            'museSpark.judge.separate': { type: 'string', default: '', scope: 'machine' },
          },
        },
      },
    })
    expect(JUDGE_ENGINES).toEqual(['auto', 'same', 'separate', 'both', 'off'])
    expect(SETTING_DEFAULTS['judge.engine']).toBe('auto')
    expect(SETTING_DEFAULTS['judge.separate']).toBe('')
    expect(MACHINE_SCOPED_SETTINGS).toContain('judge.separate')
    for (const engine of JUDGE_ENGINES) {
      const warnings: string[] = []
      const settings = readSettings(
        settingSource({ 'judge.engine': engine, 'judge.separate': 'source/model' }),
        warningLogger(warnings),
      )
      expect(settings['judge.engine']).toBe(engine)
      expect(settings['judge.separate']).toBe('source/model')
      expect(isJudgeEngineOn(engine)).toBe(engine !== 'off')
      expect(toSettingsSnapshot(settings)).not.toHaveProperty('judge.separate')
    }
    const fallback = readSettings(
      settingSource({ 'judge.engine': 'invalid', 'judge.separate': 1 }),
      warningLogger([]),
    )
    expect(fallback['judge.engine']).toBe('auto')
    expect(fallback['judge.separate']).toBe('')
  })

  it('keeps named eligibility thresholds distinct from permission and a zero CLI paid cap', () => {
    // No per-question spending cap of its own: admission and the ledger's
    // remaining budget are the only ceilings (D121).
    expect(JUDGE_CASCADE_CONFIDENCE).toBe(0.8)
    expect(JUDGE_EMBED_FALLBACK_CONFIDENCE).toBe(0.8)
    expect(JUDGE_ISOTONIC_MIN_LABELS).toBe(200)
    expect(JUDGE_CLI_DEFAULT_BUDGET_USD).toBe(0)
  })
})
