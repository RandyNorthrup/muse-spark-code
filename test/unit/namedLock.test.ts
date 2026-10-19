// The named lock's local-failure rule: a bind the OS refuses reads as
// unavailable with the OS code and the failure on cause, never as a held lock.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NamedLockError, withNamedLock } from '../../src/runtime/namedLock'

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
    // Past sockaddr_un: the real bind fails and the lock reports it.
    const directory = path.join(base, 'x'.repeat(200))
    await mkdir(directory, { recursive: true })
    try {
      let failure: unknown
      try {
        await withNamedLock(held, NAMES, { directory, timeoutMs: 1000 })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(NamedLockError)
      if (!(failure instanceof NamedLockError)) throw new Error('unreachable')
      expect(failure.kind).toBe('unavailable')
      expect(typeof failure.reason).toBe('string')
      expect(failure.cause).toBeInstanceOf(Error)
    } finally {
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
