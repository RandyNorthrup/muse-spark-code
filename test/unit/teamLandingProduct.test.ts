// The product's own landing (CC-WINLAND): the engine's merges port, with the engine's governed git,
// through the checked landing and M96c's guarantees. Real repositories, real processes, a real
// crash. teamLandingKilled and teamLandingPause prove the landing itself; this proves the product
// runs it.
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
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
  LANDING_SPELLINGS,
  landingRecords,
  landingStatuses,
  landingRunGit,
  landingTask,
  productLandingPorts,
  type LandingFixture,
} from './helpers/teamLandingFixture'
import { silentLog, teamHostPortsWithNoPerson } from './helpers/teamMcpBinding'
import { availabilityState } from './helpers/teamAvailabilityRig'
import { createTeamHost } from '../../src/host/team/teamHostEntry'
import { EN } from '../../src/shared/l10n/en'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'

const BATCH = ['a.txt', 'b.txt', 'c.txt', 'd.txt']
const shared: { lander?: LanderBuild } = {}
beforeAll(async () => {
  shared.lander = await buildLander()
}, 120_000)
afterAll(async () => {
  await shared.lander?.dispose()
})

/** The merge-port task, its copy under the canonical storage as the product makes it. */
async function productTask(fixture: LandingFixture) {
  const task = landingTask(fixture)
  return { ...task, outcome: { ...task.outcome, folder: await realpath(fixture.workerCopy) } }
}

/** A window killed with its second file staged, and the lock it left already removed by the person. */
async function deadWindowAndNoLock(
  fixtureFor: ReturnType<typeof landingFixturesIn>,
  taskId: string,
): Promise<LandingFixture> {
  const lander = shared.lander
  if (lander === undefined) throw new Error('the lander did not build')
  const fixture = await fixtureFor(taskId, BATCH)
  const running = await startLander(lander, fixture, createWindowIdentity(1000), {
    file: 'b.txt',
    atRename: true,
    viaEngine: true,
  })
  await running.stopped()
  await running.kill()
  await rm(path.join(fixture.root, '.git', 'index.lock'))
  return fixture
}

/** The person saves c.txt while its replacement stands staged, third of four. */
function personSavesThirdOfFour(root: string) {
  const state = { isDone: false }
  return async (target: string): Promise<void> => {
    if (state.isDone || path.basename(target) !== 'c.txt') return
    const stages = await stagesIn(root)
    if (stages.length === 0) return
    state.isDone = true
    await writeFile(path.join(root, 'c.txt'), 'the person\n')
  }
}

async function readIn(root: string, file: string): Promise<string> {
  return await readFile(path.join(root, file), 'utf8')
}

describe.each(LANDING_SPELLINGS)(
  "the product's landing (real git, real processes, %s)",
  (spelling) => {
    const fixtureFor = landingFixturesIn(spelling)
    const signal = new AbortController().signal

    it('plans and lands a workspace reached by this spelling as the same workspace', async () => {
      const fixture = await fixtureFor('task-spelled')
      const { merges } = productLandingPorts(fixture)
      const planned = await merges.plan(await productTask(fixture))
      expect(planned.map((file) => file.path)).toEqual(['file.txt'])
      const merged = await merges.merge(await productTask(fixture), signal, {
        allowProtected: false,
      })
      expect(merged).toMatchObject({ status: 'merged', written: ['file.txt'], conflicts: [] })
      expect(await readIn(fixture.root, 'file.txt')).toBe('after\n')
      // It went through the journal, not in place.
      expect(await landingStatuses(fixture.storage)).toEqual(['landed'])
      expect(await hasFile(path.join(fixture.root, '.git', 'index.lock'))).toBe(false)
    }, 120_000)

    it('a window killed mid-landing: the next one shows it, waits for the lock, and Recover settles it', async () => {
      const lander = shared.lander
      if (lander === undefined) throw new Error('the lander did not build')
      const fixture = await fixtureFor('task-crash', BATCH)
      const { root, storage } = fixture
      const lockFile = path.join(root, '.git', 'index.lock')
      const running = await startLander(lander, fixture, createWindowIdentity(1000), {
        file: 'c.txt',
        atRename: true,
        viaEngine: true,
      })
      await running.stopped()
      expect(await running.kill()).toEqual({ isAliveAtKill: true, signal: 'SIGKILL' })
      // Half a batch, a stage, git refused: the crash this was all for.
      expect(await readIn(root, 'a.txt')).toBe('after\n')
      expect(await readIn(root, 'b.txt')).toBe('after\n')
      expect(await readIn(root, 'c.txt')).toBe('before\n')
      expect(await stagesIn(root)).toHaveLength(1)
      expect(await gitAddExit(root, 'a.txt')).not.toBe(0)

      // The next window, at its start. Nothing asks while the lock stands, and nothing lands.
      const next = productLandingPorts(fixture).merges
      expect(await next.recoverLandings?.(false)).toBe(0)
      const [open] = (await next.openLandings?.()) ?? []
      expect(open?.paths).toEqual(BATCH)
      expect(open?.lockPath).toBeDefined()
      expect(path.basename(open?.lockPath ?? '')).toBe('index.lock')
      expect(
        await next.merge(await productTask(fixture), signal, { allowProtected: false }),
      ).toMatchObject({
        status: 'rework',
        written: [],
        refusal: { kind: 'busy' },
      })
      expect(await hasFile(lockFile)).toBe(true)

      // The person removes the lock. Without their Recover another window's record still stands.
      await rm(lockFile)
      const [unlocked] = (await next.openLandings?.()) ?? []
      expect(unlocked?.lockPath).toBeUndefined()
      expect(await next.recoverLandings?.(false)).toBe(0)
      expect(await landingStatuses(storage)).toEqual(['open'])

      // Recover: what it wrote goes back, its stage goes, the tree is the person's again.
      expect(await next.recoverLandings?.(true)).toBe(1)
      for (const file of BATCH) expect(await readIn(root, file)).toBe('before\n')
      expect(await stagesIn(root)).toEqual([])
      expect(await hasFile(lockFile)).toBe(false)
      expect(await next.openLandings?.()).toEqual([])
      expect(await gitAddExit(root, 'a.txt')).toBe(0)

      // And the task lands, whole, from a new snapshot.
      expect(
        await next.merge(await productTask(fixture), signal, { allowProtected: false }),
      ).toMatchObject({
        status: 'merged',
      })
      for (const file of BATCH) expect(await readIn(root, file)).toBe('after\n')
      expect(await hasFile(lockFile)).toBe(false)
    }, 180_000)

    it('a team host settles what a dead window left before its service exists', async () => {
      const fixture = await deadWindowAndNoLock(fixtureFor, 'task-host')
      const service = await createTeamHost(EN, 'en', {
        state: availabilityState(new Map()),
        ...teamHostPortsWithNoPerson(),
        orchestrator: { modelId: () => 'm1', backend: () => 'museCode' },
        engine: {
          repositoryRoot: () => fixture.root,
          storageRoot: fixture.storage,
          platform: process.platform,
          isTrusted: () => true,
          listModels: () => Promise.resolve([]),
          startWorker: () => Promise.reject(new Error('no worker is wanted here')),
          runGit: landingRunGit,
          now: () => Date.now(),
          log: silentLog,
          landing: { confirmTakeover: () => Promise.resolve(true) },
        },
      })
      // Before anything could claim a task, the half-written batch is back.
      for (const file of BATCH) expect(await readIn(fixture.root, file)).toBe('before\n')
      expect(await landingStatuses(fixture.storage)).toEqual(['recovered'])
      await service.dispose()
    }, 180_000)

    it('a surface that can ask recovers at start, once the lock is gone', async () => {
      const fixture = await deadWindowAndNoLock(fixtureFor, 'task-start')
      const asked: string[] = []
      const { merges } = productLandingPorts(fixture, {
        confirmTakeover: (record) => {
          asked.push(...record.files.map((file) => file.path))
          return Promise.resolve(true)
        },
      })
      expect(await merges.recoverLandings?.(false)).toBe(1)
      expect(asked).toEqual(BATCH)
      for (const file of BATCH) expect(await readIn(fixture.root, file)).toBe('before\n')
    }, 180_000)
  },
)

describe("a file changed in the middle of the product's landing", () => {
  const fixtureFor = landingFixturesIn('asCreated')
  const signal = new AbortController().signal

  it('does not pass as landed: named, refused, and Undo Merge puts back only what is the landing', async () => {
    const fixture = await fixtureFor('task-changed', BATCH)
    const { root, storage } = fixture
    const { merges } = productLandingPorts(fixture, {
      validateTarget: personSavesThirdOfFour(root),
    })
    const outcome = await merges.merge(await productTask(fixture), signal, {
      allowProtected: false,
    })
    expect(outcome.status).toBe('rework')
    expect(outcome.written).toEqual(['a.txt', 'b.txt'])
    expect(outcome.conflicts).toEqual(['c.txt', 'd.txt'])
    expect(outcome.refusal).toMatchObject({ kind: 'changed', paths: ['c.txt', 'd.txt'] })
    const [record] = await landingRecords(storage)
    expect(record).toMatchObject({ status: 'changed', conflicts: ['c.txt', 'd.txt'] })
    // The batch is not landed, its lock is gone, and its copy stays with the task.
    expect(await hasFile(path.join(root, '.git', 'index.lock'))).toBe(false)
    expect(await hasFile(fixture.workerCopy)).toBe(true)
    expect(await merges.openLandings?.()).toEqual([])

    const landingId = outcome.refusal?.landingId ?? ''
    expect(await merges.undo?.(fixture.taskId, landingId, signal)).toEqual({
      status: 'undone',
      kept: ['c.txt'],
    })
    expect(await readIn(root, 'a.txt')).toBe('before\n')
    expect(await readIn(root, 'b.txt')).toBe('before\n')
    expect(await readIn(root, 'c.txt')).toBe('the person\n')
    expect(await readIn(root, 'd.txt')).toBe('before\n')
    expect(await landingStatuses(storage)).toEqual(['recovered'])
    // Once is all there is: the landing it would put back is gone.
    await expect(merges.undo?.(fixture.taskId, landingId, signal)).rejects.toThrow(
      UI_TEXT.teamTrafficDetails.changedSinceOpened,
    )
  }, 120_000)

  it('keeps a file that changed again after the landing stopped', async () => {
    const fixture = await fixtureFor('task-changed-again', BATCH)
    const { root } = fixture
    const { merges } = productLandingPorts(fixture, {
      validateTarget: personSavesThirdOfFour(root),
    })
    const outcome = await merges.merge(await productTask(fixture), signal, {
      allowProtected: false,
    })
    await writeFile(path.join(root, 'a.txt'), 'edited after\n')
    expect(await merges.undo?.(fixture.taskId, outcome.refusal?.landingId ?? '', signal)).toEqual({
      status: 'undone',
      kept: ['c.txt', 'a.txt'],
    })
    expect(await readIn(root, 'a.txt')).toBe('edited after\n')
    expect(await readIn(root, 'b.txt')).toBe('before\n')
  }, 120_000)
})
