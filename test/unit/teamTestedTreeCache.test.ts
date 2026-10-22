// M96d tested-tree cache: a merged tree already tested reuses its
// result only when the snapshot's tree hash and the check identity
// are both equal. Tree hashes below are real git trees from a real
// scratch repository; git itself proves when two landings share one.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  COORDINATOR_TESTED_TREE_CACHE_MAX,
  COORDINATOR_TESTED_TREE_FILE_MAX_BYTES,
  TEAM_MERGE_FLAKE_RETRIES,
} from '../../src/shared/constants'
import {
  loadTestedTrees,
  saveTestedTrees,
  TestedTreeCache,
  type TestedTreeOutcome,
} from '../../src/core/team/coordinator/testedTrees'
import {
  admitMergeBatch,
  type CheckFailure,
  type MergeAdmissionCache,
  type MergeAdmissionDeps,
  type MergeCandidate,
} from '../../src/core/team/mergeQueue'
import { resolveWorkingGit } from './helpers/realGit'

const workingGit: Promise<string> = resolveWorkingGit()
const GIT = await workingGit

function git(args: readonly string[], cwd: string): string {
  return execFileSync(GIT, [...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function scratchRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'm96d-trees-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  git(['init', '-b', 'main'], root)
  git(['config', 'user.name', 'Trees'], root)
  git(['config', 'user.email', 'trees@example.invalid'], root)
  writeFileSync(path.join(root, 'a.ts'), 'export const a = 1\n')
  git(['add', '.'], root)
  git(['commit', '-m', 'base'], root)
  return root
}

/** The real tree hash of a commit: `rev-parse <commit>^{tree}`. */
function treeOf(root: string, commit: string): string {
  return git(['rev-parse', commit + '^{tree}'], root).trim()
}

function candidate(id: string): MergeCandidate {
  return {
    id,
    dependsOn: [],
    priority: 'normal',
    conflictsWith: [],
    changedLines: 1,
    files: [],
    finishedAt: 1,
    onConflict: 'rework',
  }
}

/** A tree the queue merges: an opaque handle carrying its real hash. */
interface HashTree {
  readonly hash: string
}

describe('M96d tested-tree cache', () => {
  it('hits only on the exact (tree, identity) pair', () => {
    const cache = new TestedTreeCache()
    expect(cache.lookup('tree-a', 'checks-1')).toBeUndefined()
    const outcome: TestedTreeOutcome = { status: 'passed', flaky: [] }
    cache.record('tree-a', 'checks-1', outcome, 1)
    expect(cache.lookup('tree-a', 'checks-1')).toEqual(outcome)
    // Either half differing is a miss: a changed suite never reuses.
    expect(cache.lookup('tree-a', 'checks-2')).toBeUndefined()
    expect(cache.lookup('tree-b', 'checks-1')).toBeUndefined()
  })

  it('replays failures and flaky passes exactly', () => {
    const cache = new TestedTreeCache()
    const failures: readonly CheckFailure[] = [{ id: 'lint', output: 'nope' }]
    cache.record('tree-a', 'checks-1', { status: 'failed', failures }, 2)
    cache.record('tree-b', 'checks-1', { status: 'passed', flaky: ['lint'] }, 2)
    expect(cache.lookup('tree-a', 'checks-1')).toEqual({ status: 'failed', failures })
    expect(cache.lookup('tree-b', 'checks-1')).toEqual({ status: 'passed', flaky: ['lint'] })
  })

  it('never hits on an empty key and refuses to record one', () => {
    const cache = new TestedTreeCache()
    cache.record('tree-a', 'checks-1', { status: 'passed', flaky: [] }, 1)
    expect(cache.lookup('', 'checks-1')).toBeUndefined()
    expect(cache.lookup('tree-a', '')).toBeUndefined()
    expect(() => {
      cache.record('', 'checks-1', { status: 'passed', flaky: [] }, 1)
    }).toThrow('tested-tree key is empty')
    expect(() => {
      cache.record('tree-a', '', { status: 'passed', flaky: [] }, 1)
    }).toThrow('tested-tree key is empty')
  })

  it('evicts least-recently-used beyond the cap, hits refresh recency', () => {
    const cache = new TestedTreeCache()
    const outcome: TestedTreeOutcome = { status: 'passed', flaky: [] }
    for (let n = 0; n < COORDINATOR_TESTED_TREE_CACHE_MAX; n += 1) {
      cache.record(`tree-${String(n)}`, 'checks-1', outcome, 1)
    }
    expect(cache.size).toBe(COORDINATOR_TESTED_TREE_CACHE_MAX)
    // Touch the oldest so the second-oldest evicts instead.
    expect(cache.lookup('tree-0', 'checks-1')).toEqual(outcome)
    cache.record('tree-new', 'checks-1', outcome, 1)
    expect(cache.size).toBe(COORDINATOR_TESTED_TREE_CACHE_MAX)
    expect(cache.lookup('tree-0', 'checks-1')).toEqual(outcome)
    expect(cache.lookup('tree-new', 'checks-1')).toEqual(outcome)
    expect(cache.lookup('tree-1', 'checks-1')).toBeUndefined()
  })

  it('round-trips through the store file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm96d-trees-store-'))
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true })
    })
    const cache = new TestedTreeCache()
    cache.record('tree-a', 'checks-1', { status: 'passed', flaky: ['lint'] }, 2)
    cache.record(
      'tree-b',
      'checks-1',
      { status: 'failed', failures: [{ id: 'test', output: 'red' }] },
      2,
    )
    await saveTestedTrees(dir, cache)
    const loaded = await loadTestedTrees(dir)
    expect(loaded.lookup('tree-a', 'checks-1')).toEqual({ status: 'passed', flaky: ['lint'] })
    expect(loaded.lookup('tree-b', 'checks-1')).toEqual({
      status: 'failed',
      failures: [{ id: 'test', output: 'red' }],
    })
  })

  it('treats a missing, malformed or oversized file as an empty cache', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm96d-trees-store-'))
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true })
    })
    let stored = await loadTestedTrees(dir)
    expect(stored.size).toBe(0)
    const file = path.join(dir, 'tested-trees.json')
    writeFileSync(file, '{ not json')
    stored = await loadTestedTrees(dir)
    expect(stored.size).toBe(0)
    writeFileSync(file, JSON.stringify({ version: 999, records: [] }))
    stored = await loadTestedTrees(dir)
    expect(stored.size).toBe(0)
    writeFileSync(file, JSON.stringify({ version: 1, records: [{ tree: 'x' }] }))
    stored = await loadTestedTrees(dir)
    expect(stored.size).toBe(0)
    const padded = `${JSON.stringify({
      version: 1,
      records: [
        {
          tree: 'tree-a',
          checkIdentity: 'checks-1',
          outcome: { status: 'passed', flaky: [] },
          checkRuns: 1,
          recordedAt: 1,
        },
      ],
    })}${' '.repeat(COORDINATOR_TESTED_TREE_FILE_MAX_BYTES)}`
    writeFileSync(file, padded)
    stored = await loadTestedTrees(dir)
    expect(stored.size).toBe(0)
  })
})

describe('M96d tested-tree cache in the merge queue', () => {
  it('reuses a tested tree across windows and retests on any key change', async () => {
    const root = scratchRepo()
    const base = git(['rev-parse', 'HEAD'], root).trim()
    const baseTree = treeOf(root, base)
    // Two windows land the same bytes on two branches; git proves
    // the trees identical.
    git(['checkout', '-b', 'window-1'], root)
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'change a'], root)
    const firstTree = treeOf(root, 'HEAD')
    git(['checkout', base, '-b', 'window-2'], root)
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'change a again'], root)
    const secondTree = treeOf(root, 'HEAD')
    expect(secondTree).toBe(firstTree)
    expect(firstTree).not.toBe(baseTree)

    const cache = new TestedTreeCache()
    const withCache = (checkIdentity: string): MergeAdmissionCache<HashTree> => ({
      cache,
      checkIdentity,
      treeHash: (tree) => tree.hash,
    })
    let checkRuns = 0
    // The harness maps each candidate onto its real tree; the hashes
    // are git's, the wiring is the test's.
    const realDeps: MergeAdmissionDeps<HashTree> = {
      merge: (tree, asked) =>
        Promise.resolve(
          tree.hash === baseTree && asked.id === 'a'
            ? { status: 'merged', tree: { hash: firstTree } }
            : { status: 'refused', output: 'unexpected trial' },
        ),
      check: () => {
        checkRuns += 1
        return Promise.resolve([])
      },
      rework: () => Promise.resolve(),
    }
    const initial: HashTree = { hash: baseTree }

    const first = await admitMergeBatch(
      initial,
      [candidate('a')],
      new Set(),
      realDeps,
      withCache('checks-1'),
    )
    expect(first.admitted).toEqual(['a'])
    expect(first.checkRuns).toBe(1)
    expect(checkRuns).toBe(1)
    // The second window's identical tree reuses the result: no checks run.
    const second = await admitMergeBatch(
      initial,
      [candidate('a')],
      new Set(),
      realDeps,
      withCache('checks-1'),
    )
    expect(second.admitted).toEqual(['a'])
    expect(second.checkRuns).toBe(0)
    expect(checkRuns).toBe(1)
    // A changed check suite retests the same tree.
    const rechecked = await admitMergeBatch(
      initial,
      [candidate('a')],
      new Set(),
      realDeps,
      withCache('checks-2'),
    )
    expect(rechecked.admitted).toEqual(['a'])
    expect(rechecked.checkRuns).toBe(1)
    expect(checkRuns).toBe(2)
  })

  it('replays a recorded failure without checks and retests a new tree', async () => {
    const root = scratchRepo()
    const base = git(['rev-parse', 'HEAD'], root).trim()
    const baseTree = treeOf(root, base)
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'change a'], root)
    const badTree = treeOf(root, 'HEAD')
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 3\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'change a again'], root)
    const fixedTree = treeOf(root, 'HEAD')
    expect(fixedTree).not.toBe(badTree)

    const cache = new TestedTreeCache()
    const withCache: MergeAdmissionCache<HashTree> = {
      cache,
      checkIdentity: 'checks-1',
      treeHash: (tree) => tree.hash,
    }
    const trees = new Map([
      ['bad', badTree],
      ['fixed', fixedTree],
    ])
    let checkRuns = 0
    const reworked: string[] = []
    const deps: MergeAdmissionDeps<HashTree> = {
      merge: (tree, asked) => {
        const hash = trees.get(asked.id)
        return Promise.resolve(
          hash !== undefined && tree.hash === baseTree
            ? { status: 'merged', tree: { hash } }
            : { status: 'refused', output: 'unexpected trial' },
        )
      },
      check: () => {
        checkRuns += 1
        return Promise.resolve([{ id: 'test', output: 'red' }])
      },
      rework: (asked) => {
        reworked.push(asked.id)
        return Promise.resolve()
      },
    }
    const initial: HashTree = { hash: baseTree }
    const first = await admitMergeBatch(initial, [candidate('bad')], new Set(), deps, withCache)
    expect(first.returned).toEqual(['bad'])
    // One full check plus the flake retries: the recorded outcome is terminal.
    expect(first.checkRuns).toBe(1 + TEAM_MERGE_FLAKE_RETRIES)
    const runsAfterFirst = checkRuns
    const second = await admitMergeBatch(initial, [candidate('bad')], new Set(), deps, withCache)
    expect(second.returned).toEqual(['bad'])
    expect(second.checkRuns).toBe(0)
    expect(checkRuns).toBe(runsAfterFirst)
    expect(reworked).toEqual(['bad', 'bad'])
    // The reworked tree differs, so it retests — and this time passes.
    const passing: MergeAdmissionDeps<HashTree> = {
      ...deps,
      check: () => {
        checkRuns += 1
        return Promise.resolve([])
      },
    }
    const third = await admitMergeBatch(
      initial,
      [candidate('fixed')],
      new Set(),
      passing,
      withCache,
    )
    expect(third.admitted).toEqual(['fixed'])
    expect(third.checkRuns).toBe(1)
  })

  it('reuses serial outcomes after a recorded batch failure', async () => {
    const root = scratchRepo()
    const base = git(['rev-parse', 'HEAD'], root).trim()
    const baseTree = treeOf(root, base)
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'change a'], root)
    const goodTree = treeOf(root, 'HEAD')
    writeFileSync(path.join(root, 'b.ts'), 'export const b = 1\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'add b'], root)
    const batchTree = treeOf(root, 'HEAD')

    const cache = new TestedTreeCache()
    const withCache: MergeAdmissionCache<HashTree> = {
      cache,
      checkIdentity: 'checks-1',
      treeHash: (tree) => tree.hash,
    }
    const serialTrees = new Map([
      [`${baseTree}+good`, goodTree],
      [`${goodTree}+bad`, batchTree],
    ])
    let checkRuns = 0
    const reworked: string[] = []
    const deps: MergeAdmissionDeps<HashTree> = {
      merge: (tree, asked) => {
        const hash = serialTrees.get(`${tree.hash}+${asked.id}`)
        return Promise.resolve(
          hash === undefined
            ? { status: 'refused', output: 'unexpected trial' }
            : { status: 'merged', tree: { hash } },
        )
      },
      // The batch tree fails; the good tree alone passes.
      check: (tree) => {
        checkRuns += 1
        return Promise.resolve(tree.hash === goodTree ? [] : [{ id: 'test', output: 'red' }])
      },
      rework: (asked) => {
        reworked.push(asked.id)
        return Promise.resolve()
      },
    }
    const initial: HashTree = { hash: baseTree }
    const batch = [candidate('good'), candidate('bad')]
    const first = await admitMergeBatch(initial, batch, new Set(), deps, withCache)
    expect(first.admitted).toEqual(['good'])
    expect(first.returned).toEqual(['bad'])
    const runsAfterFirst = checkRuns
    expect(runsAfterFirst).toBeGreaterThan(0)
    // The second run replays everything: the batch failure, the good
    // pass and the bad failure. No check runs.
    const second = await admitMergeBatch(initial, batch, new Set(), deps, withCache)
    expect(second.admitted).toEqual(['good'])
    expect(second.returned).toEqual(['bad'])
    expect(second.checkRuns).toBe(0)
    expect(checkRuns).toBe(runsAfterFirst)
    expect(reworked).toEqual(['bad', 'bad'])
  })

  it('replays flaky passes without checks', async () => {
    const root = scratchRepo()
    const base = git(['rev-parse', 'HEAD'], root).trim()
    const baseTree = treeOf(root, base)
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2\n')
    git(['add', '.'], root)
    git(['commit', '-m', 'change a'], root)
    const flakyTree = treeOf(root, 'HEAD')

    const cache = new TestedTreeCache()
    const withCache: MergeAdmissionCache<HashTree> = {
      cache,
      checkIdentity: 'checks-1',
      treeHash: (tree) => tree.hash,
    }
    let checkRuns = 0
    let calls = 0
    const deps: MergeAdmissionDeps<HashTree> = {
      merge: () => Promise.resolve({ status: 'merged', tree: { hash: flakyTree } }),
      check: () => {
        checkRuns += 1
        calls += 1
        return Promise.resolve(calls === 1 ? [{ id: 'lint', output: 'flake' }] : [])
      },
      rework: () => Promise.resolve(),
    }
    const initial: HashTree = { hash: baseTree }
    const first = await admitMergeBatch(initial, [candidate('a')], new Set(), deps, withCache)
    expect(first.admitted).toEqual(['a'])
    expect(first.flaky).toEqual(['lint'])
    expect(first.checkRuns).toBe(2)
    const second = await admitMergeBatch(initial, [candidate('a')], new Set(), deps, withCache)
    expect(second.admitted).toEqual(['a'])
    expect(second.flaky).toEqual(['lint'])
    expect(second.checkRuns).toBe(0)
    expect(checkRuns).toBe(2)
  })
})
