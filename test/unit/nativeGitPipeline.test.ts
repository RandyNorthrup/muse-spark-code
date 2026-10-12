// The native Git service's one bound pipeline (M123 lane G, RVM123G2's
// redesign): plan → confirmation → admission → final revalidation → spawn.
// The repository transaction lock across processes (R7, R8) with its
// stale-lock recovery; the seal; a push destination or staged bytes changed
// while the transaction waited for the host's admission (R2, R9); and a
// replacement installed right after the service was made (R6). Every git
// commits as the test's own identity (R12).

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fileLeases from '../../src/core/locks/fileLease'
import { nodeLeasePort } from '../../src/core/locks/nodeLeasePort'
import { currentProcessOwner, isProcessOwnerGone } from '../../src/core/locks/processOwner'
import { createGitProcess, type GitProcess } from '../../src/host/git'
import { NativeGitService, type NativeGitOperation } from '../../src/runtime/panel/git/service'
import {
  acquireRepositoryLock,
  isSealIntact,
  sealOf,
} from '../../src/runtime/panel/git/transaction'
import {
  GIT_TRANSACTION_LOCK_FILE,
  GIT_TRANSACTION_LOCK_POLL_MS,
  GIT_TRANSACTION_LOCK_REFRESH_MS,
  GIT_TRANSACTION_LOCK_STALE_MS,
} from '../../src/shared/constants'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'
import {
  fakeRuntimeGitDeps,
  isolateGitEnvironment,
  TEST_GIT_IDENTITY,
} from './helpers/github/fakes'

const POLL_GRACE_MS = 400

beforeEach(() => {
  isolateGitEnvironment()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** git for the fixtures, with the test's own identity and no user configuration. */
function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...TEST_GIT_IDENTITY, GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
  })
}

/** A repository with one commit, under a fresh scratch folder. */
function scratchRepository(): { readonly base: string; readonly dir: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'm123-native-pipeline-'))
  const dir = path.join(base, 'repo')
  mkdirSync(dir)
  fixtureGit(dir, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(dir, 'base.txt'), 'base\n')
  fixtureGit(dir, 'add', 'base.txt')
  fixtureGit(dir, 'commit', '-q', '-m', 'Base')
  return { base, dir }
}

/** The repository pushed to a bare origin, one commit ahead of it. */
function aheadOfOrigin(): { readonly base: string; readonly dir: string; readonly origin: string } {
  const scratch = scratchRepository()
  const origin = path.join(scratch.base, 'origin.git')
  fixtureGit(scratch.base, 'init', '-q', '--bare', origin)
  fixtureGit(scratch.dir, 'remote', 'add', 'origin', origin)
  fixtureGit(scratch.dir, 'push', '-q', '-u', 'origin', 'main')
  writeFileSync(path.join(scratch.dir, 'ahead.txt'), 'ahead\n')
  fixtureGit(scratch.dir, 'add', 'ahead.txt')
  fixtureGit(scratch.dir, 'commit', '-q', '-m', 'Ahead')
  return { ...scratch, origin }
}

function realRunner(): GitProcess {
  return createGitProcess({
    platform: process.platform,
    env: process.env,
    fileExists: existsSync,
    spawn,
  })
}

function serviceFor(dir: string, overrides: Partial<RuntimeGitDeps> = {}): NativeGitService {
  return new NativeGitService(fakeRuntimeGitDeps(dir, overrides).deps, { run: realRunner() })
}

function lastSubject(dir: string): string {
  return fixtureGit(dir, 'log', '-1', '--format=%s').trim()
}

function filesOf(dir: string, revision: string): string[] {
  return fixtureGit(dir, 'show', '--name-only', '--format=', revision)
    .split('\n')
    .filter((line) => line !== '')
    .toSorted((left, right) => left.localeCompare(right))
}

/** A wait that ends by the lock, or by an abort another check reads. */
function never(): void {
  // Nothing to recheck here.
}

/** The lock in `dir` is taken (its holder is gone), held, and given back. */
async function expectTakenOver(dir: string): Promise<void> {
  const lock = await acquireRepositoryLock(dir, new AbortController().signal, never)
  expect(lock.isHeldSync()).toBe(true)
  await lock.release()
}

describe('the repository transaction lock', () => {
  it.each([false, true])(
    'RVM123G4C: rechecks an overlapping failed sample after renewal (fenced: %s)',
    async (fenced) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'm123-renewal-sample-'))
      const reached = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const acquire = fileLeases.acquireFileLease
      let renewing: Promise<boolean> | undefined
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      vi.spyOn(fileLeases, 'acquireFileLease').mockImplementation(async (...args) => {
        const lease = await acquire(...args)
        const renew = lease.renew
        vi.spyOn(lease, 'renew').mockImplementation(
          () =>
            (renewing = (async () => {
              const isRenewed = await renew()
              reached.resolve(undefined)
              await resume.promise
              if (fenced)
                writeFileSync(
                  path.join(`${args[0]}.fences`, String(lease.fence + 1).padStart(16, '0')),
                  '',
                )
              return isRenewed
            })()),
        )
        return lease
      })
      const lock = await acquireRepositoryLock(dir, new AbortController().signal, never)
      try {
        await vi.advanceTimersByTimeAsync(GIT_TRANSACTION_LOCK_REFRESH_MS)
        await reached.promise
        vi.spyOn(nodeLeasePort, 'readFileSync').mockImplementationOnce(() => {
          throw new Error('transient sample failure')
        })
        expect(lock.isHeldSync()).toBe(false)
        expect(vi.getTimerCount()).toBe(1)
        resume.resolve(undefined)
        expect(await renewing).toBe(true)
        await vi.advanceTimersByTimeAsync(0)
        expect(vi.getTimerCount()).toBe(fenced ? 0 : 1)
        expect(lock.isHeldSync()).toBe(!fenced)
      } finally {
        resume.resolve(undefined)
        await lock.release()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('waits while another holder has it, and takes it once released', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-'))
    try {
      const first = await acquireRepositoryLock(dir, new AbortController().signal, never)
      let isSecondHeld = false
      const takeSecond = async (): Promise<Awaited<ReturnType<typeof acquireRepositoryLock>>> => {
        const lock = await acquireRepositoryLock(dir, new AbortController().signal, never)
        isSecondHeld = true
        return lock
      }
      const second = takeSecond()
      await wait(POLL_GRACE_MS)
      expect(isSecondHeld).toBe(false)
      expect(first.isHeldSync()).toBe(true)
      await first.release()
      const taken = await second
      expect(taken.isHeldSync()).toBe(true)
      expect(first.isHeldSync()).toBe(false)
      await taken.release()
      expect(existsSync(path.join(dir, GIT_TRANSACTION_LOCK_FILE))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('P2: a removed lock is lost, never re-made, and a newcomer takes the next fence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-removed-'))
    try {
      const holder = await acquireRepositoryLock(dir, new AbortController().signal, never)
      const file = path.join(dir, GIT_TRANSACTION_LOCK_FILE)
      // A hook of the holder's running Git removes the file. Fencing
      // prevents later dispatch; it cannot stop that already-running child.
      rmSync(file)
      expect(holder.isHeldSync()).toBe(false)
      const taken = await acquireRepositoryLock(dir, new AbortController().signal, never)
      const successor = readFileSync(file)
      expect(taken.isHeldSync()).toBe(true)
      await holder.release()
      expect(readFileSync(file)).toEqual(successor)
      expect(taken.isHeldSync()).toBe(true)
      await taken.release()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renews each third of the lease and drains a renewal before releasing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-renew-'))
    const file = path.join(dir, GIT_TRANSACTION_LOCK_FILE)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    const acquire = fileLeases.acquireFileLease
    let primitive: fileLeases.FileLease | undefined
    vi.spyOn(fileLeases, 'acquireFileLease').mockImplementation(async (...args) => {
      primitive = await acquire(...args)
      return primitive
    })
    const lock = await acquireRepositoryLock(dir, new AbortController().signal, never)
    const resumed = Promise.withResolvers<undefined>()
    try {
      if (primitive === undefined) {
        throw new Error('the repository must acquire LOCKLIB')
      }
      const renew = vi.spyOn(primitive, 'renew')
      // Repeated renewal carries the hold beyond its initial 30 s lease.
      for (let turn = 1; turn <= 4; turn += 1) {
        elapsed += GIT_TRANSACTION_LOCK_REFRESH_MS
        await vi.advanceTimersByTimeAsync(GIT_TRANSACTION_LOCK_REFRESH_MS)
        expect(renew).toHaveBeenCalledTimes(turn)
        const result = renew.mock.results.at(-1)
        expect(await result?.value).toBe(true)
        expect(lock.isHeldSync()).toBe(true)
      }
      // Release must stop the timer and wait for an already-open rewrite,
      // so it retires the renewed instance rather than leaving it behind.
      const rewriting = Promise.withResolvers<undefined>()
      const rewrite = nodeLeasePort.rewriteOwn
      vi.spyOn(nodeLeasePort, 'rewriteOwn').mockImplementation(async (...args) => {
        rewriting.resolve(undefined)
        await resumed.promise
        return await rewrite(...args)
      })
      elapsed += GIT_TRANSACTION_LOCK_REFRESH_MS
      await vi.advanceTimersByTimeAsync(GIT_TRANSACTION_LOCK_REFRESH_MS)
      await rewriting.promise
      let isReleased = false
      const release = async (): Promise<void> => {
        await lock.release()
        isReleased = true
      }
      const releasing = release()
      await wait(10)
      expect(isReleased).toBe(false)
      expect(lock.isHeldSync()).toBe(false)
      resumed.resolve(undefined)
      await releasing
      expect(existsSync(file)).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      resumed.resolve(undefined)
      await lock.release()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takes over a lock whose holder on this machine has ended', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-dead-'))
    try {
      const child = spawn(process.execPath, ['-e', ''])
      const pid = child.pid
      await new Promise((resolve) => child.once('exit', resolve))
      writeFileSync(
        path.join(dir, GIT_TRANSACTION_LOCK_FILE),
        JSON.stringify({
          owner: { host: hostname(), pid, processStart: 1 },
          id: 'gone',
          acquiredAt: Date.now(),
          leaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
        }),
      )
      await expectTakenOver(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takes over a lock gone silent past the stale time, and waits on a fresh one until Cancel', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-stale-'))
    const file = path.join(dir, GIT_TRANSACTION_LOCK_FILE)
    try {
      let elapsed = 0
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
      writeFileSync(
        file,
        JSON.stringify({
          owner: { host: 'elsewhere.invalid', pid: 1, processStart: 1 },
          id: 'far',
          acquiredAt: Date.now(),
          leaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
        }),
      )
      const stop = new AbortController()
      const waiting = acquireRepositoryLock(dir, stop.signal, () => {
        if (stop.signal.aborted) {
          throw new Error('closed')
        }
      })
      await wait(POLL_GRACE_MS)
      stop.abort()
      await expect(waiting).rejects.toThrow('closed')
      expect(readFileSync(file, 'utf8')).toContain('elsewhere.invalid')
      // The unchanged instance has been watched for its whole monotonic lease.
      elapsed = GIT_TRANSACTION_LOCK_STALE_MS + GIT_TRANSACTION_LOCK_POLL_MS
      await expectTakenOver(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('knows when its lock was taken from it, and never removes another holder’s', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-lost-'))
    const file = path.join(dir, GIT_TRANSACTION_LOCK_FILE)
    try {
      const lock = await acquireRepositoryLock(dir, new AbortController().signal, never)
      writeFileSync(
        file,
        JSON.stringify({
          owner: await currentProcessOwner(),
          id: 'other',
          acquiredAt: Date.now(),
          leaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
        }),
      )
      expect(lock.isHeldSync()).toBe(false)
      await lock.release()
      expect(readFileSync(file, 'utf8')).toContain('other')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the seal', () => {
  it('breaks on a rewritten, created or removed file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-seal-'))
    try {
      const kept = path.join(dir, 'kept')
      const missing = path.join(dir, 'missing')
      writeFileSync(kept, 'one')
      const seal = sealOf([kept, missing])
      expect(isSealIntact(seal)).toBe(true)
      // git writes through a lock file and a rename.
      writeFileSync(`${kept}.lock`, 'two')
      renameSync(`${kept}.lock`, kept)
      expect(isSealIntact(seal)).toBe(false)
      const created = sealOf([kept, missing])
      writeFileSync(missing, 'now')
      expect(isSealIntact(created)).toBe(false)
      const removed = sealOf([missing])
      rmSync(missing)
      expect(isSealIntact(removed)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the pipeline', () => {
  it.each(['memory', 'filesystem'])(
    'RVM123G4C: dispatches a commit during its own renewal (%s)',
    async (kind) => {
      const scratch = scratchRepository()
      const file = path.join(scratch.dir, '.git', GIT_TRANSACTION_LOCK_FILE)
      const rewritten = Promise.withResolvers<boolean>()
      const resume = Promise.withResolvers<undefined>()
      const rewrite = nodeLeasePort.rewriteOwn
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      vi.spyOn(performance, 'now').mockReturnValue(GIT_TRANSACTION_LOCK_REFRESH_MS)
      vi.spyOn(nodeLeasePort, 'rewriteOwn').mockImplementation(async (target, isOwn, content) => {
        let isWritten: boolean
        if (kind === 'memory') {
          isWritten = isOwn(await nodeLeasePort.lstat(target), await nodeLeasePort.readFile(target))
          const read = nodeLeasePort.readFile
          const readSync = nodeLeasePort.readFileSync
          const bytes = Buffer.from(content)
          vi.spyOn(nodeLeasePort, 'readFile').mockImplementation((name) =>
            name === file ? Promise.resolve(bytes) : read(name),
          )
          vi.spyOn(nodeLeasePort, 'readFileSync').mockImplementation((name) =>
            name === file ? bytes : readSync(name),
          )
        } else {
          isWritten = await rewrite(target, isOwn, content)
        }
        rewritten.resolve(isWritten)
        await resume.promise
        if (kind === 'memory') writeFileSync(target, content) // Persist for native retirement.
        return isWritten
      })
      try {
        writeFileSync(path.join(scratch.dir, 'a.txt'), 'confirmed\n')
        fixtureGit(scratch.dir, 'add', 'a.txt')
        const service = serviceFor(scratch.dir, {
          admitWorkspaceCommand: async (start) => {
            await vi.advanceTimersByTimeAsync(GIT_TRANSACTION_LOCK_REFRESH_MS)
            try {
              expect(await rewritten.promise).toBe(true)
              const result = await start()
              expect(lastSubject(scratch.dir)).toBe('Renewal overlap')
              return result
            } finally {
              resume.resolve(undefined)
            }
          },
        })
        await service.commit('Renewal overlap', false)
        expect(existsSync(file)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        resume.resolve(undefined)
        rmSync(scratch.base, { recursive: true, force: true })
      }
    },
  )

  it('R2: refuses a push whose destination changed while it waited for admission', async () => {
    const scratch = aheadOfOrigin()
    const unapproved = path.join(scratch.base, 'unapproved.git')
    try {
      fixtureGit(scratch.base, 'init', '-q', '--bare', unapproved)
      const service = serviceFor(scratch.dir, {
        admitWorkspaceCommand: async (start) => {
          // The plan was confirmed; the destination moves during the wait.
          fixtureGit(scratch.dir, 'config', 'remote.origin.pushurl', unapproved)
          return await start()
        },
      })
      const plan = await service.planPush()
      if (!plan.ok) {
        throw new Error('the scratch repository must be ahead')
      }
      await expect(service.push(plan)).rejects.toThrow('changed')
      expect(fixtureGit(unapproved, 'for-each-ref').trim()).toBe('')
      expect(fixtureGit(scratch.origin, 'rev-list', '--count', 'main').trim()).toBe('1')
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('P3: shows the pushInsteadOf destination, pushes there, and refuses once the rewrite changes', async () => {
    const scratch = aheadOfOrigin()
    const rewritten = path.join(scratch.base, 'rewritten.git')
    const rule = `url.${rewritten}.pushInsteadOf`
    try {
      fixtureGit(scratch.base, 'init', '-q', '--bare', rewritten)
      fixtureGit(scratch.dir, 'config', rule, scratch.origin)
      // The rewrite goes away while the confirmed push waits for admission:
      // git would now push to the origin, which nobody confirmed.
      const unbound = serviceFor(scratch.dir, {
        admitWorkspaceCommand: async (start) => {
          fixtureGit(scratch.dir, 'config', '--unset', rule)
          return await start()
        },
      })
      const confirmed = await unbound.planPush()
      if (!confirmed.ok) {
        throw new Error('the scratch repository must be ahead')
      }
      // The raw configuration still names the origin; git pushes elsewhere.
      expect(confirmed.pushUrls).toEqual([rewritten])
      await expect(unbound.push(confirmed)).rejects.toThrow('changed')
      expect(fixtureGit(scratch.origin, 'rev-list', '--count', 'main').trim()).toBe('1')
      expect(fixtureGit(rewritten, 'for-each-ref').trim()).toBe('')
      // With the rewrite in place, the confirmed push lands where it was shown.
      fixtureGit(scratch.dir, 'config', rule, scratch.origin)
      const service = serviceFor(scratch.dir)
      const plan = await service.planPush()
      if (!plan.ok) {
        throw new Error('the scratch repository must still be ahead')
      }
      await service.push(plan)
      expect(fixtureGit(rewritten, 'rev-parse', 'main').trim()).toBe(
        fixtureGit(scratch.dir, 'rev-parse', 'main').trim(),
      )
      expect(fixtureGit(scratch.origin, 'rev-list', '--count', 'main').trim()).toBe('1')
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('P2: a hook removing the lock cannot let its running push reclaim or release a successor', async () => {
    const scratch = aheadOfOrigin()
    const started = path.join(scratch.base, 'hook-started')
    const released = path.join(scratch.base, 'hook-released')
    let pushing: Promise<PromiseSettledResult<void>[]> | undefined
    let successor: Awaited<ReturnType<typeof acquireRepositoryLock>> | undefined
    try {
      const lockFile = path.join(scratch.dir, '.git', GIT_TRANSACTION_LOCK_FILE)
      const slashed = (file: string): string => file.replaceAll('\\', '/')
      // Shell builtins for the wait: Windows hooks need no `sleep`.
      writeFileSync(
        path.join(scratch.dir, '.git', 'hooks', 'pre-push'),
        [
          '#!/bin/sh',
          `rm -f "${slashed(lockFile)}"`,
          `: > "${slashed(started)}"`,
          `while [ ! -f "${slashed(released)}" ]; do :; done`,
          '',
        ].join('\n'),
        { mode: 0o755 },
      )
      const pusher = serviceFor(scratch.dir)
      const plan = await pusher.planPush()
      if (!plan.ok) {
        throw new Error('the scratch repository must be ahead')
      }
      pushing = Promise.allSettled([pusher.push(plan)])
      while (!existsSync(started)) {
        await wait(10)
      }
      successor = await acquireRepositoryLock(
        path.join(scratch.dir, '.git'),
        new AbortController().signal,
        never,
      )
      const note = readFileSync(lockFile)
      expect(successor.isHeldSync()).toBe(true)
      writeFileSync(released, '')
      const [pushed] = await pushing
      expect(pushed?.status).toBe('fulfilled')
      // The already-running child finishes, but its holder cannot remove B.
      expect(readFileSync(lockFile)).toEqual(note)
      expect(successor.isHeldSync()).toBe(true)
    } finally {
      writeFileSync(released, '')
      await pushing
      await successor?.release()
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('R9: refuses a staged-only commit whose staged bytes changed while it waited for admission', async () => {
    const scratch = scratchRepository()
    try {
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'confirmed\n')
      fixtureGit(scratch.dir, 'add', 'a.txt')
      const service = serviceFor(scratch.dir, {
        admitWorkspaceCommand: async (start) => {
          writeFileSync(path.join(scratch.dir, 'a.txt'), 'unconfirmed\n')
          fixtureGit(scratch.dir, 'add', 'a.txt')
          return await start()
        },
      })
      const { stamp } = await service.formStatus()
      await expect(service.commit('Confirmed bytes', false, stamp)).rejects.toThrow('changed')
      expect(lastSubject(scratch.dir)).toBe('Base')
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('refuses at the spawn a transaction whose lock was taken from it', async () => {
    const scratch = scratchRepository()
    try {
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'a\n')
      fixtureGit(scratch.dir, 'add', 'a.txt')
      const service = serviceFor(scratch.dir, {
        admitWorkspaceCommand: async (start) => {
          // Another holder's instance: no newcomer settle grace period.
          const lockFile = path.join(scratch.dir, '.git', GIT_TRANSACTION_LOCK_FILE)
          writeFileSync(
            lockFile,
            JSON.stringify({
              owner: await currentProcessOwner(),
              id: 'taken',
              acquiredAt: Date.now(),
              leaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
            }),
          )
          return await start()
        },
      })
      await expect(service.commit('Lock lost', false)).rejects.toThrow('changed')
      expect(lastSubject(scratch.dir)).toBe('Base')
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('RVM123G4: a resumed old holder never reclaims a refreshed successor or authorizes a spawn', async () => {
    const scratch = scratchRepository()
    const commonDir = path.join(scratch.dir, '.git')
    const file = path.join(commonDir, GIT_TRANSACTION_LOCK_FILE)
    // Pause only the old holder's renewal timer; Git and real file I/O keep
    // running. Each process's monotonic clock advances with the schedule.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    let successor: fileLeases.FileLease | undefined
    let refreshed: Buffer | undefined
    try {
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'a\n')
      fixtureGit(scratch.dir, 'add', 'a.txt')
      const service = serviceFor(scratch.dir, {
        admitWorkspaceCommand: async (start) => {
          // A's hook removed its lock while A's event loop was paused. B
          // acquired, settled, and later refreshed; A resumes 10 ms later.
          rmSync(file)
          successor = await fileLeases.acquireFileLease(file, {
            port: nodeLeasePort,
            now: Date.now,
            monotonic: () => elapsed,
            sleep: wait,
            owner: await currentProcessOwner(),
            isOwnerGone: isProcessOwnerGone,
            leaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
            honoredLeaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
            unreadableMs: GIT_TRANSACTION_LOCK_STALE_MS,
            timeoutMs: GIT_TRANSACTION_LOCK_STALE_MS,
            pollMs: GIT_TRANSACTION_LOCK_POLL_MS,
            watches: new Map(),
          })
          elapsed = GIT_TRANSACTION_LOCK_REFRESH_MS + 1000
          expect(await successor.renew()).toBe(true)
          refreshed = readFileSync(file)
          elapsed += 10
          await vi.advanceTimersByTimeAsync(GIT_TRANSACTION_LOCK_REFRESH_MS)
          return await start()
        },
      })
      await expect(service.commit('Old holder resumed', false)).rejects.toThrow('changed')
      // Includes the old holder's renewal and release: neither rewrites B.
      expect(readFileSync(file)).toEqual(refreshed)
      expect(successor?.isHeldSync()).toBe(true)
      expect(lastSubject(scratch.dir)).toBe('Base')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await successor?.release()
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('R6: never binds a replacement installed right after the service was made', async () => {
    const scratch = scratchRepository()
    try {
      const service = serviceFor(scratch.dir)
      // Before any await: the approved folder moves, another repository takes its name.
      renameSync(scratch.dir, path.join(scratch.base, 'approved-moved'))
      mkdirSync(scratch.dir)
      fixtureGit(scratch.dir, 'init', '-q', '-b', 'main')
      writeFileSync(path.join(scratch.dir, 'impostor.txt'), 'impostor\n')
      await expect(service.commit('Into the impostor', true)).rejects.toThrow('changed')
      expect(() => fixtureGit(scratch.dir, 'rev-parse', 'HEAD')).toThrow()
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('R7: a waiter cancelled behind a running commit never lets the next one start beside it', async () => {
    const scratch = scratchRepository()
    try {
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'a\n')
      fixtureGit(scratch.dir, 'add', 'a.txt')
      const events: string[] = []
      const releaseA = Promise.withResolvers<undefined>()
      const admitted = (name: string): RuntimeGitDeps['admitWorkspaceCommand'] => {
        return async (start) => {
          events.push(`${name} admitted`)
          if (name === 'A') {
            await releaseA.promise
          }
          const result = await start()
          events.push(`${name} done`)
          return result
        }
      }
      const a = serviceFor(scratch.dir, { admitWorkspaceCommand: admitted('A') })
      const b = serviceFor(scratch.dir, { admitWorkspaceCommand: admitted('B') })
      const c = serviceFor(scratch.dir, { admitWorkspaceCommand: admitted('C') })
      const committingA = a.commit('Only staged A', false)
      while (!events.includes('A admitted')) {
        await wait(10)
      }
      const stopB = new AbortController()
      const operationB: NativeGitOperation = { signal: stopB.signal }
      const committingB = b.commit('Cancelled B', false, undefined, operationB)
      await wait(POLL_GRACE_MS)
      stopB.abort()
      await expect(committingB).rejects.toThrow('closed')
      writeFileSync(path.join(scratch.dir, 'c.txt'), 'c\n')
      const committingC = c.commit('Everything C', true)
      await wait(POLL_GRACE_MS)
      expect(events).toEqual(['A admitted'])
      releaseA.resolve(undefined)
      await committingA
      await committingC
      expect(events).toEqual(['A admitted', 'A done', 'C admitted', 'C done'])
      expect(filesOf(scratch.dir, 'HEAD~1')).toEqual(['a.txt'])
      expect(filesOf(scratch.dir, 'HEAD')).toEqual(['c.txt'])
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })

  it('R8: two independent copies of the service (two processes) take turns on one repository', async () => {
    const scratch = scratchRepository()
    try {
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'a\n')
      fixtureGit(scratch.dir, 'add', 'a.txt')
      writeFileSync(path.join(scratch.dir, 'b.txt'), 'b\n')
      // Each import is a separate module instance: no shared in-memory state.
      vi.resetModules()
      const first = await import('../../src/runtime/panel/git/service')
      vi.resetModules()
      const second = await import('../../src/runtime/panel/git/service')
      expect(first.NativeGitService).not.toBe(second.NativeGitService)
      const atCommit = Promise.withResolvers<undefined>()
      const releaseA = Promise.withResolvers<undefined>()
      const real = realRunner()
      const pausing: GitProcess = async (args, options) => {
        if (args[0] === 'commit') {
          atCommit.resolve(undefined)
          await releaseA.promise
        }
        return await real(args, options)
      }
      const a = new first.NativeGitService(fakeRuntimeGitDeps(scratch.dir).deps, { run: pausing })
      const b = new second.NativeGitService(fakeRuntimeGitDeps(scratch.dir).deps, {
        run: realRunner(),
      })
      const committingA = a.commit('Only staged A', false)
      await atCommit.promise
      const committingB = b.commit('Everything B', true)
      await wait(POLL_GRACE_MS)
      releaseA.resolve(undefined)
      await committingA
      await committingB
      expect(fixtureGit(scratch.dir, 'log', '-2', '--format=%s').trim().split('\n')).toEqual([
        'Everything B',
        'Only staged A',
      ])
      expect(filesOf(scratch.dir, 'HEAD~1')).toEqual(['a.txt'])
      expect(filesOf(scratch.dir, 'HEAD')).toEqual(['b.txt'])
    } finally {
      rmSync(scratch.base, { recursive: true, force: true })
    }
  })
})
