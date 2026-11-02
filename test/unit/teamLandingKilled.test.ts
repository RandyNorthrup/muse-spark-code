import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { landTeamTask, recoverOpenLandings } from '../../src/host/team/teamLandingEntry'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { ATOMIC_TEMPORARY_SUFFIX } from '../../src/shared/constants'
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
  fixtureGit,
  LANDING_SPELLINGS,
  landingDeps,
  landingPolicy,
  landingRecords,
  landingStatuses,
  landingTask,
  makeLandingFixture,
  type LandingFixture,
} from './helpers/teamLandingFixture'

// Killed lander (M96c lanes K/I/X2), with real processes: a bundled child runs
// the product's checked landing and is killed (SIGKILL; on Windows Node's kill
// is TerminateProcess, as abrupt) with its journal intent durable and its index
// lock held. Nothing half-landed passes as finished: the record stays open and
// refuses every later landing. The next window cannot recover while the dead
// lander's lock stands; once the person removes that lock (git's own advice),
// confirmed-takeover recovery settles the dead owner's record, rolls back what
// it wrote, keeps a later user edit, and landing works again. Each spelling of
// the workspace and storage folders runs the whole drill: a link or an 8.3
// short name above them is the same folder (PLAN.md D24).

const shared: { lander?: LanderBuild } = {}
const BATCH = ['a.txt', 'b.txt', 'c.txt', 'd.txt']
const PERSONS_FILE = `c.txt.00000000-0000-4000-8000-000000000000${ATOMIC_TEMPORARY_SUFFIX}`

beforeAll(async () => {
  shared.lander = await buildLander()
}, 120_000)

afterAll(async () => {
  await shared.lander?.dispose()
})

function readIn(root: string, file: string): Promise<string> {
  return readFile(path.join(root, file), 'utf8')
}

/** What the next window hands the product: its own identity, the person's Take over given. */
function nextWindowDeps(fixture: LandingFixture, isConfirmed = true) {
  return landingDeps(
    fixture,
    landingPolicy(createWindowIdentity(2000), {
      confirmTakeover: () => Promise.resolve(isConfirmed),
    }),
  )
}

/** Two files written, the third and fourth still holding their old bytes. */
async function expectHalfTheBatch(root: string): Promise<void> {
  expect(await readIn(root, 'a.txt')).toBe('after\n')
  expect(await readIn(root, 'b.txt')).toBe('after\n')
  expect(await readIn(root, 'c.txt')).toBe('before\n')
  expect(await readIn(root, 'd.txt')).toBe('before\n')
}

describe.each(LANDING_SPELLINGS)('killed lander recovery (real processes, %s)', (spelling) => {
  const fixtureFor = landingFixturesIn(spelling)

  it('a SIGKILLed lander blocks, then confirmed takeover recovers its record', async () => {
    const lander = shared.lander
    if (lander === undefined) throw new Error('the lander did not build')
    const fixture = await fixtureFor('task-killed')
    const { root, storage } = fixture
    const running = await startLander(lander, fixture, createWindowIdentity(1000), {
      file: 'file.txt',
      atRename: false,
    })

    // The intent is durable and the lock held; no rename has happened.
    await running.stopped()
    const lockFile = path.join(root, '.git', 'index.lock')
    expect(await hasFile(lockFile)).toBe(true)
    expect(await readIn(root, 'file.txt')).toBe('before\n')

    // The kill lands on a live process, and it dies of it.
    expect(await running.kill()).toEqual({ isAliveAtKill: true, signal: 'SIGKILL' })
    expect(await readIn(root, 'file.txt')).toBe('before\n')
    expect(await hasFile(lockFile)).toBe(true)

    const deps = nextWindowDeps(fixture)
    const signal = new AbortController().signal

    // The dead lander's lock is never removed silently: recovery waits.
    expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(0)

    // The person removes the stale lock and edits the file themselves.
    await rm(lockFile)
    await writeFile(path.join(root, 'file.txt'), 'user edit\n')

    // Confirmed takeover settles the dead owner's open record and keeps
    // the person's bytes (reported as the recovered landing's conflict).
    expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(1)
    expect(await readIn(root, 'file.txt')).toBe('user edit\n')
    // Recovery released the lock it took: git can work in the tree again.
    expect(await hasFile(lockFile)).toBe(false)
    const [record] = await landingRecords(storage)
    expect(record).toMatchObject({ status: 'recovered', conflicts: ['file.txt'] })

    // The settled record no longer blocks landing: with the person's edit
    // resolved back to the base bytes, the worker change lands.
    await writeFile(path.join(root, 'file.txt'), 'before\n')
    const result = await landTeamTask(EN, 'en', deps, landingTask(fixture), signal, {
      allowProtected: false,
    })
    expect(result.status).toBe('merged')
    expect(await readIn(root, 'file.txt')).toBe('after\n')
    expect(await hasFile(lockFile)).toBe(false)
    // A real child process, real git checkouts and two recoveries exceed
    // the 5 s default on this rig class.
  }, 120_000)

  it('a batch killed before its third rename rolls back, and nothing passes as landed', async () => {
    const lander = shared.lander
    if (lander === undefined) throw new Error('the lander did not build')
    const fixture = await fixtureFor('task-batch', BATCH)
    const { root, storage } = fixture
    const lockFile = path.join(root, '.git', 'index.lock')
    const running = await startLander(lander, fixture, createWindowIdentity(1000), {
      file: 'c.txt',
      atRename: true,
    })
    await running.stopped()

    // Two files written, the third's new bytes staged beside it, the fourth untouched.
    expect(await running.kill()).toEqual({ isAliveAtKill: true, signal: 'SIGKILL' })
    await expectHalfTheBatch(root)
    expect(await stagesIn(root)).toHaveLength(1)

    // Half a batch is never finished: the record stays open, git meets the
    // lock, and every next landing stops with Retry.
    expect(await landingStatuses(storage)).toEqual(['open'])
    expect(await gitAddExit(root, 'a.txt')).toBe(128)
    const signal = new AbortController().signal
    const deps = nextWindowDeps(fixture)
    const land = () =>
      landTeamTask(EN, 'en', deps, landingTask(fixture), signal, { allowProtected: false })
    expect(await land()).toMatchObject({ status: 'rework', refusal: { kind: 'busy' } })

    // Recovery waits for the lock, and for the person's Take over.
    expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(0)
    await rm(lockFile)
    expect(await recoverOpenLandings(EN, 'en', nextWindowDeps(fixture, false), signal)).toBe(0)
    expect(await readIn(root, 'a.txt')).toBe('after\n')
    expect(await landingStatuses(storage)).toEqual(['open'])

    // The person edited a written file meanwhile, and keeps a file of their
    // own under a stage's name: the edit is named and kept, and their file
    // stays. What the lander wrote goes back, what it never reached stays,
    // and what it staged goes with it.
    await writeFile(path.join(root, 'b.txt'), 'user edit\n')
    await writeFile(path.join(root, PERSONS_FILE), 'the person keeps this\n')
    expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(1)
    expect(await readIn(root, 'a.txt')).toBe('before\n')
    expect(await readIn(root, 'b.txt')).toBe('user edit\n')
    expect(await readIn(root, 'c.txt')).toBe('before\n')
    expect(await readIn(root, 'd.txt')).toBe('before\n')
    expect(await stagesIn(root)).toEqual([PERSONS_FILE])
    expect(await readIn(root, PERSONS_FILE)).toBe('the person keeps this\n')
    expect(await hasFile(lockFile)).toBe(false)
    const [record] = await landingRecords(storage)
    expect(record).toMatchObject({ status: 'recovered', conflicts: ['b.txt'] })
    const status = await fixtureGit(root, ['status', '--porcelain'])
    expect(status.split('\n').filter((line) => line !== '')).toEqual([
      ' M b.txt',
      `?? ${PERSONS_FILE}`,
    ])

    // With the edit resolved, the whole batch lands from a new snapshot.
    await writeFile(path.join(root, 'b.txt'), 'before\n')
    expect(await land()).toMatchObject({ status: 'merged' })
    for (const file of BATCH) expect(await readIn(root, file)).toBe('after\n')
    expect(await hasFile(lockFile)).toBe(false)
    expect(await gitAddExit(root, 'a.txt')).toBe(0)
    // A real child process, four real files and two recoveries.
  }, 120_000)

  it('a recovery killed in its turn leaves the record open, and the next finishes it', async () => {
    const lander = shared.lander
    if (lander === undefined) throw new Error('the lander did not build')
    const fixture = await fixtureFor('task-twice', BATCH)
    const { root, storage } = fixture
    const lockFile = path.join(root, '.git', 'index.lock')
    const landing = await startLander(lander, fixture, createWindowIdentity(1000), {
      file: 'c.txt',
      atRename: true,
    })
    await landing.stopped()
    await landing.kill()
    await rm(lockFile)

    // The recovery takes the lock, takes over, clears the dead lander's stage,
    // and dies at the rename that would put the first file back (it goes in
    // reverse: nothing to do for d and c, then b).
    const recovering = await startLander(lander, fixture, createWindowIdentity(1500), {
      file: 'b.txt',
      atRename: true,
      isRecovery: true,
    })
    await recovering.stopped()
    expect(await recovering.kill()).toEqual({ isAliveAtKill: true, signal: 'SIGKILL' })
    expect(await readIn(root, 'a.txt')).toBe('after\n')
    expect(await readIn(root, 'b.txt')).toBe('after\n')
    expect(await landingStatuses(storage)).toEqual(['open'])
    expect(await hasFile(lockFile)).toBe(true)
    const left = await stagesIn(root)
    expect(left).toHaveLength(1)
    expect(left[0]?.startsWith('b.txt.')).toBe(true)

    // Its lock is as stale as the lander's was. Once the person removes it the
    // next window finishes the same record, with nothing left behind by either.
    await rm(lockFile)
    const signal = new AbortController().signal
    expect(await recoverOpenLandings(EN, 'en', nextWindowDeps(fixture), signal)).toBe(1)
    for (const file of BATCH) expect(await readIn(root, file)).toBe('before\n')
    expect(await stagesIn(root)).toEqual([])
    expect(await hasFile(lockFile)).toBe(false)
    expect(await landingRecords(storage)).toMatchObject([{ status: 'recovered', conflicts: [] }])
    expect(await fixtureGit(root, ['status', '--porcelain'])).toBe('')
    // Two real child processes killed, and a third recovery.
  }, 120_000)
})

// On Windows a program can hold a file open without letting anyone delete it
// (the FileShare flags Office, a scanner or a running program use). Node opens
// nothing that way, so a real PowerShell holds it. The rename fails after its
// retries, mid-batch, in a window that lives on: the same rule holds.
const WINDOWS_POWERSHELL = path.join(
  process.env['SystemRoot'] ?? String.raw`C:\Windows`,
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

describe.runIf(process.platform === 'win32')('a held file stops a Windows landing', () => {
  it('leaves the batch open and recoverable, never finished', async () => {
    const fixture = await makeLandingFixture('task-held', 'asCreated', BATCH)
    const { root, storage } = fixture
    const lockFile = path.join(root, '.git', 'index.lock')
    const target = path.join(root, 'c.txt')
    const script = `$s = [IO.File]::Open('${target}', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); [Console]::Out.WriteLine('held'); [void][Console]::In.ReadLine(); $s.Dispose()`
    const holderProcess = spawn(
      WINDOWS_POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      },
    )
    try {
      await once(holderProcess.stdout, 'data')
      const deps = landingDeps(fixture, landingPolicy(createWindowIdentity(1000)))
      const signal = new AbortController().signal
      // What Windows answers a rename over a held file, after the retries.
      await expect(
        landTeamTask(EN, 'en', deps, landingTask(fixture), signal, { allowProtected: false }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/u) })

      // Two files written, the held one and the last untouched; nothing
      // staged is left; the record open, the landing's lock still standing.
      await expectHalfTheBatch(root)
      expect(await stagesIn(root)).toEqual([])
      expect(await landingStatuses(storage)).toEqual(['open'])
      expect(await hasFile(lockFile)).toBe(true)

      // The program closes the file. Recovery still waits for the person to
      // remove the lock, then this window rolls its own landing back at once.
      holderProcess.stdin.end('\n')
      await once(holderProcess, 'exit')
      expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(0)
      await rm(lockFile)
      expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(1)
      for (const file of BATCH) expect(await readIn(root, file)).toBe('before\n')
      expect(await hasFile(lockFile)).toBe(false)
      expect(await landingRecords(storage)).toMatchObject([{ status: 'recovered', conflicts: [] }])
    } finally {
      // Gone before its folder goes: Windows refuses to remove a file it holds.
      if (holderProcess.exitCode === null) {
        holderProcess.kill()
        await once(holderProcess, 'exit')
      }
      await fixture.dispose()
    }
    // A PowerShell start, the rename's retries, and two recoveries.
  }, 120_000)
})
