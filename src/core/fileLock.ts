// The repository's one cross-process mutex (PLAN.md D85.2): an atomic
// directory creation retried a bounded number of times, released by removing
// exactly the directory this process created. A lock is never stolen, so a
// holder that pauses mid-acquire keeps its critical section and a contender
// waits; a crashed holder fails its scope closed (the session-budget
// journal's documented decision). No PID files, no liveness probes, no new
// design: every durable store that needs mutual exclusion uses this.
import { mkdir, rmdir } from 'node:fs/promises'
import path from 'node:path'

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

export interface MkdirLockOptions {
  /** Waits between attempts; injected so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  /** Bounded attempts before the scope fails closed. */
  readonly attempts: number
  /** Milliseconds between attempts. */
  readonly waitMs: number
  /** The scope's own failure when attempts run out; a generic error by default. */
  readonly locked?: () => Error
  /** Maps a lock-acquisition failure that is not a held lock; rethrown as-is by default. */
  readonly wrapError?: (error: unknown) => Error
}

/** Holds `lockPath` across `operation`, then releases exactly what was held. */
export async function withMkdirLock<T>(
  lockPath: string,
  options: MkdirLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  if (
    !Number.isSafeInteger(options.attempts) ||
    options.attempts <= 0 ||
    !Number.isSafeInteger(options.waitMs) ||
    options.waitMs < 0
  )
    throw new Error('Invalid lock options')
  await mkdir(path.dirname(lockPath), { recursive: true })
  let hasLock = false
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      await mkdir(lockPath)
      hasLock = true
      break
    } catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') throw options.wrapError?.(error) ?? error
      await options.sleep(options.waitMs)
    }
  }
  if (!hasLock) throw options.locked?.() ?? new Error('Store is locked')
  try {
    return await operation()
  } finally {
    await rmdir(lockPath)
  }
}
