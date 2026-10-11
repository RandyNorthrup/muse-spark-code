import { describe, expect, it, vi } from 'vitest'
import {
  createReportCollector,
  type ReportCollectorDependencies,
} from '../../src/core/reporting/collect'
import {
  REPORT_ID_PATTERN,
  REPORT_KINDS,
  REPORT_MAX_ID_CHARS,
  REPORT_SECTION_ROWS,
} from '../../src/shared/constants'
import { key } from '../../src/core/reporting/collect/common'
import { buildSessionExport } from '../../src/core/export/sessionTransfer'
import {
  collectFixture,
  fixtureCollector,
  fixtureFinalize,
  facet,
  fullSnapshot,
  getSection,
  noSources,
} from './helpers/reporting/collect'
import { availableSource, reportOptions, unavailableSource } from './helpers/reporting/snapshot'

function dependencies(): ReportCollectorDependencies {
  return {
    finalize: fixtureFinalize,
    nextStepLimit: 3,
    selections: {
      changes: () => unavailableSource('changesRange'),
      changeBranches: () => unavailableSource('changeBranches'),
      risksSinceRelease: () => unavailableSource('risksSinceRelease'),
    },
  }
}

describe('collector boundary and policy', () => {
  it.each(REPORT_KINDS)(
    'generates schema-valid %s from unavailable sources without dropping them',
    (kind) => {
      const report = fixtureCollector(noSources(), reportOptions(kind))
      expect(report.header.kind).toBe(kind)
      expect(
        report.sources.some((source) => source.id === 'git' && source.status === 'unavailable'),
      ).toBe(true)
      expect(
        report.sources.some((source) => source.id === 'usage' && source.status === 'unavailable'),
      ).toBe(true)
      expect(report.sections.length).toBeGreaterThan(0)
    },
  )

  it('hands an unhashed document to the injected finalizer and validates its result', () => {
    const finalize = vi.fn(fixtureFinalize)
    const report = createReportCollector({ ...dependencies(), finalize })(
      fullSnapshot(),
      reportOptions('quality'),
    )
    expect(finalize).toHaveBeenCalledOnce()
    expect(finalize.mock.calls[0]![0].header).not.toHaveProperty('contentHash')
    expect(report.header.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(() =>
      createReportCollector({
        ...dependencies(),
        finalize: (draft) => ({
          ...fixtureFinalize(draft),
          header: { ...report.header, contentHash: 'bad' },
        }),
      })(fullSnapshot(), reportOptions('project')),
    ).toThrow()
  })

  it('requires one asOf stamp and a positive bounded next-step policy', () => {
    expect(() => collectFixture('project', { asOf: '2026-10-01T00:00:00Z' })).toThrow(
      'report/asOfMismatch',
    )
    for (const nextStepLimit of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => createReportCollector({ ...dependencies(), nextStepLimit })).toThrow(
        'report/invalidNextStepLimit',
      )
    }
  })

  it('caps ordinary rows and Needs you only after sorting, and --full retains every row', () => {
    const snapshot = fullSnapshot()
    const plan = snapshot.sources.plan.data!
    const questions = Array.from({ length: REPORT_SECTION_ROWS + 2 }, (_, index) => ({
      id: `Q-${String(index)}`,
      text: `Question ${String(index)}`,
      milestoneIds: ['M12'],
      state: 'open' as const,
    }))
    const input = {
      ...snapshot,
      sources: { ...snapshot.sources, plan: availableSource('plan', { ...plan, questions }) },
    }
    const full = collectFixture('milestone', { full: true }, input)
    const short = collectFixture('milestone', {}, input)
    expect(getSection(short, 'milestoneQuestions').rows).toEqual(
      getSection(full, 'milestoneQuestions').rows.slice(0, REPORT_SECTION_ROWS),
    )
    expect(getSection(short, 'milestoneQuestions').omittedRows).toBe(2)
    expect(full.needsYou.rows).toHaveLength(REPORT_SECTION_ROWS + 4)
    expect(short.needsYou.rows).toEqual(full.needsYou.rows.slice(0, REPORT_SECTION_ROWS))
    expect(short.needsYou.omittedRows).toBe(4)
  })

  it('does not read the ambient clock, randomness or installed language', () => {
    const snapshot = fullSnapshot()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('ambient-clock')
    })
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('ambient-random')
    })
    try {
      expect(collectFixture('project', {}, snapshot).header.asOf).toBe(snapshot.asOf)
    } finally {
      clock.mockRestore()
      random.mockRestore()
    }
  })

  it('preserves partial source reasons and freshness and rejects conflicting evidence ids', () => {
    const snapshot = fullSnapshot()
    const usage = availableSource('usage', snapshot.sources.usage.data!)
    const partial = {
      data: snapshot.sources.usage.data!,
      record: {
        ...usage.record,
        status: 'partial' as const,
        reason: 'Journal truncated',
        freshness: { state: 'stale' as const, ageMs: 100 },
      },
    }
    const report = collectFixture(
      'usage',
      {},
      { ...snapshot, sources: { ...snapshot.sources, usage: partial } },
    )
    expect(report.sources.find((source) => source.id === 'usage')).toEqual(partial.record)
    expect(
      getSection(report, 'totals').rows.some(
        (row) =>
          row.cells['reason']?.type === 'text' && row.cells['reason'].value === 'Journal truncated',
      ),
    ).toBe(true)
    const input = JSON.stringify(snapshot)
    collectFixture('project', {}, snapshot)
    expect(JSON.stringify(snapshot)).toBe(input)
    expect(() =>
      createReportCollector({
        ...dependencies(),
        selections: {
          ...dependencies().selections,
          risksSinceRelease: () => unavailableSource('plan', 'Conflicting evidence'),
        },
      })(snapshot, reportOptions('project')),
    ).toThrow('report/conflictingSourceRecords')
  })

  it('validates injected facets before handing them to the finalizer', () => {
    const snapshot = fullSnapshot()
    const invalid = facet('fleet', 'agents')
    invalid.rows.push(invalid.rows[0]!)
    const finalize = vi.fn(fixtureFinalize)
    const collect = createReportCollector({ ...dependencies(), finalize })
    expect(() =>
      collect(
        {
          ...snapshot,
          sources: { ...snapshot.sources, fleet: availableSource('fleet', [invalid]) },
        },
        reportOptions('fleet'),
      ),
    ).toThrow()
    expect(finalize).not.toHaveBeenCalled()
  })

  it('rejects unsupported runtime kinds with an explicit error', () => {
    const options = reportOptions()
    Object.defineProperty(options, 'kind', { value: 'unsupported' })
    expect(() => fixtureCollector(fullSnapshot(), options)).toThrow('report/unsupportedKind')
  })

  it('encodes invalid namespace characters without losing distinct identities', () => {
    const first = key('bad namespace', 'fact')
    expect(first).toMatch(REPORT_ID_PATTERN)
    expect(key('bad namespace', 'other')).not.toBe(first)
    expect(key('different namespace', 'fact')).not.toBe(first)
    expect(key('g'.repeat(1000), 'fact').length).toBeLessThanOrEqual(REPORT_MAX_ID_CHARS)
  })

  it('keeps generated row identities through the real M84 scrub while scrubbing source digests', async () => {
    const keys = REPORT_KINDS.flatMap((kind) => {
      const report = collectFixture(kind)
      return [report.needsYou, ...report.sections].flatMap((entry) =>
        entry.rows.map((row) => row.key),
      )
    })
    keys.push(key('a'.repeat(64), 'fact'), key('commit-M' + '9'.repeat(70), 'fact'))
    const built = await buildSessionExport(
      {
        backend: 'modelApi',
        modelId: 'fixture-model',
        exportedAt: new Date(fullSnapshot().asOf).toISOString(),
        items: keys.map((itemId) => ({
          itemId,
          kind: 'userMessage',
          status: 'completed',
          text: 'a'.repeat(64),
        })),
      },
      { redact: true, localRoots: [] },
    )
    expect(built.doc.transcript.map((item) => item.itemId)).toEqual(keys)
    expect(built.doc.transcript.every((item) => !item.text?.includes('a'.repeat(64)))).toBe(true)
  })

  it('bounds derived source ids while retaining distinct facets and their provenance', () => {
    const snapshot = fullSnapshot()
    const sourceId = 'g'.repeat(REPORT_MAX_ID_CHARS)
    const input = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        usage: {
          data: { ...snapshot.sources.usage.data!, cachedTokens: null },
          record: {
            ...snapshot.sources.usage.record,
            id: sourceId,
            status: 'ok' as const,
            reason: null,
          },
        },
        fleet: {
          data: [],
          record: {
            ...snapshot.sources.fleet.record,
            id: sourceId,
            status: 'ok' as const,
            reason: null,
          },
        },
      },
    }
    for (const kind of ['usage', 'fleet'] as const) {
      const report = collectFixture(
        kind,
        {},
        {
          ...input,
          sources: {
            ...input.sources,
            ...(kind === 'usage'
              ? { fleet: snapshot.sources.fleet }
              : { usage: snapshot.sources.usage }),
          },
        },
      )
      expect(report.sources.some((source) => source.id === sourceId)).toBe(true)
      const derived = report.sources.filter(
        (source) =>
          source.reason !== null &&
          (source.reason.includes('=null') || source.reason.endsWith(': undefined')),
      )
      expect(derived.length).toBeGreaterThan(0)
      expect(derived.every((source) => source.id.length <= REPORT_MAX_ID_CHARS)).toBe(true)
      expect(new Set(derived.map((source) => source.id)).size).toBe(derived.length)
    }
  })
})
