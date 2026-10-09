// The worktree records' cross-process lock and fenced generations (M123
// lane P, RVM123P/P2/P3): two windows as two store instances over one data
// folder, a file-operation port that pauses one call where an interleaving
// matters, real files on this platform's file system.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
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
  errorCode,
  nodeRecordStoreFs,
  type RecordStoreFs,
} from '../../src/runtime/panel/pullRequests/recordStoreFs'
import {
  currentProcessOwner,
  isProcessOwnerGone,
  processStartTime,
  systemBootId,
  type ProcessOwner,
} from '../../src/runtime/panel/pullRequests/processOwner'
import {
  acquireStoreLock,
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

/** The file operations, with every lock instance reporting one inode number. */
function reusingInodes(base: RecordStoreFs): RecordStoreFs {
  return {
    ...base,
    lstat: async (file) => {
      const stats = await base.lstat(file)
      if (path.basename(file).startsWith('lock')) {
        stats.ino = 1n
      }
      return stats
    },
  }
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
      if (isArmed && /\d+\.json$/u.test(target)) {
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

/** Something to resolve from outside: a window reaching the point a test waits for. */
function deferred(): { readonly promise: Promise<undefined>; readonly resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<undefined>()
  return {
    promise,
    resolve: () => {
      resolve(undefined)
    },
  }
}

/** One turn of the event loop: other windows' steps run in it. */
async function nextTurn(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
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
    unlink: (file) => base.unlink(file),
    lstat: async (file) => {
      await next()
      return await base.lstat(file)
    },
  }
}

async function lockEnv(overrides: Partial<StoreLockEnv> = {}): Promise<StoreLockEnv> {
  return {
    fs: nodeRecordStoreFs,
    now: Date.now,
    monotonic: () => performance.now(),
    sleep: (ms) => delay(ms),
    owner: await currentProcessOwner(),
    isOwnerGone: (owner) => isProcessOwnerGone(owner),
    leaseMs: 30_000,
    honoredLeaseMs: 30_000,
    unreadableMs: 2000,
    timeoutMs: 3000,
    ...overrides,
  }
}

/**
 * Another window's note. It carries the lease both ways an earlier note
 * did (`leaseUntil`, wall clock) and this one does (`leaseMs`, the
 * holder's monotonic clock), so a reader of either version reads the same
 * live or expired lock.
 */
function lockNote(owner: ProcessOwner, leaseMs: number, id = 'someone-else') {
  const now = Date.now()
  return JSON.stringify({
    owner,
    id,
    acquiredAt: now,
    leaseMs,
    leaseUntil: now + leaseMs,
  })
}

/** A wall clock stepped an hour forward. */
function anHourAhead(): number {
  return Date.now() + 3_600_000
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

/** A live process for the test's length; `stop` ends it and waits. */
function liveProcess(): { readonly pid: number; readonly stop: () => Promise<void> } {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    windowsHide: true,
  })
  const exited = new Promise((resolve) => {
    child.once('exit', resolve)
  })
  if (child.pid === undefined) {
    throw new Error('the process never started')
  }
  return {
    pid: child.pid,
    stop: async () => {
      child.kill('SIGKILL')
      await exited
    },
  }
}

async function lockFolder(): Promise<{ readonly folder: string; readonly lockPath: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'm123p-lock-'))
  return { folder, lockPath: path.join(folder, 'lock') }
}

/** How a promise settled within `ms`: its value, its error, or `hung`. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | Error | 'hung'> {
  const settled = (async () => {
    try {
      return await work
    } catch (error: unknown) {
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
  return await Promise.race([settled, delay(ms, 'hung' as const)])
}

describe('process owners (M123 lane P)', () => {
  it('reads this process’s birth from the system', async () => {
    const started = await processStartTime(process.pid)
    expect(started).toBeDefined()
    const self = await currentProcessOwner()
    expect(self.processStart).toBe(started)
    expect(await processStartTime(await exitedProcessId())).toBeUndefined()
  })

  it.skipIf(process.platform === 'linux')(
    'reads a Windows or macOS birth as the epoch time it was recorded at',
    async () => {
      const started = await processStartTime(process.pid)
      expect(Math.abs((started ?? 0) - (Date.now() - process.uptime() * 1000))).toBeLessThan(2000)
      const self = await currentProcessOwner()
      expect(self.bootId).toBeUndefined()
    },
  )

  it.runIf(process.platform === 'linux')(
    'reads a Linux birth as kernel ticks in this boot, never the wall clock',
    async () => {
      // RVM123P5 finding 3, natively: ticks since boot and the boot id.
      const bootId = await systemBootId()
      expect(bootId).toMatch(/^[\da-f-]{36}$/u)
      const self = await currentProcessOwner()
      expect(self.bootId).toBe(bootId)
      expect(self.processStart).toBe(await processStartTime(process.pid))
      // Ticks since boot: far below any epoch time.
      expect(self.processStart).toBeLessThan(Date.now() / 1000)
    },
  )

  it('names a gone owner only when it is provably gone', async () => {
    const self = await currentProcessOwner()
    expect(await isProcessOwnerGone(self)).toBe(false)
    // This process's id with another start time: an earlier process.
    expect(await isProcessOwnerGone({ ...self, processStart: self.processStart - 60_000 })).toBe(
      true,
    )
    expect(await isProcessOwnerGone({ ...self, pid: await exitedProcessId() })).toBe(true)
    // Another host's process is never provably gone: its lease decides.
    expect(await isProcessOwnerGone({ ...self, host: `${self.host}-elsewhere`, pid: 1 })).toBe(
      false,
    )
    const live = liveProcess()
    try {
      const started = await processStartTime(live.pid)
      expect(started).toBeDefined()
      const owner = { ...self, pid: live.pid, processStart: started ?? 0 }
      expect(await isProcessOwnerGone(owner)).toBe(false)
      // RVM123P4 finding 4: the id now names a process that started at
      // another time, so the recorded owner is gone, whoever's id it is.
      expect(
        await isProcessOwnerGone({ ...owner, processStart: owner.processStart - 60_000 }),
      ).toBe(true)
      // A live id whose start time cannot be read proves nothing.
      expect(
        await isProcessOwnerGone(
          { ...owner, processStart: 1 },
          { startTimeOf: () => Promise.resolve(undefined) },
        ),
      ).toBe(false)
    } finally {
      await live.stop()
    }
  })
})

describe('worktree records lock (M123 lane P)', () => {
  it('takes over at once a lock whose owner process is gone', async () => {
    const { lockPath } = await lockFolder()
    const gone = { host: hostname(), pid: await exitedProcessId(), processStart: 1 }
    await writeFile(lockPath, lockNote(gone, 60_000))
    const started = performance.now()
    const lease = await acquireStoreLock(lockPath, await lockEnv())
    expect(performance.now() - started).toBeLessThan(1000)
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('takes over at once a lock whose owner id now names another process', async () => {
    // RVM123P4 finding 4: the owner crashed and the system gave its id to a
    // live, unrelated process; its lease would otherwise hold for a minute.
    const { lockPath } = await lockFolder()
    const live = liveProcess()
    try {
      const self = await currentProcessOwner()
      // Born at another time than the id's live process, in this boot.
      const reused = { ...self, pid: live.pid, processStart: 1 }
      await writeFile(lockPath, lockNote(reused, 60_000))
      const lease = await acquireStoreLock(lockPath, await lockEnv({ timeoutMs: 3000 }))
      expect(await lease.isHeld()).toBe(true)
      await lease.release()
    } finally {
      await live.stop()
    }
  })

  it('waits out a live-looking owner’s lease across attempts shorter than it', async () => {
    // RVM123P5 finding 1: each attempt gives up after its 10 s timeout; the
    // instance watched in earlier attempts keeps its first-seen time, so the
    // 30 s lease is waited out and the lock taken over.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000))
    let elapsed = 0
    const env = await lockEnv({
      monotonic: () => elapsed,
      sleep: async () => {
        elapsed += 1000
        await nextTurn()
      },
      timeoutMs: 10_000,
      watches: new Map(),
    })
    const outcomes: string[] = []
    for (let attempt = 1; attempt <= 5 && !outcomes.includes('acquired'); attempt += 1) {
      try {
        const lease = await acquireStoreLock(lockPath, env)
        outcomes.push('acquired')
        await lease.release()
      } catch (error: unknown) {
        outcomes.push(error instanceof StoreBusyError ? 'busy' : String(error))
      }
    }
    // Two 10 s attempts give up; the third reaches 30 s watched and takes over.
    expect(outcomes).toEqual(['busy', 'busy', 'acquired'])
    expect(elapsed).toBeGreaterThanOrEqual(30_000)
  })

  it('starts the watch again when the instance changes between attempts', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000))
    let elapsed = 0
    const env = await lockEnv({
      monotonic: () => elapsed,
      sleep: async () => {
        elapsed += 1000
        await nextTurn()
      },
      timeoutMs: 20_000,
      watches: new Map(),
    })
    await expect(acquireStoreLock(lockPath, env)).rejects.toBeInstanceOf(StoreBusyError)
    // Another holder now: 20 s already watched of the old one count for nothing.
    await rm(lockPath, { force: true })
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000, 'another-holder'))
    const started = elapsed
    await expect(acquireStoreLock(lockPath, env)).rejects.toBeInstanceOf(StoreBusyError)
    const lease = await acquireStoreLock(lockPath, env)
    expect(elapsed - started).toBeGreaterThanOrEqual(30_000)
    await lease.release()
  })

  it('waits for a live owner until its lease ends, and no longer', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 400))
    await expect(
      acquireStoreLock(lockPath, await lockEnv({ timeoutMs: 100 })),
    ).rejects.toBeInstanceOf(StoreBusyError)
    const lease = await acquireStoreLock(lockPath, await lockEnv())
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
  })

  it('waits out another window’s lease only up to the longest it honors', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 3_600_000))
    const lease = await acquireStoreLock(
      lockPath,
      await lockEnv({ honoredLeaseMs: 300, timeoutMs: 2000 }),
    )
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
  })

  it('bounds the wait when the wall clock steps back', async () => {
    // RVM123P4 finding 3: the wall clock moves back an hour during the
    // wait; the wait and the lease are measured on the monotonic clock.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 60_000))
    let calls = 0
    const steppingBack = () => {
      calls += 1
      return calls === 1 ? Date.now() : Date.now() - 3_600_000
    }
    try {
      const outcome = await within(
        acquireStoreLock(lockPath, await lockEnv({ now: steppingBack, timeoutMs: 300 })),
        2000,
      )
      expect(outcome).toBeInstanceOf(StoreBusyError)
    } finally {
      // Lets a wait that never ended (the earlier wall-clock deadline) end.
      await rm(lockPath, { force: true })
    }
  })

  it('never lets a wall clock step forward cut a live lease', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 60_000))
    await expect(
      acquireStoreLock(lockPath, await lockEnv({ now: anHourAhead, timeoutMs: 300 })),
    ).rejects.toBeInstanceOf(StoreBusyError)
    // The holder's own lease does not end with a step either.
    await rm(lockPath, { force: true })
    let isStepped = false
    const lease = await acquireStoreLock(
      lockPath,
      await lockEnv({ now: () => (isStepped ? Date.now() + 3_600_000 : Date.now()) }),
    )
    isStepped = true
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
  })

  it('expires a lock whose owner note is missing or torn after the short bound', async () => {
    // RVM123P3 finding 5: a crash between creating the lock and writing
    // its note must not leave a lock that never expires.
    const { lockPath } = await lockFolder()
    for (const content of ['', '{"owner":{"host"']) {
      await writeFile(lockPath, content)
      // Watched less than the bound: its writer may still be writing.
      await expect(
        acquireStoreLock(lockPath, await lockEnv({ unreadableMs: 300, timeoutMs: 100 })),
      ).rejects.toBeInstanceOf(StoreBusyError)
      // Watched past the bound: taken over.
      const lease = await acquireStoreLock(
        lockPath,
        await lockEnv({ unreadableMs: 300, timeoutMs: 2000 }),
      )
      expect(await lease.isHeld()).toBe(true)
      await lease.release()
    }
  })

  it('never lets two waiters on one expired lock delete each other’s fresh lock', async () => {
    // RVM123P3 finding 1: both windows judge the same expired instance; A
    // takes it over first, then B's already-authorized move reaches A's
    // fresh lock.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 0))
    const windowB = pausingFs()
    const beforeMove = windowB.pauseAt('rename', ([from]) => from === lockPath)
    let isBHolding = false
    const bEnv = await lockEnv({ fs: windowB.fs })
    const bAcquire = (async () => {
      const lease = await acquireStoreLock(lockPath, bEnv)
      isBHolding = true
      return lease
    })()
    await beforeMove.reached
    const a = await acquireStoreLock(lockPath, await lockEnv({ honoredLeaseMs: 0 }))
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

  it('tells a fresh lock from the stale one it replaced when the inode number is reused', async () => {
    // Found natively on Linux (FIXM123P6): ext4 gave A's fresh lock the
    // stale lock's freed inode number, so B's move-aside check matched A's
    // live lock by file id alone and deleted it. This port reports one
    // inode number for every lock instance, as such reuse looks.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 0))
    const windowB = pausingFs(reusingInodes(nodeRecordStoreFs))
    const beforeMove = windowB.pauseAt('rename', ([from]) => from === lockPath)
    let isBHolding = false
    const bEnv = await lockEnv({ fs: windowB.fs, watches: new Map() })
    const bAcquire = (async () => {
      const lease = await acquireStoreLock(lockPath, bEnv)
      isBHolding = true
      return lease
    })()
    await beforeMove.reached
    const a = await acquireStoreLock(
      lockPath,
      await lockEnv({
        fs: reusingInodes(nodeRecordStoreFs),
        honoredLeaseMs: 0,
        watches: new Map(),
      }),
    )
    beforeMove.resume()
    await delay(150)
    expect(await a.isHeld()).toBe(true)
    expect(isBHolding).toBe(false)
    await a.release()
    const b = await bAcquire
    expect(await b.isHeld()).toBe(true)
    await b.release()
  })

  it('releases only its own instance, never a lock taken over from it', async () => {
    const { lockPath } = await lockFolder()
    const a = await acquireStoreLock(lockPath, await lockEnv({ leaseMs: 100 }))
    await delay(200)
    const b = await acquireStoreLock(lockPath, await lockEnv())
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

const GENERATION_FILE = /\d+\.json$/u

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
      GENERATION_FILE.test(target ?? ''),
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
      GENERATION_FILE.test(target ?? ''),
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

  it('keeps a published write whose successor the sweep removed', async () => {
    // RVM123P4 finding 2: A publishes its reservation, then is delayed
    // before proving it; B takes the lock over and writes twelve more
    // generations, sweeping A's and its successor. A must report its own
    // reservation, not refuse it and strand it pending.
    const { dataFolder, heldRoot, folder } = await dataSetup()
    let hasPublished = false
    const windowAFs = pausingFs({
      ...nodeRecordStoreFs,
      link: async (existing, target) => {
        await nodeRecordStoreFs.link(existing, target)
        hasPublished ||= GENERATION_FILE.test(target)
      },
    })
    const beforeProof = windowAFs.pauseAt('readdir', () => hasPublished)
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      fs: windowAFs.fs,
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
    const stale = { generation: 2, writeId: 'long-gone', records: [] }
    expect(
      await writeNextGeneration(nodeRecordStoreFs, recordsFolder, stale, [], () =>
        Promise.resolve(true),
      ),
    ).toBe('unverified')
    const head = await readRecordHead(nodeRecordStoreFs, recordsFolder, log)
    expect(head.generation).toBe(12)
    expect(head.records).toHaveLength(12)
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
      StoreBusyError,
    )
    const patient = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      unreadableMs: 200,
      timeoutMs: 2000,
    })
    const reserved = await patient.reserve(heldRecord(folder, { checkoutId: 'a' }))
    expect(reserved.ok).toBe(true)
  })

  it('loses no update and lands each once while windows race through forced takeovers', async () => {
    // Property: three windows, a seeded random number of turns before every
    // file call, and one window that waits out no other window's lease, so
    // it takes their lock over mid-write again and again (a delayed or
    // evicted owner, from their side). Whatever interleaving results, the
    // records are exactly the reserves that reported success, each once,
    // and the kept generations form one chain.
    const { dataFolder, heldRoot, recordsFolder } = await dataSetup()
    const seen = { lockMoves: 0, lostGenerations: 0 }
    // Every window polls every turn (no timer gaps leave the lock idle);
    // the third waits out others' leases for only a few milliseconds and
    // arrives staggered, so its takeovers land inside their writes: after
    // their last lease check, before they publish. However fast or loaded
    // the machine, one takeover mid-write is certain: the first window
    // holds its first publish until the third has taken the lock over and
    // published that very generation (at most 2 s), so the fence must
    // refuse it.
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
        sleep: () => nextTurn(),
        timeoutMs: 4000,
      }),
    )
    const EAGER = 2
    const outcomes = await Promise.all(
      windows.flatMap((window, index) =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(async (number) => {
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
