// M125 lane E: the engine resolver, latency windows, slack rules,
// the deterministic-first cascade, the packer and the closed `install`
// gap. A hanging engine stops costing waits by its third miss and
// returns only through the reprobe; the chat model never serves I or
// S; a class with no fitting engine runs deterministic checks with
// its reason.
import { describe, expect, it } from 'vitest'
import { runCascade } from '../../src/core/judge/fast/cascade'
import { EngineLatency, ProbeTracker } from '../../src/core/judge/fast/latency'
import { packByState } from '../../src/core/judge/fast/pack'
import {
  descriptorForSide,
  resolveFastEngine,
  type FastEngineDescriptor,
} from '../../src/core/judge/fast/resolve'
import { isLateAnswer, slackWindow } from '../../src/core/judge/fast/slack'
import type { Phase2SeparateSource } from '../../src/core/judge/binding'
import type { JudgeRuntime } from '../../src/core/judge/engine'
import { buildSeparateSource } from '../../src/core/judge/sides'
import type { JudgeCapability, JudgeOutcome } from '../../src/core/judge/schema'
import { Usd } from '../../src/shared/usd'

const engine = (
  overrides: Partial<FastEngineDescriptor> & { id: string },
): FastEngineDescriptor => ({
  kind: 'local-verified',
  state: 'ready',
  p95Ms: 200,
  selection: 'auto',
  ...overrides,
})

const silentAnswer: JudgeOutcome = { outcome: 'no-answer', reason: 'source-unavailable' }

const testCapability = (overrides: Partial<JudgeCapability>): JudgeCapability => ({
  source: 'separate',
  providerId: 'acme',
  model: 'tev1',
  modelVersion: 'tev1',
  endpoint: 'https://acme.example/judge',
  captureId: 'cap',
  logprobs: { kind: 'unknown' },
  stated: false,
  systemone: true,
  reasoningForced: false,
  cache: false,
  contextWindowTokens: 4096,
  minOutputTokens: 1,
  ...overrides,
})

const testSource = (locality: Phase2SeparateSource['locality']): Phase2SeparateSource => ({
  runtime: { judge: () => Promise.resolve(silentAnswer) },
  capability: testCapability({}),
  fitVersion: '',
  verified: true,
  locality,
})

describe('fast engine latency windows', () => {
  it('suspends by the third trailing miss after fifty fast answers, and only then', () => {
    const latency = new EngineLatency()
    for (let at = 0; at < 50; at += 1) latency.record({ latencyMs: 100 }, at)
    expect(latency.p95()).toBe(100)
    expect(latency.isSuspended()).toBe(false)
    latency.record({ miss: true }, 50)
    latency.record({ miss: true }, 51)
    expect(latency.isSuspended()).toBe(false)
    latency.record({ miss: true }, 52)
    expect(latency.isSuspended()).toBe(true)
    expect(latency.p95()).toBe(Infinity)
  })

  it('breaks the suspension run on any answer and keeps fifty attempts', () => {
    const latency = new EngineLatency()
    latency.record({ miss: true }, 0)
    latency.record({ latencyMs: 100 }, 1)
    latency.record({ miss: true }, 2)
    latency.record({ miss: true }, 3)
    expect(latency.trailingMisses()).toBe(2)
    expect(latency.isSuspended()).toBe(false)
    for (let at = 4; at < 60; at += 1) latency.record({ latencyMs: 100 }, at)
    expect(latency.size).toBe(50)
    expect(latency.isSuspended()).toBe(false)
    latency.reset()
    expect(latency.size).toBe(0)
    expect(latency.p95()).toBe(Infinity)
  })

  it('expires hosted samples past their TTL', () => {
    const latency = new EngineLatency()
    latency.record({ latencyMs: 100 }, 0)
    latency.record({ latencyMs: 100 }, 3_600_000)
    latency.prune(7_200_000, 3_600_000)
    expect(latency.size).toBe(1)
  })

  it('requalifies only on three consecutive in-budget probes, and warms up on one', () => {
    const requalify = new ProbeTracker()
    expect(requalify.probe({ latencyMs: 100 }, 5000)).toBe(false)
    expect(requalify.probe({ latencyMs: 100 }, 5000)).toBe(false)
    expect(requalify.probe({ miss: true }, 5000)).toBe(false)
    expect(requalify.progress).toBe(0)
    expect(requalify.probe({ latencyMs: 100 }, 5000)).toBe(false)
    expect(requalify.probe({ latencyMs: 6000 }, 5000)).toBe(false)
    expect(requalify.probe({ latencyMs: 100 }, 5000)).toBe(false)
    expect(requalify.probe({ latencyMs: 100 }, 5000)).toBe(false)
    expect(requalify.probe({ latencyMs: 100 }, 5000)).toBe(true)
    const warmup = new ProbeTracker(1)
    expect(warmup.probe({ latencyMs: 100 }, 300)).toBe(true)
  })
})

describe('fast engine resolution', () => {
  it('chooses the first engine its class admits', () => {
    const slow = engine({ id: 'slow', p95Ms: 9000 })
    const fast = engine({ id: 'fast', p95Ms: 200 })
    const verdict = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [slow, fast],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(verdict.engine?.id).toBe('fast')
  })

  it('never serves inline or slack from the chat model, but allows it at the boundary', () => {
    const chat = engine({ id: 'chat', kind: 'chat', p95Ms: 10 })
    for (const decision of ['triage.needFull', 'loop.stuck'] as const) {
      const verdict = resolveFastEngine({
        decision,
        engines: [chat],
        window: 'real',
        confidential: false,
        hostedConsented: true,
      })
      expect(verdict.engine, decision).toBeUndefined()
    }
    const boundary = resolveFastEngine({
      decision: 'edit.misfit',
      engines: [chat],
      window: 'none',
      confidential: false,
      hostedConsented: true,
    })
    expect(boundary.engine?.id).toBe('chat')
  })

  it('names why no engine serves the decision', () => {
    const hosted = engine({ id: 'hosted', kind: 'hosted', p95Ms: 200 })
    const confidential = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [hosted],
      window: 'real',
      confidential: true,
      hostedConsented: true,
    })
    expect(confidential).toMatchObject({ engine: undefined, reason: 'confidential-excludes' })
    const consent = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [hosted],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(consent).toMatchObject({ engine: undefined, reason: 'consent-needed' })
    const unverified = engine({ id: 'local', kind: 'local-unverified', p95Ms: 200 })
    const explicit = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [unverified],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(explicit).toMatchObject({ engine: undefined, reason: 'explicit-needed' })
    const chosen = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [
        engine({ id: 'local', kind: 'local-unverified', p95Ms: 200, selection: 'explicit' }),
      ],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(chosen.engine?.id).toBe('local')
    const suspended = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [engine({ id: 'hung', state: 'suspended', p95Ms: Infinity })],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(suspended).toMatchObject({ engine: undefined, reason: 'suspended-reprobe' })
    const unloaded = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [engine({ id: 'cold', state: 'unloaded', p95Ms: Infinity })],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(unloaded).toMatchObject({ engine: undefined, reason: 'preload-needed' })
    const unmeasured = resolveFastEngine({
      decision: 'loop.stuck',
      engines: [engine({ id: 'new', state: 'unmeasured', p95Ms: Infinity })],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(unmeasured).toMatchObject({ engine: undefined, reason: 'unmeasured-warmup' })
    const tooSlow = resolveFastEngine({
      decision: 'triage.needFull',
      engines: [engine({ id: 'slow', p95Ms: 9000 })],
      window: 'real',
      confidential: false,
      hostedConsented: false,
    })
    expect(tooSlow).toMatchObject({ engine: undefined, reason: 'no-engine-fits' })
  })

  it('describes built sides to the resolver by locality', () => {
    expect(descriptorForSide(testSource('remote'), 'ready', 200, 'auto').kind).toBe('hosted')
    expect(descriptorForSide(testSource('verified-local'), 'ready', 200, 'auto').kind).toBe(
      'local-verified',
    )
    expect(descriptorForSide(testSource('unverified-local'), 'ready', 200, 'auto').kind).toBe(
      'local-unverified',
    )
    expect(descriptorForSide(testSource('remote'), 'ready', 200, 'auto').id).toBe(
      'acme:tev1:https://acme.example/judge',
    )
  })
})

describe('slack scheduling', () => {
  it('offers a real window everywhere but a lone result', () => {
    for (const kind of ['generation', 'round', 'hooks', 'verification', 'compaction'] as const)
      expect(slackWindow(kind)).toBe('real')
    expect(slackWindow('lone')).toBe('none')
  })

  it('calls an answer late only past its deadline', () => {
    expect(isLateAnswer(0, 300, 300)).toBe(false)
    expect(isLateAnswer(0, 301, 300)).toBe(true)
    expect(isLateAnswer(NaN, 10, 300)).toBe(true)
  })
})

/** On a deterministic miss the engine's answer wins, and an abstaining engine falls back. */
async function expectEngineThenAbstention(deadlineMs: number | undefined): Promise<void> {
  const miss = { deterministic: () => ({ hit: false }) as const, fallback: () => 'today' }
  const hit = await runCascade({ ...miss, engine: () => Promise.resolve('engine'), deadlineMs })
  expect(hit).toEqual({ value: 'engine', engine: 'hit' })
  const abstained = await runCascade({
    ...miss,
    engine: () => Promise.resolve(undefined),
    deadlineMs,
  })
  expect(abstained).toEqual({ value: 'today', engine: 'abstained' })
}

describe('deterministic-first cascade', () => {
  it('ends on a deterministic hit with no engine call', async () => {
    let called = 0
    const result = await runCascade({
      deterministic: () => ({ hit: true, value: 'reflex' }),
      engine: () => {
        called += 1
        return Promise.resolve('engine')
      },
      fallback: () => 'today',
      deadlineMs: 500,
    })
    expect(result).toEqual({ value: 'reflex', engine: 'deterministic' })
    expect(called).toBe(0)
  })

  it('uses the engine on a miss and falls back on abstention', async () => {
    await expectEngineThenAbstention(500)
  })

  it('discards a late answer, falls back, and still reports the settlement', async () => {
    const gated = Promise.withResolvers<string>()
    const settled: string[] = []
    const result = await runCascade({
      deterministic: () => ({ hit: false }),
      engine: () => gated.promise,
      fallback: () => 'today',
      deadlineMs: 20,
      report: (outcome) => {
        settled.push(outcome)
      },
    })
    expect(result).toEqual({ value: 'today', engine: 'late' })
    gated.resolve('too late')
    await gated.promise
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toEqual(['answered'])
  })

  it('records a thrown engine as a miss and an abort as our own cancellation', async () => {
    const failure = new Error('engine blew up')
    const missed = await runCascade({
      deterministic: () => ({ hit: false }),
      engine: () => Promise.reject(failure),
      fallback: () => 'today',
      deadlineMs: 500,
    })
    expect(missed.value).toBe('today')
    expect(missed.engine).toBe('miss')
    expect(missed.cause).toBe(failure)
    const aborted = new AbortController()
    aborted.abort()
    const cancelled = await runCascade({
      deterministic: () => ({ hit: false }),
      engine: () => Promise.resolve('engine'),
      fallback: () => 'today',
      deadlineMs: 500,
      signal: aborted.signal,
    })
    expect(cancelled).toEqual({ value: 'today', engine: 'cancelled' })
  })

  it('waits for the engine past no deadline, and still falls back on abstention', async () => {
    await expectEngineThenAbstention(undefined)
  })
})

describe('question packing', () => {
  it('batches per state within bounds and reports the oversized', () => {
    const packed = packByState(
      [
        {
          stateId: 's1',
          questions: [
            { id: 'a', bytes: 60 },
            { id: 'b', bytes: 60 },
            { id: 'c', bytes: 60 },
          ],
        },
        { stateId: 's2', questions: [{ id: 'd', bytes: 10 }] },
      ],
      100,
      64,
    )
    expect(packed.batches).toHaveLength(4)
    for (const batch of packed.batches) expect(batch.questions.length).toBeLessThanOrEqual(2)
    expect(packed.batches.map((batch) => batch.stateId)).toEqual(['s1', 's1', 's1', 's2'])
    expect(packed.oversized).toEqual([])
    const over = packByState(
      [{ stateId: 's1', questions: [{ id: 'huge', bytes: 10_000 }] }],
      100,
      64,
    )
    expect(over.batches).toEqual([])
    expect(over.oversized.map((question) => question.id)).toEqual(['huge'])
  })
})

describe('verified local separate sides', () => {
  it('keeps the install gap without a verified runtime and builds with one', () => {
    // The local path never touches paid IO: every paid seam throws when called.
    const neverPaid = (name: string): never => {
      throw new Error(`local sides never call ${name}`)
    }
    const ports = (local: Parameters<typeof buildSeparateSource>[1]['local']) =>
      buildSeparateSource(
        'local:tev1:4b',
        {
          systemOne: {
            readStoredCredential: () => neverPaid('readStoredCredential'),
            reserve: () => neverPaid('reserve'),
            consent: () => neverPaid('consent'),
            generation: () => neverPaid('generation'),
            confidential: () => neverPaid('confidential'),
            isExplicit: () => neverPaid('isExplicit'),
          },
          hasStoredKey: () => undefined,
          local,
        },
        'noul',
      )
    expect(ports(undefined)).toEqual({ kind: 'gap', gap: 'install' })
    const runtime: JudgeRuntime = {
      judge: () => Promise.resolve(silentAnswer),
    }
    const built = ports({
      runtime,
      capability: {
        source: 'separate',
        providerId: 'ollama',
        model: 'tev1:4b',
        modelVersion: 'tev1:4b',
        endpoint: 'http://127.0.0.1:11434',
        captureId: 'ollama-ps',
        logprobs: { kind: 'unknown' },
        stated: false,
        systemone: true,
        reasoningForced: false,
        cache: false,
        contextWindowTokens: 4096,
        minOutputTokens: 1,
      },
      model: 'tev1:4b',
      fitVersion: '',
    })
    expect(built.kind).toBe('built')
    if (built.kind !== 'built') throw new Error('Missing local side')
    expect(built.source.verified).toBe(true)
    expect(built.source.locality).toBe('verified-local')
    expect(built.source.technique).toBe('systemone')
    expect(built.source.runtime).toBe(runtime)
    expect(built.worstCaseUsd).toBe(Usd.from(0).toAmount())
    expect(built.model).toBe('tev1:4b')
  })
})
