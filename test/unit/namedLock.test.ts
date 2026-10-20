// The named lock's local-failure rule: a bind the OS refuses reads as
// unavailable with the OS code and the failure on cause, never as a held lock.
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NamedLockError, withNamedLock } from '../../src/runtime/namedLock'
import { captureFailure } from './helpers/captureFailure'

const NAMES = { pipe: 'test-unavailable-pipe', folder: 'test-unavailable', file: 'test.lock' }

// Socket paths must fit sockaddr_un (103 bytes on macOS): the lane's TMPDIR
// does not, so these cases bind under the worktree's temp/ by relative path,
// as the race tests do.
async function scratch(prefix: string): Promise<string> {
  await mkdir(path.join('temp', 'named-lock-test'), { recursive: true })
  return await mkdtemp(path.join('temp', 'named-lock-test', prefix))
}

function held(): Promise<string> {
  return Promise.resolve('held')
}

describe.runIf(process.platform !== 'win32')('namedLock local failures', () => {
  it('reports a refused bind as unavailable with its OS code and cause', async () => {
    const base = await scratch('refused-')
    // Past sockaddr_un: the real bind fails and the lock reports it. The
    // folder itself is private on purpose: the lock refuses a
    // group-or-other-readable folder before it binds, and a plain mkdir
    // follows the process umask (0755 under the hosted runners' 022), so
    // the mode is pinned and the bind is what fails everywhere.
    const directory = path.join(base, 'x'.repeat(200))
    await mkdir(directory, { recursive: true })
    await chmod(directory, 0o700)
    try {
      const failure = await captureFailure(() =>
        withNamedLock(held, NAMES, { directory, timeoutMs: 1000 }),
      )
      expect(failure).toBeInstanceOf(NamedLockError)
      if (!(failure instanceof NamedLockError)) throw new Error('unreachable')
      expect(failure.kind).toBe('unavailable')
      expect(typeof failure.reason).toBe('string')
      expect(failure.cause).toBeInstanceOf(Error)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('reports an unreadable foreign entry as unavailable with its OS code and cause', async () => {
    const base = await scratch('foreign-')
    // A foreign listener the lock cannot read is a local failure, never a
    // held lock: the OS code reads as the reason and the failure itself
    // stays on cause. The listener is real and bound; only its mode refuses
    // the connect, which fails EACCES on every platform (an unbound file
    // instead reads as a dead entry, and the lock is rightly had).
    const foreign = path.join(base, 'test.lock.foreign')
    const listener = createServer(() => undefined)
    await new Promise<void>((resolve) => listener.listen(foreign, resolve))
    await chmod(foreign, 0o000)
    try {
      const failure = await captureFailure(() =>
        withNamedLock(held, NAMES, { directory: base, timeoutMs: 1000 }),
      )
      expect(failure).toBeInstanceOf(NamedLockError)
      if (!(failure instanceof NamedLockError)) throw new Error('unreachable')
      expect(failure.kind).toBe('unavailable')
      expect(failure.reason).toBe('EACCES')
      expect(failure.cause).toBeInstanceOf(Error)
    } finally {
      listener.close()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('holds and releases a free lock', async () => {
    const base = await scratch('free-')
    try {
      await expect(withNamedLock(held, NAMES, { directory: base, timeoutMs: 5000 })).resolves.toBe(
        'held',
      )
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
