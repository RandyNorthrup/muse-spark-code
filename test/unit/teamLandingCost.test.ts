// What one landing costs in git processes, and what it still refuses for that price (CC-LANDFAST).
// It took 27 processes per changed file, 876 for thirty, most of them under git's lock. The price is
// now one number whatever the batch, and every guard still reads the bytes on disk at that guard.
// Real repositories, real git, the product's own merges port; nothing here reads a clock.
import { chmod, lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyTeamMerge } from '../../src/core/team/teamMerge'
import type { TeamGit } from '../../src/core/team/teamGit'
import type { EngineLandingPorts } from '../../src/host/team/teamLandingEntry'
import { gitLaunchProfile } from '../../src/core/team/workers/workerOpsEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { landingFixturesIn } from './helpers/teamLander'
import {
  fixtureGit,
  landingRecords,
  landingRunGit,
  landingStatuses,
  landingTask,
  productLandingPorts,
  type FixtureBytes,
  type LandingFixture,
} from './helpers/teamLandingFixture'

const signal = new AbortController().signal
const fixtureFor = landingFixturesIn('asCreated')
const lockOf = (fixture: LandingFixture) => path.join(fixture.root, '.git', 'index.lock')

async function isLocked(fixture: LandingFixture): Promise<boolean> {
  try {
    await lstat(lockOf(fixture))
    return true
  } catch {
    return false
  }
}

interface GitCall {
  readonly args: readonly string[]
  readonly isUnderLock: boolean
}

/** A blob of its own for each file: a process per blob cannot hide behind one blob. */
const OWN_BYTES: FixtureBytes = (file, side) => `${side} of ${file}\n`

/** The product's landing of this fixture's task, with what each git call and each guard saw. */
async function land(
  fixture: LandingFixture,
  ports: EngineLandingPorts = {},
  calls: GitCall[] = [],
) {
  const git: TeamGit = async (args, cwd, input, env) => {
    calls.push({ args, isUnderLock: await isLocked(fixture) })
    return await landingRunGit(args, cwd, input, env)
  }
  const task = landingTask(fixture)
  const { merges } = productLandingPorts(fixture, ports, git)
  const outcome = await merges.merge(
    { ...task, outcome: { ...task.outcome, folder: await realpath(fixture.workerCopy) } },
    signal,
    { allowProtected: false },
  )
  return { outcome, calls, merges }
}

const batch = (size: number): readonly string[] =>
  Array.from({ length: size }, (_, at) => `file-${String(at)}.txt`)

async function bytes(fixture: LandingFixture, file: string): Promise<string> {
  return await readFile(path.join(fixture.root, file), 'utf8')
}

async function moveRef(fixture: LandingFixture): Promise<void> {
  await fixtureGit(fixture.root, ['update-ref', fixture.agentsRef, fixture.baseCommit])
}

/**
The port every guard goes through before it reads the file. It calls `act` at the guard numbered
`at` for this file (the first is the check before anything is written), so what `act` does lands
exactly between two guards. Counts them all, so the suite never has to know how many there are.
*/
function atGuard(file: string, at: number, act: () => Promise<void>) {
  const seen = { guards: 0 }
  const ports: EngineLandingPorts = {
    validateTarget: async (target) => {
      if (path.basename(target) !== file) return
      seen.guards += 1
      if (seen.guards === at) await act()
    },
  }
  return { ports, seen }
}

describe('what a landing costs in git processes', () => {
  it('is the same number at any size of batch', async () => {
    const costs = new Map<number, number>()
    for (const size of [1, 4, 30]) {
      const fixture = await fixtureFor(`task-cost-${String(size)}`, batch(size), OWN_BYTES)
      const { outcome, calls } = await land(fixture)
      expect(outcome.status).toBe('merged')
      expect(await landingStatuses(fixture.storage)).toEqual(['landed'])
      expect(await bytes(fixture, 'file-0.txt')).toBe('after of file-0.txt\n')
      costs.set(size, calls.length)
    }
    expect(costs.get(4)).toBe(costs.get(1))
    expect(costs.get(30)).toBe(costs.get(1))
  }, 120_000)

  it('is the same number to put a batch back, at any size', async () => {
    const costs = new Map<number, number>()
    for (const size of [2, 30]) {
      const files = batch(size)
      const fixture = await fixtureFor(`task-back-${String(size)}`, files, OWN_BYTES)
      const last = files.at(-1) ?? ''
      // The last file's guards under the lock: every other file is already in.
      const { ports } = atGuard(last, 2, () => moveRef(fixture))
      const calls: GitCall[] = []
      await expect(land(fixture, ports, calls)).rejects.toThrow(
        UI_TEXT.teamTrafficDetails.changedSinceOpened,
      )
      for (const file of files) expect(await bytes(fixture, file)).toBe(`before of ${file}\n`)
      expect(await landingStatuses(fixture.storage)).toEqual(['recovered'])
      costs.set(size, calls.length)
    }
    expect(costs.get(30)).toBe(costs.get(2))
  }, 120_000)

  it('is the same number for Undo Merge, at any size', async () => {
    const costs = new Map<number, number>()
    for (const size of [2, 30]) {
      const files = batch(size)
      const fixture = await fixtureFor(`task-undo-${String(size)}`, files, OWN_BYTES)
      const last = files.at(-1) ?? ''
      const { ports } = atGuard(last, 2, async () => {
        await writeFile(path.join(fixture.root, last), 'the person\n')
      })
      const calls: GitCall[] = []
      const { outcome, merges } = await land(fixture, ports, calls)
      expect(outcome.refusal?.kind).toBe('changed')
      if (outcome.refusal?.kind !== 'changed') throw new Error('no changed refusal')
      const before = calls.length
      expect(await merges.undo?.(fixture.taskId, outcome.refusal.landingId, signal)).toMatchObject({
        status: 'undone',
      })
      const others = files.slice(0, -1)
      for (const file of others) expect(await bytes(fixture, file)).toBe(`before of ${file}\n`)
      expect(await bytes(fixture, last)).toBe('the person\n')
      costs.set(size, calls.length - before)
    }
    expect(costs.get(30)).toBe(costs.get(2))
  }, 120_000)

  it('only reads while it holds the lock, however many files go in', async () => {
    const fixture = await fixtureFor('task-reads', batch(12), OWN_BYTES)
    const { calls } = await land(fixture)
    const held = calls.filter((call) => call.isUnderLock)
    expect(held.length).toBeGreaterThan(0)
    expect(
      held.map((call) => call.args).filter((args) => gitLaunchProfile(args) !== 'probe'),
    ).toEqual([])
  }, 120_000)

  it('carries more files than one write set may name, all of them', async () => {
    const files = batch(300)
    const fixture = await fixtureFor('task-many', files, OWN_BYTES)
    const { outcome } = await land(fixture)
    expect(outcome.status).toBe('merged')
    expect(outcome.written).toHaveLength(300)
    expect(await bytes(fixture, 'file-299.txt')).toBe('after of file-299.txt\n')
    const [record] = await landingRecords(fixture.storage)
    expect(record?.files).toHaveLength(300)
    expect(record?.status).toBe('landed')
  }, 300_000)
})

describe('a landing record larger than a settings file', () => {
  // Long names make it large with few files. Windows has no room for them under its path limit.
  it.runIf(process.platform !== 'win32')(
    'still lands, past the 1 MiB other records keep to',
    async () => {
      const long = 'n'.repeat(200)
      const files = Array.from({ length: 3200 }, (_, at) => `${long}-${String(at)}.txt`)
      const fixture = await fixtureFor('task-long', files)
      const { outcome } = await land(fixture)
      expect(outcome.status).toBe('merged')
      expect(await bytes(fixture, files.at(-1) ?? '')).toBe('after\n')
    },
    300_000,
  )
})

describe('how a git command launches', () => {
  it('is a probe only when it cannot write, whatever options come first', () => {
    const prefix = ['--no-replace-objects', '-c', 'core.fsmonitor=', '-c', 'gc.auto=0']
    for (const reads of [
      ['rev-parse', '--verify', 'HEAD'],
      ['ls-tree', '-r', '-z', 'HEAD'],
      ['ls-files', '--stage', '-z'],
      ['diff-files', '--raw', '-z'],
      ['cat-file', '--batch'],
      ['hash-object', '--no-filters', '--stdin-paths'],
      ['config', '--type=bool', '--default=false', '--get', 'core.filemode'],
    ]) {
      expect(gitLaunchProfile(reads)).toBe('probe')
      expect(gitLaunchProfile([...prefix, ...reads])).toBe('probe')
    }
    for (const writes of [
      ['hash-object', '-w', '--no-filters', '--stdin-paths'],
      ['config', 'core.filemode', 'true'],
      ['update-ref', 'refs/heads/x', 'HEAD'],
      ['fetch', '--no-tags', '--', 'there'],
      ['checkout', '--detach', 'HEAD'],
      ['commit-tree', 'HEAD^{tree}'],
      ['write-tree'],
      ['merge-file', 'a', 'b', 'c'],
      ['status'],
      [],
    ]) {
      expect(gitLaunchProfile(writes)).toBe('contained')
      expect(gitLaunchProfile([...prefix, ...writes])).toBe('contained')
    }
    // The value of an option is never read as the command.
    expect(gitLaunchProfile(['-c', 'rev-parse', 'fetch'])).toBe('contained')
    expect(gitLaunchProfile(['-C', 'rev-parse', 'fetch'])).toBe('contained')
  })
})

describe('a file changed between two guards of one landing', () => {
  const BATCH = ['a.txt', 'b.txt', 'c.txt']

  /** How many guards one file goes through on its way in, by a landing nothing disturbs. */
  async function guardsPerFile(): Promise<number> {
    const fixture = await fixtureFor('task-guards', BATCH)
    const { ports, seen } = atGuard('b.txt', -1, () => Promise.resolve())
    const { outcome } = await land(fixture, ports)
    expect(outcome.status).toBe('merged')
    return seen.guards
  }

  it('is refused and named at every guard, and keeps what the person wrote', async () => {
    const guards = await guardsPerFile()
    // One before anything is written, three compares, and each compare's own read.
    expect(guards).toBeGreaterThanOrEqual(6)
    for (let at = 2; at <= guards; at += 1) {
      const fixture = await fixtureFor(`task-bytes-${String(at)}`, BATCH)
      const { ports, seen } = atGuard('b.txt', at, async () => {
        await writeFile(path.join(fixture.root, 'b.txt'), 'the person\n')
      })
      const { outcome } = await land(fixture, ports)
      expect({ at, status: outcome.status, kind: outcome.refusal?.kind }).toEqual({
        at,
        status: 'rework',
        kind: 'changed',
      })
      if (outcome.refusal?.kind !== 'changed') throw new Error('no changed refusal')
      expect(outcome.refusal.paths).toContain('b.txt')
      expect(await bytes(fixture, 'b.txt')).toBe('the person\n')
      expect(seen.guards).toBeGreaterThanOrEqual(at)
      expect(await landingStatuses(fixture.storage)).toEqual(['changed'])
    }
  }, 300_000)

  it.runIf(process.platform !== 'win32')(
    'a chmod reads as a change too, by name, at every guard',
    async () => {
      const guards = await guardsPerFile()
      for (let at = 2; at <= guards; at += 1) {
        const fixture = await fixtureFor(`task-mode-${String(at)}`, BATCH)
        const { ports } = atGuard('b.txt', at, async () => {
          await chmod(path.join(fixture.root, 'b.txt'), 0o755)
        })
        const { outcome } = await land(fixture, ports)
        expect({ at, kind: outcome.refusal?.kind }).toEqual({ at, kind: 'changed' })
        if (outcome.refusal?.kind !== 'changed') throw new Error('no changed refusal')
        expect(outcome.refusal.paths).toContain('b.txt')
        expect(await bytes(fixture, 'b.txt')).toBe('before\n')
      }
    },
    300_000,
  )
})

describe('a worker ref that moves during a landing', () => {
  const BATCH = ['a.txt', 'b.txt', 'c.txt']

  it('stops it before the first write when it moved first', async () => {
    const fixture = await fixtureFor('task-ref-early', BATCH)
    // The check before anything is written, on the first file: the lock is not taken yet.
    const { ports } = atGuard('a.txt', 1, () => moveRef(fixture))
    await expect(land(fixture, ports)).rejects.toThrow(
      UI_TEXT.teamTrafficDetails.changedSinceOpened,
    )
    for (const file of BATCH) expect(await bytes(fixture, file)).toBe('before\n')
    // Nothing was opened to recover: no record, and the lock is gone.
    expect(await landingStatuses(fixture.storage)).toEqual([])
    expect(await isLocked(fixture)).toBe(false)
  }, 120_000)

  it('puts back what went in when it moved in the middle of the batch', async () => {
    const fixture = await fixtureFor('task-ref-late', BATCH)
    // The second file's first guard under the lock: one file is already in.
    const { ports } = atGuard('b.txt', 2, () => moveRef(fixture))
    await expect(land(fixture, ports)).rejects.toThrow(
      UI_TEXT.teamTrafficDetails.changedSinceOpened,
    )
    for (const file of BATCH) expect(await bytes(fixture, file)).toBe('before\n')
    expect(await landingStatuses(fixture.storage)).toEqual(['recovered'])
    expect(await isLocked(fixture)).toBe(false)
  }, 120_000)
})

describe('the merge inside its staging copy', () => {
  it('reads the ref twice, and undoes what went in when it moved meanwhile', async () => {
    const files = batch(12)
    const fixture = await fixtureFor('task-copy', files)
    const reads = { count: 0 }
    const git: TeamGit = async (args, cwd, input, env) => {
      const output = await landingRunGit(args, cwd, input, env)
      if (args.join(' ') === `rev-parse --verify ${fixture.agentsRef}`) {
        reads.count += 1
        // Answered as it stood, then moved: only the read after the files can see it.
        if (reads.count === 1)
          await fixtureGit(fixture.root, ['update-ref', fixture.agentsRef, fixture.baseCommit])
      }
      return output
    }
    await expect(
      applyTeamMerge(
        { runGit: git, realPath: realpath },
        {
          repositoryRoot: fixture.root,
          baseCommit: fixture.baseCommit,
          branchHead: fixture.head,
          agentRefs: [{ ref: fixture.agentsRef, expected: fixture.head, actual: fixture.head }],
        },
        { platform: process.platform },
      ),
    ).rejects.toMatchObject({ code: 'refBreach' })
    expect(reads.count).toBe(2)
    for (const file of files) expect(await bytes(fixture, file)).toBe('before\n')
  }, 120_000)
})

describe('a tree that holds links', () => {
  it.runIf(process.platform !== 'win32')(
    'lands beside them for the same price',
    async () => {
      const costOf = async (taskId: string, links: number) => {
        const fixture = await fixtureFor(taskId, ['a.txt'])
        await mkdir(path.join(fixture.root, 'links'))
        for (let at = 0; at < links; at += 1)
          await symlink('../a.txt', path.join(fixture.root, 'links', `link-${String(at)}`))
        const { outcome, calls } = await land(fixture)
        expect(outcome.status).toBe('merged')
        return calls.length
      }
      expect(await costOf('task-links-40', 40)).toBe(await costOf('task-links-1', 1))
    },
    120_000,
  )
})
