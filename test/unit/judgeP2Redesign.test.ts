// Regressions for the M98 phase-2 redesign (RVM98P2BF): one immutable plan
// per judge run, one technique selector, one evidence-root convention with
// bounded file names, and one clientless constructor. Each fails on
// a46bece6d. Spending is recorded in exact amounts on a recording ledger;
// no live, paid or local-model call.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasJudgeAdoptionEvidence } from '../../src/core/judge/adoption'
import {
  cliEvidenceRoot,
  createPhase2Binding,
  filePhase2EvidenceStore,
  phase2AdoptionSlug,
  phase2EvidenceFile,
  phase2ProfileSlug,
  type Phase2EvidenceStore,
} from '../../src/core/judge/binding'
import { parseCalibrationProfile } from '../../src/core/judge/calibration/schema'
import { judgeRuntimeContext } from '../../src/core/judge/plan'
import { resolveJudgeMode2a } from '../../src/core/judge/resolve'
import { judgeSideTechnique } from '../../src/core/judge/sides'
import { createJudgeRuntime, type JudgeRuntimeBinding } from '../../src/core/judge/runtime'
import type { JudgeCapability } from '../../src/core/judge/schema'
import {
  resolveModelCapabilities,
  type ModelCapabilityRecord,
} from '../../src/core/providers/capabilityRecord'
import { JUDGE_CALIBRATION_LIMITS, JUDGE_EVIDENCE_DIRNAME } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { embeddingAvailability } from '../../src/core/judge/embedding/availability'
import { runEmbeddingJudge } from '../../src/core/judge/embedding/route'
import { createJudgeCommandDeps } from '../../src/runtime/judge/assembly'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { embeddedBinding, phase2Binding, surfaceInput } from './helpers/judgePhase2Rig'
import { FIXTURE_BINDING_CONTEXT, wiringFixture, wiringLimits } from './helpers/judgeWiring'
import { command, io, REQUEST } from './judgeCliFixtures'

function loadEmbedding() {
  return Promise.resolve({ run: runEmbeddingJudge, availability: embeddingAvailability })
}

/** A binding reader that answers `first` for the first `count` reads, then `later`. */
function changingBinding(
  first: JudgeRuntimeBinding,
  later: JudgeRuntimeBinding,
  count: number,
): { read: () => JudgeRuntimeBinding; reads: () => number } {
  let reads = 0
  return {
    read: () => {
      reads += 1
      return reads <= count ? first : later
    },
    reads: () => reads,
  }
}

describe('P1: one plan per run prices, admits and dispatches the same binding', () => {
  it.each(['ask', 'mcp'])(
    'keeps auto on the planned same side when a receipt lands before dispatch (%s)',
    async (action) => {
      const fixture = phase2Binding('auto')
      const priced = { ...fixture.value, attemptCostUsd: () => 0.0002 }
      const readiness = priced.context.separate
      if (readiness === undefined) throw new Error('fixture needs separate readiness')
      // Resolution sees no adoption receipt: `auto` is `same`. The valid
      // fixture receipt is installed for every later read.
      const withoutReceipt: JudgeRuntimeBinding = {
        ...priced,
        context: { ...priced.context, separate: { ...readiness, adoption: undefined } },
      }
      const binding = changingBinding(withoutReceipt, priced, 1)
      const deps = createJudgeCommandDeps({
        binding: binding.read,
        billing: 'paid',
        worstCaseUsd: () => 0,
      })
      const streams = io(surfaceInput(action))
      const code = await runJudgeCommand(
        command(action, ['--engine', 'auto', '--model', 'chosen', '--budget-usd', '0.0002']),
        streams,
        deps,
      )
      expect(code).toBe(0)
      // MCP nests the outcome as escaped JSON text; unescape before reading.
      expect(streams.output().replaceAll(String.raw`\"`, '"')).toContain('"source":"same"')
      expect(fixture.same.calls).toHaveLength(1)
      expect(fixture.separate.calls).toHaveLength(0)
      expect(binding.reads()).toBe(1)
    },
  )

  it.each(['ask', 'mcp'])(
    'never dispatches a tariff refreshed after pricing and admission (%s)',
    async (action) => {
      const rig = embeddedBinding('same-provider')
      const embedding = rig.value.embedding
      const refreshed: JudgeRuntimeBinding = {
        ...rig.value,
        embedding: { ...embedding, source: { ...embedding.source, uncachedCostUsd: 0.2 } },
      }
      // Resolution, pricing and admission see $0.0002; every read after
      // them sees $0.20.
      const binding = changingBinding(rig.value, refreshed, 3)
      const deps = createJudgeCommandDeps({
        binding: binding.read,
        billing: 'paid',
        worstCaseUsd: () => 0,
        loadEmbedding,
      })
      const streams = io(surfaceInput(action))
      const code = await runJudgeCommand(
        command(action, ['--engine', 'same', '--model', 'chosen', '--budget-usd', '0.0002']),
        streams,
        deps,
      )
      expect(code).toBe(0)
      expect(rig.embedCalls).toHaveLength(1)
      expect(rig.claims).toEqual([Usd.from(0.0002).toAmount()])
      expect(binding.reads()).toBe(1)
    },
  )

  it('reads the binding exactly once per runtime run', async () => {
    const fixture = phase2Binding('both')
    let reads = 0
    const read = () => {
      reads += 1
      return fixture.value
    }
    const runtime = createJudgeRuntime({ binding: read })
    const result = await runtime.judge({ ...REQUEST }, new AbortController().signal)
    expect(result).toMatchObject({ outcome: 'answered', result: { model: expect.any(String) } })
    expect(reads).toBe(1)
    expect(fixture.same.calls).toHaveLength(1)
    expect(fixture.separate.calls).toHaveLength(1)
  })

  it('prices the whole plan: both sides and the embedding tariff', () => {
    const rig = embeddedBinding('same-provider')
    const runtime = createJudgeRuntime({
      binding: () => ({ ...rig.value, attemptCostUsd: () => 0.0003 }),
    })
    const plan = runtime.plan({ ...REQUEST }, { engine: 'both', hasFreeSides: false })
    expect(plan).toMatchObject({
      resolution: { mode: 'both' },
      isPaid: true,
      embedding: { tariffUsd: 0.0002 },
    })
    if (!('worstCaseUsd' in plan)) throw new Error('expected a plan')
    expect(plan.worstCaseUsd).toBeCloseTo(0.0008, 12)
    expect(plan.same?.tariffUsd).toBe(0.0003)
    expect(plan.separate?.tariffUsd).toBe(0.0003)
    expect(Object.isFrozen(plan)).toBe(true)
  })
})

/** Fixture evidence re-identified under another technique (validation only). */
function retechnique() {
  const technique = 'logprob' as const
  const fixture = wiringFixture()
  const profileOf = (profile: unknown) => {
    const parsed = parseCalibrationProfile(profile, wiringLimits)
    if (parsed === undefined) throw new Error('fixture profile should parse')
    return { ...parsed, identity: { ...parsed.identity, technique } }
  }
  const datasetOf = (dataset: typeof fixture.adoption.record.same.dataset) => ({
    ...dataset,
    identity: { ...dataset.identity, technique },
  })
  const same = profileOf(fixture.same.profile)
  const separate = profileOf(fixture.separate.profile)
  const record = {
    ...fixture.adoption.record,
    same: { profile: same, dataset: datasetOf(fixture.adoption.record.same.dataset) },
    separate: {
      profile: separate,
      dataset: datasetOf(fixture.adoption.record.separate.dataset),
    },
  }
  return { fixture, same, separate, record }
}

const SOURCE_CAPTURE = { kind: 'capture' as const, ref: 'fixture-capture' }

/** A captured M95 record with the given logprob and output facts (fixture data). */
function recordFor(
  capability: JudgeCapability,
  facts: { readonly topK: boolean; readonly structured: boolean },
): ModelCapabilityRecord {
  return resolveModelCapabilities(
    { provider: capability.providerId, nativeModel: capability.model, format: 'chat' },
    [
      {
        source: SOURCE_CAPTURE,
        fields: {
          logprobs: facts.topK
            ? {
                state: 'yes',
                value: { kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' },
                source: SOURCE_CAPTURE,
              }
            : { state: 'no', source: SOURCE_CAPTURE },
          output: {
            formats: {
              state: 'yes',
              value: facts.structured ? ['text', 'json_schema'] : ['text'],
              source: SOURCE_CAPTURE,
            },
          },
        },
      },
    ],
  )
}

/** Build the production binding over a memory store keyed by the real slugs. */
function bindingWith(input: {
  readonly engine: string
  readonly capability: (side: 'same' | 'separate') => JudgeCapability
  readonly facts: { readonly topK: boolean; readonly structured: boolean }
  readonly profiles: Readonly<Record<string, unknown>>
  readonly record: unknown
  readonly fixture: ReturnType<typeof wiringFixture>
}) {
  const reads: string[] = []
  const store: Phase2EvidenceStore = {
    readProfile: (query) => {
      reads.push(query.technique)
      return input.profiles[phase2ProfileSlug(query)]
    },
    readAdoptionRecord: () => input.record,
    readEmbeddingHead: () => undefined,
    readEmbeddingManifest: () => undefined,
  }
  // Each side's technique comes from the one selector over its captured record.
  const techniqueOf = (capability: JudgeCapability) =>
    judgeSideTechnique({ capability, record: recordFor(capability, input.facts), kind: 'noul' })
  const same = {
    ...input.fixture.same,
    capability: input.capability('same'),
    technique: techniqueOf(input.capability('same')),
  }
  const separate = { ...input.fixture.separate, capability: input.capability('separate') }
  const binding = createPhase2Binding({
    engine: input.engine,
    separateId: 'fixture-separate',
    same,
    separate: {
      runtime: {
        judge: async (request, signal) => {
          const receipt = await separate.run(request, signal)
          return receipt.outcome
        },
      },
      capability: separate.capability,
      fitVersion: 'fit-1',
      verified: true,
      locality: 'verified-local',
      technique: techniqueOf(separate.capability),
    },
    store,
    options: input.fixture.options,
    limits: wiringLimits,
    context: FIXTURE_BINDING_CONTEXT,
    adoptionCheck: hasJudgeAdoptionEvidence,
  })
  return { binding, reads }
}

function profilesFor(evidence: ReturnType<typeof retechnique>): Record<string, unknown> {
  const technique = 'logprob' as const
  const slugOf = (profile: { identity: Record<string, string> }) =>
    phase2ProfileSlug({
      providerId: profile.identity['providerId'] ?? '',
      model: profile.identity['model'] ?? '',
      modelVersion: profile.identity['modelVersion'] ?? '',
      endpoint: profile.identity['endpoint'] ?? '',
      source: profile.identity['source'] === 'same' ? 'same' : 'separate',
      technique,
      family: profile.identity['family'] ?? '',
      promptVersion: profile.identity['promptVersion'] ?? '',
      criteriaVersion: profile.identity['criteriaVersion'] ?? '',
      fitVersion: profile.identity['fitVersion'] ?? '',
    })
  return {
    [slugOf(evidence.same)]: evidence.same,
    [slugOf(evidence.separate)]: evidence.separate,
  }
}

describe('P2: one technique selector decides profile lookup and qualification', () => {
  it('finds logprob profiles when the real selector chooses logprob over a recorded stated format', () => {
    const evidence = retechnique()
    const { binding, reads } = bindingWith({
      engine: 'auto',
      capability: (side) => ({
        ...evidence.fixture[side].capability,
        logprobs: { kind: 'topk', topK: 5 },
        stated: true,
      }),
      facts: { topK: true, structured: true },
      profiles: profilesFor(evidence),
      record: evidence.record,
      fixture: evidence.fixture,
    })
    expect(reads).toEqual(['logprob', 'logprob'])
    expect(binding?.separate?.technique).toBe('logprob')
    if (binding === undefined) throw new Error('binding expected')
    expect(judgeRuntimeContext(binding).separate).toMatchObject({ profilesReady: true })
    expect(resolveJudgeMode2a(judgeRuntimeContext(binding))).toMatchObject({
      mode: 'both',
      reason: 'auto-both',
    })
  })

  it('never qualifies auto-both for capabilities that support no technique', async () => {
    const evidence = retechnique()
    const { binding, reads } = bindingWith({
      engine: 'auto',
      capability: (side) => ({
        ...evidence.fixture[side].capability,
        logprobs: { kind: 'refused' },
        stated: false,
        systemone: false,
      }),
      facts: { topK: false, structured: false },
      profiles: profilesFor(evidence),
      record: evidence.record,
      fixture: evidence.fixture,
    })
    expect(reads).toEqual([])
    if (binding === undefined) throw new Error('binding expected')
    expect(binding.separate?.technique).toBeUndefined()
    const statuses: unknown[] = []
    const runtime = createJudgeRuntime({
      binding: () => binding,
      status: (status) => {
        statuses.push(status)
      },
    })
    await runtime.judge({ ...REQUEST, model: 'chosen' }, new AbortController().signal)
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({ mode: 'same', autoSameReason: 'profile-missing' })
    expect(evidence.fixture.separate.calls).toHaveLength(0)
  })
})

describe('P2: one evidence-root convention and bounded file names', () => {
  const ADOPTION = {
    providerId: 'fixture-provider',
    modelId: 'chosen',
    family: 'risk.destructive',
    promptVersion: '1',
    criteriaVersion: '1',
  }

  it.each([
    ['CLI', cliEvidenceRoot({ evidenceDir: undefined, configHome: '/example/config' })],
    ['host', path.join('/example/globalStorage', JUDGE_EVIDENCE_DIRNAME)],
  ])('reads the %s root documented drop path, adoption/<slug>.json', (_surface, root) => {
    const documented = `${root.replaceAll('\\', '/')}/adoption/${phase2AdoptionSlug(ADOPTION)}.json`
    const files = new Map([[documented, JSON.stringify({ marker: 'recorded' })]])
    const requested: string[] = []
    const store = filePhase2EvidenceStore({
      root,
      readFile: (file) => {
        requested.push(file)
        return files.get(file)
      },
    })
    expect(store.readAdoptionRecord(ADOPTION)).toEqual({ marker: 'recorded' })
    expect(requested).toEqual([documented])
    expect(requested[0]).not.toMatch(/\/judge\/judge\//)
  })

  it('records and reads back a schema-valid profile with a long identity', () => {
    const fixture = wiringFixture()
    const parsed = parseCalibrationProfile(fixture.separate.profile, wiringLimits)
    if (parsed === undefined) throw new Error('fixture profile should parse')
    const identity = {
      ...parsed.identity,
      providerId: 'acme-inference-gateway-custom-provider',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      modelVersion: 'revision-2026-09-30-8f3c2a1b9d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e',
      endpoint: 'https://acme-inference-gateway.example.com/deployments/llama-3-3-70b/v1',
      fitVersion: 'fit-2026-10-08-held-out-grouped-lineage',
    }
    const profile = { ...parsed, identity }
    expect(parseCalibrationProfile(profile, JUDGE_CALIBRATION_LIMITS)).toBeDefined()
    const query = { ...identity, source: 'separate' as const, technique: identity.technique }
    const slug = phase2ProfileSlug(query)
    expect(Buffer.byteLength(`${slug}.json`)).toBeLessThan(160)
    const root = mkdtempSync(path.join(tmpdir(), 'muse-p2r-'))
    try {
      const file = phase2EvidenceFile(root, 'profile', slug)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(profile))
      const store = filePhase2EvidenceStore({
        root,
        readFile: (name) => readFileSync(name, 'utf8'),
      })
      expect(store.readProfile(query)).toEqual(profile)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
