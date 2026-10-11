import { describe, expect, it, vi } from 'vitest'
import { createHostReportSources } from '../../src/host/reporting/sources'
import { createRuntimeReportSources } from '../../src/runtime/reporting/sources'
import { questionsSource } from '../../src/core/reporting/sources/questions'
import { sessionSource } from '../../src/core/reporting/sources/session'
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
import type { ReportQuestion } from '../../src/core/reporting/sources/types'

const context = () => ({
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
describe('session, registry and shared report adapters', () => {
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
    questions.push(questions[0]!)
    const observed4 = await questionsSource(reader, scrub).read(context())
    expect(observed4.record.status).toBe('unavailable')
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
      'agentUsage',
      'certification',
      'changelog',
      'git',
      'package',
      'questions',
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
