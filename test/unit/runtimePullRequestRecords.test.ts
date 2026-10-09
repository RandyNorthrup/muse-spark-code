// The worktree records' cross-process lock and fenced generations (M123
// lane P, RVM123P/P2/P3): two windows as two store instances over one data
// folder, a file-operation port that pauses one call where an interleaving
// matters, real files on this platform's file system.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import type { WorktreeRecord } from '../../src/core/worktreeConversations'
import {
  createFileWorktreeRecordStore,
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
  nodeRecordStoreFs,
  type RecordStoreFs,
} from '../../src/runtime/panel/pullRequests/recordStoreFs'
import {
  acquireStoreLock,
  currentProcessOwner,
  isProcessOwnerGone,
  StoreBusyError,
  type StoreLockEnv,
} from '../../src/runtime/panel/pullRequests/storeLock'

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

function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

interface Pause {
  /** Settles when the paused call is reached, before it runs. */
  readonly reached: Promise<void>
  readonly resume: () => void
}

/** The node file operations, with one-shot pauses a test arms per call. */
function pausingFs(base: RecordStoreFs = nodeRecordStoreFs) {
  const traps: {
    readonly op: string
    readonly isMatch: (args: readonly string[]) => boolean
    readonly hit: () => void
    readonly gate: Promise<void>
  }[] = []
  const pass = async (op: string, args: readonly string[]): Promise<void> => {
    const index = traps.findIndex((trap) => trap.op === op && trap.isMatch(args))
    const trap = traps[index]
    if (trap === undefined) {
      return
    }
    traps.splice(index, 1)
    trap.hit()
    await trap.gate
  }
  const fs: RecordStoreFs = {
    mkdir: async (folder) => {
      await pass('mkdir', [folder])
      await base.mkdir(folder)
    },
    readdir: async (folder) => {
      await pass('readdir', [folder])
      return await base.readdir(folder)
    },
    readFile: async (file) => {
      await pass('readFile', [file])
      return await base.readFile(file)
    },
    createExclusive: async (file, content) => {
      await pass('createExclusive', [file, content])
      await base.createExclusive(file, content)
    },
    link: async (existing, target) => {
      await pass('link', [existing, target])
      await base.link(existing, target)
    },
    rename: async (from, to) => {
      await pass('rename', [from, to])
      await base.rename(from, to)
    },
    unlink: async (file) => {
      await pass('unlink', [file])
      await base.unlink(file)
    },
    lstat: async (file) => {
      await pass('lstat', [file])
      return await base.lstat(file)
    },
  }
  const pauseAt = (
    op: keyof RecordStoreFs,
    isMatch: (args: readonly string[]) => boolean,
  ): Pause => {
    const reached = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    traps.push({
      op,
      isMatch,
      hit: () => {
        reached.resolve(undefined)
      },
      gate: gate.promise,
    })
    return {
      reached: reached.promise,
      resume: () => {
        gate.resolve(undefined)
      },
    }
  }
  return { fs, pauseAt }
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
): RecordStoreFs {
  // Park–Miller: deterministic turns; the thread pool still varies the rest.
  let state = seed
  const next = async () => {
    state = (state * 48_271) % 2_147_483_647
    for (let turn = state % (maxTurns + 1); turn > 0; turn -= 1) {
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
    }
  }
  const base = nodeRecordStoreFs
  return {
    mkdir: (folder) => base.mkdir(folder),
    readdir: async (folder) => {
      await next()
      return await base.readdir(folder)
    },
    readFile: async (file) => {
      await next()
      return await base.readFile(file)
    },
    createExclusive: async (file, content) => {
      await next()
      await base.createExclusive(file, content)
    },
    link: async (existing, target) => {
      await next()
      try {
        await base.link(existing, target)
      } catch (error: unknown) {
        // A generation someone else took first: the fence at work.
        seen.lostGenerations += 1
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
    unlink: (file) => base.unlink(file),
    lstat: async (file) => {
      await next()
      return await base.lstat(file)
    },
  }
}

function lockEnv(overrides: Partial<StoreLockEnv> = {}): StoreLockEnv {
  return {
    fs: nodeRecordStoreFs,
    now: Date.now,
    sleep: (ms) => delay(ms),
    owner: currentProcessOwner(),
    isOwnerGone: (owner) => isProcessOwnerGone(owner),
    leaseMs: 30_000,
    timeoutMs: 3000,
    ...overrides,
  }
}

function lockNote(owner: { host: string; pid: number; processStart: number }, leaseUntil: number) {
  return JSON.stringify({ owner, id: 'someone-else', acquiredAt: Date.now(), leaseUntil })
}

/** The id of a process that has exited: provably gone on this host. */
async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true })
  await new Promise((resolve) => {
    child.once('exit', resolve)
  })
  if (child.pid === undefined) {
    throw new Error('the process never started')
  }
  return child.pid
}

/** Sets a file's times `ageMs` into the past. */
async function age(file: string, ageMs: number): Promise<void> {
  const then = new Date(Date.now() - ageMs)
  await utimes(file, then, then)
}

async function lockFolder(): Promise<{ readonly folder: string; readonly lockPath: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'm123p-lock-'))
  return { folder, lockPath: path.join(folder, 'lock') }
}

describe('worktree records lock (M123 lane P)', () => {
  it('names a gone owner only when it is provably gone', async () => {
    const self = currentProcessOwner()
    expect(isProcessOwnerGone(self)).toBe(false)
    // This process's id with another start time: an earlier process.
    expect(isProcessOwnerGone({ ...self, processStart: self.processStart - 60_000 })).toBe(true)
    expect(isProcessOwnerGone({ ...self, pid: await exitedProcessId() })).toBe(true)
    // Another host's process is never provably gone: its lease decides.
    expect(isProcessOwnerGone({ ...self, host: `${self.host}-elsewhere`, pid: 1 })).toBe(false)
  })

  it('takes over at once a lock whose owner process is gone', async () => {
    const { lockPath } = await lockFolder()
    const gone = { host: hostname(), pid: await exitedProcessId(), processStart: 1 }
    await writeFile(lockPath, lockNote(gone, Date.now() + 60_000))
    const started = Date.now()
    const lease = await acquireStoreLock(lockPath, lockEnv())
    expect(Date.now() - started).toBeLessThan(1000)
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('waits for a live owner until its lease ends, and no longer', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(currentProcessOwner(), Date.now() + 400))
    await expect(acquireStoreLock(lockPath, lockEnv({ timeoutMs: 100 }))).rejects.toBeInstanceOf(
      StoreBusyError,
    )
    const lease = await acquireStoreLock(lockPath, lockEnv())
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
  })

  it('lets no note pin the lock past the lease after its file was written', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(currentProcessOwner(), Date.now() + 3_600_000))
    await age(lockPath, 60_000)
    const lease = await acquireStoreLock(lockPath, lockEnv({ timeoutMs: 500 }))
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
  })

  it('expires a lock whose owner note is missing or torn after the short bound', async () => {
    // RVM123P3 finding 5: a crash between creating the lock and writing
    // its note must not leave a lock that never expires.
    const { lockPath } = await lockFolder()
    for (const content of ['', '{"owner":{"host"']) {
      await writeFile(lockPath, content)
      // Fresh: its writer may still be writing; it is not taken.
      await expect(acquireStoreLock(lockPath, lockEnv({ timeoutMs: 200 }))).rejects.toBeInstanceOf(
        StoreBusyError,
      )
      // Past the bound: taken over.
      await age(lockPath, 10_000)
      const lease = await acquireStoreLock(lockPath, lockEnv({ timeoutMs: 500 }))
      expect(await lease.isHeld()).toBe(true)
      await lease.release()
    }
  })

  it('never lets two waiters on one expired lock delete each other’s fresh lock', async () => {
    // RVM123P3 finding 1: both windows judge the same expired instance; A
    // takes it over first, then B's already-authorized move reaches A's
    // fresh lock.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(currentProcessOwner(), Date.now() - 1))
    const windowB = pausingFs()
    const beforeMove = windowB.pauseAt('rename', ([from]) => from === lockPath)
    let isBHolding = false
    const bAcquire = (async () => {
      const lease = await acquireStoreLock(lockPath, lockEnv({ fs: windowB.fs }))
      isBHolding = true
      return lease
    })()
    await beforeMove.reached
    const a = await acquireStoreLock(lockPath, lockEnv())
    expect(await a.isHeld()).toBe(true)
    beforeMove.resume()
    await delay(150)
    // B moved A's lock aside, saw it was not the instance it judged, and
    // put it back: A still holds, B still waits.
    expect(await a.isHeld()).toBe(true)
    expect(isBHolding).toBe(false)
    await a.release()
    const b = await bAcquire
    expect(await b.isHeld()).toBe(true)
    expect(await a.isHeld()).toBe(false)
    await b.release()
    // No instance was left aside.
    const left = await readdir(path.dirname(lockPath))
    expect(left).toEqual([])
  })

  it('releases only its own instance, never a lock taken over from it', async () => {
    const { lockPath } = await lockFolder()
    const a = await acquireStoreLock(lockPath, lockEnv({ leaseMs: 100 }))
    await delay(200)
    const b = await acquireStoreLock(lockPath, lockEnv())
    expect(await a.isHeld()).toBe(false)
    await a.release()
    expect(await b.isHeld()).toBe(true)
    await b.release()
  })
})

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

describe('worktree records generations (M123 lane P)', () => {
  it('never lets a delayed old owner land a write after a takeover', async () => {
    // RVM123P2 finding 1 and RVM123P3 finding 1: window A read the head
    // (the old trusted checkout) and was delayed past its last lease check,
    // right before publishing; its lease ran out, window B took the lock
    // over and replaced the checkout with a new, unconfirmed one.
    const { dataFolder, heldRoot, folder, other } = await dataSetup()
    const trusted = await seeded(dataFolder, folder, true)
    const windowAFs = pausingFs()
    const beforePublish = windowAFs.pauseAt('link', ([, target]) =>
      /\d+\.json$/u.test(target ?? ''),
    )
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      fs: windowAFs.fs,
      leaseMs: 200,
    })
    const aReserve = windowA.reserve(heldRecord(other, { checkoutId: 'other-checkout' }))
    await beforePublish.reached
    await delay(300)
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const replaced = await windowB.supersede(
      folder,
      versionOf(trusted),
      heldRecord(folder, { checkoutId: 'new-checkout', createdAt: 2000, isCheckoutPending: true }),
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
      headSha: ORIGIN.headSha,
      folderIdentity: 'dev:1',
      pullRequest: { ...ORIGIN },
    }
    const windowAFs = pausingFs()
    const beforePublish = windowAFs.pauseAt('link', ([, target]) =>
      /\d+\.json$/u.test(target ?? ''),
    )
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      fs: windowAFs.fs,
      leaseMs: 200,
    })
    const aRelease = windowA.release(ticket, 3000)
    await beforePublish.reached
    await delay(300)
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const replaced = await windowB.supersede(
      folder,
      versionOf(ready),
      heldRecord(folder, { checkoutId: 'new-checkout', createdAt: 2000, isCheckoutPending: true }),
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

  it('never counts a publish into a swept generation as in effect', async () => {
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
    // takes the free number, and must learn it was never in effect.
    const stale = { generation: 2, writeId: 'long-gone', records: [] }
    expect(
      await writeNextGeneration(nodeRecordStoreFs, recordsFolder, stale, [], () =>
        Promise.resolve(true),
      ),
    ).toBe('lost')
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    expect(head.generation).toBe(12)
    expect(head.records).toHaveLength(12)
  })

  it('takes over a lock left without its note by a crash, on the store', async () => {
    // RVM123P3 finding 5 on the store: a fresh window long after the crash
    // (the virtual clock) mutates; a crash in progress is left alone.
    const { dataFolder, folder, recordsFolder } = await dataSetup()
    await mkdir(recordsFolder, { recursive: true })
    await writeFile(path.join(recordsFolder, 'lock'), '')
    const hurried = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      timeoutMs: 200,
    })
    await expect(hurried.reserve(heldRecord(folder, { checkoutId: 'a' }))).rejects.toBeInstanceOf(
      StoreBusyError,
    )
    const later = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      now: () => Date.now() + 140_000,
      timeoutMs: 1000,
    })
    const reserved = await later.reserve(heldRecord(folder, { checkoutId: 'a' }))
    expect(reserved.ok).toBe(true)
  })

  it('loses no update and lands each once while windows race through forced takeovers', async () => {
    // Property: three windows, a seeded random number of turns before every
    // file call, and one window whose clock runs past every other's lease,
    // so it takes their lock over mid-write again and again (a delayed or
    // evicted owner, from their side). Whatever interleaving results, the
    // records are exactly the reserves that reported success, each once,
    // and the kept generations form one chain.
    const { dataFolder, heldRoot, recordsFolder } = await dataSetup()
    const seen = { lockMoves: 0, lostGenerations: 0 }
    const windows = [
      { seed: 11, skewMs: 0 },
      { seed: 23, skewMs: 0 },
      { seed: 37, skewMs: 45_000 },
    ].map(({ seed, skewMs }) =>
      createFileWorktreeRecordStore(dataFolder, process.platform, log, {
        fs: jitteringFs(seed, 4, seen),
        now: () => Date.now() + skewMs,
        timeoutMs: 4000,
      }),
    )
    const outcomes = await Promise.all(
      windows.flatMap((window, index) =>
        [1, 2, 3, 4, 5].map(async (number) => {
          const folder = path.join(heldRoot, `${String(index)}-${String(number)}`)
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
    // The race really happened: locks were moved aside (releases and
    // takeovers).
    expect(seen.lockMoves).toBeGreaterThan(0)
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    const landed = head.records.map((record) => record.folder)
    expect(new Set(landed).size).toBe(landed.length)
    expect(landed.toSorted(byName)).toEqual(succeeded.toSorted(byName))
    // The kept generations: each one's parent is the one before.
    const listed = await readdir(recordsFolder)
    const generations = listed.filter((name) => /^\d+\.json$/u.test(name)).toSorted(byName)
    const files = await Promise.all(
      generations.map(
        async (name) =>
          JSON.parse(await readFile(path.join(recordsFolder, name), 'utf8')) as {
            readonly generation: number
            readonly writeId: string
            readonly parent: string | null
          },
      ),
    )
    const top = files.filter((file) => file.generation > head.generation - 8)
    for (let index = 1; index < top.length; index += 1) {
      expect(top[index]?.parent).toBe(top[index - 1]?.writeId)
    }
  })
})
