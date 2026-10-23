// Regression tests for the M98 phase-2 review findings (one P1, five P2s).
// Each test fails on m98/p2-bind's head and passes with the fix. Spending is
// recorded in exact amounts on a recording ledger; no live, paid or
// local-model call is made.
import { describe, expect, it } from 'vitest'
import { createJudgeRuntime, type JudgeRuntimeBinding } from '../../src/core/judge/runtime'
import type { JudgeTechniqueReceipt } from '../../src/core/judge/sampling'
import { parseCalibrationProfile } from '../../src/core/judge/calibration/schema'
import { embeddingAvailability } from '../../src/core/judge/embedding/availability'
import { runEmbeddingJudge } from '../../src/core/judge/embedding/route'
import { createJudgeCommandDeps } from '../../src/runtime/judge/assembly'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { embeddedBinding, surfaceInput } from './helpers/judgePhase2Rig'
import { wiringFixture, wiringLimits } from './helpers/judgeWiring'
import { Usd } from '../../src/shared/usd'
import { command, io, REQUEST } from './judgeCliFixtures'

function loadEmbedding() {
  return Promise.resolve({ run: runEmbeddingJudge, availability: embeddingAvailability })
}

/** A run-cap refusal sends nothing: no dispatch, no reservation, no consent. */
function expectOverBudgetRefusal(
  code: number,
  output: string,
  rig: Pick<ReturnType<typeof embeddedBinding>, 'embedCalls' | 'claims'>,
): void {
  expect(code).toBe(4)
  expect(output).toContain('over-budget')
  expect(rig.embedCalls).toHaveLength(0)
  expect(rig.claims).toHaveLength(0)
}

/** The same recorded profile re-identified as logprob evidence. */
function asLogprobProfile(profile: unknown): unknown {
  const parsed = parseCalibrationProfile(profile, wiringLimits)
  if (parsed === undefined) throw new Error('fixture profile should parse')
  return { ...parsed, identity: { ...parsed.identity, technique: 'logprob' } }
}

describe('P1: the CLI/MCP run budget constrains the dispatched binding', () => {
  it('keeps the planned tariff when the binding rises after resolution, and refuses an undersized reservation', async () => {
    // Redesign (RVM98P2BF): the run's one plan holds the tariff it was
    // priced at. A later tariff rise reaches the next plan, never this
    // dispatch; a reservation below the plan's ceiling sends nothing.
    const rig = embeddedBinding('same-provider')
    let current: JudgeRuntimeBinding = rig.value
    const deps = createJudgeCommandDeps({
      binding: () => current,
      billing: 'paid',
      worstCaseUsd: () => Usd.from(0).toAmount(),
      loadEmbedding,
    })
    const signal = new AbortController().signal
    const parsed = command('ask', [
      '--engine',
      'same',
      '--model',
      'chosen',
      '--budget-usd',
      '0.0002',
    ])
    const resolved = await deps.resolveSource?.(parsed.options, signal, REQUEST)
    if (resolved === undefined || 'outcome' in resolved) throw new Error('source should resolve')
    // The embedding tariff changes after resolution, before dispatch.
    current = {
      ...current,
      embedding:
        current.embedding === undefined
          ? undefined
          : {
              ...current.embedding,
              source: { ...current.embedding.source, uncachedCostUsd: Usd.from(0.2).toAmount() },
            },
    }
    expect(resolved.worstCaseUsd(REQUEST)).toBe('0.0002')
    expect(await deps.admitPaid?.(resolved, REQUEST, Usd.from(0.0001).toAmount(), signal)).toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    expect(rig.embedCalls).toHaveLength(0)
    expect(rig.claims).toHaveLength(0)
    const streams = io(JSON.stringify(REQUEST))
    const code = await runJudgeCommand(parsed, streams, {
      resolveSource: () => Promise.resolve(resolved),
      ...(deps.admitPaid !== undefined && { admitPaid: deps.admitPaid }),
    })
    expect(code).toBe(0)
    expect(rig.embedCalls).toHaveLength(1)
    expect(rig.claims).toEqual([Usd.from(0.0002).toAmount()])
  })

  it('treats a free judge with paid embeddings as paid, so --budget-usd 0 refuses first', async () => {
    const rig = embeddedBinding('same-provider')
    const deps = createJudgeCommandDeps({
      binding: () => rig.value,
      billing: 'free',
      worstCaseUsd: () => Usd.from(0).toAmount(),
      loadEmbedding,
    })
    const parsed = command('ask', ['--engine', 'same', '--model', 'chosen', '--budget-usd', '0'])
    const streams = io(JSON.stringify(REQUEST))
    const code = await runJudgeCommand(parsed, streams, deps)
    expectOverBudgetRefusal(code, streams.output(), rig)
    expect(rig.allowsCalls).toHaveLength(0)
    expect(rig.prompts).toHaveLength(0)
  })
})

describe('P2: embedding answers name their embedding model', () => {
  it.each(['ask', 'mcp'])(
    'accepts the declared embedding model from the %s surface',
    async (action) => {
      const rig = embeddedBinding('verified-local')
      const deps = createJudgeCommandDeps({
        binding: () => rig.value,
        billing: 'free',
        worstCaseUsd: () => Usd.from(0).toAmount(),
        loadEmbedding,
      })
      const parsed = command(action, ['--engine', 'same', '--model', 'chosen'])
      const streams = io(surfaceInput(action))
      expect(await runJudgeCommand(parsed, streams, deps)).toBe(0)
      expect(streams.output()).toContain('embedding')
      expect(streams.output()).not.toContain('isError')
      expect(rig.embedCalls).toHaveLength(1)
    },
  )

  it('still refuses a genuinely foreign model', async () => {
    const rig = embeddedBinding('verified-local')
    const intruder = {
      ...rig.value,
      embedding: { ...rig.value.embedding, capable: false },
      same: {
        ...rig.value.same,
        run: (): Promise<JudgeTechniqueReceipt> =>
          Promise.resolve({
            reservedCostUsd: Usd.from(0).toAmount(),
            settledCostUsd: Usd.from(0).toAmount(),
            uncertainCostUsd: Usd.from(0).toAmount(),
            outcome: {
              outcome: 'answered',
              result: {
                model: 'intruder-model',
                answers: {
                  risk: { type: 'noul', noul: 0.8, probabilities: { true: 0.8, false: 0.2 } },
                },
                muse: {
                  risk: {
                    source: 'same',
                    model: 'intruder-model',
                    technique: 'stated',
                    label: 'uncalibrated',
                    confidence: 0.2,
                    partial: false,
                  },
                },
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            },
          }),
      },
    }
    const deps = createJudgeCommandDeps({
      binding: () => intruder,
      billing: 'free',
      worstCaseUsd: () => Usd.from(0).toAmount(),
      loadEmbedding,
    })
    const streams = io(JSON.stringify(REQUEST))
    expect(
      await runJudgeCommand(
        command('ask', ['--engine', 'same', '--model', 'chosen']),
        streams,
        deps,
      ),
    ).toBe(4)
    expect(streams.output()).toContain('engine-failure')
  })
})

describe('P2: adoption profiles must serve the current technique', () => {
  it('keeps auto on same with profile-missing for logprob evidence on a stated-only source', async () => {
    const fixture = wiringFixture()
    const sameProfile = asLogprobProfile(fixture.adoption.record.same.profile)
    const separateProfile = asLogprobProfile(fixture.adoption.record.separate.profile)
    const sameDataset = {
      ...fixture.adoption.record.same.dataset,
      identity: { ...fixture.adoption.record.same.dataset.identity, technique: 'logprob' },
    }
    const separateDataset = {
      ...fixture.adoption.record.separate.dataset,
      identity: { ...fixture.adoption.record.separate.dataset.identity, technique: 'logprob' },
    }
    // Capabilities refuse logprobs and serve stated confidence only; the
    // recorded evidence is logprob, so it cannot qualify the stated path.
    // The held-out receipt matches the logprob profiles, so only the
    // technique check stands between this binding and automatic `both`.
    const record = {
      ...fixture.adoption.record,
      same: { profile: sameProfile, dataset: sameDataset },
      separate: { profile: separateProfile, dataset: separateDataset },
    }
    const adoptionContext = { ...fixture.adoption.context, sameProfile, separateProfile }
    const separateReadiness = fixture.context.separate
    if (separateReadiness?.adoption === undefined)
      throw new Error('fixture needs adoption readiness')
    const value: JudgeRuntimeBinding = {
      ...fixture,
      separateVerified: true,
      separateLocality: 'verified-local' as const,
      context: {
        ...fixture.context,
        separate: {
          ...separateReadiness,
          adoption: { ...separateReadiness.adoption, record, context: adoptionContext },
        },
      },
      same: { ...fixture.same, profile: sameProfile },
      separate: { ...fixture.separate, profile: separateProfile },
    }
    const statuses: unknown[] = []
    const runtime = createJudgeRuntime({
      binding: () => value,
      status: (status) => {
        statuses.push(status)
      },
    })
    const result = await runtime.judge(
      { ...REQUEST, model: 'chosen' },
      new AbortController().signal,
    )
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({
      mode: 'same',
      reason: 'auto-same',
      autoSameReason: 'profile-missing',
    })
    expect(result).toMatchObject({ outcome: 'answered' })
    expect(fixture.same.calls).toHaveLength(1)
    expect(fixture.separate.calls).toHaveLength(0)
  })
})

describe('P2: concurrent first embedding uses share one consent decision', () => {
  it('asks once for two simultaneous judges and grants before either dispatch', async () => {
    const rig = embeddedBinding('same-provider', 10)
    const runtime = createJudgeRuntime({ binding: () => rig.value, loadEmbedding })
    const signal = new AbortController().signal
    const [first, second] = await Promise.all([
      runtime.judge({ ...REQUEST }, signal),
      runtime.judge({ ...REQUEST }, signal),
    ])
    for (const result of [first, second]) {
      expect(result).toMatchObject({
        outcome: 'answered',
        result: { muse: { risk: { technique: 'embedding' } } },
      })
    }
    expect(rig.allowsCalls).toHaveLength(1)
    expect(rig.prompts).toHaveLength(1)
    expect(rig.embedCalls).toHaveLength(2)
    expect(rig.claims).toHaveLength(2)
  })
})
