// Regression tests for the M98 phase-2 review findings (one P1, five P2s).
// Each test fails on m98/p2-bind's head and passes with the fix. All spending
// is fake; no live, paid or local-model call is made.
import { EN } from '../../src/shared/l10n/en'
import { PaidUseConsent, paidUseQuestion } from '../../src/core/paid/paidConsent'
import { describe, expect, it, vi } from 'vitest'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import { createJudgeRuntime, type JudgeRuntimeBinding } from '../../src/core/judge/runtime'
import type { JudgeTechniqueReceipt } from '../../src/core/judge/sampling'
import { parseCalibrationProfile } from '../../src/core/judge/calibration/schema'
import { embeddingAvailability } from '../../src/core/judge/embedding/availability'
import { fitEmbeddingHead } from '../../src/core/judge/embedding/fit'
import { runEmbeddingJudge } from '../../src/core/judge/embedding/route'
import { embeddingHeadDigest, weightEnvelopeFor } from '../../src/core/judge/embedding/schema'
import { createJudgeCommandDeps } from '../../src/runtime/judge/assembly'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { FakeLogOutputChannel } from './helpers/fakes'
import { wiringFixture, wiringLimits } from './helpers/judgeWiring'
import { memento } from './helpers/memento'
import { command, io, REQUEST } from './judgeCliFixtures'
import {
  confidentVectors,
  embeddingLimits,
  embeddingSource,
  groupedDataset,
} from './judgeEmbeddingFixtures'

function loadEmbedding() {
  return Promise.resolve({ run: runEmbeddingJudge, availability: embeddingAvailability })
}

/** The same recorded profile re-identified as logprob evidence. */
function asLogprobProfile(profile: unknown): unknown {
  const parsed = parseCalibrationProfile(profile, wiringLimits)
  if (parsed === undefined) throw new Error('fixture profile should parse')
  return { ...parsed, identity: { ...parsed.identity, technique: 'logprob' } }
}

/** A command binding with a capable embedding transport, paid or verified-local. */
function embeddedBinding(locality: 'same-provider' | 'verified-local', consentDelayMs = 0) {
  const fixture = wiringFixture()
  const value: JudgeRuntimeBinding = {
    ...fixture,
    context: { ...fixture.context, engine: 'same' },
    separateVerified: true,
    separateLocality: 'verified-local',
    attemptCostUsd: () => 0,
  }
  const dataset = groupedDataset(200)
  dataset.identity.endpoint = 'fixture://offline'
  dataset.identity.providerId = 'fixture-provider'
  const fitted = fitEmbeddingHead(
    dataset,
    { optedIn: true },
    { ...embeddingLimits, maxSamples: 1000, minLabels: 200 },
  )
  if (!('version' in fitted)) throw new Error(fitted.reason)
  const head = { ...fitted, evidence: 'independent' as const }
  head.digest = embeddingHeadDigest(head)
  const built = embeddingSource({
    locality,
    endpoint: 'fixture://offline',
    uncachedCostUsd: locality === 'verified-local' ? 0 : 0.0002,
    embed: () => Promise.resolve(confidentVectors),
  })
  const prompts: { title: string; detail: string }[] = []
  const consent = new PaidUseConsent({
    isOn: () => true,
    canRemember: () => false,
    readGrants: () => new Set(),
    writeGrants: () => Promise.resolve(),
    log: new FakeLogOutputChannel(),
    ask: async (request) => {
      prompts.push(await paidUseQuestion(request))
      if (consentDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, consentDelayMs))
      return 'once'
    },
  })
  const allowsPaidUse = vi.fn((request: Parameters<typeof consent.allows>[0]) =>
    consent.allows(request),
  )
  const claims: number[] = []
  const ledger = {
    remainingUsd: () => Promise.resolve(1),
    reserve: (cost: number) => {
      claims.push(cost)
      return Promise.resolve({
        claimId: `claim-${String(claims.length)}`,
        reservedUsd: cost,
        check: vi.fn(),
        settle: vi.fn(() => Promise.resolve()),
      })
    },
  }
  const manifest = {
    identity: head.identity,
    evidence: 'independent',
    rows: dataset.samples.map((sample) => ({
      id: sample.id,
      labelId: sample.labelId,
      taskGroup: sample.taskGroup,
      repositoryGroup: sample.repositoryGroup,
      split: sample.split,
      labelSource: sample.labelSource,
      label: sample.label === 1,
      embeddingAttempts: 1,
      fallbackAttempts: 1,
      ...(sample.split === 'evaluation' && {
        fullProbability: 0.7,
        embeddingProbability: sample.label === 1 ? 0.9 : 0.1,
      }),
    })),
  }
  const embedding = {
    capable: true,
    source: built.source,
    localOptedIn: true,
    head,
    weights: weightEnvelopeFor(head),
    manifest,
    fitVersion: head.identity.fitVersion,
    gate: { isOn: () => true },
    isEnabled: () => true,
    priceFingerprint: 'fixture-verified-price',
    consentEpoch: () => 'epoch-1',
    allowsPaidUse,
    dailyBudgetUsd: () => 1,
    ledger,
  }
  return {
    ...fixture,
    value: { ...value, embedding },
    embed: built.embed,
    allowsPaidUse,
    claims,
    prompts,
  }
}

describe('P1: the CLI/MCP run budget constrains the dispatched binding', () => {
  it('refuses a tariff rise between source resolution and dispatch before anything is sent', async () => {
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
    const resolved = await deps.resolveSource?.(parsed.options, signal)
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
    const streams = io(JSON.stringify(REQUEST))
    const code = await runJudgeCommand(parsed, streams, {
      resolveSource: () => Promise.resolve(resolved),
      ...(deps.admitPaid !== undefined && { admitPaid: deps.admitPaid }),
    })
    expect(code).toBe(4)
    expect(streams.output()).toContain('over-budget')
    expect(rig.embed).not.toHaveBeenCalled()
    expect(rig.claims).toHaveLength(0)
    expect(rig.prompts).toHaveLength(0)
    // The admission layer re-checks the same cap against the changed
    // binding, so a stale reservation cannot dispatch either.
    expect(await deps.admitPaid?.(resolved, REQUEST, 0.0002, signal)).toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    expect(rig.embed).not.toHaveBeenCalled()
    expect(rig.claims).toHaveLength(0)
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
    expect(code).toBe(4)
    expect(streams.output()).toContain('over-budget')
    expect(rig.embed).not.toHaveBeenCalled()
    expect(rig.claims).toHaveLength(0)
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
      const input =
        action === 'ask'
          ? JSON.stringify(REQUEST)
          : `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'judge', arguments: REQUEST } })}\n`
      const streams = io(input)
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
    const paid = createPaidFeatures({
      globalState: memento(new Map()),
      workspaceState: memento(new Map()),
      isSettingOn: () => false,
      isJudgeOn: () => true,
      isKeyStored: () => false,
      canRememberPaidUse: () => false,
      log: new FakeLogOutputChannel(),
    })
    const judge = createWindowJudge(
      {
        phase2: {
          binding: () => stale,
          createRuntime: (runtimeDeps) => {
            runtimeCreations += 1
            return Promise.resolve(createJudgeRuntime(runtimeDeps))
          },
        },
        engine: () => 'both',
        context: () => ({
          backend: 'museCode',
          modelId: 'chosen',
          ownerId: 'owner-1',
          contextLimit: 32_000,
          confidential: false,
        }),
        readSettingsText: () => undefined,
        startSession: vi.fn(),
        modelApi: () => undefined,
        paid,
        emit: vi.fn(),
        status: vi.fn(),
        notice: vi.fn(),
        log: new FakeLogOutputChannel(),
      },
      EN,
      'en',
    )
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
    const value: JudgeRuntimeBinding = {
      ...fixture,
      separateVerified: true,
      separateLocality: 'verified-local',
      same: { ...fixture.same, profile: sameProfile },
      separate: { ...fixture.separate, profile: separateProfile },
      adoption: {
        ...fixture.adoption,
        record: {
          ...fixture.adoption.record,
          same: { profile: sameProfile, dataset: sameDataset },
          separate: { profile: separateProfile, dataset: separateDataset },
        },
        context: { ...fixture.adoption.context, sameProfile, separateProfile },
      },
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
