// Production phase-2 binding construction (M98 P2B): the factory that
// turns recorded evidence and real C/E/J sides into the binding every
// surface shares. Fixture profiles and receipts below are clearly labelled
// test fixtures: they exercise validation, never product evidence.
import { describe, expect, it } from 'vitest'
import { hasJudgeAdoptionEvidence } from '../../src/core/judge/adoption'
import {
  cascadeSideFromRuntime,
  cliEvidenceRoot,
  createClientlessBinding,
  createPhase2Binding,
  emptyPhase2EvidenceStore,
  phase2AdoptionSlug,
  phase2EmbeddingSlug,
  phase2EvidenceFile,
  phase2EvidenceSlug,
  phase2ProfileSlug,
  unavailablePhase2SeparateSource,
  type Phase2BindingRequest,
  type Phase2EvidenceStore,
  type Phase2SeparateSource,
} from '../../src/core/judge/binding'
import { createJudgeRuntime } from '../../src/core/judge/runtime'
import { judgeRuntimeContext } from '../../src/core/judge/plan'
import { judgeSideTechnique } from '../../src/core/judge/sides'
import { createJudgeFeatures } from '../../src/runtime/judge/judgeEntry'
import { EN } from '../../src/shared/l10n/en'
import { resolveJudgeMode2a } from '../../src/core/judge/resolve'
import { JUDGE_MIN_READY_RATE } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type { JudgeCapability } from '../../src/core/judge/schema'
import { toRuntime } from './helpers/judgeBinding'
import { statedRecord, wiringFixture, wiringLimits } from './helpers/judgeWiring'
import { REQUEST } from './judgeCliFixtures'

const OPTIONS = {
  family: 'risk.destructive',
  promptVersion: 'prompt-1',
  criteriaVersion: 'criteria-1',
  highStakes: true,
}

const BASE_CONTEXT = {
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
  minReadyRate: JUDGE_MIN_READY_RATE,
}

/** Clearly labelled test fixtures: memory evidence for one wiring family. */
function evidenceFixtures() {
  const wired = wiringFixture()
  const separate: Phase2SeparateSource = {
    runtime: toRuntime(wired.separate),
    capability: wired.separate.capability,
    fitVersion: 'fit-1',
    verified: true,
    locality: 'remote',
    technique: judgeSideTechnique({
      capability: wired.separate.capability,
      record: statedRecord(wired.separate.capability),
      kind: 'noul',
    }),
  }
  const store: Phase2EvidenceStore = {
    readProfile: (query) => (query.source === 'same' ? wired.same.profile : wired.separate.profile),
    readAdoptionRecord: () => wired.adoption.record,
    readEmbeddingHead: () => undefined,
    readEmbeddingManifest: () => undefined,
  }
  return { wired, separate, store }
}

function request(overrides: Partial<Phase2BindingRequest> = {}): Phase2BindingRequest {
  const { wired, separate, store } = evidenceFixtures()
  return {
    engine: 'auto',
    separateId: 'fixture-separate',
    same: wired.same,
    separate,
    store,
    options: OPTIONS,
    limits: wiringLimits,
    context: BASE_CONTEXT,
    adoptionCheck: hasJudgeAdoptionEvidence,
    ...overrides,
  }
}

describe('production phase-2 binding', () => {
  it.each([['off'], ['same']] as const)('keeps phase-1 behaviour for engine %s', (engine) => {
    expect(createPhase2Binding(request({ engine }))).toBeUndefined()
  })

  it('keeps phase-1 behaviour without a configured separate source', () => {
    expect(createPhase2Binding(request({ separateId: '' }))).toBeUndefined()
    expect(createPhase2Binding(request({ separateId: '  ' }))).toBeUndefined()
    const { store } = evidenceFixtures()
    expect(
      createPhase2Binding(request({ separate: undefined, store, same: undefined })),
    ).toBeUndefined()
  })

  it('reports a configured-but-clientless source instead of silently staying phase-1', () => {
    const binding = createPhase2Binding(request({ separate: undefined, separateConfigured: true }))
    expect(binding).toBeDefined()
    expect(binding?.same).toBeDefined()
    expect(binding?.separate).toBeUndefined()
    expect(resolveJudgeMode2a({ ...binding!.context, engine: 'auto' })).toMatchObject({
      mode: 'same',
      autoSameReason: 'source-unavailable',
    })
    expect(resolveJudgeMode2a({ ...binding!.context, engine: 'separate' })).toMatchObject({
      mode: 'off',
      reason: 'source-unavailable',
    })
    expect(resolveJudgeMode2a({ ...binding!.context, engine: 'both' })).toMatchObject({
      mode: 'off',
      reason: 'source-unavailable',
    })
    // The runtime layer keeps the reported gap; it never invents a source.
    expect(judgeRuntimeContext(binding!).separate).toMatchObject({ available: false })
  })

  it('routes a malformed separate capability to the gap report, never to a silent fallback', () => {
    const { separate } = evidenceFixtures()
    const binding = createPhase2Binding(
      request({
        separate: { ...separate, capability: { source: 'separate' } as unknown as JudgeCapability },
      }),
    )
    expect(binding).toBeDefined()
    expect(binding?.separate).toBeUndefined()
    expect(resolveJudgeMode2a({ ...binding!.context, engine: 'both' })).toMatchObject({
      mode: 'off',
      reason: 'source-unavailable',
    })
  })

  it('dispatches explicit both once per side with recorded profiles and no adoption receipt', async () => {
    const { wired, separate } = evidenceFixtures()
    const store: Phase2EvidenceStore = {
      ...evidenceFixtures().store,
      readAdoptionRecord: () => undefined,
    }
    const binding = createPhase2Binding(
      request({ engine: 'both', separate, same: wired.same, store }),
    )
    expect(binding).toBeDefined()
    expect(resolveJudgeMode2a({ ...binding!.context, engine: 'both' })).toMatchObject({
      mode: 'both',
      reason: 'explicit-both',
    })
    // Adoption gates only the automatic choice, never an explicit one.
    expect(resolveJudgeMode2a({ ...binding!.context, engine: 'auto' })).toMatchObject({
      mode: 'same',
      autoSameReason: 'evidence-missing',
    })
    const runtime = createJudgeRuntime({ binding: () => binding })
    const outcome = await runtime.judge(
      { ...REQUEST, model: 'chosen' },
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { source: 'both', technique: 'cascade' } } },
    })
    expect(wired.same.calls).toHaveLength(1)
    expect(wired.separate.calls).toHaveLength(1)
  })

  it('resolves auto to both only with the recorded held-out receipt', () => {
    const proved = createPhase2Binding(request({ engine: 'auto' }))
    expect(proved).toBeDefined()
    expect(resolveJudgeMode2a({ ...proved!.context, engine: 'auto' })).toMatchObject({
      mode: 'both',
      reason: 'auto-both',
    })
    const unproved = createPhase2Binding(
      request({ store: { ...evidenceFixtures().store, readAdoptionRecord: () => undefined } }),
    )
    expect(resolveJudgeMode2a({ ...unproved!.context, engine: 'auto' })).toMatchObject({
      mode: 'same',
      autoSameReason: 'evidence-missing',
    })
  })

  it('refuses a recorded-but-unsuitable profile at the runtime layer', () => {
    const { separate } = evidenceFixtures()
    const stale = {
      ...(evidenceFixtures().wired.separate.profile as Record<string, unknown>),
      identity: {
        ...((evidenceFixtures().wired.separate.profile as Record<string, unknown>)[
          'identity'
        ] as Record<string, unknown>),
        fitVersion: 'fit-2',
      },
    }
    const store: Phase2EvidenceStore = {
      ...evidenceFixtures().store,
      readProfile: (query) =>
        query.source === 'same' ? evidenceFixtures().wired.same.profile : stale,
    }
    const binding = createPhase2Binding(request({ engine: 'both', separate, store }))
    expect(binding).toBeDefined()
    expect(judgeRuntimeContext(binding!)).toMatchObject({
      separate: expect.objectContaining({ profilesReady: false }),
    })
    expect(resolveJudgeMode2a({ ...judgeRuntimeContext(binding!), engine: 'both' })).toMatchObject({
      mode: 'off',
      reason: 'profile-missing',
    })
  })

  it('marks embedding labels missing only for a configured transport', () => {
    expect(createPhase2Binding(request())?.embeddingNote).toBeUndefined()
    expect(createPhase2Binding(request({ embeddingAwaitingLabels: true }))?.embeddingNote).toBe(
      'labels-missing',
    )
  })

  it('adapts a lane runtime into a side without inventing costs or identities', async () => {
    const { wired } = evidenceFixtures()
    const side = cascadeSideFromRuntime({
      runtime: toRuntime(wired.separate),
      capability: wired.separate.capability,
      profile: wired.separate.profile,
      fitVersion: 'fit-1',
      limits: wiringLimits,
    })
    expect(side).toBeDefined()
    const receipt = await side!.run({ ...REQUEST, model: 'chosen' }, new AbortController().signal)
    expect(receipt.outcome).toMatchObject({ outcome: 'answered' })
    const zero = Usd.from(0).toAmount()
    expect(receipt).toMatchObject({
      reservedCostUsd: zero,
      settledCostUsd: zero,
      uncertainCostUsd: zero,
    })
    expect(
      cascadeSideFromRuntime({
        runtime: { judge: () => Promise.resolve({ outcome: 'no-answer', reason: 'timeout' }) },
        capability: wired.separate.capability,
        profile: undefined,
        fitVersion: 'fit-1',
        limits: wiringLimits,
      }),
    ).toBeDefined()
    expect(
      cascadeSideFromRuntime({
        runtime: unavailablePhase2SeparateSource().runtime,
        capability: { source: 'separate' } as unknown as JudgeCapability,
        profile: undefined,
        fitVersion: 'fit-1',
        limits: wiringLimits,
      }),
    ).toBeUndefined()
    expect(
      cascadeSideFromRuntime({
        runtime: unavailablePhase2SeparateSource().runtime,
        capability: wired.separate.capability,
        profile: undefined,
        fitVersion: '',
        limits: wiringLimits,
      }),
    ).toBeUndefined()
  })

  it('passes a refused lane outcome through as the failed side', async () => {
    const { wired } = evidenceFixtures()
    const side = cascadeSideFromRuntime({
      runtime: unavailablePhase2SeparateSource().runtime,
      capability: wired.separate.capability,
      profile: undefined,
      fitVersion: 'fit-1',
      limits: wiringLimits,
    })
    const receipt = await side!.run({ ...REQUEST }, new AbortController().signal)
    expect(receipt.outcome).toEqual({ outcome: 'no-answer', reason: 'source-unavailable' })
  })

  it('takes each side technique from the one selector, never from capability booleans', () => {
    const { wired } = evidenceFixtures()
    const capability = wired.separate.capability
    expect(judgeSideTechnique({ capability, record: statedRecord(capability), kind: 'noul' })).toBe(
      'stated',
    )
    // Without a captured record a non-SystemOne capability supports nothing.
    expect(judgeSideTechnique({ capability, kind: 'noul' })).toBeUndefined()
    expect(
      judgeSideTechnique({
        capability: { ...capability, stated: false, systemone: true },
        kind: 'noul',
      }),
    ).toBe('systemone')
  })

  it('builds evidence paths directly under the surface root on every platform', () => {
    const slug = phase2EvidenceSlug(['a/b', 'c:d', '', '..'])
    expect(slug).toMatch(/^a-b__c-d__unknown--[0-9a-f]{32}$/)
    expect(slug).not.toMatch(/[/\\:]/)
    expect(phase2EvidenceFile(String.raw`C:\Users\randy\.config\muse\judge`, 'profile', slug)).toBe(
      `C:/Users/randy/.config/muse/judge/profiles/${slug}.json`,
    )
    expect(phase2EvidenceFile('/home/u/.config/muse/judge/', 'adoption', 'a')).toBe(
      '/home/u/.config/muse/judge/adoption/a.json',
    )
    const profile = phase2ProfileSlug({
      providerId: 'p',
      model: 'm',
      modelVersion: 'v',
      endpoint: 'e',
      source: 'same',
      technique: 'stated',
      family: 'risk.destructive',
      promptVersion: 'prompt-1',
      criteriaVersion: 'criteria-1',
      fitVersion: 'fit-1',
    })
    expect(profile).toMatch(
      /^p__m__v__e__same__stated__risk\.destructive__prompt-1__criteria-1__fit-1--[0-9a-f]{32}$/,
    )
    expect(
      phase2AdoptionSlug({
        providerId: 'p',
        modelId: 'm',
        family: 'risk.destructive',
        promptVersion: 'prompt-1',
        criteriaVersion: 'criteria-1',
      }),
    ).toMatch(/^p__m__risk\.destructive__prompt-1__criteria-1--[0-9a-f]{32}$/)
    expect(
      phase2EmbeddingSlug({
        providerId: 'p',
        model: 'm',
        modelVersion: 'v',
        endpoint: 'e',
        source: 'separate',
        family: 'risk.destructive',
        promptVersion: 'prompt-1',
        criteriaVersion: 'criteria-1',
        fitVersion: 'fit-1',
        dimension: 8,
      }),
    ).toMatch(
      /^p__m__v__e__separate__risk\.destructive__prompt-1__criteria-1__fit-1__8--[0-9a-f]{32}$/,
    )
    // Identities that sanitize alike still name different files.
    expect(phase2EvidenceSlug(['a/b'])).not.toBe(phase2EvidenceSlug(['a:b']))
    expect(cliEvidenceRoot({ evidenceDir: '  ', configHome: String.raw`C:\Users\r\.config` })).toBe(
      'C:/Users/r/.config/muse/judge',
    )
    expect(
      cliEvidenceRoot({ evidenceDir: '/custom/evidence', configHome: '/home/u/.config' }),
    ).toBe('/custom/evidence')
    const empty = emptyPhase2EvidenceStore()
    expect(empty.readProfile({} as never)).toBeUndefined()
    expect(empty.readAdoptionRecord({} as never)).toBeUndefined()
    expect(empty.readEmbeddingHead({} as never)).toBeUndefined()
    expect(empty.readEmbeddingManifest({} as never)).toBeUndefined()
  })
})

/** A configured id with no live side, as the CLI and the window both request it. */
function clientlessRequest(overrides: Partial<Phase2BindingRequest> = {}) {
  const { store } = evidenceFixtures()
  return {
    engine: 'auto',
    separateId: 'fixture-separate',
    separateConfigured: true,
    store,
    options: OPTIONS,
    limits: wiringLimits,
    context: BASE_CONTEXT,
    billing: 'free' as const,
    ...overrides,
  }
}

describe('one binding policy', () => {
  it.each([
    ['recorded receipt', {}],
    ['missing receipt', { store: emptyPhase2EvidenceStore() }],
    ['unbilled', { billing: undefined }],
    ['a named gap', { separateGap: 'unknown' as const }],
  ] as const)('the judgeP2 entry builds exactly the host binding with %s', (_label, overrides) => {
    const request = clientlessRequest(overrides)
    const entry = createJudgeFeatures({ uiText: EN, uiLocale: 'en' }).createPhase2Binding(request)
    const host = createPhase2Binding({ ...request, adoptionCheck: hasJudgeAdoptionEvidence })
    expect(entry).toBeDefined()
    expect(entry).toEqual(host)
    expect(createClientlessBinding).toBeTypeOf('function')
    expect(resolveJudgeMode2a({ ...entry!.context, engine: 'auto' })).toMatchObject({
      mode: 'same',
      autoSameReason: 'source-unavailable',
    })
  })

  it('keeps phase-1 behaviour without a configured separate source', () => {
    const features = createJudgeFeatures({ uiText: EN, uiLocale: 'en' })
    for (const overrides of [
      { separateId: '' },
      { separateId: '  ' },
      { separateConfigured: false },
    ])
      expect(features.createPhase2Binding(clientlessRequest(overrides))).toBeUndefined()
  })
})
