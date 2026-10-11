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
  it.each(['git', 'changelog', 'plan', 'github'] as const)(
    'keeps release absence unknown when %s is unavailable or partial',
    (kind) => {
      const snapshot = fullSnapshot()
      for (const isPartial of [false, true]) {
        const source = snapshot.sources[kind]
        const missing = isPartial
          ? {
              data: source.data!,
              record: { ...source.record, status: 'partial' as const, reason: 'Read incomplete' },
            }
          : unavailableSource(kind, 'Read failed')
        const report = collectFixture(
          'release',
          { scope: '0.0.0' },
          {
            ...snapshot,
            sources: { ...snapshot.sources, [kind]: missing },
          },
        )
        const evidence = getSection(report, 'releaseEvidence')
        expect(evidence.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              cells: expect.objectContaining({
                status: { type: 'label', value: 'unknown' },
                sources: { type: 'textList', value: [kind] },
              }),
            }),
            expect.objectContaining({
              sourceIds: [kind],
              cells: expect.objectContaining({
                reason: { type: 'text', value: isPartial ? 'Read incomplete' : 'Read failed' },
              }),
            }),
          ]),
        )
      }
    },
  )

  it('keeps release absence unknown with only a readable empty plan', () => {
    const snapshot = noSources()
    const plan = { ...fullSnapshot().sources.plan.data!, releases: [] }
    const report = collectFixture(
      'release',
      { scope: '0.14.2' },
      {
        ...snapshot,
        sources: { ...snapshot.sources, plan: availableSource('plan', plan) },
      },
    )
    expect(getSection(report, 'releaseEvidence').rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cells: expect.objectContaining({
            status: { type: 'label', value: 'unknown' },
            sources: { type: 'textList', value: ['changelog', 'git', 'github'] },
          }),
        }),
      ]),
    )
  })

  it('selects the latest release from GitHub alone with source-labelled project evidence', () => {
    const snapshot = noSources()
    const github = availableSource('github', {
      ...fullSnapshot().sources.github.data!,
      releases: [
        { version: 'v0.14.2', commit: 'tagged', at: '2026-10-05T00:00:00Z', assets: ['agent.tgz'] },
        { version: 'v0.14.3', commit: 'latest', at: '2026-10-06T00:00:00Z', assets: ['new.tgz'] },
      ],
    })
    const input = { ...snapshot, sources: { ...snapshot.sources, github } }
    const release = collectFixture('release', { scope: 'latest' }, input)
    expect(getSection(release, 'assets').rows[0]!.cells).toMatchObject({
      commit: { type: 'text', value: 'latest' },
      files: { type: 'textList', value: ['new.tgz'] },
    })
    expect(getSection(release, 'assets').rows[0]!.sourceIds).toEqual(['github'])
    const project = collectFixture('project', {}, input)
    expect(getSection(project, 'releases').rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cells: expect.objectContaining({ version: { type: 'text', value: '0.14.3' } }),
          sourceIds: ['github'],
        }),
      ]),
    )
    expect(getSection(project, 'channels').rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cells: expect.objectContaining({
            name: { type: 'text', value: 'GitHub' },
            version: { type: 'text', value: '0.14.3' },
            status: { type: 'label', value: 'current' },
          }),
          sourceIds: ['github'],
        }),
      ]),
    )
    expect(
      collectFixture(
        'project',
        {},
        {
          ...input,
          sources: {
            ...input.sources,
            github: availableSource('github', {
              ...github.data!,
              releases: github.data!.releases.toReversed(),
            }),
          },
        },
      ),
    ).toEqual(project)
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
