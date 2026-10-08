import { EN } from '../../src/shared/l10n/en'
import { PaidUseConsent, paidUseQuestion } from '../../src/core/paid/paidConsent'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { judgeFeaturesLoader } from '../../src/runtime/judge/judgeBundle'
import { createLogger } from '../../src/host/logger'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import type { JudgeRuntimeBinding } from '../../src/core/judge/runtime'
import { embeddingHeadDigest, weightEnvelopeFor } from '../../src/core/judge/embedding/schema'
import { fitEmbeddingHead } from '../../src/core/judge/embedding/fit'
import { builtJudgeFactories } from './helpers/judgeFactoryBundles'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memento } from './helpers/memento'
import { wiringFixture } from './helpers/judgeWiring'
import { command, io, REQUEST } from './judgeCliFixtures'
import {
  embeddingLimits,
  embeddingSource,
  confidentVectors,
  groupedDataset,
} from './judgeEmbeddingFixtures'

const built = builtJudgeFactories()
function features() {
  return judgeFeaturesLoader({
    bundlePath: path.join(built.folder, 'judgeP2.js'),
    log: createLogger(new FakeLogOutputChannel()),
  })()
}
function binding(engine = 'both') {
  const fixture = wiringFixture()
  const value: JudgeRuntimeBinding = {
    ...fixture,
    context: { ...fixture.context, engine },
    separateVerified: true,
    separateLocality: 'verified-local',
  }
  return { ...fixture, value }
}
function embedded(locality: 'same-provider' | 'verified-local' = 'same-provider') {
  const fixture = binding('same')
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
  const source = embeddingSource({
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
    source: source.source,
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
  const value: JudgeRuntimeBinding = { ...fixture.value, embedding }
  return { ...fixture, value, embedding, embed: source.embed, allowsPaidUse, claims, prompts }
}

describe('phase-2 paths through the shipped lazy assembly', () => {
  it('reaches cascade from the runtime factory with one distinct attempt per source', async () => {
    const fixture = binding()
    const runtime = await features().createRuntime({ binding: () => fixture.value })
    const result = await runtime.judge(
      { ...REQUEST, model: 'chosen' },
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { source: 'both', technique: 'cascade' } } },
    })
    expect(fixture.same.run).toHaveBeenCalledTimes(1)
    expect(fixture.separate.run).toHaveBeenCalledTimes(1)
  })
  it.each(['ask', 'mcp'])(
    'reaches cascade from the %s surface through the real command assembly',
    async (action) => {
      const fixture = binding()
      const factory = features()
      const deps = await factory.createCommandDeps({
        binding: () => fixture.value,
        billing: 'free',
        worstCaseUsd: () => 0,
      })
      const input =
        action === 'ask'
          ? JSON.stringify(REQUEST)
          : `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'judge', arguments: REQUEST } })}\n`
      const streams = io(input)
      expect(
        await factory.runJudgeCommand(
          command(action, ['--engine', 'both', '--model', 'chosen']),
          streams,
          deps,
        ),
      ).toBe(0)
      expect(streams.output()).toContain('cascade')
      expect(fixture.same.run).toHaveBeenCalledTimes(1)
      expect(fixture.separate.run).toHaveBeenCalledTimes(1)
    },
  )
  it('reaches cascade through the window factory without changing the same-model fallback', async () => {
    const fixture = binding()
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
          binding: () => fixture.value,
          createRuntime: (deps) => features().createRuntime(deps),
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
      { backend: 'museCode', sessionId: 's1', turnId: 'turn-1', tool: 'bash', args: {} },
      'state',
    )
    await vi.waitFor(() => {
      expect(fixture.same.run).toHaveBeenCalledTimes(1)
    })
    expect(judge.readPanelSnapshot()?.effectiveSource).toBe('both')
    expect(fence?.read()).toBe('caution')
    judge.dispose()
  })
  it('drops a cascade verdict and prevents the follow-up when its turn changes during the first source', async () => {
    const fixture = binding()
    let current = fixture.value
    fixture.separate.run.mockImplementationOnce(async (request, signal) => {
      current = { ...current, context: { ...current.context, turn: 'replacement' } }
      return await binding().separate.run(request, signal)
    })
    const runtime = await features().createRuntime({ binding: () => current })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(fixture.same.run).not.toHaveBeenCalled()
  })
  it('reaches capable paid embeddings, publishes the manifest ceiling before dispatch and asks consent once', async () => {
    const fixture = embedded()
    const status = vi.fn()
    const runtime = await features().createRuntime({
      binding: () => fixture.value,
      embeddingStatus: status,
    })
    for (let index = 0; index < 2; index += 1) {
      const result = await runtime.judge(REQUEST, new AbortController().signal)
      expect(result).toMatchObject({
        outcome: 'answered',
        result: { muse: { risk: { technique: 'embedding', uncertainCostUsd: 0.0002 } } },
      })
    }
    expect(status).toHaveBeenCalledWith({ available: true, attemptCeiling: 408 })
    expect(status.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.embed.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(fixture.allowsPaidUse).toHaveBeenCalledTimes(1)
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0]?.detail).toContain('$0.000200')
    expect(fixture.prompts[0]?.detail).toContain('$1.00')
    expect(fixture.embed).toHaveBeenCalledTimes(2)
    expect(fixture.claims).toHaveLength(2)
    expect(fixture.same.run).not.toHaveBeenCalled()
  })
  it('offers free verified-local embeddings only after explicit local opt-in', async () => {
    const fixture = embedded('verified-local')
    const runtime = await features().createRuntime({ binding: () => fixture.value })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'embedding' } } },
    })
    expect(fixture.claims).toHaveLength(0)
    expect(fixture.allowsPaidUse).not.toHaveBeenCalled()
  })
  it('reports unavailable capability and preserves the full judge without embedding dispatch or consent', async () => {
    const fixture = embedded()
    const status = vi.fn()
    const value = { ...fixture.value, embedding: { ...fixture.embedding, capable: false } }
    const runtime = await features().createRuntime({
      binding: () => value,
      embeddingStatus: status,
    })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'stated' } } },
    })
    expect(status).toHaveBeenCalledWith({ available: false, reason: 'capability-unavailable' })
    expect(fixture.embed).not.toHaveBeenCalled()
    expect(fixture.allowsPaidUse).not.toHaveBeenCalled()
  })
})
