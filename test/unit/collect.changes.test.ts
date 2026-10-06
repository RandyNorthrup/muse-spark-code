import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createReportCollector } from '../../src/core/reporting/collect'
import type { GitFacts } from '../../src/core/reporting/sources/types'
import {
  collectFixture,
  fixtureFinalize,
  fullSnapshot,
  getSection,
} from './helpers/reporting/collect'
import { availableSource, reportOptions, unavailableSource } from './helpers/reporting/snapshot'
import { buildFixtureRepository } from './helpers/reporting/repository'

const scratch = { directory: '', first: '', tip: '', sibling: '', base: '' }
const commits: GitFacts['commits'][number][] = []
const memberships: { commit: string; branches: string[] }[] = []

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, '../../temp')
  await mkdir(root, { recursive: true })
  scratch.directory = await mkdtemp(path.join(root, 'm113-k-ancestry-'))
  const { git, head } = await buildFixtureRepository(scratch.directory)
  scratch.base = head
  git(['switch', '-c', 'm113/k'])
  git(['commit', '--allow-empty', '-m', 'First lane change'])
  scratch.first = git(['rev-parse', 'HEAD'])
  git(['commit', '--allow-empty', '-m', 'Second lane change'])
  scratch.tip = git(['rev-parse', 'HEAD'])
  git(['switch', '-c', 'feature/m114-u', 'main'])
  git(['commit', '--allow-empty', '-m', 'Sibling lane change'])
  scratch.sibling = git(['rev-parse', 'HEAD'])
  const branches = ['m113/k', 'feature/m114-u']
  const laneCommits = branches.map((branch) => ({
    branch,
    reachable: new Set(
      git(['rev-list', branch, `^${git(['merge-base', 'main', branch])}`]).split('\n'),
    ),
  }))
  for (const sha of [scratch.first, scratch.tip, scratch.sibling, scratch.base]) {
    commits.push({
      sha,
      at: git(['show', '-s', '--format=%cI', sha]),
      subject: git(['show', '-s', '--format=%s', sha]),
      files: git(['show', '--format=', '--name-only', sha]).split('\n').filter(Boolean),
    })
    memberships.push({
      commit: sha,
      branches: laneCommits.filter((lane) => lane.reachable.has(sha)).map((lane) => lane.branch),
    })
  }
})

afterAll(async () => {
  if (scratch.directory !== '') await rm(scratch.directory, { recursive: true, force: true })
})

describe('changes report', () => {
  it('groups earlier lane commits by merge-base reachability without assigning shared or sibling history', () => {
    const snapshot = fullSnapshot()
    const input = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        git: availableSource('git', {
          ...snapshot.sources.git.data!,
          commits,
          branches: [
            { name: 'm113/k', commit: scratch.tip, merged: false },
            { name: 'feature/m114-u', commit: scratch.sibling, merged: false },
          ],
        }),
      },
    }
    const changeBranches = vi.fn(() => availableSource('changeBranches', memberships))
    const collect = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: {
        changes: () => availableSource('changesRange', commits),
        changeBranches,
        risksSinceRelease: () => unavailableSource('risksSinceRelease'),
      },
    })
    const options = reportOptions('changes', { scope: 'since v0.14.2', full: true })
    const report = collect(input, options)
    const rows = getSection(report, 'commits').rows
    const find = (sha: string) => rows.find((row) => row.cells['commit']?.value === sha)!
    expect(find(scratch.first).cells['milestones']).toEqual({ type: 'textList', value: ['M113'] })
    expect(find(scratch.tip).cells['milestones']).toEqual({ type: 'textList', value: ['M113'] })
    expect(find(scratch.sibling).cells['milestones']).toEqual({ type: 'textList', value: ['M114'] })
    expect(find(scratch.base).cells['milestones']).toEqual({ type: 'textList', value: ['M110A0'] })
    expect(find(scratch.first).sourceIds).toEqual(['changeBranches', 'changesRange'])
    expect(changeBranches).toHaveBeenCalledWith(input, options)
    expect(report.sources).toContainEqual(availableSource('changeBranches', memberships).record)
    const reordered = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: {
        changes: () => availableSource('changesRange', commits.toReversed()),
        changeBranches: () => availableSource('changeBranches', memberships.toReversed()),
        risksSinceRelease: () => unavailableSource('risksSinceRelease'),
      },
    })(input, options)
    expect(reordered).toEqual(report)
  })

  it('distinguishes missing branch membership from an observed empty membership', () => {
    const snapshot = fullSnapshot()
    const selected = [{ ...snapshot.sources.git.data!.commits[0]!, subject: 'No milestone token' }]
    for (const source of [
      unavailableSource('changeBranches', 'Ancestry read failed'),
      availableSource('changeBranches', []),
      availableSource('changeBranches', [{ commit: 'head', branches: [] }]),
      {
        data: [{ commit: 'head', branches: [] }],
        record: {
          ...availableSource('changeBranches', []).record,
          status: 'partial' as const,
          reason: 'Branch scan incomplete',
        },
      },
    ]) {
      const report = createReportCollector({
        finalize: fixtureFinalize,
        nextStepLimit: 3,
        selections: {
          changes: () => availableSource('changesRange', selected),
          changeBranches: () => source,
          risksSinceRelease: () => unavailableSource('risksSinceRelease'),
        },
      })(snapshot, reportOptions('changes'))
      const entry = getSection(report, 'commits').rows.find(
        (row) => row.cells['commit']?.value === 'head',
      )!
      expect(entry.cells['milestones']).toEqual({ type: 'textList', value: [] })
      expect(entry.cells['status']).toEqual({
        type: 'label',
        value: source.record.status === 'ok' && source.data?.length === 1 ? 'ok' : 'unknown',
      })
      if (source.record.status !== 'ok') {
        expect(getSection(report, 'commits').rows).toContainEqual(
          expect.objectContaining({
            sourceIds: ['changeBranches'],
            cells: expect.objectContaining({
              reason: { type: 'text', value: source.record.reason },
            }),
          }),
        )
      }
    }
  })

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
      selections: {
        changes,
        changeBranches: () =>
          availableSource('changeBranches', [{ commit: 'older', branches: [] }]),
        risksSinceRelease: () => unavailableSource('risksSinceRelease'),
      },
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
