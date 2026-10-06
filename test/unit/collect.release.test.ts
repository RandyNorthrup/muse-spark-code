import { describe, expect, it } from 'vitest'
import { collectFixture, fullSnapshot, getSection, noSources } from './helpers/reporting/collect'
import { availableSource, unavailableSource } from './helpers/reporting/snapshot'
import { ReportScopeNotFound } from '../../src/core/reporting/collect/plan'

describe('release report', () => {
  it.each(['0.14.2', 'v0.14.2', 'latest'])(
    'selects %s with tag, changelog, channels, record and tag CI',
    (scope) => {
      const report = collectFixture('release', { scope })
      expect(getSection(report, 'tag').rows[0]!.cells['commit']).toEqual({
        type: 'text',
        value: 'tagged',
      })
      expect(getSection(report, 'changelog').rows[0]!.cells['name']).toEqual({
        type: 'text',
        value: 'A released feature',
      })
      expect(getSection(report, 'releaseRecord').rows).toHaveLength(1)
      expect(getSection(report, 'assets').rows[0]!.cells['files']).toEqual({
        type: 'textList',
        value: ['agent.tgz', 'extension.vsix'],
      })
      expect(getSection(report, 'ci').rows[0]!.cells['outcome']).toEqual({
        type: 'label',
        value: 'running',
      })
      expect(getSection(report, 'ci').rows[0]!.cells['scope']).toEqual({
        type: 'text',
        value: 'release-tag',
      })
    },
  )

  it('distinguishes not found from unavailable evidence', () => {
    expect(() => collectFixture('release', { scope: '0.0.0' })).toThrow(ReportScopeNotFound)
    const unavailable = collectFixture('release', {}, noSources())
    expect(getSection(unavailable, 'tag').rows[0]!.cells['status']).toEqual({
      type: 'label',
      value: 'unavailable',
    })
  })
  it('orders release dates by instant and retains local tags when the changelog is unavailable', () => {
    const snapshot = fullSnapshot()
    const input = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        changelog: unavailableSource('changelog', 'No changelog'),
        plan: unavailableSource('plan', 'No plan'),
        git: availableSource('git', {
          ...snapshot.sources.git.data!,
          tags: [
            { name: 'v0.14.2', commit: 'early', at: '2026-10-06T10:00:00+02:00' },
            { name: 'v0.14.3', commit: 'late', at: '2026-10-06T09:00:00Z' },
          ],
        }),
      },
    }
    expect(
      getSection(collectFixture('release', { scope: 'latest' }, input), 'tag').rows[0]!.cells[
        'commit'
      ],
    ).toEqual({ type: 'text', value: 'late' })
    const project = collectFixture('project', {}, input)
    expect(
      getSection(project, 'releases').rows.some(
        (row) => row.cells['version']?.type === 'text' && row.cells['version'].value === '0.14.3',
      ),
    ).toBe(true)
    expect(
      getSection(project, 'releases').rows.some(
        (row) =>
          row.cells['reason']?.type === 'text' && row.cells['reason'].value === 'No changelog',
      ),
    ).toBe(true)
  })
})
