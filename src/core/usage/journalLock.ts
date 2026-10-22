// The cross-process journal lock both usage journals share, waiting its
// turn instead of failing a momentarily held call. A leaf on purpose:
// the resource journal's bundle carries this file, so it reaches nothing
// that prices. Its lock shapes mirror `UsageFs`/`UsageLock`
// structurally rather than importing them.
import {
  RESOURCE_JOURNAL_WRITE_LOCK_ATTEMPTS,
  RESOURCE_JOURNAL_WRITE_LOCK_WAIT_MS,
} from '../../shared/constants'

/** What a waited acquire returns: `UsageLock`'s shape, structurally. */
export interface JournalLock {
  readonly token: string
  readonly generation: number
  isHeld(): Promise<boolean>
  release(): Promise<void>
}

/** The lock half of the journal filesystem: the rest is not needed here. */
export interface JournalLockFs {
  acquireLock(file: string, staleMs: number): Promise<JournalLock | undefined>
}

/**
A cross-process journal lock, waiting its turn: a momentarily held lock
(another window's snapshot or retention) waits instead of failing the
call. Attempts and spacing are the one lock discipline both journals
share (RESOURCE_JOURNAL_WRITE_LOCK_*); a lock still held after them
returns undefined and the caller names its own failure.
*/
export async function acquireJournalLock(
  fs: JournalLockFs,
  file: string,
  staleMs: number,
  sleep?: (ms: number) => Promise<void>,
): Promise<JournalLock | undefined> {
  const wait =
    sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))
  for (let attempt = 0; attempt < RESOURCE_JOURNAL_WRITE_LOCK_ATTEMPTS; attempt++) {
    const lock = await fs.acquireLock(file, staleMs)
    if (lock !== undefined) return lock
    await wait(RESOURCE_JOURNAL_WRITE_LOCK_WAIT_MS)
  }
  return undefined
}
