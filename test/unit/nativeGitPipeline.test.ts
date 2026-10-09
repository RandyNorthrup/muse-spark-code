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
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitProcess, type GitProcess } from '../../src/host/git'
import { NativeGitService, type NativeGitOperation } from '../../src/runtime/panel/git/service'
import {
  acquireRepositoryLock,
  isSealIntact,
  sealOf,
} from '../../src/runtime/panel/git/transaction'
import {
  GIT_TRANSACTION_LOCK_FILE,
  GIT_TRANSACTION_LOCK_SETTLE_MS,
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
  expect(lock.isHeld()).toBe(true)
  lock.release()
}

describe('the repository transaction lock', () => {
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
      expect(first.isHeld()).toBe(true)
      first.release()
      const taken = await second
      expect(taken.isHeld()).toBe(true)
      expect(first.isHeld()).toBe(false)
      taken.release()
      expect(existsSync(path.join(dir, GIT_TRANSACTION_LOCK_FILE))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('P2: keeps a lock its holder still holds when the file is removed: a newcomer waits', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-lock-removed-'))
    try {
      const holder = await acquireRepositoryLock(dir, new AbortController().signal, never)
      // A hook of the holder's running git removes the file.
      rmSync(path.join(dir, GIT_TRANSACTION_LOCK_FILE))
      let isTaken = false
      const take = async (): Promise<Awaited<ReturnType<typeof acquireRepositoryLock>>> => {
        const lock = await acquireRepositoryLock(dir, new AbortController().signal, never)
        isTaken = true
        return lock
      }
      const taking = take()
      await wait(2 * POLL_GRACE_MS)
      expect(isTaken).toBe(false)
      expect(holder.isHeld()).toBe(true)
      holder.release()
      const taken = await taking
      expect(taken.isHeld()).toBe(true)
      taken.release()
    } finally {
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
        JSON.stringify({ host: hostname(), pid, nonce: 'gone' }),
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
      writeFileSync(file, JSON.stringify({ host: 'elsewhere.invalid', pid: 1, nonce: 'far' }))
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
      // Silent past the stale time: its holder is gone.
      const past = new Date(Date.now() - 2 * GIT_TRANSACTION_LOCK_STALE_MS)
      utimesSync(file, past, past)
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
      writeFileSync(file, JSON.stringify({ host: hostname(), pid: process.pid, nonce: 'other' }))
      expect(lock.isHeld()).toBe(false)
      lock.release()
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

  it('P2: a hook that removes the lock while its push runs lets no commit start beside it', async () => {
    const scratch = aheadOfOrigin()
    const started = path.join(scratch.base, 'hook-started')
    const released = path.join(scratch.base, 'hook-released')
    const settled: Promise<unknown>[] = []
    try {
      const lockFile = path.join(scratch.dir, '.git', GIT_TRANSACTION_LOCK_FILE)
      const slashed = (file: string): string => file.replaceAll('\\', '/')
      // The hook removes the lock, then waits for the test (shell builtins
      // only: a Windows hook's PATH need not carry `sleep`).
      writeFileSync(
        path.join(scratch.dir, '.git', 'hooks', 'pre-push'),
        [
          '#!/bin/sh',
          `: > "${slashed(started)}"`,
          `rm -f "${slashed(lockFile)}"`,
          `while [ ! -f "${slashed(released)}" ]; do :; done`,
          '',
        ].join('\n'),
        { mode: 0o755 },
      )
      const events: string[] = []
      const pusher = serviceFor(scratch.dir)
      const plan = await pusher.planPush()
      if (!plan.ok) {
        throw new Error('the scratch repository must be ahead')
      }
      const pushAndNote = async (): Promise<void> => {
        await pusher.push(plan)
        events.push('push done')
      }
      const pushing = Promise.allSettled([pushAndNote()])
      settled.push(pushing)
      while (!existsSync(started)) {
        await wait(10)
      }
      writeFileSync(path.join(scratch.dir, 'beside.txt'), 'beside\n')
      const committer = serviceFor(scratch.dir, {
        admitWorkspaceCommand: async (start) => {
          events.push('commit admitted')
          return await start()
        },
      })
      const committing = Promise.allSettled([committer.commit('Beside the push', true)])
      settled.push(committing)
      // Several settle times while the push's hook runs with its lock file gone.
      await wait(2 * POLL_GRACE_MS)
      expect(events).toEqual([])
      writeFileSync(released, '')
      const [pushed] = await pushing
      const [committed] = await committing
      expect(pushed.status).toBe('fulfilled')
      expect(committed.status).toBe('fulfilled')
      expect(events).toEqual(['push done', 'commit admitted'])
    } finally {
      // The hook never outlives the test: it is released, and both settle.
      writeFileSync(released, '')
      await Promise.all(settled)
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
          // Another holder's lock that already outlived its settle time.
          const lockFile = path.join(scratch.dir, '.git', GIT_TRANSACTION_LOCK_FILE)
          writeFileSync(
            lockFile,
            JSON.stringify({ host: hostname(), pid: process.pid, nonce: 'taken' }),
          )
          const settled = new Date(Date.now() - 2 * GIT_TRANSACTION_LOCK_SETTLE_MS)
          utimesSync(lockFile, settled, settled)
          return await start()
        },
      })
      await expect(service.commit('Lock lost', false)).rejects.toThrow('changed')
      expect(lastSubject(scratch.dir)).toBe('Base')
    } finally {
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
