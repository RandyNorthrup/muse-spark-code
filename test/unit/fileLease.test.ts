// LOCKLIB, the cross-process file lease (M123 lane P, RVM123P3–P6 and
// M123P7): the process owners it judges, fences strictly increasing and
// checked synchronously, takeover only after the same instance was watched
// for its lease on the monotonic clock, renewal and release of the
// caller's own instance only, and a moved instance put back whenever it
// cannot be proven — on real files, with a port that pauses or fails one
// call where an interleaving matters.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import {
  acquireFileLease,
  LeaseBusyError,
  type FileLease,
  type FileLeaseEnv,
  type LeasePort,
} from '../../src/core/locks/fileLease'
import { nodeLeasePort } from '../../src/core/locks/nodeLeasePort'
import {
  currentProcessOwner,
  isProcessOwnerGone,
  processStartTime,
  systemBootId,
  type ProcessOwner,
} from '../../src/core/locks/processOwner'
import { FILE_LEASE_FENCES_KEPT } from '../../src/shared/constants'
import { deferred, exitedProcessId, nextTurn, pausingPort } from './helpers/leaseFs'
import { canReadProcessBirth } from './helpers/processBirth'

/** A lock instance's stats as inode reuse looks: one inode number for all. */
function reused<T extends { ino: bigint }>(file: string, stats: T): T {
  if (path.basename(file).startsWith('lock')) {
    stats.ino = 1n
  }
  return stats
}

/** The lease port, with every lock instance reporting one inode number. */
function reusingInodes(base: LeasePort): LeasePort {
  return {
    ...base,
    lstat: async (file) => reused(file, await base.lstat(file)),
    lstatSync: (file) => reused(file, base.lstatSync(file)),
    rewriteOwn: (file, isOwn, content) =>
      base.rewriteOwn(file, (opened, bytes) => isOwn(reused(file, opened), bytes), content),
  }
}

async function leaseEnv(overrides: Partial<FileLeaseEnv> = {}): Promise<FileLeaseEnv> {
  return {
    port: nodeLeasePort,
    now: Date.now,
    monotonic: () => performance.now(),
    sleep: (ms) => delay(ms),
    owner: await currentProcessOwner(),
    isOwnerGone: (owner) => isProcessOwnerGone(owner),
    leaseMs: 30_000,
    honoredLeaseMs: 30_000,
    unreadableMs: 2000,
    timeoutMs: 3000,
    pollMs: 10,
    ...overrides,
  }
}

/**
 * Another holder's note, readable by every version: the renewal count this
 * one keeps and the wall-clock lease an earlier one did are both there.
 */
function lockNote(owner: ProcessOwner, leaseMs: number, id = 'someone-else') {
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

/** A wall clock stepped an hour forward. */
function anHourAhead(): number {
  return Date.now() + 3_600_000
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
  const folder = await mkdtemp(path.join(tmpdir(), 'm123p-lease-'))
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

/** The note id at the lock's name now, or undefined when the name is free. */
async function noteIdAt(lockPath: string): Promise<string | undefined> {
  try {
    const note = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly id?: string }
    return note.id
  } catch {
    return undefined
  }
}

function eacces(file: string): Error {
  return Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' })
}

/** Whether `name` is a moved lock instance (a takeover's or a release's aside name). */
function isAside(name: string | undefined): boolean {
  return name?.endsWith('.retired') === true
}

/** The moved lock instances left in `folder`. */
async function asideNames(folder: string): Promise<string[]> {
  const names = await readdir(folder)
  return names.filter((name) => isAside(name))
}

/** A lock held by a live owner of this host whose lease has already run out. */
async function expiredLock(): Promise<string> {
  const { lockPath } = await lockFolder()
  await writeFile(lockPath, lockNote(await currentProcessOwner(), 0))
  return lockPath
}

/** A takes `lockPath` over at once, honouring no lease (through `port`). */
async function takeOverAtOnce(lockPath: string, port: LeasePort = nodeLeasePort) {
  return await acquireFileLease(
    lockPath,
    await leaseEnv({ port, honoredLeaseMs: 0, watches: new Map() }),
  )
}

/** A's 100 ms hold, left to expire, then taken over by B. */
async function expiredAndTakenOver() {
  const { lockPath } = await lockFolder()
  const a = await acquireFileLease(lockPath, await leaseEnv({ leaseMs: 100, watches: new Map() }))
  await delay(200)
  const b = await acquireFileLease(
    lockPath,
    await leaseEnv({ honoredLeaseMs: 100, watches: new Map() }),
  )
  return { lockPath, a, b }
}

/** B acquiring `lockPath` through `window`, paused just before it moves the lock aside. */
async function movingTaker(lockPath: string, window: ReturnType<typeof pausingPort>) {
  const beforeMove = window.pauseAt('rename', ([from]) => from === lockPath)
  let isBHolding = false
  const bEnv = await leaseEnv({ port: window.port, watches: new Map() })
  const bAcquire = (async () => {
    const lease = await acquireFileLease(lockPath, bEnv)
    isBHolding = true
    return lease
  })()
  return { beforeMove, bAcquire, isBHolding: () => isBHolding }
}

/**
 * B resumed: it put A's fresh lock back, so A still holds and B waits; once
 * A releases, B holds. B's lease.
 */
async function takerWaitsForRelease(
  beforeMove: { readonly resume: () => void },
  a: FileLease,
  bAcquire: Promise<FileLease>,
  isBHolding: () => boolean,
): Promise<FileLease> {
  beforeMove.resume()
  await delay(150)
  expect(a.isHeldSync()).toBe(true)
  expect(isBHolding()).toBe(false)
  await a.release()
  const b = await bAcquire
  expect(await b.isHeld()).toBe(true)
  return b
}

/** `base`, failing every read of a moved-aside instance (EACCES). */
function asideUnreadable(base: LeasePort): LeasePort {
  return {
    ...base,
    readFile: async (file) => {
      if (isAside(file)) {
        throw eacces(file)
      }
      return await base.readFile(file)
    },
  }
}

/** A lease env on a monotonic clock that steps a second per sleep. */
async function steppingClock(timeoutMs: number) {
  let elapsed = 0
  const env = await leaseEnv({
    monotonic: () => elapsed,
    sleep: async () => {
      elapsed += 1000
      await nextTurn()
    },
    timeoutMs,
    watches: new Map(),
  })
  return { env, elapsed: () => elapsed }
}

describe('process owners (M123 lane P)', () => {
  it('reads this process’s birth from the system, or the documented estimate where the table is silent', async () => {
    const started = await processStartTime(process.pid)
    const self = await currentProcessOwner()
    if (canReadProcessBirth()) {
      expect(started).toBeDefined()
      expect(self.processStart).toBe(started)
    } else {
      // No process table: no birth to read, and the owner falls back to
      // the uptime estimate instead of inventing one.
      expect(started).toBeUndefined()
      expect(self.pid).toBe(process.pid)
      expect(Math.abs(self.processStart - (Date.now() - process.uptime() * 1000))).toBeLessThan(
        2000,
      )
    }
    expect(await processStartTime(await exitedProcessId())).toBeUndefined()
  })

  it.skipIf(process.platform === 'linux')(
    'reads a Windows or macOS birth as the epoch time it was recorded at, or the estimate where the table is silent',
    async () => {
      const started = await processStartTime(process.pid)
      const self = await currentProcessOwner()
      if (canReadProcessBirth()) {
        expect(Math.abs((started ?? 0) - (Date.now() - process.uptime() * 1000))).toBeLessThan(2000)
      } else {
        expect(started).toBeUndefined()
        expect(Math.abs(self.processStart - (Date.now() - process.uptime() * 1000))).toBeLessThan(
          2000,
        )
      }
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
      if (canReadProcessBirth()) {
        expect(self.bootId).toBe(bootId)
        expect(self.processStart).toBe(await processStartTime(process.pid))
        // Ticks since boot: far below any epoch time.
        expect(self.processStart).toBeLessThan(Date.now() / 1000)
      } else {
        // Without the table the owner is the estimate form: no boot, no birth.
        expect(await processStartTime(process.pid)).toBeUndefined()
        expect(self.bootId).toBeUndefined()
        expect(Math.abs(self.processStart - (Date.now() - process.uptime() * 1000))).toBeLessThan(
          2000,
        )
      }
    },
  )

  it('names a gone owner only when it is provably gone', async () => {
    const canReadTable = canReadProcessBirth()
    const self = await currentProcessOwner()
    expect(await isProcessOwnerGone(self)).toBe(false)
    // This process's id with another start time: our own birth is known
    // without any table (it is this process's), so the mismatch is
    // provable everywhere, table or none.
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
      // A live id whose birth the table answers carries it; where the
      // table is silent there is nothing to carry, and doubt keeps it.
      if (canReadTable) expect(started).toBeDefined()
      else expect(started).toBeUndefined()
      const owner = { ...self, pid: live.pid, processStart: started ?? 0 }
      expect(await isProcessOwnerGone(owner)).toBe(false)
      // RVM123P4 finding 4: the id now names a process that started at
      // another time, so the recorded owner is gone, whoever's id it is —
      // provable only where the table answers.
      expect(
        await isProcessOwnerGone({ ...owner, processStart: owner.processStart - 60_000 }),
      ).toBe(canReadTable)
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

describe('file lease: fences (M123 LOCKLIB)', () => {
  it('gives every hold a fence above every earlier one, kept beside the lock', async () => {
    const { lockPath } = await lockFolder()
    const env = await leaseEnv({ watches: new Map() })
    const fences: number[] = []
    for (let hold = 1; hold <= FILE_LEASE_FENCES_KEPT + 4; hold += 1) {
      const lease = await acquireFileLease(lockPath, env)
      expect(lease.isHeldSync()).toBe(true)
      fences.push(lease.fence)
      await lease.release()
      expect(lease.isHeldSync()).toBe(false)
    }
    expect(fences).toEqual(fences.map((_fence, index) => index + 1))
    // Only the newest fences are kept; the highest is the current one.
    const kept = await readdir(`${lockPath}.fences`)
    expect(kept.map(Number).toSorted((left, right) => left - right)).toEqual(
      fences.slice(-FILE_LEASE_FENCES_KEPT),
    )
    // Released: the lock's name is free and nothing was left aside.
    expect(existsSync(lockPath)).toBe(false)
    expect(await asideNames(path.dirname(lockPath))).toEqual([])
  })

  it('is no longer held, synchronously, once another hold has a later fence', async () => {
    const { a, b } = await expiredAndTakenOver()
    expect(b.fence).toBeGreaterThan(a.fence)
    expect(a.isHeldSync()).toBe(false)
    expect(await a.isHeld()).toBe(false)
    // A renewal and a release act on the caller's own instance only.
    expect(await a.renew()).toBe(false)
    await a.release()
    expect(b.isHeldSync()).toBe(true)
    await b.release()
  })

  it('is no longer held once its own lease ran out on its own clock', async () => {
    const { lockPath } = await lockFolder()
    let elapsed = 0
    const lease = await acquireFileLease(
      lockPath,
      await leaseEnv({ monotonic: () => elapsed, leaseMs: 1000, watches: new Map() }),
    )
    expect(lease.isHeldSync()).toBe(true)
    elapsed = 999
    expect(lease.isHeldSync()).toBe(true)
    elapsed = 1000
    // Nobody took it over; its own lease ended, so nothing may rely on it.
    expect(lease.isHeldSync()).toBe(false)
    expect(await lease.renew()).toBe(false)
    await lease.release()
  })

  it('is no longer held when the highest fence is not its own', async () => {
    const { lockPath } = await lockFolder()
    const lease = await acquireFileLease(lockPath, await leaseEnv({ watches: new Map() }))
    // A later hold's fence, however it came (a takeover not yet visible as a new lock).
    await writeFile(path.join(`${lockPath}.fences`, String(lease.fence + 1).padStart(16, '0')), '')
    expect(lease.isHeldSync()).toBe(false)
    expect(await lease.isHeld()).toBe(false)
    await lease.release()
  })
})

/**
 * A holder whose renewal passed its own check and then waits, at the
 * open, for the test; and a taker that, meanwhile, watches the holder's
 * instance run out and takes the lock over with a fence of its own.
 */
async function renewalOvertaken(port: LeasePort) {
  const { lockPath } = await lockFolder()
  let elapsed = 0
  const atOpen = deferred()
  const goOn = deferred()
  const holder = await acquireFileLease(
    lockPath,
    await leaseEnv({
      port: {
        ...port,
        rewriteOwn: async (file, isOwn, content) => {
          atOpen.resolve()
          await goOn.promise
          return await port.rewriteOwn(file, isOwn, content)
        },
      },
      monotonic: () => elapsed,
      leaseMs: 1000,
      watches: new Map(),
    }),
  )
  const renewing = holder.renew()
  await atOpen.promise
  const taker = await acquireFileLease(
    lockPath,
    await leaseEnv({
      port,
      monotonic: () => elapsed,
      sleep: async () => {
        elapsed += 200
        await nextTurn()
      },
      timeoutMs: 10_000,
      watches: new Map(),
    }),
  )
  const takersNote = await readFile(lockPath, 'utf8')
  goOn.resolve()
  return { lockPath, holder, taker, takersNote, isRenewed: await renewing }
}

describe('file lease: renewal (M123 LOCKLIB)', () => {
  it.each([false, true])(
    'RVM123G4C: recognizes only its own pending rewrite (expiry: %s)',
    async (expires) => {
      const { lockPath } = await lockFolder()
      const atOpen = deferred()
      const accept = deferred()
      const written = Promise.withResolvers<string>()
      const resume = deferred()
      const checked = deferred()
      const finish = deferred()
      let isObserving = false
      let elapsed = 0
      let samples = 0
      let changed: 'none' | 'file' | 'birth' | 'time' = 'none'
      const lease = await acquireFileLease(
        lockPath,
        await leaseEnv({
          monotonic: () => elapsed,
          leaseMs: 1000,
          watches: new Map(),
          port: {
            ...nodeLeasePort,
            readdir: async (folder) => {
              if (isObserving) {
                checked.resolve()
                await finish.promise
              }
              return await nodeLeasePort.readdir(folder)
            },
            lstatSync: (file) => {
              const stats = nodeLeasePort.lstatSync(file)
              switch (changed) {
                case 'file': {
                  stats.ino += 1n
                  break
                }
                case 'birth': {
                  stats.birthtimeNs += 1n
                  break
                }
                case 'time': {
                  stats.mtimeNs += BigInt(++samples)
                  break
                }
                case 'none': {
                  break
                }
              }
              return stats
            },
            rewriteOwn: async (file, isOwn, content) => {
              atOpen.resolve()
              await accept.promise
              if (!isOwn(await nodeLeasePort.lstat(file), await readFile(file))) return false
              written.resolve(content)
              await resume.promise
              await writeFile(file, content)
              isObserving = true
              return true
            },
          },
        }),
      )
      const before = await readFile(lockPath)
      elapsed = 100
      const renewals = [lease.renew(), lease.renew()]
      try {
        await atOpen.promise
        expect(await within(Promise.race(renewals), 100)).toBe(false)
        await writeFile(lockPath, '')
        expect(lease.isHeldSync()).toBe(false) // Not yet accepted by the opened-file guard.
        await writeFile(lockPath, before)
        accept.resolve()
        const after = await written.promise
        expect(lease.isHeldSync()).toBe(true) // Still the old renewal count.
        expect(await within(lease.renew(), 100)).toBe(false) // One rewrite at a time.
        await writeFile(lockPath, after)
        expect(lease.isHeldSync()).toBe(true) // The next renewal count, not yet settled.
        expect(await lease.isHeld()).toBe(true)
        for (const foreign of [
          after.replace(/"id":"[^"]+"/u, '"id":"foreign"'),
          after.replace('"renewal":1', '"renewal":2'),
        ]) {
          await writeFile(lockPath, foreign)
          expect(lease.isHeldSync()).toBe(false)
        }
        for (const torn of ['', '{"owner":']) {
          await writeFile(lockPath, torn)
          changed = 'time' // The holder's write can change metadata between sync samples.
          expect(lease.isHeldSync()).toBe(true)
          for (const field of ['file', 'birth'] as const) {
            changed = field
            expect(lease.isHeldSync()).toBe(false)
          }
        }
        changed = 'none'
        const laterFence = path.join(
          `${lockPath}.fences`,
          String(lease.fence + 1).padStart(16, '0'),
        )
        await writeFile(laterFence, '')
        expect(lease.isHeldSync()).toBe(false)
        await rm(laterFence)
        if (expires) elapsed = 1000
        expect(lease.isHeldSync()).toBe(!expires)
        resume.resolve()
        await checked.promise
        expect(lease.isHeldSync()).toBe(!expires) // Complete next note during post-write checks.
        await writeFile(lockPath, '')
        expect(lease.isHeldSync()).toBe(false) // Rewrite settled; observations still pending.
        await writeFile(lockPath, after)
        finish.resolve()
        const results = await Promise.all(renewals)
        expect(results.filter(Boolean)).toHaveLength(expires ? 0 : 1)
        await writeFile(lockPath, '')
        expect(lease.isHeldSync()).toBe(false) // No pending rewrite remains.
      } finally {
        accept.resolve()
        resume.resolve()
        finish.resolve()
        await Promise.all(renewals)
        await lease.release()
        await rm(path.dirname(lockPath), { recursive: true, force: true })
      }
    },
  )

  it('keeps a renewing holder against a waiter, and is taken over a lease after it stops', async () => {
    // Liveness by renewal (lane G's transaction lock moves onto this): the
    // waiter watches each renewed instance afresh, so it never takes over
    // while the holder renews within its lease.
    const { lockPath } = await lockFolder()
    let elapsed = 0
    const holder = await acquireFileLease(
      lockPath,
      await leaseEnv({ monotonic: () => elapsed, leaseMs: 1000, watches: new Map() }),
    )
    let renewals = 0
    let lastRenewal = 0
    const renewing = { isOn: true }
    const waiter = acquireFileLease(
      lockPath,
      await leaseEnv({
        monotonic: () => elapsed,
        sleep: async () => {
          elapsed += 100
          if (renewing.isOn && elapsed - lastRenewal >= 400) {
            expect(await holder.renew()).toBe(true)
            renewals += 1
            lastRenewal = elapsed
          }
          if (renewals >= 5) {
            renewing.isOn = false
          }
          await nextTurn()
        },
        timeoutMs: 10_000,
        watches: new Map(),
      }),
    )
    const taken = await waiter
    expect(renewals).toBe(5)
    // Taken over only once a full lease passed after the last renewal.
    expect(elapsed - lastRenewal).toBeGreaterThanOrEqual(1000)
    expect(taken.fence).toBeGreaterThan(holder.fence)
    expect(holder.isHeldSync()).toBe(false)
    expect(await holder.renew()).toBe(false)
    await holder.release()
    expect(taken.isHeldSync()).toBe(true)
    await taken.release()
  })

  it('never renews over a taker’s lock that reuses its file id', async () => {
    // RVM123P7 finding 2: the holder passed its check and paused before
    // opening the file; its lease ran out and the taker's lock, with the
    // same file id (Linux reuses one at once; this port reports one for
    // every lock), stands at the name. The renewal reads the opened file's
    // own birth and note and writes nothing.
    const overtaken = await renewalOvertaken(reusingInodes(nodeLeasePort))
    expect(overtaken.isRenewed).toBe(false)
    expect(await readFile(overtaken.lockPath, 'utf8')).toBe(overtaken.takersNote)
    expect(overtaken.taker.fence).toBeGreaterThan(overtaken.holder.fence)
    expect(overtaken.taker.isHeldSync()).toBe(true)
    expect(overtaken.holder.isHeldSync()).toBe(false)
    await overtaken.taker.release()
  })

  it('never renews over a taker’s lock, natively', async () => {
    // The same on this platform's own file system, whatever file id the
    // taker's lock gets.
    const overtaken = await renewalOvertaken(nodeLeasePort)
    expect(overtaken.isRenewed).toBe(false)
    expect(await readFile(overtaken.lockPath, 'utf8')).toBe(overtaken.takersNote)
    expect(overtaken.taker.isHeldSync()).toBe(true)
    await overtaken.taker.release()
  })

  it('reports a renewal lost when a later fence is the highest after it wrote', async () => {
    const { lockPath } = await lockFolder()
    const lease = await acquireFileLease(
      lockPath,
      await leaseEnv({
        port: {
          ...nodeLeasePort,
          rewriteOwn: async (file, isOwn, content) => {
            const isWritten = await nodeLeasePort.rewriteOwn(file, isOwn, content)
            // A later hold's fence, taken while this one wrote.
            await writeFile(
              path.join(`${lockPath}.fences`, String(lease.fence + 1).padStart(16, '0')),
              '',
            )
            return isWritten
          },
        },
        watches: new Map(),
      }),
    )
    expect(await lease.renew()).toBe(false)
    expect(lease.isHeldSync()).toBe(false)
  })

  it('rewrites a file only while its owner check accepts the file opened', async () => {
    const { folder } = await lockFolder()
    const file = path.join(folder, 'note')
    await writeFile(file, 'old')
    expect(await nodeLeasePort.rewriteOwn(file, () => false, 'new')).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('old')
    const seen: string[] = []
    const isOwn = (_opened: unknown, bytes: Buffer) => {
      seen.push(bytes.toString('utf8'))
      return true
    }
    expect(await nodeLeasePort.rewriteOwn(file, isOwn, 'new')).toBe(true)
    expect(seen).toEqual(['old'])
    expect(await readFile(file, 'utf8')).toBe('new')
    expect(await nodeLeasePort.rewriteOwn(path.join(folder, 'gone'), () => true, 'x')).toBe(false)
  })
})

describe('file lease: waiting and takeover (M123 LOCKLIB)', () => {
  it('takes over at once a lock whose owner process is gone', async () => {
    const { lockPath } = await lockFolder()
    const gone = { host: hostname(), pid: await exitedProcessId(), processStart: 1 }
    await writeFile(lockPath, lockNote(gone, 60_000))
    const started = performance.now()
    const lease = await acquireFileLease(lockPath, await leaseEnv())
    expect(performance.now() - started).toBeLessThan(1000)
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('takes over at once a lock whose owner id now names another process', async () => {
    // RVM123P4 finding 4: the owner crashed and the system gave its id to a
    // live, unrelated process; its lease would otherwise hold for a minute.
    // Reuse is provable at once only where the table answers; where it is
    // silent the waiter takes over at the lease's own expiry instead.
    const { lockPath } = await lockFolder()
    const live = liveProcess()
    try {
      const self = await currentProcessOwner()
      // Born at another time than the id's live process, in this boot.
      const reused = { ...self, pid: live.pid, processStart: 1 }
      await writeFile(lockPath, lockNote(reused, canReadProcessBirth() ? 60_000 : 1000))
      const lease = await acquireFileLease(lockPath, await leaseEnv({ timeoutMs: 3000 }))
      expect(await lease.isHeld()).toBe(true)
      await lease.release()
    } finally {
      await live.stop()
    }
  })

  it('takes over only after watching the same instance for its whole lease', async () => {
    // The watched expiry: first seen at 0 on the waiter's monotonic clock,
    // the instance is busy at every poll before 30 s and taken at 30 s.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000))
    let elapsed = 0
    const seenBusy: number[] = []
    const lease = await acquireFileLease(
      lockPath,
      await leaseEnv({
        monotonic: () => elapsed,
        sleep: async () => {
          seenBusy.push(elapsed)
          elapsed += 250
          await nextTurn()
        },
        timeoutMs: 60_000,
        watches: new Map(),
      }),
    )
    expect(seenBusy.at(-1)).toBe(29_750)
    expect(elapsed).toBe(30_000)
    expect(lease.isHeldSync()).toBe(true)
    await lease.release()
  })

  it('waits out a live-looking owner’s lease across attempts shorter than it', async () => {
    // RVM123P5 finding 1: each attempt gives up after its 10 s timeout; the
    // instance watched in earlier attempts keeps its first-seen time, so the
    // 30 s lease is waited out and the lock taken over.
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000))
    const clock = await steppingClock(10_000)
    const { env } = clock
    const outcomes: string[] = []
    for (let attempt = 1; attempt <= 5 && !outcomes.includes('acquired'); attempt += 1) {
      try {
        const lease = await acquireFileLease(lockPath, env)
        outcomes.push('acquired')
        await lease.release()
      } catch (error: unknown) {
        outcomes.push(error instanceof LeaseBusyError ? 'busy' : String(error))
      }
    }
    // Two 10 s attempts give up; the third reaches 30 s watched and takes over.
    expect(outcomes).toEqual(['busy', 'busy', 'acquired'])
    expect(clock.elapsed()).toBeGreaterThanOrEqual(30_000)
  })

  it('starts the watch again when the instance changes between attempts', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000))
    const clock = await steppingClock(20_000)
    const { env } = clock
    await expect(acquireFileLease(lockPath, env)).rejects.toBeInstanceOf(LeaseBusyError)
    // Another holder now: 20 s already watched of the old one count for nothing.
    await rm(lockPath, { force: true })
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 30_000, 'another-holder'))
    const started = clock.elapsed()
    await expect(acquireFileLease(lockPath, env)).rejects.toBeInstanceOf(LeaseBusyError)
    const lease = await acquireFileLease(lockPath, env)
    expect(clock.elapsed() - started).toBeGreaterThanOrEqual(30_000)
    await lease.release()
  })

  it('waits for a live owner until its lease ends, and no longer', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 400))
    await expect(
      acquireFileLease(lockPath, await leaseEnv({ timeoutMs: 100, watches: new Map() })),
    ).rejects.toBeInstanceOf(LeaseBusyError)
    const lease = await acquireFileLease(lockPath, await leaseEnv({ watches: new Map() }))
    expect(await lease.isHeld()).toBe(true)
    await lease.release()
  })

  it('waits out another holder’s lease only up to the longest it honors', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 3_600_000))
    const lease = await acquireFileLease(
      lockPath,
      await leaseEnv({ honoredLeaseMs: 300, timeoutMs: 2000 }),
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
        acquireFileLease(lockPath, await leaseEnv({ now: steppingBack, timeoutMs: 300 })),
        2000,
      )
      expect(outcome).toBeInstanceOf(LeaseBusyError)
    } finally {
      await rm(lockPath, { force: true })
    }
  })

  it('never lets a wall clock step forward cut a live lease', async () => {
    const { lockPath } = await lockFolder()
    await writeFile(lockPath, lockNote(await currentProcessOwner(), 60_000))
    await expect(
      acquireFileLease(lockPath, await leaseEnv({ now: anHourAhead, timeoutMs: 300 })),
    ).rejects.toBeInstanceOf(LeaseBusyError)
    // The holder's own lease does not end with a step either.
    await rm(lockPath, { force: true })
    let isStepped = false
    const lease = await acquireFileLease(
      lockPath,
      await leaseEnv({ now: () => (isStepped ? Date.now() + 3_600_000 : Date.now()) }),
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
        acquireFileLease(
          lockPath,
          await leaseEnv({ unreadableMs: 300, timeoutMs: 100, watches: new Map() }),
        ),
      ).rejects.toBeInstanceOf(LeaseBusyError)
      // Watched past the bound: taken over.
      const lease = await acquireFileLease(
        lockPath,
        await leaseEnv({ unreadableMs: 300, timeoutMs: 2000, watches: new Map() }),
      )
      expect(await lease.isHeld()).toBe(true)
      await lease.release()
    }
  })

  it('never lets two waiters on one expired lock delete each other’s fresh lock', async () => {
    // RVM123P3 finding 1: both judge the same expired instance; A takes it
    // over first, then B's already-authorized move reaches A's fresh lock.
    const lockPath = await expiredLock()
    const { beforeMove, bAcquire, isBHolding } = await movingTaker(lockPath, pausingPort())
    await beforeMove.reached
    const a = await takeOverAtOnce(lockPath)
    expect(await a.isHeld()).toBe(true)
    // B moves A's lock aside, sees it is not the instance it judged, and
    // puts it back: A still holds, B still waits.
    const b = await takerWaitsForRelease(beforeMove, a, bAcquire, isBHolding)
    expect(b.fence).toBeGreaterThan(a.fence)
    expect(await a.isHeld()).toBe(false)
    await b.release()
    // No instance was left aside.
    expect(await asideNames(path.dirname(lockPath))).toEqual([])
  })

  it('tells a fresh lock from the stale one it replaced when the inode number is reused', async () => {
    // Found natively on Linux (FIXM123P6): ext4 gave A's fresh lock the
    // stale lock's freed inode number. This port reports one inode number
    // for every lock instance, as such reuse looks.
    const lockPath = await expiredLock()
    const { beforeMove, bAcquire, isBHolding } = await movingTaker(
      lockPath,
      pausingPort(reusingInodes(nodeLeasePort)),
    )
    await beforeMove.reached
    const a = await takeOverAtOnce(lockPath, reusingInodes(nodeLeasePort))
    const b = await takerWaitsForRelease(beforeMove, a, bAcquire, isBHolding)
    await b.release()
  })

  it('puts back a moved lock it cannot read, and never acquires over it', async () => {
    // RVM123P6 finding 3: B judged the expired instance, A took it over
    // first, and B's move reached A's fresh lock; B's read of the moved
    // file failed (EACCES). Unproven, it goes back under its name: A still
    // holds, and B waits for A's lease instead of acquiring at once.
    const lockPath = await expiredLock()
    const windowB = pausingPort(asideUnreadable(nodeLeasePort))
    const beforeMove = windowB.pauseAt('rename', ([from]) => from === lockPath)
    const bOutcome = within(
      acquireFileLease(
        lockPath,
        await leaseEnv({ port: windowB.port, timeoutMs: 300, watches: new Map() }),
      ),
      5000,
    )
    await beforeMove.reached
    const a = await takeOverAtOnce(lockPath)
    const aNote = await noteIdAt(lockPath)
    beforeMove.resume()
    // B never acquires over A's live lease: busy at its timeout.
    expect(await bOutcome).toBeInstanceOf(LeaseBusyError)
    expect(a.isHeldSync()).toBe(true)
    expect(await noteIdAt(lockPath)).toBe(aNote)
    expect(await asideNames(path.dirname(lockPath))).toEqual([])
    await a.release()
  })

  it('ends busy, never acquired, when an unproven moved lock cannot go back', async () => {
    // The restore itself fails (its name was taken meanwhile, or the link
    // is refused): the moved file stays aside, never removed, and the
    // taker does not acquire.
    const lockPath = await expiredLock()
    const windowB = pausingPort({
      ...asideUnreadable(nodeLeasePort),
      link: async (existing, target) => {
        if (target === lockPath && isAside(path.basename(existing))) {
          throw Object.assign(new Error('EPERM: link refused'), { code: 'EPERM' })
        }
        await nodeLeasePort.link(existing, target)
      },
    })
    const beforeMove = windowB.pauseAt('rename', ([from]) => from === lockPath)
    const bOutcome = within(
      acquireFileLease(lockPath, await leaseEnv({ port: windowB.port, watches: new Map() })),
      5000,
    )
    await beforeMove.reached
    const a = await takeOverAtOnce(lockPath)
    const aNote = await noteIdAt(lockPath)
    beforeMove.resume()
    const outcome = await bOutcome
    expect(outcome).toBeInstanceOf(LeaseBusyError)
    // A's instance survives aside, whole: never unlinked unproven.
    const aside = await asideNames(path.dirname(lockPath))
    expect(aside).toHaveLength(1)
    expect(await noteIdAt(path.join(path.dirname(lockPath), aside[0] ?? ''))).toBe(aNote)
    await a.release()
  })

  it('releases only its own instance, never a lock taken over from it', async () => {
    const { a, b } = await expiredAndTakenOver()
    expect(await a.isHeld()).toBe(false)
    await a.release()
    expect(await b.isHeld()).toBe(true)
    await b.release()
  })
})
