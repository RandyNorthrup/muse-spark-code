import { describe, expect, it } from 'vitest'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'

describe('quality collector', () => {
  it('lists declared scripts even before any local run and keeps CI refs separate', () => {
    const report = collectFixture('quality')
    expect(getSection(report, 'gates').rows).toHaveLength(3)
    expect(getSection(report, 'lastLocalRuns').rows).toHaveLength(3)
    expect(
      getSection(report, 'lastLocalRuns').rows.find(
        (row) => row.cells['name']?.type === 'text' && row.cells['name'].value === 'quality',
      )!.cells['outcome'],
    ).toEqual({
      type: 'label',
      value: 'passed',
    })
    expect(getSection(report, 'ci').rows).toHaveLength(3)
    expect(getSection(report, 'certification').rows[0]!.cells['count']).toEqual({
      type: 'count',
      value: 1,
    })
    const snapshot = fullSnapshot()
    const empty = collectFixture(
      'quality',
      {},
      {
        ...snapshot,
        sources: { ...snapshot.sources, checkRuns: availableSource('checkRuns', []) },
      },
    )
    expect(getSection(empty, 'gates').rows).toHaveLength(3)
    expect(getSection(empty, 'lastLocalRuns').rows).toHaveLength(3)
    expect(
      getSection(empty, 'lastLocalRuns').rows.every(
        (row) =>
          row.cells['outcome']?.type === 'label' && row.cells['outcome'].value === 'unavailable',
      ),
    ).toBe(true)
  })

  it('selects last checks by instant with stable ties and preserves new CI outcomes', () => {
    const snapshot = fullSnapshot()
    const report = collectFixture(
      'quality',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          checkRuns: availableSource('checkRuns', [
            {
              check: 'quality',
              outcome: 'failed',
              durationMs: 1,
              commit: 'early',
              at: '2026-10-06T10:00:00+02:00',
            },
            {
              check: 'quality',
              outcome: 'passed',
              durationMs: 2,
              commit: 'late',
              at: '2026-10-06T09:00:00Z',
            },
          ]),
          github: availableSource('github', {
            ...snapshot.sources.github.data!,
            runs: [{ ...snapshot.sources.github.data!.runs[0]!, conclusion: 'future-conclusion' }],
          }),
        },
      },
    )
    expect(
      getSection(report, 'lastLocalRuns').rows.find(
        (row) => row.cells['name']?.type === 'text' && row.cells['name'].value === 'quality',
      )!.cells['commit'],
    ).toEqual({
      type: 'text',
      value: 'late',
    })
    expect(getSection(report, 'ci').rows[0]!.cells['outcome']).toEqual({
      type: 'text',
      value: 'future-conclusion',
    })
  })
})
