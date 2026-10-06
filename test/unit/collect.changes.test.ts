import { describe, expect, it, vi } from 'vitest'
import { createReportCollector } from '../../src/core/reporting/collect'
import {
  collectFixture,
  fixtureFinalize,
  fullSnapshot,
  getSection,
} from './helpers/reporting/collect'
import { availableSource, reportOptions, unavailableSource } from './helpers/reporting/snapshot'

describe('changes report', () => {
  it('groups commits by milestone and normalizes file areas before counting', () => {
    const report = collectFixture('changes')
    expect(getSection(report, 'commits').rows).toHaveLength(2)
    expect(
      getSection(report, 'commits').rows.find(
        (row) => row.cells['commit']?.type === 'text' && row.cells['commit'].value === 'head',
      )!.cells['milestones'],
    ).toEqual({
      type: 'textList',
      value: ['M12'],
    })
    const core = getSection(report, 'files').rows.find(
      (row) => row.cells['scope']?.type === 'text' && row.cells['scope'].value === 'src/core',
    )!
    expect(core.cells['count']).toEqual({ type: 'count', value: 1 })
    expect(core.cells['files']).toEqual({
      type: 'textList',
      value: ['src/core/reporting/collect.ts'],
    })
    expect(getSection(report, 'changelog').rows[0]!.cells['name']).toEqual({
      type: 'text',
      value: 'Added collectors',
    })
  })

  it('uses injected ancestry selection for refs or dates and never guesses from timestamps', () => {
    const snapshot = fullSnapshot()
    const changes = vi.fn((_snapshot, _options) =>
      availableSource('changesRange', [snapshot.sources.git.data!.commits[1]!]),
    )
    const collect = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: { changes, risksSinceRelease: () => unavailableSource('risksSinceRelease') },
    })
    const options = reportOptions('changes', { scope: 'since v0.14.1' })
    const report = collect(snapshot, options)
    expect(changes).toHaveBeenCalledWith(snapshot, options)
    expect(getSection(report, 'commits').rows).toHaveLength(1)
    expect(getSection(report, 'commits').rows[0]!.cells['commit']).toEqual({
      type: 'text',
      value: 'older',
    })
  })

  it('keeps long source-derived group identities inside the report id bound without truncating data', () => {
    const snapshot = fullSnapshot()
    const subject = `M${'9'.repeat(1000)} release work`
    const report = collectFixture(
      'changes',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          git: availableSource('git', {
            ...snapshot.sources.git.data!,
            branches: [],
            commits: [{ ...snapshot.sources.git.data!.commits[0]!, subject }],
          }),
        },
      },
    )
    expect(getSection(report, 'commits').rows[0]!.key.length).toBeLessThanOrEqual(256)
    expect(getSection(report, 'commits').rows[0]!.cells['name']).toEqual({
      type: 'text',
      value: subject,
    })
  })
  it('maps the declared layout areas with Windows paths before comparing them', () => {
    const snapshot = fullSnapshot()
    const files = [
      String.raw`src\runtime\exec\runner.ts`,
      'src/shared/l10n/en.ts',
      String.raw`native\windows\helper.cs`,
      'test/unit/example.test.ts',
      'docs/certification/example.md',
      'action/apply/lib/prepare.mjs',
    ]
    const report = collectFixture(
      'changes',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          git: availableSource('git', {
            ...snapshot.sources.git.data!,
            commits: [{ ...snapshot.sources.git.data!.commits[0]!, files }],
          }),
        },
      },
    )
    expect(getSection(report, 'files').rows.map((row) => row.cells['scope'])).toEqual(
      expect.arrayContaining(
        [
          'src/runtime/exec',
          'src/shared/l10n',
          'native/windows',
          'test/unit',
          'docs/certification',
          'action/apply',
        ].map((value) => ({ type: 'text', value })),
      ),
    )
    expect(getSection(report, 'files').rows).toHaveLength(6)
  })
})
