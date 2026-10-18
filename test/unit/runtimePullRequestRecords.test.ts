// The worktree records over the fenced file lease (M123 lane P,
// RVM123P/P2–P6, M123P7): reservations that are a checkout id and a fence,
// compare-and-swaps on them, the folder absent under the supersede's own
// hold, the claim making the folder under the hold that claims it, and
// generations that refuse a stale writer — two windows as two store
// instances over one data folder, a file port that pauses or fails one
// call where an interleaving matters, real files on this platform.

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { LeaseBusyError } from '../../src/core/locks/fileLease'
import { currentProcessOwner } from '../../src/core/locks/processOwner'
import type { WorktreeRecord } from '../../src/core/worktreeConversations'
import {
  createFileRecordRegistry,
  createFileWorktreeRecordStore,
  createMemoryRecordRegistry,
  createMemoryWorktreeRecordStore,
  holdForRoots,
  recordRevision,
  versionOf,
  type TrustTicket,
} from '../../src/runtime/panel/pullRequests/records'
import {
  readRecordHead,
  writeNextGeneration,
} from '../../src/runtime/panel/pullRequests/recordGenerations'
import {
  errorCode,
  nodeRecordStoreFs,
  type RecordStoreFs,
} from '../../src/runtime/panel/pullRequests/recordStoreFs'
import {
  deferred,
  failingListingsAfterLink,
  GENERATION_FILE,
  nextTurn,
  pausingPort,
} from './helpers/leaseFs'

const quiet = () => undefined
const log: CoreLogger = { trace: quiet, info: quiet, warn: quiet, error: quiet }
const ORIGIN = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 51,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
  title: 'A foreign pull request',
  author: 'Piangpi1997',
  headSha: 'c'.repeat(40),
  isAuthoredByUser: false,
} as const
/** The folder check a supersede runs under its hold: nothing there. */
function isFolderGone(): boolean {
  return true
}

function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

/**
 * The file operations, holding the window's first generation publish
 * (after its last lease check) until another window has published that
 * same generation, or 2 s have passed: a takeover mid-write, every time.
 */
function holdingFirstPublish(base: RecordStoreFs, onHeld: () => void): RecordStoreFs {
  let isArmed = true
  return {
    ...base,
    link: async (existing, target) => {
      if (isArmed && GENERATION_FILE.test(target)) {
        isArmed = false
        onHeld()
        const until = performance.now() + 2000
        while (!existsSync(target) && performance.now() < until) {
          await delay(5)
        }
      }
      await base.link(existing, target)
    },
  }
}

/**
 * The file operations behind a seeded random number of event-loop turns:
 * windows interleave anywhere. Turns, not timers, so the interleaving does
 * not depend on the platform's timer granularity.
 */
function jitteringFs(
  seed: number,
  maxTurns: number,
  seen: { lockMoves: number; lostGenerations: number },
  publishDelayMs = 0,
): RecordStoreFs {
  // Park–Miller: deterministic turns; the thread pool still varies the rest.
  let state = seed
  const draw = (most: number) => {
    state = (state * 48_271) % 2_147_483_647
    return state % (most + 1)
  }
  const next = async () => {
    for (let turn = draw(maxTurns); turn > 0; turn -= 1) {
      await nextTurn()
    }
  }
  const base = nodeRecordStoreFs
  return {
    ...base,
    readdir: async (folder) => {
      await next()
      return await base.readdir(folder)
    },
    readFile: async (file) => {
      await next()
      return await base.readFile(file)
    },
    createExclusive: async (file, content, durability) => {
      await next()
      await base.createExclusive(file, content, durability)
    },
    link: async (existing, target) => {
      // A writer that checked its lease lingers before it publishes, in real
      // time (file calls take longer than turns): the window a takeover
      // mid-write lands in.
      await next()
      await delay(draw(publishDelayMs))
      try {
        await base.link(existing, target)
      } catch (error: unknown) {
        // A generation someone else took first: the fence at work.
        if (errorCode(error) === 'EEXIST') {
          seen.lostGenerations += 1
        }
        throw error
      }
    },
    rename: async (from, to) => {
      await next()
      if (path.basename(from) === 'lock') {
        seen.lockMoves += 1
      }
      await base.rename(from, to)
    },
    lstat: async (file) => {
      await next()
      return await base.lstat(file)
    },
  }
}

function byName(left: string, right: string): number {
  return left.localeCompare(right)
}

function heldRecord(folder: string, overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    folder,
    repositoryRoot: '/repo',
    createdAt: 1000,
    pullRequest: { ...ORIGIN },
    isHeld: true,
    ...overrides,
  }
}

function pendingRecord(folder: string, checkoutId: string): WorktreeRecord {
  return heldRecord(folder, { checkoutId, isCheckoutPending: true })
}

async function dataSetup() {
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-gen-'))
  const heldRoot = path.join(dataFolder, 'pr-worktrees')
  return {
    dataFolder,
    heldRoot,
    folder: path.join(heldRoot, '51-abcdef12'),
    other: path.join(heldRoot, '56-fedcba98'),
    recordsFolder: path.join(dataFolder, 'worktree-records'),
  }
}

/** A trusted or ready checkout of the old head at `folder`. */
async function seeded(dataFolder: string, folder: string, isTrusted: boolean) {
  const seed = createFileWorktreeRecordStore(dataFolder, process.platform, log)
  const reserved = await seed.reserve(
    heldRecord(folder, {
      checkoutId: 'old-checkout',
      folderIdentity: 'dev:1',
      ...(isTrusted && { trustConfirmedAt: 1500, isHeld: false }),
    }),
  )
  if (!reserved.ok) {
    throw new Error('seed refused')
  }
  return reserved.stored
}

/** A window's file store over a fresh data folder, with checkout 'a' reserved. */
async function reservedStore(
  logger: CoreLogger = log,
  options: { readonly fs?: RecordStoreFs } = {},
) {
  const setup = await dataSetup()
  const store = createFileWorktreeRecordStore(setup.dataFolder, process.platform, logger, options)
  const reserved = await store.reserve(pendingRecord(setup.folder, 'a'))
  if (!reserved.ok) {
    throw new Error('refused')
  }
  return { ...setup, store, reserved }
}

/**
 * Window A's store, paused just before it publishes a generation. Its lease
 * is 2 s: the retry after the takeover must still fit a full save path
 * (read the head, a flushed stage write, the link) inside one lease. A
 * 200 ms lease passed here but failed on Windows (PR 161): the first publish
 * beat it and paused, then the retries each outlasted it, so one test saw
 * the product's `could not be kept` after its attempts and the other's
 * `beforePublish.reached` never settled (the loss is reported before the
 * link the pause watches). The takeover stays fast: window B honors 10 ms.
 */
function pausedPublisher(dataFolder: string) {
  const windowAFs = pausingPort()
  const beforePublish = windowAFs.pauseAt('link', ([, target]) =>
    GENERATION_FILE.test(target ?? ''),
  )
  const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
    fs: windowAFs.port,
    leaseMs: 2000,
  })
  return { windowA, beforePublish }
}

describe('worktree record store: fenced reservations (M123 lane P)', () => {
  it('stamps each write with its hold’s fence and refuses a reservation another write moved', async () => {
    const { folder, store, reserved } = await reservedStore()
    expect(reserved.stored.fence).toBe(reserved.reservation.fence)
    expect(store.holdsSync(reserved.reservation)).toBe(true)
    const claimed = await store.claim(reserved.reservation, () => Promise.resolve('made'))
    if (claimed.status !== 'made') {
      throw new Error('claim refused')
    }
    expect(claimed.reservation.fence).toBeGreaterThan(reserved.reservation.fence)
    // The claim moved the fence: the reservation it replaced is spent.
    expect(store.holdsSync(reserved.reservation)).toBe(false)
    expect(await store.complete(reserved.reservation, 'dev:2')).toBe(false)
    expect(await store.discard(reserved.reservation)).toBe(false)
    expect(store.holdsSync(claimed.reservation)).toBe(true)
    expect(await store.complete(claimed.reservation, 'dev:2')).toBe(true)
    expect(store.holdsSync(claimed.reservation)).toBe(false)
    const ready = await store.recordFor(folder)
    expect(ready?.isCheckoutPending).toBeUndefined()
    expect(ready?.folderIdentity).toBe('dev:2')
    expect(ready?.fence).toBeGreaterThan(claimed.reservation.fence)
  })

  it('supersedes only the version read, and only while the folder is absent under its hold', async () => {
    const { folder, store, reserved: first } = await reservedStore()
    let asked = 0
    const present = await store.supersede(
      folder,
      versionOf(first.stored),
      pendingRecord(folder, 'b'),
      () => {
        asked += 1
        return false
      },
    )
    expect(asked).toBe(1)
    expect(present.ok).toBe(false)
    const replaced = await store.supersede(
      folder,
      versionOf(first.stored),
      pendingRecord(folder, 'b'),
      isFolderGone,
    )
    expect(replaced.ok).toBe(true)
    // The version read is gone now: a second supersede of it is refused.
    const again = await store.supersede(
      folder,
      versionOf(first.stored),
      pendingRecord(folder, 'c'),
      isFolderGone,
    )
    expect(again.ok).toBe(false)
    const current = await store.recordFor(folder)
    expect(current?.checkoutId).toBe('b')
    expect(store.holdsSync(first.reservation)).toBe(false)
  })

  it('claims under one hold, and makes nothing for a reservation that moved', async () => {
    const { dataFolder, folder, store, reserved: first } = await reservedStore()
    const replaced = await store.supersede(
      folder,
      versionOf(first.stored),
      pendingRecord(folder, 'b'),
      isFolderGone,
    )
    expect(replaced.ok).toBe(true)
    let made = 0
    const refused = await store.claim(first.reservation, () => {
      made += 1
      return Promise.resolve()
    })
    expect(refused.status).toBe('refused')
    expect(made).toBe(0)
    // The claim's making runs while the hold that published it is held.
    if (!replaced.ok) {
      throw new Error('refused')
    }
    const lockPath = path.join(dataFolder, 'worktree-records', 'lock')
    const claimed = await store.claim(replaced.reservation, () => {
      made += 1
      return Promise.resolve(existsSync(lockPath))
    })
    expect(claimed).toMatchObject({ status: 'made', made: true })
    expect(made).toBe(1)
  })

  it('hands back the claimed reservation when making the folder failed', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const folder = path.join(tmpdir(), 'pr-worktrees', '51-claim')
    const reserved = await store.reserve(pendingRecord(folder, 'a'))
    if (!reserved.ok) {
      throw new Error('refused')
    }
    const failure = new Error('the folder was there')
    const claimed = await store.claim(reserved.reservation, () => Promise.reject(failure))
    if (claimed.status !== 'failed') {
      throw new Error('expected a failed claim')
    }
    expect(claimed.error).toBe(failure)
    expect(store.holdsSync(claimed.reservation)).toBe(true)
    expect(await store.discard(claimed.reservation)).toBe(true)
    expect(await store.recordFor(folder)).toBeUndefined()
  })

  it('reads a reservation synchronously, and refuses one it cannot read', async () => {
    const { recordsFolder, store, reserved } = await reservedStore()
    expect(store.holdsSync(reserved.reservation)).toBe(true)
    expect(
      store.holdsSync({ ...reserved.reservation, fence: reserved.reservation.fence + 1 }),
    ).toBe(false)
    expect(store.holdsSync({ ...reserved.reservation, checkoutId: 'b' })).toBe(false)
    // A torn head proves nothing: the gate refuses.
    const names = await readdir(recordsFolder)
    const head =
      names
        .filter((name) => GENERATION_FILE.test(name))
        .toSorted(byName)
        .at(-1) ?? ''
    await writeFile(path.join(recordsFolder, head), '{"generation":')
    expect(store.holdsSync(reserved.reservation)).toBe(false)
  })

  it.each([
    { code: 'EACCES', loggedCode: 'EACCES' },
    {
      code: String.raw`EACCES: C:\Users\private\worktree-records`,
      loggedCode: 'an unrecognized value',
    },
  ])(
    'keeps a landed claim when the sweep after it cannot list the records ($loggedCode)',
    async ({ code, loggedCode }) => {
      // RVM123P7 finding 1: the claim's generation landed and was proven;
      // the best-effort sweep's listing then failed once (EACCES). The claim
      // stands, with its new fence, and its folder is made.
      const { dataFolder, folder } = await dataSetup()
      const failing = failingListingsAfterLink([2], code)
      const warnings: string[] = []
      const logger: CoreLogger = {
        ...log,
        warn: (message) => {
          warnings.push(message)
        },
      }
      const store = createFileWorktreeRecordStore(dataFolder, process.platform, logger, {
        fs: failing.fs,
      })
      const reserved = await store.reserve(pendingRecord(folder, 'a'))
      if (!reserved.ok) {
        throw new Error('refused')
      }
      failing.arm()
      let made = 0
      const claimed = await store.claim(reserved.reservation, () => {
        made += 1
        return Promise.resolve('made')
      })
      expect(failing.failed()).toBe(1)
      if (claimed.status !== 'made') {
        throw new Error(`expected a made claim, not ${claimed.status}`)
      }
      expect(claimed.reservation.fence).toBeGreaterThan(reserved.reservation.fence)
      expect(made).toBe(1)
      expect(store.holdsSync(claimed.reservation)).toBe(true)
      expect(warnings).toEqual([
        `The worktree records sweep listing failed (${loggedCode}); the next write tries again`,
      ])
    },
  )

  it('keeps a landed claim whose proof cannot be read, once the head shows it', async () => {
    const failing = failingListingsAfterLink([1])
    const { store, reserved } = await reservedStore(log, { fs: failing.fs })
    failing.arm()
    const claimed = await store.claim(reserved.reservation, () => Promise.resolve('made'))
    expect(failing.failed()).toBe(1)
    expect(claimed.status).toBe('made')
  })

  it('names every fence a claim may hold when its landing cannot be known', async () => {
    // The proof and the reconciliation both fail: whether the claim landed
    // is not known, so nothing is made and both reservations come back.
    const failing = failingListingsAfterLink([1, 2])
    const { folder, store, reserved } = await reservedStore(log, { fs: failing.fs })
    failing.arm()
    let made = 0
    const claimed = await store.claim(reserved.reservation, () => {
      made += 1
      return Promise.resolve('made')
    })
    expect(failing.failed()).toBe(2)
    if (claimed.status !== 'unknown') {
      throw new Error(`expected an unknown claim, not ${claimed.status}`)
    }
    expect(made).toBe(0)
    const fences = claimed.reservations.map((reservation) => reservation.fence)
    expect(fences).toContain(reserved.reservation.fence)
    expect(Math.max(...fences)).toBeGreaterThan(reserved.reservation.fence)
    // It landed here: the newer fence is the record's, and it discards.
    const [newest] = claimed.reservations
    if (newest === undefined) {
      throw new Error('no reservations')
    }
    expect(await store.discard(newest)).toBe(true)
    expect(await store.recordFor(folder)).toBeUndefined()
  })

  it('keeps a pending checkout owner’s boot through the file', async () => {
    // A Linux birth is clock ticks of one boot: without its boot id a
    // pending owner could never be judged gone by its birth.
    const { dataFolder, folder } = await dataSetup()
    const store = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const pendingOwner = {
      host: 'this-host',
      pid: 4242,
      processStart: 50_000,
      bootId: 'a3f1c0de-1111-4222-8333-944455556666',
    }
    const reserved = await store.reserve({ ...pendingRecord(folder, 'a'), pendingOwner })
    expect(reserved.ok).toBe(true)
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const record = await fresh.recordFor(folder)
    expect(record?.pendingOwner).toEqual(pendingOwner)
  })

  it('keeps publishing above the records’ fence when the fences lost their history', async () => {
    const { dataFolder, folder, other, recordsFolder } = await dataSetup()
    const store = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    for (let index = 0; index < 3; index += 1) {
      const reserved = await store.reserve(
        pendingRecord(`${folder}-${String(index)}`, `a${String(index)}`),
      )
      expect(reserved.ok).toBe(true)
    }
    const before = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    await rm(path.join(recordsFolder, 'lock.fences'), { recursive: true, force: true })
    const reserved = await store.reserve(pendingRecord(other, 'b'))
    if (!reserved.ok) {
      throw new Error('refused')
    }
    expect(reserved.reservation.fence).toBeGreaterThan(before.fence ?? Infinity)
    expect(await store.list()).toHaveLength(4)
  })
})

describe('worktree records generations (M123 lane P)', () => {
  it('never lets a delayed old owner land a write after a takeover', async () => {
    // RVM123P2 finding 1 and RVM123P3 finding 1: window A read the head
    // (the old trusted checkout) and was delayed past its last lease check,
    // right before publishing; its lease ran out, window B took the lock
    // over and replaced the checkout with a new, unconfirmed one.
    const { dataFolder, heldRoot, folder, other } = await dataSetup()
    const trusted = await seeded(dataFolder, folder, true)
    const { windowA, beforePublish } = pausedPublisher(dataFolder)
    const aReserve = windowA.reserve(heldRecord(other, { checkoutId: 'other-checkout' }))
    await beforePublish.reached
    await delay(300)
    // Takes the lock over within milliseconds of watching it (the race
    // test's eager window does the same), so the takeover does not wait out
    // A's two-second lease.
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      honoredLeaseMs: 10,
    })
    const replaced = await windowB.supersede(
      folder,
      versionOf(trusted),
      heldRecord(folder, { checkoutId: 'new-checkout', createdAt: 2000, isCheckoutPending: true }),
      isFolderGone,
    )
    expect(replaced.ok).toBe(true)
    beforePublish.resume()
    // A lost its generation, read the new head and applied its change again.
    const reservedByA = await aReserve
    expect(reservedByA.ok).toBe(true)
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const current = await fresh.recordFor(folder)
    expect(current?.checkoutId).toBe('new-checkout')
    expect(current?.isCheckoutPending).toBe(true)
    expect(current?.trustConfirmedAt).toBeUndefined()
    expect(await fresh.recordFor(other)).toBeDefined()
    expect(holdForRoots([folder], [heldRoot], await fresh.list(), process.platform)?.folder).toBe(
      slashed(folder),
    )
  })

  it('never lets a delayed owner’s release restore trust after a takeover', async () => {
    const { dataFolder, heldRoot, folder } = await dataSetup()
    const ready = await seeded(dataFolder, folder, false)
    const ticket: TrustTicket = {
      folder,
      checkoutId: 'old-checkout',
      revision: recordRevision(ready),
      fence: ready.fence,
      headSha: ORIGIN.headSha,
      folderIdentity: 'dev:1',
      pullRequest: { ...ORIGIN },
    }
    const { windowA, beforePublish } = pausedPublisher(dataFolder)
    const aRelease = windowA.release(ticket, 3000)
    await beforePublish.reached
    await delay(300)
    // Takes the lock over within milliseconds of watching it (the race
    // test's eager window does the same), so the takeover does not wait out
    // A's two-second lease.
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      honoredLeaseMs: 10,
    })
    const replaced = await windowB.supersede(
      folder,
      versionOf(ready),
      heldRecord(folder, { checkoutId: 'new-checkout', createdAt: 2000, isCheckoutPending: true }),
      isFolderGone,
    )
    expect(replaced.ok).toBe(true)
    beforePublish.resume()
    // Applied again to the new head, the old ticket matches nothing.
    expect(await aRelease).toBeUndefined()
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const current = await fresh.recordFor(folder)
    expect(current?.trustConfirmedAt).toBeUndefined()
    expect(holdForRoots([folder], [heldRoot], await fresh.list(), process.platform)).toBeDefined()
  })

  it('keeps a published write whose successor the sweep removed', async () => {
    // RVM123P4 finding 2: A publishes its reservation, then is delayed
    // before proving it; B takes the lock over and writes twelve more
    // generations, sweeping A's and its successor. A must report its own
    // reservation, not refuse it and strand it pending.
    const { dataFolder, heldRoot, folder } = await dataSetup()
    let hasPublished = false
    const windowAFs = pausingPort({
      ...nodeRecordStoreFs,
      link: async (existing, target) => {
        await nodeRecordStoreFs.link(existing, target)
        hasPublished ||= GENERATION_FILE.test(target)
      },
    })
    const beforeProof = windowAFs.pauseAt('readdir', () => hasPublished)
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      fs: windowAFs.port,
      leaseMs: 200,
    })
    const aReserve = windowA.reserve(heldRecord(folder, { checkoutId: 'a-checkout' }))
    await beforeProof.reached
    await delay(300)
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    for (let number = 1; number <= 12; number += 1) {
      const reserved = await windowB.reserve(
        heldRecord(path.join(heldRoot, `${String(number)}-b`), {
          checkoutId: `b-${String(number)}`,
        }),
      )
      expect(reserved.ok).toBe(true)
    }
    beforeProof.resume()
    const reservedByA = await aReserve
    expect(reservedByA.ok).toBe(true)
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const records = await fresh.list()
    expect(records).toHaveLength(13)
    expect(records.filter((record) => record.checkoutId === 'a-checkout')).toHaveLength(1)
  })

  it('never counts a publish into a swept generation as proven', async () => {
    const { dataFolder, heldRoot, recordsFolder } = await dataSetup()
    const store = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    for (let number = 1; number <= 12; number += 1) {
      const reserved = await store.reserve(
        heldRecord(path.join(heldRoot, `${String(number)}-abcdef12`), {
          checkoutId: `checkout-${String(number)}`,
        }),
      )
      expect(reserved.ok).toBe(true)
    }
    // Generation 3 was swept; a writer that read generation 2 long ago
    // takes the free number, and must learn its place cannot be proven.
    const stale = { generation: 2, writeId: 'long-gone', fence: undefined, records: [] }
    expect(
      await writeNextGeneration(nodeRecordStoreFs, recordsFolder, stale, [], 1000, () => true),
    ).toBe('unverified')
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    expect(head.generation).toBe(12)
    expect(head.records).toHaveLength(12)
  })

  it('refuses a publish under a fence not above the head’s, whatever its lease says', async () => {
    // The registry's compare-and-swap on the fence: a writer whose hold is
    // older than the head's publishes nothing, even when its own lease
    // check would let it.
    const { recordsFolder } = await reservedStore()
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    const fence = head.fence ?? 0
    for (const stale of [fence, fence - 1]) {
      expect(
        await writeNextGeneration(nodeRecordStoreFs, recordsFolder, head, [], stale, () => true),
      ).toBe('lost')
    }
    const unchanged = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    expect(unchanged.generation).toBe(head.generation)
    // Above it, and still current: published.
    expect(
      await writeNextGeneration(nodeRecordStoreFs, recordsFolder, head, [], fence + 1, () => true),
    ).toBe('written')
  })

  it('refuses a publish once its lease is no longer current, checked just before the link', async () => {
    const { recordsFolder } = await reservedStore()
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    let checks = 0
    expect(
      await writeNextGeneration(
        nodeRecordStoreFs,
        recordsFolder,
        head,
        [],
        (head.fence ?? 0) + 1,
        () => {
          checks += 1
          return false
        },
      ),
    ).toBe('lost')
    expect(checks).toBe(1)
    const unchanged = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    expect(unchanged.generation).toBe(head.generation)
    // No stage was left behind either.
    const names = await readdir(recordsFolder)
    expect(names.filter((name) => name.startsWith('.stage-'))).toEqual([])
  })

  it('takes over a lock left without its note by a crash, on the store', async () => {
    // RVM123P3 finding 5 on the store: a window that watched the noteless
    // lock past the bound mutates; one that gives up first leaves it alone.
    const { dataFolder, folder, recordsFolder } = await dataSetup()
    await mkdir(recordsFolder, { recursive: true })
    await writeFile(path.join(recordsFolder, 'lock'), '')
    const hurried = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      timeoutMs: 100,
    })
    await expect(hurried.reserve(heldRecord(folder, { checkoutId: 'a' }))).rejects.toBeInstanceOf(
      LeaseBusyError,
    )
    const patient = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      unreadableMs: 200,
      timeoutMs: 2000,
    })
    const reserved = await patient.reserve(heldRecord(folder, { checkoutId: 'a' }))
    expect(reserved.ok).toBe(true)
  })

  it('never removes a fresh holder’s lock it moved aside and could not read', async () => {
    // RVM123P6 finding 3 on the store: window B judged an expired lock;
    // before B's move, window A took it over and made a fresh lock, which
    // B's move reached. B's read of the moved file failed (EACCES). The
    // fresh lock must go back, and B must not write as if it held the lock.
    const { dataFolder, folder, recordsFolder } = await dataSetup()
    await mkdir(recordsFolder, { recursive: true })
    const lockPath = path.join(recordsFolder, 'lock')
    const owner = await currentProcessOwner()
    const note = (id: string, leaseMs: number) => {
      const now = Date.now()
      return JSON.stringify({
        owner,
        id,
        renewal: 0,
        acquiredAt: now,
        leaseMs,
        leaseUntil: now + leaseMs,
      })
    }
    await writeFile(lockPath, note('expired-holder', 0))
    let hasSwapped = false
    const windowB: RecordStoreFs = {
      ...nodeRecordStoreFs,
      rename: async (from, to) => {
        if (!hasSwapped && from === lockPath) {
          hasSwapped = true
          // Window A's takeover, finished just before B's move.
          await rm(lockPath, { force: true })
          await writeFile(lockPath, note('fresh-holder', 30_000))
        }
        await nodeRecordStoreFs.rename(from, to)
      },
      readFile: async (file) => {
        if (file.endsWith('.retired')) {
          throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), {
            code: 'EACCES',
          })
        }
        return await nodeRecordStoreFs.readFile(file)
      },
    }
    const store = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      fs: windowB,
      timeoutMs: 300,
    })
    const started = performance.now()
    let outcome: string
    try {
      const reserved = await store.reserve(pendingRecord(folder, 'b'))
      outcome = reserved.ok ? 'reserved' : 'refused'
    } catch (error: unknown) {
      outcome = error instanceof Error ? error.name : String(error)
    }
    expect(hasSwapped).toBe(true)
    // A's fresh lock is where A looks for it, whole.
    const kept = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly id: string }
    expect(kept.id).toBe('fresh-holder')
    // B waited for the lease it could not prove ended, and wrote nothing.
    expect(outcome).not.toBe('reserved')
    expect(performance.now() - started).toBeGreaterThanOrEqual(250)
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    await rm(lockPath, { force: true })
    expect(await fresh.recordFor(folder)).toBeUndefined()
  })

  it('loses no update and lands each once while windows race through forced takeovers', async () => {
    // Property: three windows, a seeded random number of turns before every
    // file call, and one window that waits out no other window's lease, so
    // it takes their lock over mid-write again and again (a delayed or
    // evicted owner, from their side). Whatever interleaving results, the
    // records are exactly the reserves that reported success, each once,
    // and the kept generations form one chain whose fences only rise.
    const { dataFolder, heldRoot, recordsFolder } = await dataSetup()
    const seen = { lockMoves: 0, lostGenerations: 0 }
    // Every window polls every few milliseconds (no long gaps leave the
    // lock idle); the third waits out others' leases for only a few
    // milliseconds and
    // arrives staggered, so its takeovers land inside their writes: after
    // their last lease check, before they publish. However fast or loaded
    // the machine, one takeover mid-write is certain: the first window
    // holds its first publish until the third has taken the lock over and
    // published that very generation (at most 2 s), so it must be refused.
    const firstHeld = deferred()
    const windows = [
      { seed: 11, honoredLeaseMs: 30_000 },
      { seed: 23, honoredLeaseMs: 30_000 },
      { seed: 37, honoredLeaseMs: 10 },
    ].map(({ seed, honoredLeaseMs }, index) =>
      createFileWorktreeRecordStore(dataFolder, process.platform, log, {
        fs:
          index === 0
            ? holdingFirstPublish(jitteringFs(seed, 4, seen, 40), firstHeld.resolve)
            : jitteringFs(seed, 4, seen, 40),
        honoredLeaseMs,
        // A 2 ms poll, not every event-loop turn: turn-spinning
        // waiters each retry with real file calls, and that traffic alone
        // passed the 5 s budget on a loaded machine. The publish linger
        // (up to 40 ms) and the held first publish (up to 2 s) leave the
        // takeover window far wider than this gap.
        sleep: async () => {
          await delay(2)
        },
        // The lock wait each reserve allows itself. Nine reserves race
        // one lock, so most waits end here rather than in a publish; at
        // 4000 the case's wall time passed the 5 s test budget on a loaded
        // machine (18 s measured at load ~8, 2.2 s unloaded) even though
        // every assertion still held. 1200 keeps the race (the held first
        // publish forces a mid-write takeover regardless) inside budget.
        timeoutMs: 1200,
      }),
    )
    const EAGER = 2
    const outcomes = await Promise.all(
      windows.flatMap((window, index) =>
        // Three reserves a window (nine racers) still race one lock
        // through forced takeovers; ten a window serialised enough real
        // file work to pass the 5 s budget on a loaded machine, and five
        // still passed it beside other files in a shard.
        [1, 2, 3].map(async (number) => {
          const folder = path.join(heldRoot, `${String(index)}-${String(number)}`)
          if (index === EAGER) {
            await firstHeld.promise
            await delay(number * 6)
          }
          try {
            const reserved = await window.reserve(
              heldRecord(folder, { checkoutId: `${String(index)}-${String(number)}` }),
            )
            return { folder: slashed(folder), ok: reserved.ok }
          } catch {
            return { folder: slashed(folder), ok: false }
          }
        }),
      ),
    )
    const succeeded = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.folder)
    expect(succeeded.length).toBeGreaterThan(0)
    // RVM123P4 finding 5: the race really happened. A generation number
    // already taken when a writer published means two writers held the
    // lock at once: a takeover mid-write, fenced.
    expect(seen.lostGenerations).toBeGreaterThan(0)
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    const landed = head.records.map((record) => record.folder)
    expect(new Set(landed).size).toBe(landed.length)
    expect(landed.toSorted(byName)).toEqual(succeeded.toSorted(byName))
    // The kept generations: each one's parent is the one before, and each
    // was written under a later fence than its parent.
    const listed = await readdir(recordsFolder)
    const generations = listed.filter((name) => /^\d+\.json$/u.test(name)).toSorted(byName)
    const files = await Promise.all(
      generations.map(
        async (name) =>
          JSON.parse(await readFile(path.join(recordsFolder, name), 'utf8')) as {
            readonly generation: number
            readonly writeId: string
            readonly parent: string | null
            readonly fence: number
          },
      ),
    )
    const top = files.filter((file) => file.generation > head.generation - 8)
    for (let index = 1; index < top.length; index += 1) {
      expect(top[index]?.parent).toBe(top[index - 1]?.writeId)
      expect(top[index]?.fence).toBeGreaterThan(top[index - 1]?.fence ?? Infinity)
    }
  })
})

describe('worktree records: a publication’s last check (RVINTM123B)', () => {
  it.each([
    ['in memory', () => Promise.resolve(createMemoryRecordRegistry())],
    [
      'as files',
      async () =>
        createFileRecordRegistry(await mkdtemp(path.join(tmpdir(), 'm123p-last-check-')), log),
    ],
  ] as const)('publishes nothing whose caller ended, %s', async (_, made) => {
    const registry = await made()
    const record = heldRecord('/data/pr-worktrees/51-abcdef12')
    expect(await registry.hold((hold) => hold.publish([record], () => false))).toBe('lost')
    expect(await registry.read()).toEqual([])
    expect(await registry.hold((hold) => hold.publish([record], () => true))).toBe('written')
    expect(await registry.read()).toEqual([record])
  })
})
