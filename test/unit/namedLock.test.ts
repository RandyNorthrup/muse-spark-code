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
    // A private folder this user cannot write: the lock's own folder rule
    // passes it (no group or other bits), and the kernel refuses to create
    // the socket there (EACCES), whatever Node's socket path handling. A
    // socket path past sockaddr_un is no refusal everywhere: some Node
    // versions bind it anyway.
    const directory = path.join(base, 'locked')
    await mkdir(directory)
    await chmod(directory, 0o500)
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
      await chmod(directory, 0o700)
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
