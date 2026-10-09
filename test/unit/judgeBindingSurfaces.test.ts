// The production phase-2 binding through the real factories (M98 P2B):
// window, CLI ask and MCP all reach the same binding construction, and the
// feature-off path keeps phase-1 behaviour. Fixture evidence is clearly
// labelled and lives only in this file's temporary folders.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { hasJudgeAdoptionEvidence } from '../../src/core/judge/adoption'
import {
  createPhase2Binding,
  phase2AdoptionSlug,
  phase2EvidenceFile,
  phase2ProfileSlug,
  type Phase2EvidenceStore,
} from '../../src/core/judge/binding'
import {
  createJudgeRuntime,
  type JudgeRuntimeBinding,
  type JudgeRuntimeDeps,
} from '../../src/core/judge/runtime'
import { createJudgeCommandDeps } from '../../src/runtime/judge/assembly'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import { createHostPhase2 } from '../../src/host/judge/judgeBinding'
import { judgeSideTechnique } from '../../src/core/judge/sides'
import { JUDGE_MIN_READY_RATE, type JudgeEngine } from '../../src/shared/constants'
import type { JudgeEntryParts } from '../../src/core/judge/entries'
import type { JudgeStatus } from '../../src/shared/judge'
import { bindingWindowBase, toRuntime } from './helpers/judgeBinding'
import { statedRecord, wiringFixture, wiringLimits } from './helpers/judgeWiring'
import { FakeLogOutputChannel } from './helpers/fakes'
import { command, io, REQUEST } from './judgeCliFixtures'

const OPTIONS = {
  family: 'risk.destructive',
  promptVersion: 'prompt-1',
  criteriaVersion: 'criteria-1',
  highStakes: true,
}

/** A window phase-2 pair that shares one production binding. */
function windowPhase2(binding: JudgeRuntimeBinding | undefined) {
  return {
    binding: () => binding,
    createRuntime: (deps: JudgeRuntimeDeps) => Promise.resolve(createJudgeRuntime(deps)),
  }
}

/** Runs CLI ask through the real command assembly and dispatcher. */
async function runAsk(
  binding: JudgeRuntimeBinding | undefined,
  engine: string,
): Promise<{ code: number; output: string }> {
  const deps = createJudgeCommandDeps({
    binding: () => binding,
    billing: 'free',
    worstCaseUsd: () => 0,
  })
  const streams = io(JSON.stringify({ ...REQUEST, model: 'chosen' }))
  const code = await runJudgeCommand(
    command('ask', ['--engine', engine, '--model', 'chosen']),
    streams,
    deps,
  )
  return { code, output: streams.output() }
}

/** Clearly labelled test fixtures: one wiring family with file evidence. */
function fileEvidence() {
  const wired = wiringFixture()
  const root = mkdtempSync(path.join(tmpdir(), 'muse-p2b-evidence-'))
  mkdirSync(path.join(root, 'profiles'), { recursive: true })
  mkdirSync(path.join(root, 'adoption'), { recursive: true })
  const profileQuery = (source: 'same' | 'separate') => ({
    providerId: 'fixture-provider',
    model: source === 'same' ? 'chosen' : 'separate-model',
    modelVersion: 'v1',
    endpoint: 'fixture://offline',
    source,
    technique: 'stated',
    family: OPTIONS.family,
    promptVersion: OPTIONS.promptVersion,
    criteriaVersion: OPTIONS.criteriaVersion,
    fitVersion: 'fit-1',
  })
  writeFileSync(
    phase2EvidenceFile(root, 'profile', phase2ProfileSlug(profileQuery('same'))),
    JSON.stringify(wired.same.profile),
  )
  writeFileSync(
    phase2EvidenceFile(root, 'profile', phase2ProfileSlug(profileQuery('separate'))),
    JSON.stringify(wired.separate.profile),
  )
  // The original held-out record, byte for byte: rebuilding it from the
  // sides would drop the datasets (`wired.same` is the side, whose
  // `.dataset` is undefined) and fail validation, honestly.
  writeFileSync(
    phase2EvidenceFile(
      root,
      'adoption',
      phase2AdoptionSlug({
        providerId: 'fixture-provider',
        modelId: 'chosen',
        family: OPTIONS.family,
        promptVersion: OPTIONS.promptVersion,
        criteriaVersion: OPTIONS.criteriaVersion,
      }),
    ),
    JSON.stringify(wired.adoption.record),
  )
  const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8')) as unknown
  const store: Phase2EvidenceStore = {
    readProfile: (query) => readJson(phase2EvidenceFile(root, 'profile', phase2ProfileSlug(query))),
    readAdoptionRecord: (query) =>
      readJson(phase2EvidenceFile(root, 'adoption', phase2AdoptionSlug(query))),
    readEmbeddingHead: () => undefined,
    readEmbeddingManifest: () => undefined,
  }
  const cleanup = () => {
    rmSync(root, { recursive: true, force: true })
  }
  return {
    wired,
    root,
    store,
    cleanup,
    sources: () => ({
      same: wired.same,
      separate: {
        runtime: toRuntime(wired.separate),
        capability: wired.separate.capability,
        fitVersion: 'fit-1',
        verified: true as const,
        locality: 'remote' as const,
        technique: judgeSideTechnique({
          capability: wired.separate.capability,
          record: statedRecord(wired.separate.capability),
          kind: 'noul',
        }),
      },
    }),
  }
}

function bindingOf(
  fixtures: ReturnType<typeof fileEvidence>,
  engine: unknown,
  store?: Phase2EvidenceStore,
) {
  return createPhase2Binding({
    engine,
    separateId: 'fixture-separate',
    ...fixtures.sources(),
    store: store ?? fixtures.store,
    options: OPTIONS,
    limits: wiringLimits,
    context: {
      providerId: 'fixture-provider',
      modelId: 'chosen',
      endpoint: 'fixture://offline',
      profileId: 'fit-1',
      ownerId: 'owner-1',
      turn: 'turn-1',
      confidential: false,
      sourceAvailable: true,
      paidConsent: 'not-required',
      readyRate: undefined,
      minReadyRate: JUDGE_MIN_READY_RATE,
    },
    billing: 'free',
    adoptionCheck: hasJudgeAdoptionEvidence,
  })
}

function windowDeps(overrides: {
  engine: () => JudgeEngine
  phase2?: Parameters<typeof createWindowJudge>[0]['phase2']
  onStatus?: ((action: JudgeEntryParts, status: JudgeStatus) => void) | undefined
}) {
  return {
    ...bindingWindowBase(),
    phase2: overrides.phase2,
    engine: overrides.engine,
    status: (action: JudgeEntryParts, status: JudgeStatus) => {
      overrides.onStatus?.(action, status)
    },
  }
}

describe('production binding through the real factories', () => {
  it('window, CLI ask and MCP share one binding: auto reaches both with recorded evidence', async () => {
    const fixtures = fileEvidence()
    try {
      const binding = bindingOf(fixtures, 'auto')
      expect(binding).toBeDefined()
      // Window through the real window factory.
      const onStatus = vi.fn<(action: JudgeEntryParts, status: JudgeStatus) => void>()
      const window = createWindowJudge(
        windowDeps({ engine: () => 'auto', onStatus, phase2: windowPhase2(binding) }),
        EN,
        'en',
      )
      const fence = window.start(
        { backend: 'museCode', sessionId: 's1', turnId: 'turn-1', tool: 'bash', args: {} },
        'state',
      )
      const separateRun = fixtures.wired.separate.run
      await vi.waitFor(() => {
        expect(separateRun).toHaveBeenCalledTimes(1)
      })
      expect(fence?.read()).toBe('caution')
      expect(onStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: 'both', reason: 'auto-both' }),
      )
      expect(window.readPanelSnapshot()?.effectiveSource).toBe('both')
      window.dispose()
      // CLI ask through the real command assembly and dispatcher.
      const ask = await runAsk(binding, 'both')
      expect(ask.code).toBe(0)
      expect(ask.output).toContain('cascade')
      // MCP through the same dispatcher.
      const mcpInput = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'judge', arguments: { ...REQUEST, model: 'chosen' } } })}\n`
      const mcpStreams = io(mcpInput)
      const mcpCode = await runJudgeCommand(
        command('mcp', ['--engine', 'both', '--model', 'chosen']),
        mcpStreams,
        createJudgeCommandDeps({ binding: () => binding, billing: 'free', worstCaseUsd: () => 0 }),
      )
      expect(mcpCode).toBe(0)
      expect(mcpStreams.output()).toContain('cascade')
    } finally {
      fixtures.cleanup()
    }
  })

  it('names the missing evidence on every surface when nothing is recorded', async () => {
    const fixtures = fileEvidence()
    try {
      const empty: Phase2EvidenceStore = {
        readProfile: () => undefined,
        readAdoptionRecord: () => undefined,
        readEmbeddingHead: () => undefined,
        readEmbeddingManifest: () => undefined,
      }
      // Window: the status names the gap; nothing dispatches.
      const onStatus = vi.fn<(action: JudgeEntryParts, status: JudgeStatus) => void>()
      const judge = createWindowJudge(
        windowDeps({
          engine: () => 'auto',
          onStatus,
          phase2: windowPhase2(bindingOf(fixtures, 'auto', empty)),
        }),
        EN,
        'en',
      )
      judge.start(
        { backend: 'museCode', sessionId: 's1', turnId: 'turn-1', tool: 'bash', args: {} },
        'state',
      )
      await vi.waitFor(() => {
        expect(onStatus).toHaveBeenCalled()
      })
      expect(onStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: 'same', autoSameReason: 'profile-missing' }),
      )
      expect(fixtures.wired.same.run).not.toHaveBeenCalled()
      expect(fixtures.wired.separate.run).not.toHaveBeenCalled()
      judge.dispose()
      // CLI ask refuses with the named reason, never an empty success.
      // G's dispatcher reports an unusable source without inventing one;
      // the exact gap (profile-missing here) is the window status line's.
      const refused = await runAsk(bindingOf(fixtures, 'both', empty), 'both')
      expect(refused.code).not.toBe(0)
      expect(refused.output).toContain('source-unavailable')
    } finally {
      fixtures.cleanup()
    }
  })

  it('builds the host production binding from files with no live clients', () => {
    const fixtures = fileEvidence()
    try {
      const host = createHostPhase2({
        judgeP2BundlePath: path.join('nowhere', 'judgeP2.js'),
        log: new FakeLogOutputChannel(),
        engine: () => 'both',
        separateId: () => 'future-source',
        evidenceRoot: fixtures.root,
        limits: wiringLimits,
        options: () => OPTIONS,
        sources: () => ({}),
        separateConfigured: true,
        context: (action) => ({
          providerId: 'fixture-provider',
          modelId: 'chosen',
          ownerId: 'owner-1',
          turn: action.turnId,
          confidential: false,
          sourceAvailable: true,
          paidConsent: 'not-required',
          readyRate: undefined,
          minReadyRate: JUDGE_MIN_READY_RATE,
        }),
        billing: () => 'subscription',
      })
      const binding = host.binding({
        backend: 'museCode',
        sessionId: 's1',
        turnId: 'turn-1',
        tool: 'bash',
        args: {},
      })
      expect(binding).toBeDefined()
      expect(binding?.separate).toBeUndefined()
      expect(binding?.embeddingNote).toBeUndefined()
    } finally {
      fixtures.cleanup()
    }
  })

  it('keeps exact phase-1 behaviour with the feature off', () => {
    expect(
      createPhase2Binding({
        engine: 'off',
        separateId: 'fixture-separate',
        store: emptyStore(),
        options: OPTIONS,
        limits: wiringLimits,
        context: {
          providerId: 'fixture-provider',
          modelId: 'chosen',
          ownerId: 'owner-1',
          confidential: false,
          sourceAvailable: true,
          paidConsent: 'not-required',
          readyRate: undefined,
          minReadyRate: JUDGE_MIN_READY_RATE,
        },
      }),
    ).toBeUndefined()
    // Without any binding the window resolves through the phase-1 entry:
    // an unknown phase-2 engine word stays off, never a separate mode.
    const onStatus = vi.fn<(action: JudgeEntryParts, status: JudgeStatus) => void>()
    const judge = createWindowJudge(windowDeps({ engine: () => 'same', onStatus }), EN, 'en')
    const fence = judge.start(
      { backend: 'museCode', sessionId: 's1', turnId: 'turn-1', tool: 'bash', args: {} },
      'state',
    )
    expect(onStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'same', reason: 'explicit-same' }),
    )
    expect(fence).toBeDefined()
    judge.dispose()
  })
})

function emptyStore(): Phase2EvidenceStore {
  return {
    readProfile: () => undefined,
    readAdoptionRecord: () => undefined,
    readEmbeddingHead: () => undefined,
    readEmbeddingManifest: () => undefined,
  }
}
