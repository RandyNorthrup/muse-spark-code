import { EventEmitter, once } from 'node:events'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { takeIndexLock } from '../../src/host/team/gitIndexLock'
import { landTeamTask } from '../../src/host/team/teamLandingEntry'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { EN } from '../../src/shared/l10n/en'
import {
  buildLander,
  gitAddExit,
  hasFile,
  landingFixturesIn,
  stagesIn,
  startLander,
  type LanderBuild,
} from './helpers/teamLander'
import {
  addLandingWorker,
  landingDeps,
  landingPolicy,
  LANDING_SPELLINGS,
  landingStatuses,
  landingTask,
  makeLandingFixture,
} from './helpers/teamLandingFixture'

// Pause-before-rename (M96c lane K), on a real repository. While the workspace
// check runs in the staging copy, the user's tree keeps its old bytes. Then a
// real lander process stands at the last check before its rename, with the
// index lock held, its intent durable and its replacement staged: git commands
// meet the lock, another window's landing stops with Retry and writes nothing,
// and when the pause ends the rename completes, the lock goes, and that Retry
// lands from a new snapshot that holds the first change. Each spelling of the
// workspace and storage folders runs both: a link or an 8.3 short name above
// them is the same folder (PLAN.md D24).

const shared: { lander?: LanderBuild } = {}

beforeAll(async () => {
  shared.lander = await buildLander()
}, 120_000)

afterAll(async () => {
  await shared.lander?.dispose()
})

describe.each(LANDING_SPELLINGS)('checked landing (real git, %s)', (spelling) => {
  const fixtureFor = landingFixturesIn(spelling)

  it('renames nothing into the user tree while the check is still running', async () => {
    const fixture = await fixtureFor('task-landing')
    const { root } = fixture
    const gate = new EventEmitter()
    let isCheckStarted = false
    const landing = landTeamTask(
      EN,
      'en',
      landingDeps(
        fixture,
        landingPolicy(createWindowIdentity(Date.now()), {
          runChecks: async () => {
            isCheckStarted = true
            await once(gate, 'release')
            return { passed: true }
          },
        }),
      ),
      landingTask(fixture),
      new AbortController().signal,
      { allowProtected: false },
    )

    // The check is running in the staging copy; the user tree is untouched.
    // Staging clones and merges with real git before the check runs.
    await vi.waitFor(
      () => {
        expect(isCheckStarted).toBe(true)
      },
      { timeout: 30_000 },
    )
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('before\n')

    gate.emit('release')
    const result = await landing
    expect(result.status).toBe('merged')
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('after\n')
    // Real git processes on a cold cache exceed the 5 s default on this rig class.
  }, 60_000)

  it('a lander paused before its rename holds everyone off, then lands; the retry sees it', async () => {
    const lander = shared.lander
    if (lander === undefined) throw new Error('the lander did not build')
    const fixture = await fixtureFor('task-a')
    const second = await addLandingWorker(fixture, 'task-b', 'other.txt')
    const { root, storage } = fixture
    const target = path.join(root, 'file.txt')
    const lockFile = path.join(root, '.git', 'index.lock')

    const first = await startLander(lander, fixture, createWindowIdentity(1000), {
      file: 'file.txt',
      atRename: true,
    })
    await first.stopped()

    // Paused: the lock held, the intent durable, the new bytes staged beside
    // a target that still holds the old ones.
    expect(await hasFile(lockFile)).toBe(true)
    expect(await landingStatuses(storage)).toEqual(['open'])
    expect(await readFile(target, 'utf8')).toBe('before\n')
    expect(await stagesIn(root)).toHaveLength(1)

    // A git command meets the lock, as with any git operation.
    expect(await gitAddExit(root, 'file.txt')).toBe(128)

    // Another window's landing into the tree stops with Retry and writes nothing.
    const other = createWindowIdentity(2000)
    const refused = await landTeamTask(
      EN,
      'en',
      landingDeps(second, landingPolicy(other)),
      landingTask(second),
      new AbortController().signal,
      { allowProtected: false },
    )
    expect(refused).toEqual({
      status: 'rework',
      written: [],
      conflicts: [],
      refusal: {
        kind: 'busy',
        action: 'recheck',
        // What holds the repository: the paused landing's own lock, with its record.
        holder: {
          kind: 'lock',
          path: expect.stringContaining('index.lock') as string,
          owner: expect.objectContaining({ landingId: expect.any(String) as string }) as object,
        },
      },
    })
    expect(await hasFile(path.join(root, 'other.txt'))).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('before\n')
    expect(await hasFile(lockFile)).toBe(true)

    // The pause ends: the rename completes, the journal closes, the lock goes.
    expect(await first.release()).toEqual({ exit: 0, status: 'merged' })
    expect(await readFile(target, 'utf8')).toBe('after\n')
    expect(await hasFile(lockFile)).toBe(false)
    expect(await landingStatuses(storage)).toEqual(['landed'])
    expect(await stagesIn(root)).toEqual([])
    expect(await gitAddExit(root, 'file.txt')).toBe(0)

    // The Retry takes a new snapshot: it holds the first change and adds its own.
    const retried = await landTeamTask(
      EN,
      'en',
      landingDeps(second, landingPolicy(other)),
      landingTask(second),
      new AbortController().signal,
      { allowProtected: false },
    )
    expect(retried.status).toBe('merged')
    expect(await readFile(target, 'utf8')).toBe('after\n')
    expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('after\n')
    expect(await hasFile(lockFile)).toBe(false)
    // Two real landers, a dozen git commands each, on a cold cache.
  }, 120_000)
})

describe('the index lock itself (a real file)', () => {
  it('is never taken or touched while another holds it, and is taken once it is gone', async () => {
    const fixture = await makeLandingFixture('task-lock')
    try {
      const gitDirectory = path.join(fixture.root, '.git')
      const lockFile = path.join(gitDirectory, 'index.lock')
      await writeFile(lockFile, 'another writer\n')
      const owner = { landingId: 'landing-a', windowInstanceId: 'window-a' }
      // The product's own clock and sleep, over a wait this test can afford.
      const wait = { now: Date.now, sleep: delay, waitMs: 200 }

      const busy = await takeIndexLock(gitDirectory, owner, wait)
      expect(busy).toMatchObject({ kind: 'busy', holder: { kind: 'lock', owner: null } })
      expect(await readFile(lockFile, 'utf8')).toBe('another writer\n')

      await rm(lockFile)
      const taken = await takeIndexLock(gitDirectory, owner, wait)
      if (taken.kind !== 'taken') throw new Error('the free lock was not taken')
      expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject(owner)
      expect(await taken.lease.isHeld()).toBe(true)
      expect(await taken.lease.release()).toBe(true)
      expect(await hasFile(lockFile)).toBe(false)
    } finally {
      await fixture.dispose()
    }
  }, 60_000)
})
