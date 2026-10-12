import { EN } from '../../src/shared/l10n/en'
import { describe, expect, it, vi } from 'vitest'
import { createHostReportSources } from '../../src/host/reporting/sources'
import { createRuntimeReportSources } from '../../src/runtime/reporting/sources'
import { questionsSource } from '../../src/core/reporting/sources/questions'
import { sessionSource } from '../../src/core/reporting/sources/session'
import { buildSourceSnapshot } from './helpers/reporting/snapshot'
import {
  renderAllFormats,
  renderTestCollector,
  threeIndexOrders,
  type RenderedReport,
} from './helpers/reporting/render'
import {
  codeUnitCompare,
  reportWorkspaceKey,
  sourceFreshness,
  type LocalFileIo,
} from '../../src/core/reporting/sources/local'
import {
  reportOptions,
  reportFactSnapshot,
  REPORT_FIXTURE_AS_OF,
} from './helpers/reporting/snapshot'
import { REPORT_SOURCE_TIMEOUT_MS, UI_TEXT } from '../../src/shared/constants'
import type { LocalReportSourceDeps } from '../../src/core/reporting/sources'
import type { ReportSessionReader } from '../../src/core/reporting/sources/session'
import type {
  CheckRunRecord,
  ReportQuestion,
  UsageFacts,
} from '../../src/core/reporting/sources/types'

const context = () => ({
  reportText: EN,
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions(),
  signal: new AbortController().signal,
})
const scrub = (text: string) => text.replaceAll('private-canary', '[redacted]')
const files: LocalFileIo = {
  read: () => Promise.reject(new Error('private-canary')),
  list: () => Promise.reject(new Error('private-canary')),
}
function sessionReader(): ReportSessionReader {
  const facts = reportFactSnapshot().sources.session
  if (facts.data === null) throw new Error('Missing test fixture')
  return {
    read: () =>
      Promise.resolve({
        source: {
          backend: 'modelApi',
          modelId: 'fixture-model',
          exportedAt: '2026-10-06T12:00:00Z',
          items: [
            {
              itemId: 'user',
              kind: 'userMessage',
              status: 'completed',
              turnId: 'one',
              text: 'Start',
            },
            {
              itemId: 'steer',
              kind: 'userMessage',
              status: 'completed',
              turnId: 'one',
              text: 'Steer',
            },
            {
              itemId: 'tool',
              kind: 'tool',
              status: 'completed',
              turnId: 'one',
              visibleOutput: String.raw`private-canary owner@example.invalid C:\Users\Private\folder`,
              args: JSON.stringify({ secret: 'private-canary' }),
            },
          ],
        },
        activity: facts.data.activity,
        usage: facts.data.usage,
        checkRuns: [],
        observedAt: REPORT_FIXTURE_AS_OF,
      }),
  }
}
const deps = (): LocalReportSourceDeps => ({
  files,
  git: { run: () => Promise.resolve({ stdout: '', code: 1 }) },
  scrub,
  roots: [],
  enabledAgents: [],
  agentFiles: [],
})
function permutations<T>(rows: readonly T[]): T[][] {
  return rows.length === 0
    ? [[]]
    : rows.flatMap((row, index) =>
        permutations(rows.filter((_row, other) => other !== index)).map((rest) => [row, ...rest]),
      )
}
async function readSessionFacts(
  order: readonly number[],
  checks: readonly CheckRunRecord[],
  breakdown: UsageFacts['breakdown'],
  limits: UsageFacts['limits'],
) {
  const original = await sessionReader().read(context())
  if (original === null) throw new Error('Missing test fixture')
  return await sessionSource(
    {
      read: () =>
        Promise.resolve({
          ...original,
          checkRuns: order.flatMap((index) => checks[index] ?? []),
          usage: {
            ...original.usage,
            breakdown: order.flatMap((index) => breakdown[index] ?? []),
            limits: order.flatMap((index) => limits[index] ?? []),
          },
        }),
    },
    [],
    scrub,
  ).read(context())
}
describe('session, registry and shared report adapters', () => {
  it('produces byte-identical session facts for every permutation of tied checks and usage keys', async () => {
    const check: CheckRunRecord = {
      at: '2026-10-06T11:59:59Z',
      check: 'quality',
      commit: 'fixture-a',
      outcome: 'passed',
      durationMs: 1,
    }
    const checks: CheckRunRecord[] = [
      check,
      { ...check, commit: 'fixture-b' },
      { ...check, outcome: 'failed' },
      { ...check, durationMs: 2 },
    ]
    const breakdown = checks.map(
      (row) =>
        ({
          key: 'fixture-model',
          inputTokens: row.durationMs,
          outputTokens: row.outcome === 'failed' ? 2 : 1,
          costUsd: null,
          certainty: 'unknown',
        }) satisfies UsageFacts['breakdown'][number],
    )
    const limits = checks.map(
      (row) =>
        ({
          key: 'fixture-limit',
          used: row.durationMs,
          limit: row.outcome === 'failed' ? 2 : 1,
          resetsAt: null,
        }) satisfies UsageFacts['limits'][number],
    )
    let expected: string | undefined
    const orders = permutations(checks.map((_row, index) => index))
    for (const order of orders) {
      const result = await readSessionFacts(order, checks, breakdown, limits)
      expect(result.record.status).toBe('ok')
      expect(result.data?.checkRuns.map((row) => row.commit)).toEqual([
        'fixture-a',
        'fixture-a',
        'fixture-a',
        'fixture-b',
      ])
      const bytes = JSON.stringify(result)
      expected ??= bytes
      expect(bytes).toBe(expected)
    }
  })
  it('produces byte-identical questions for every permutation when scrubbed ids collide', async () => {
    const questions: ReportQuestion[] = [
      { id: 'private-a', text: 'First', milestoneIds: ['M13', 'M12'], state: 'answered' },
      { id: 'private-b', text: 'Second', milestoneIds: [], state: 'open' },
      { id: 'private-c', text: 'Third', milestoneIds: [], state: 'dismissed' },
    ]
    let expected: string | undefined
    for (const rows of permutations(questions)) {
      const result = await questionsSource(
        { read: () => Promise.resolve({ questions: rows, observedAt: REPORT_FIXTURE_AS_OF }) },
        (text) => text.replaceAll(/private-[abc]/gu, '[redacted]'),
      ).read(context())
      expect(result.record.status).toBe('ok')
      const bytes = JSON.stringify(result)
      expected ??= bytes
      expect(bytes).toBe(expected)
    }
  })
  it('renders byte-identical session reports in every format for every permutation of valid inputs', async () => {
    // RVCM1131 finding 1: source-byte equality alone never certified the
    // report. This test carries permuted source inputs through the production
    // collector, the production finalizer and all four production renderers.
    // Every row keeps a distinct collector identity (checks differ in `at`,
    // usage keys and question ids are distinct), so the document is valid;
    // scrub-collapsed identities still collide at the collector and are
    // recorded as a limitation in docs/certification/m113-s-local-sources.md.
    const checks: CheckRunRecord[] = []
    const breakdown: UsageFacts['breakdown'][number][] = []
    const limits: UsageFacts['limits'][number][] = []
    for (const [step, suffix] of ['a', 'b', 'c'].entries()) {
      checks.push({
        at: `2026-10-06T11:59:0${String(step)}Z`,
        check: 'quality',
        commit: 'fixture-commit',
        outcome: 'passed',
        durationMs: 1,
      })
      breakdown.push({
        key: `render-model-${suffix}`,
        inputTokens: step + 1,
        outputTokens: 1,
        costUsd: null,
        certainty: 'unknown',
      })
      limits.push({ key: `render-limit-${suffix}`, used: step + 1, limit: 10, resetsAt: null })
    }
    const questions: ReportQuestion[] = [
      { id: 'render-q-a', text: 'First', milestoneIds: [], state: 'answered' },
      { id: 'render-q-b', text: 'Second', milestoneIds: [], state: 'open' },
      { id: 'render-q-c', text: 'Third', milestoneIds: [], state: 'dismissed' },
    ]
    const options = reportOptions('session')
    let expectedSource: string | undefined
    let expectedRenders: RenderedReport | undefined
    for (const order of threeIndexOrders) {
      const session = await readSessionFacts(order, checks, breakdown, limits)
      expect(session.record.status).toBe('ok')
      // Checks tie on check/outcome/commit/durationMs and differ only in
      // `at`: the `at` term orders them oldest first, and the
      // serialized-bytes tail covers the same rows, so removing either
      // guard alone stays green while removing both fails this test.
      expect(session.data?.checkRuns.map((row) => row.at)).toEqual([
        '2026-10-06T11:59:00Z',
        '2026-10-06T11:59:01Z',
        '2026-10-06T11:59:02Z',
      ])
      const sessionBytes = JSON.stringify(session)
      expectedSource ??= sessionBytes
      expect(sessionBytes).toBe(expectedSource)
      const asked = await questionsSource(
        {
          read: () =>
            Promise.resolve({
              questions: order.flatMap((index) => questions[index] ?? []),
              observedAt: REPORT_FIXTURE_AS_OF,
            }),
        },
        scrub,
      ).read(context())
      expect(asked.record.status).toBe('ok')
      if (session.data === null || asked.data === null) throw new Error('Missing test facts')
      const snapshot = buildSourceSnapshot({ session, questions: asked })
      const document = renderTestCollector(snapshot, options)
      expect(document.header.contentHash).toMatch(/^[a-f0-9]{64}$/u)
      const rendered = renderAllFormats(document)
      expectedRenders ??= rendered
      expect(rendered).toEqual(expectedRenders)
    }
  })
  it('uses M84 export and retains real turns and all approval outcomes', async () => {
    const result = await sessionSource(sessionReader(), [String.raw`C:\Users\Private`], scrub).read(
      context(),
    )
    expect(result.record.status).toBe('ok')
    expect(result.data?.activity).toEqual({
      turns: { status: 'available', count: 1 },
      approvals: { status: 'available', approved: 1, denied: 2, auto: 0, expired: 1 },
    })
    expect(result.data?.export.transcript.filter((row) => row.kind === 'userMessage')).toHaveLength(
      2,
    )
    expect(JSON.stringify(result)).not.toMatch(/private-canary|owner@example|Private/)
    expect(result.data?.export.exportedAt).toBe('2026-10-06T12:00:00.000Z')
    expect(result.data?.usage.costUsd).toBeNull()
    expect(result.data?.usage.cachedTokens).toBeNull()
  })
  it('retains explicit unavailability instead of inferring activity from messages', async () => {
    const reader = sessionReader()
    const original = await reader.read(context())
    if (original === null) throw new Error('Missing test fixture')
    const result = await sessionSource(
      {
        read: () =>
          Promise.resolve({
            ...original,
            activity: {
              turns: { status: 'unavailable', reason: 'private-canary' },
              approvals: { status: 'unavailable', reason: 'History lacks approvals' },
            },
          }),
      },
      [],
      scrub,
    ).read(context())
    expect(result.data?.activity.turns).toEqual({ status: 'unavailable', reason: '[redacted]' })
    expect(result.data?.activity.approvals.status).toBe('unavailable')
  })
  it('names absent bindings, sessions and malformed activity honestly', async () => {
    const observed1 = await sessionSource(undefined, [], scrub).read(context())
    expect(observed1.data).toBeNull()
    const observed2 = await sessionSource({ read: () => Promise.resolve(null) }, [], scrub).read(
      context(),
    )
    expect(observed2.record.status).toBe('unavailable')
    const original = await sessionReader().read(context())
    if (original === null) throw new Error('Missing test fixture')
    const observed3 = await sessionSource(
      {
        read: () =>
          Promise.resolve({
            ...original,
            activity: { ...original.activity, turns: { status: 'available', count: -1 } },
          }),
      },
      [],
      scrub,
    ).read(context())
    expect(observed3.data).toBeNull()
  })
  it('orders tied check runs deterministically regardless of input order', async () => {
    const runs = [
      {
        check: 'quality',
        outcome: 'passed',
        durationMs: 10,
        commit: 'a'.repeat(40),
        at: REPORT_FIXTURE_AS_OF,
      },
      {
        check: 'quality',
        outcome: 'failed',
        durationMs: 20,
        commit: 'b'.repeat(40),
        at: REPORT_FIXTURE_AS_OF,
      },
    ] as const
    const read = async (checkRuns: readonly (typeof runs)[number][]) => {
      const original = await sessionReader().read(context())
      if (original === null) throw new Error('Missing test fixture')
      const result = await sessionSource(
        {
          read: () => Promise.resolve({ ...original, checkRuns: [...checkRuns] }),
        },
        [],
        scrub,
      ).read(context())
      return result.data?.checkRuns
    }
    const forward = await read(runs)
    const reversed = await read(runs.toReversed())
    expect(forward?.map((row) => row.outcome)).toEqual(['failed', 'passed'])
    expect(reversed).toEqual(forward)
  })
  it('preserves question states, stable ordering, timestamps and scrubs text', async () => {
    const questions: ReportQuestion[] = [
      { id: 'b', text: 'private-canary', milestoneIds: ['M13', 'M12'], state: 'answered' },
      { id: 'a', text: 'Needs you', milestoneIds: [], state: 'open' },
    ]
    const reader = {
      read: () => Promise.resolve({ questions, observedAt: '2026-10-06T11:59:59+00:00' }),
    }
    const first = await questionsSource(reader, scrub).read(context())
    expect(first.data?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(first.data?.[1]).toMatchObject({
      text: '[redacted]',
      state: 'answered',
      milestoneIds: ['M12', 'M13'],
    })
    expect(first.record.freshness).toEqual({ state: 'fresh', ageMs: 1000 })
    questions.reverse()
    expect(await questionsSource(reader, scrub).read(context())).toEqual(first)
    // RVREPORTJOIN P2-1: a repeated id keeps its first row; the later copy
    // is a named problem beside the good rows, never a lost registry.
    questions.push(questions[0]!)
    const observed4 = await questionsSource(reader, scrub).read(context())
    expect(observed4.record.status).toBe('partial')
    expect(observed4.data?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(observed4.record.reason).toContain(EN.reportSourceReasons.invalid)
  })
  it('computes keys consistently for Windows separators and casing', () => {
    expect(() => reportWorkspaceKey('relative', 'win32')).toThrow()
    expect(reportWorkspaceKey(String.raw`C:\Users\Fixture\workspace`, 'win32')).toBe(
      reportWorkspaceKey('c:/users/fixture/workspace', 'win32'),
    )
    expect(reportWorkspaceKey('/workspace/A', 'linux')).not.toBe(
      reportWorkspaceKey('/workspace/a', 'linux'),
    )
    expect(reportWorkspaceKey(String.raw`C:\Users\Fixture\workspace`, 'win32')).toMatch(
      /^[a-f0-9]{16}$/u,
    )
  })
  it('provides explicit availability for all local sources in every host', async () => {
    const sources = createHostReportSources(deps())
    const results = await Promise.all(
      Object.values(sources).map((source) => source.read(context())),
    )
    expect(results.map((result) => result.record.id).toSorted(codeUnitCompare)).toEqual([
      'accounts',
      'agentUsage',
      'certification',
      'changelog',
      'git',
      'package',
      'questions',
      'security',
      'session',
      'usage',
    ])
    expect(results.every((result) => result.data === null && result.record.reason.length > 0)).toBe(
      true,
    )
    expect(results.find((result) => result.record.id === 'agentUsage')?.record.status).toBe(
      'notApplicable',
    )
    expect(JSON.stringify(results)).not.toContain('private-canary')
    for (const id of ['session', 'questions', 'usage']) {
      expect(results.find((result) => result.record.id === id)?.record.reason).toBe(
        UI_TEXT.reportSourceReasons.unbound,
      )
    }
    // Without their readers the accounts and security integrations report
    // unavailable; bound readers scope other kinds to not applicable (proved
    // in the dedicated source suites).
    for (const id of ['accounts', 'security']) {
      expect(results.find((result) => result.record.id === id)?.record).toMatchObject({
        status: 'unavailable',
        reason: UI_TEXT.reportSourceReasons.unbound,
      })
    }
    const runtime = createRuntimeReportSources({
      ...deps(),
      workspaceRoot: 'C:/fixture/workspace',
      homeDir: 'C:/fixture',
      platform: 'win32',
      env: {},
    })
    expect(Object.keys(runtime.sources)).toEqual(Object.keys(sources))
    expect(runtime.workspaceKey).toBe(reportWorkspaceKey('C:/fixture/workspace', 'win32'))
  })
  it('uses injected usage aggregation without guessing journal fields', async () => {
    const session = reportFactSnapshot().sources.session
    if (session.data === null) throw new Error('Missing test fixture')
    const usage = { ...session.data.usage, period: 'private-canary' }
    const sources = createHostReportSources({
      ...deps(),
      usage: () => Promise.resolve({ usage, observedAt: REPORT_FIXTURE_AS_OF }),
    })
    const observed5 = await sources.usage.read(context())
    expect(observed5.data?.period).toBe('[redacted]')
    const observed6 = await createHostReportSources({
      ...deps(),
      usage: () =>
        Promise.resolve({ usage: { ...usage, inputTokens: -1 }, observedAt: REPORT_FIXTURE_AS_OF }),
    }).usage.read(context())
    expect(observed6.data).toBeNull()
  })
  it('cancels a reader that ignores the signal and enforces the per-source timeout', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    try {
      const sources = createHostReportSources({
        ...deps(),
        usage: () =>
          new Promise((_resolve) => {
            /* Deliberately ignores cancellation to exercise the source deadline. */
          }),
      })
      const pending = sources.usage.read(context())
      controller.abort()
      const result = await pending
      expect(result).toMatchObject({
        record: { status: 'unavailable', observedAt: null },
        data: null,
      })
      expect(timeout).toHaveBeenCalledWith(REPORT_SOURCE_TIMEOUT_MS)
    } finally {
      timeout.mockRestore()
    }
  })
  it('rejects invalid observation timestamps at the source boundary', async () => {
    const result = await questionsSource(
      { read: () => Promise.resolve({ questions: [], observedAt: 'invalid' }) },
      scrub,
    ).read(context())
    expect(result.data).toBeNull()
    expect(result.record.status).toBe('unavailable')
  })
  it('distinguishes stale, future and unknown observations without reading a clock', () => {
    expect(sourceFreshness(REPORT_FIXTURE_AS_OF, '2026-10-05T12:00:00Z')).toEqual({
      state: 'stale',
      ageMs: 86_400_000,
    })
    expect(sourceFreshness(REPORT_FIXTURE_AS_OF, null)).toEqual({ state: 'unknown', ageMs: null })
    expect(sourceFreshness(REPORT_FIXTURE_AS_OF, '2026-10-07T12:00:00Z')).toEqual({
      state: 'unknown',
      ageMs: null,
    })
  })
})
