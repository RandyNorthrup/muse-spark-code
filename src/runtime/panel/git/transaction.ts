// One native Git transaction per repository (M123 lane G, PLAN.md D104;
// RVM123G2 R1, R2, R7, R8, R9): the lock that serializes the service's
// mutations across every editor and runtime process, and the seal that
// carries a revalidated plan to the moment its git starts.
//
// - The lock is a file in git's common directory, created exclusively
//   (`wx`). It names its holder (machine, process, a random nonce), and the
//   holder refreshes its time while it holds it. A waiter polls, and takes a
//   lock over only when its holder is gone: on the same machine, its process
//   ended; anywhere, silent for GIT_TRANSACTION_LOCK_STALE_MS. A takeover
//   moves the file aside first and keeps it only if it is the one judged
//   stale, so a fresh lock is put back. The holder checks at each spawn that
//   the file is still its own, so a lock lost anyway refuses its payload.
// - The seal is the state git reads for a payload (HEAD, the index, packed
//   and loose refs, the reftable list, the configuration files), sampled
//   synchronously by identity, size and times BEFORE the plan is
//   revalidated, and compared again synchronously at the last line before
//   the payload process starts, after every wait. A change anywhere in
//   between refuses the payload.
// - Both detect and fail closed. Neither defeats a same-user process that
//   rewrites a file and restores its times, or swaps directories between a
//   check and the operating system acting on a path: D104's threat boundary
//   leaves that process out, since it already holds the user's authority.

import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { link, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { fileReadIdentity, lstatIdentitySync } from '../../../core/fs/fileIdentity'
import { isMissingPath } from '../../../host/canonicalPath'
import {
  GIT_TRANSACTION_LOCK_FILE,
  GIT_TRANSACTION_LOCK_POLL_MS,
  GIT_TRANSACTION_LOCK_REFRESH_MS,
  GIT_TRANSACTION_LOCK_STALE_MS,
} from '../../../shared/constants'

const ALREADY_EXISTS = 'EEXIST'
const NO_SUCH_PROCESS = 'ESRCH'

/** Who holds a lock: written once by its holder, read by waiters. */
const lockHolderSchema = z.object({
  host: z.string(),
  pid: z.number().check(z.int(), z.positive()),
  nonce: z.string(),
})

/** A held repository lock. */
export interface RepositoryLock {
  /** Whether the lock file is still this holder's: checked at each spawn. */
  readonly isHeld: () => boolean
  /** Ends the hold; removes the file only while it is still this holder's. */
  readonly release: () => void
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM: it exists, under another user.
    return errorCode(error) !== NO_SUCH_PROCESS
  }
}

/** Whether a lock with this text and age has no live holder. */
function isStaleLock(text: string, ageMs: number): boolean {
  if (ageMs > GIT_TRANSACTION_LOCK_STALE_MS) {
    return true
  }
  let holder: z.infer<typeof lockHolderSchema>
  try {
    holder = lockHolderSchema.parse(JSON.parse(text))
  } catch {
    // Still being written, or not ours to read: only its age can free it.
    return false
  }
  return holder.host === hostname() && holder.pid !== process.pid && !isProcessAlive(holder.pid)
}

/** The lock's text and age, or undefined when it is gone. */
async function heldLock(file: string): Promise<{ text: string; ageMs: number } | undefined> {
  try {
    const [text, stats] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    return { text, ageMs: Date.now() - stats.mtimeMs }
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

/**
 * Moves a stale lock aside and drops it, unless what moved is not the one
 * judged (another waiter's fresh lock): that one goes back, if its name is
 * still free. If it is not, its holder's spawn check refuses.
 */
async function takeOver(file: string, judged: string, nonce: string): Promise<void> {
  const aside = `${file}.${nonce}`
  try {
    await rename(file, aside)
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return
    }
    throw error
  }
  try {
    const moved = await readFile(aside, 'utf8')
    if (moved !== judged) {
      await link(aside, file)
    }
  } catch {
    // The name was taken again meanwhile: the moved holder's spawn check refuses.
  } finally {
    await rm(aside, { force: true })
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts (the caller's check then throws). */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Takes the repository's transaction lock in `commonDir`, waiting while
 * another holder (this process or any other) has it. `check` runs after
 * every await: Cancel, a lost owner or trust ends the wait.
 */
export async function acquireRepositoryLock(
  commonDir: string,
  signal: AbortSignal,
  check: () => void,
): Promise<RepositoryLock> {
  const file = path.join(commonDir, GIT_TRANSACTION_LOCK_FILE)
  const nonce = randomUUID()
  const text = JSON.stringify({ host: hostname(), pid: process.pid, nonce })
  for (;;) {
    check()
    try {
      await writeFile(file, text, { flag: 'wx' })
      break
    } catch (error: unknown) {
      if (errorCode(error) !== ALREADY_EXISTS) {
        throw error
      }
    }
    const held = await heldLock(file)
    check()
    if (held === undefined) {
      continue
    }
    if (isStaleLock(held.text, held.ageMs)) {
      await takeOver(file, held.text, nonce)
      continue
    }
    await pause(GIT_TRANSACTION_LOCK_POLL_MS, signal)
  }
  let isReleased = false
  const isHeld = (): boolean => {
    if (isReleased) {
      return false
    }
    try {
      return readFileSync(file, 'utf8') === text
    } catch {
      return false
    }
  }
  const touch = async (): Promise<void> => {
    if (!isHeld()) {
      return
    }
    const now = new Date()
    try {
      await utimes(file, now, now)
    } catch {
      // Gone or taken: the spawn check reads that, not this refresh.
    }
  }
  const refresh = setInterval(() => {
    void touch()
  }, GIT_TRANSACTION_LOCK_REFRESH_MS)
  refresh.unref()
  return {
    isHeld,
    release: () => {
      clearInterval(refresh)
      if (isHeld()) {
        try {
          unlinkSync(file)
        } catch {
          // Already gone: nothing to release.
        }
      }
      isReleased = true
    },
  }
}

/** The state a payload's git reads, as sampled before its plan was revalidated. */
export interface StateSeal {
  readonly files: readonly string[]
  readonly marks: readonly string[]
}

/** One file's identity, size, times and mode; its absence is a mark too. */
function markOf(file: string): string {
  try {
    const stats = lstatIdentitySync(file)
    return JSON.stringify([
      fileReadIdentity(stats),
      stats.ctimeNs.toString(),
      stats.mode.toString(),
    ])
  } catch (error: unknown) {
    return isMissingPath(error) ? 'absent' : 'unreadable'
  }
}

/** Samples `files` now, synchronously. */
export function sealOf(files: readonly string[]): StateSeal {
  const unique = [...new Set(files)]
  return { files: unique, marks: unique.map((file) => markOf(file)) }
}

/** Whether every sealed file is still as sampled (synchronous: the spawn's last line). */
export function isSealIntact(seal: StateSeal): boolean {
  return seal.files.every((file, index) => markOf(file) === seal.marks[index])
}
