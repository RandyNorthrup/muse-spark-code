// Regression tests for the M98 phase-2 review findings (one P1, five P2s).
// Each test fails on m98/p2-bind's head and passes with the fix. All spending
// is fake; no live, paid or local-model call is made.
import { describe, expect, it, vi } from 'vitest'
import { createJudgeRuntime, type JudgeRuntimeBinding } from '../../src/core/judge/runtime'
import type { JudgeTechniqueReceipt } from '../../src/core/judge/sampling'
import { parseCalibrationProfile } from '../../src/core/judge/calibration/schema'
import { embeddingAvailability } from '../../src/core/judge/embedding/availability'
import { runEmbeddingJudge } from '../../src/core/judge/embedding/route'
import { createJudgeCommandDeps } from '../../src/runtime/judge/assembly'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { embeddedBinding, phase2Window, surfaceInput } from './helpers/judgePhase2Rig'
import { wiringFixture, wiringLimits } from './helpers/judgeWiring'
import { command, io, REQUEST } from './judgeCliFixtures'

function loadEmbedding() {
  return Promise.resolve({ run: runEmbeddingJudge, availability: embeddingAvailability })
}

/** A run-cap refusal sends nothing: no dispatch, no reservation, no consent. */
function expectOverBudgetRefusal(
  code: number,
  output: string,
  rig: Pick<ReturnType<typeof embeddedBinding>, 'embed' | 'claims'>,
): void {
  expect(code).toBe(4)
  expect(output).toContain('over-budget')
  expect(rig.embed).not.toHaveBeenCalled()
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
      worstCaseUsd: () => 0,
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
    if (resolved === undefined) throw new Error('source should resolve')
    // The embedding tariff changes after resolution, before dispatch.
    current = {
      ...current,
      embedding:
        current.embedding === undefined
          ? undefined
          : {
              ...current.embedding,
              source: { ...current.embedding.source, uncachedCostUsd: 0.2 },
            },
    }
    expect(resolved.worstCaseUsd(REQUEST)).toBe(0.0002)
    expect(await deps.admitPaid?.(resolved, REQUEST, 0.0001, signal)).toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    expect(rig.embed).not.toHaveBeenCalled()
    expect(rig.claims).toHaveLength(0)
    const streams = io(JSON.stringify(REQUEST))
    const code = await runJudgeCommand(parsed, streams, {
      resolveSource: () => Promise.resolve(resolved),
      ...(deps.admitPaid !== undefined && { admitPaid: deps.admitPaid }),
    })
    expect(code).toBe(0)
    expect(rig.embed).toHaveBeenCalledTimes(1)
    expect(rig.claims).toEqual([0.0002])
  })

  it('treats a free judge with paid embeddings as paid, so --budget-usd 0 refuses first', async () => {
    const rig = embeddedBinding('same-provider')
    const deps = createJudgeCommandDeps({
      binding: () => rig.value,
      billing: 'free',
      worstCaseUsd: () => 0,
      loadEmbedding,
    })
    const parsed = command('ask', ['--engine', 'same', '--model', 'chosen', '--budget-usd', '0'])
    const streams = io(JSON.stringify(REQUEST))
    const code = await runJudgeCommand(parsed, streams, deps)
    expectOverBudgetRefusal(code, streams.output(), rig)
    expect(rig.allowsPaidUse).not.toHaveBeenCalled()
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
        worstCaseUsd: () => 0,
        loadEmbedding,
      })
      const parsed = command(action, ['--engine', 'same', '--model', 'chosen'])
      const streams = io(surfaceInput(action))
      expect(await runJudgeCommand(parsed, streams, deps)).toBe(0)
      expect(streams.output()).toContain('embedding')
      expect(streams.output()).not.toContain('isError')
      expect(rig.embed).toHaveBeenCalledTimes(1)
    },
  )

  it('still refuses a genuinely foreign model', async () => {
    const rig = embeddedBinding('verified-local')
    if (rig.value.same === undefined) throw new Error('fixture needs a same side')
    const intruder = {
      ...rig.value,
      embedding: { ...rig.value.embedding, capable: false },
      same: {
        ...rig.value.same,
        run: vi.fn((): Promise<JudgeTechniqueReceipt> =>
          Promise.resolve({
            reservedCostUsd: 0,
            settledCostUsd: 0,
            uncertainCostUsd: 0,
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
        ),
      },
    }
    const deps = createJudgeCommandDeps({
      binding: () => intruder,
      billing: 'free',
      worstCaseUsd: () => 0,
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

describe('P2: a binding from another turn never becomes the action snapshot', () => {
  it('refuses a stale turn-1 binding for a turn-2 action without reaching its fence', async () => {
    const fixture = wiringFixture()
    const stale: JudgeRuntimeBinding = {
      ...fixture,
      context: { ...fixture.context, engine: 'both', turn: 'turn-1' },
      separateVerified: true,
      separateLocality: 'verified-local',
    }
    let runtimeCreations = 0
    const judge = phase2Window({
      binding: () => stale,
      createRuntime: (runtimeDeps) => {
        runtimeCreations += 1
        return Promise.resolve(createJudgeRuntime(runtimeDeps))
      },
    })
    const fence = judge.start(
      { backend: 'museCode', sessionId: 's1', turnId: 'turn-2', tool: 'bash', args: {} },
      'state',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(runtimeCreations).toBe(0)
    expect(fixture.same.run).not.toHaveBeenCalled()
    expect(fixture.separate.run).not.toHaveBeenCalled()
    expect(fence?.read()).not.toBe('caution')
    judge.dispose()
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
      separateLocality: 'verified-local',
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
    const status = vi.fn()
    const runtime = createJudgeRuntime({ binding: () => value, status })
    const result = await runtime.judge(
      { ...REQUEST, model: 'chosen' },
      new AbortController().signal,
    )
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'same',
        reason: 'auto-same',
        autoSameReason: 'profile-missing',
      }),
    )
    expect(result).toMatchObject({ outcome: 'answered' })
    expect(fixture.same.run).toHaveBeenCalledTimes(1)
    expect(fixture.separate.run).not.toHaveBeenCalled()
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
    expect(rig.allowsPaidUse).toHaveBeenCalledTimes(1)
    expect(rig.prompts).toHaveLength(1)
    expect(rig.embed).toHaveBeenCalledTimes(2)
    expect(rig.claims).toHaveLength(2)
  })
})
