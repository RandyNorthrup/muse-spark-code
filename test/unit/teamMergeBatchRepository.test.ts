import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { admitMergeBatch, type MergeCandidate } from '../../src/core/team/mergeQueue'
import type { TeamSnapshot } from '../../src/host/team/stagingCopy'
import { teamRepository } from './helpers/teamRepository'
import { teamLandingFixture } from './helpers/teamLanding'

interface TrialTree {
  readonly snapshot: TeamSnapshot
  readonly directory: string
}
describe('cumulative batches on real repositories', () => {
  let repo: Awaited<ReturnType<typeof teamRepository>>
  beforeEach(async () => {
    repo = await teamRepository()
  })
  afterEach(async () => {
    await repo.dispose()
  })

  it.each(['green', 'culprit', 'interaction', 'dependency'])(
    'checks actual merged files and lands the exact last passing tree: %s',
    async (scenario) => {
      const fixture = await teamLandingFixture(repo)
      const initial: TrialTree = { snapshot: fixture.admission.snapshot, directory: repo.root }
      const candidates: MergeCandidate[] = ['A', 'B', 'C', 'D'].map((id) => ({
        id,
        dependsOn: id === 'D' && scenario === 'dependency' ? ['C'] : [],
        priority: 'normal',
        conflictsWith: [],
        changedLines: 1,
        files: [{ shared: false, protected: false }],
        finishedAt: 0,
        onConflict: 'rework',
      }))
      let trial = 0
      const checked: { readonly tree: string; readonly failed: boolean }[] = []
      const rework = vi.fn().mockResolvedValue(undefined)
      const result = await admitMergeBatch(initial, candidates, new Set(), {
        merge: async (state, candidate) => {
          trial += 1
          const directory = path.join(repo.storage, `trial-${String(trial)}`)
          await repo.staging.clone(state.directory, state.snapshot, directory)
          await repo.write(`${candidate.id}.txt`, candidate.id, directory)
          return {
            status: 'merged',
            tree: { directory, snapshot: await repo.staging.snapshot(directory) },
          }
        },
        check: async (state) => {
          const files = await readdir(state.directory)
          const isFailed =
            scenario !== 'green' &&
            files.includes('C.txt') &&
            (scenario !== 'interaction' || files.includes('A.txt'))
          checked.push({ tree: state.snapshot.tree, failed: isFailed })
          return isFailed ? [{ id: 'predicate', output: 'seeded merged-file failure' }] : []
        },
        rework,
      })
      let expected = ['A', 'B', 'D']
      if (scenario === 'green') expected = ['A', 'B', 'C', 'D']
      else if (scenario === 'dependency') expected = ['A', 'B']
      expect(result.admitted).toEqual(expected)
      expect(result.returned).toEqual(scenario === 'green' ? [] : ['C'])
      expect(result.held).toEqual(scenario === 'dependency' ? ['D'] : [])
      expect(checked.findLast((check) => !check.failed)?.tree).toBe(result.tree.snapshot.tree)
      expect(result.checkRuns).toBeLessThanOrEqual(6)
      if (scenario === 'green') expect(result.checkRuns).toBe(1)
      await repo.git([
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        result.tree.directory,
        result.tree.snapshot.commit,
      ])
      const admission = {
        ...fixture.admission,
        final: result.tree.snapshot,
        owners: new Map(expected.map((id) => [`${id}.txt`, [id]])),
      }
      expect(await fixture.landing.land(repo.root, admission)).toMatchObject({ status: 'landed' })
      const landed = await repo.staging.snapshot(repo.root)
      expect(landed.tree).toBe(result.tree.snapshot.tree)
      const files = await readdir(repo.root)
      expect(files.filter((name) => /^[A-D]\.txt$/u.test(name))).toEqual(
        expected.map((id) => `${id}.txt`),
      )
    },
  )
})
