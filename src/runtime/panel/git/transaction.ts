// One native Git transaction per repository (M123 lane G, PLAN.md D104;
// RVM123G2 R1, R2, R7, R8, R9): the lock that serializes the service's
// mutations across every editor and runtime process, and the seal that
// carries a revalidated plan to the moment its git starts.
//
// - The lock is a file in git's common directory, created exclusively
//   (`wx`). It names its holder (machine, process, a random nonce). A
//   waiter polls, and takes a lock over only when its holder is gone: on
//   the same machine, its process ended; anywhere, silent for
//   GIT_TRANSACTION_LOCK_STALE_MS. A takeover moves the file aside first and
//   keeps it only if it is the one judged stale, so a fresh lock is put back.
// - The holder keeps the lock for the whole transaction, every git it runs
//   included (RVM123G3G): every GIT_TRANSACTION_LOCK_WATCH_MS it refreshes
//   its file, and puts its own back when the file is gone (a hook removed
//   it) or a newcomer's is still settling. A newcomer trusts its new file
//   only after GIT_TRANSACTION_LOCK_SETTLE_MS, so it never runs beside a
//   holder that is still alive. A newcomer that outlived the settle time
//   means the lock was lost, and the old holder's spawn check refuses.
// - The seal is the state git reads for a payload (HEAD, the index, packed
//   and loose refs, the reftable list, the configuration files), sampled
//   synchronously by identity, size and times BEFORE the plan is
//   revalidated, and compared again synchronously at the last line before
//   the payload process starts, after every wait. A link is sampled with
//   the file it leads to. A change anywhere in between refuses the payload.
// - Both detect and fail closed. Neither defeats a same-user process that
//   rewrites a file and restores its times, or swaps directories between a
//   check and the operating system acting on a path: D104's threat boundary
//   leaves that process out, since it already holds the user's authority.

import { randomUUID } from 'node:crypto'
import {
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { link, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  fileReadIdentity,
  lstatIdentitySync,
  statIdentitySync,
} from '../../../core/fs/fileIdentity'
import { isMissingPath } from '../../../host/canonicalPath'
import {
  GIT_TRANSACTION_LOCK_FILE,
  GIT_TRANSACTION_LOCK_POLL_MS,
  GIT_TRANSACTION_LOCK_REFRESH_MS,
  GIT_TRANSACTION_LOCK_SETTLE_MS,
  GIT_TRANSACTION_LOCK_STALE_MS,
  GIT_TRANSACTION_LOCK_WATCH_MS,
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

/** Creates the lock file with `text` if no lock exists; false when one does. */
async function isCreated(file: string, text: string): Promise<boolean> {
  try {
    await writeFile(file, text, { flag: 'wx' })
    return true
  } catch (error: unknown) {
    if (errorCode(error) !== ALREADY_EXISTS) {
      throw error
    }
    return false
  }
}

/** Whether the lock file holds exactly `text`, read now. */
function isOwnLock(file: string, text: string): boolean {
  try {
    return readFileSync(file, 'utf8') === text
  } catch {
    return false
  }
}

/**
 * A newcomer's own new file, trusted only once it outlived the settle time:
 * a holder whose file was removed puts its own back within
 * GIT_TRANSACTION_LOCK_WATCH_MS, over a newcomer's (RVM123G3G). A Cancel
 * meanwhile removes the newcomer's file again.
 */
async function isSettled(
  file: string,
  text: string,
  signal: AbortSignal,
  check: () => void,
): Promise<boolean> {
  await pause(GIT_TRANSACTION_LOCK_SETTLE_MS, signal)
  try {
    check()
  } catch (error: unknown) {
    if (isOwnLock(file, text)) {
      unlinkSync(file)
    }
    throw error
  }
  return isOwnLock(file, text)
}

/**
 * The holder's watch while it holds the lock, through every wait and every
 * git it runs (RVM123G3G): its own file is refreshed; a removed file (a
 * hook of the running git) or a newcomer's still settling is replaced by
 * its own at once; a newcomer's file that outlived the settle time means
 * the lock was lost, and every later spawn check refuses.
 */
function keepHolding(file: string, text: string, onLost: () => void): () => void {
  let touchedAt = Date.now()
  const keep = (): void => {
    let found: { readonly text: string; readonly ageMs: number } | undefined
    try {
      found = { text: readFileSync(file, 'utf8'), ageMs: Date.now() - statSync(file).mtimeMs }
    } catch (error: unknown) {
      if (!isMissingPath(error)) {
        throw error
      }
    }
    if (found?.text === text) {
      if (Date.now() - touchedAt >= GIT_TRANSACTION_LOCK_REFRESH_MS) {
        const now = new Date()
        utimesSync(file, now, now)
        touchedAt = now.getTime()
      }
      return
    }
    if (found !== undefined && found.ageMs >= GIT_TRANSACTION_LOCK_SETTLE_MS) {
      clearInterval(watch)
      onLost()
      return
    }
    const ours = `${file}.${randomUUID()}`
    writeFileSync(ours, text)
    renameSync(ours, file)
    touchedAt = Date.now()
  }
  const watch = setInterval(() => {
    try {
      keep()
    } catch {
      // Unreadable or unwritable: the spawn check reads the file itself.
    }
  }, GIT_TRANSACTION_LOCK_WATCH_MS)
  watch.unref()
  return () => {
    clearInterval(watch)
  }
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
    if (await isCreated(file, text)) {
      if (await isSettled(file, text, signal, check)) {
        break
      }
      continue
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
  let isLost = false
  const stopWatching = keepHolding(file, text, () => {
    isLost = true
  })
  return {
    isHeld: () => !isReleased && !isLost && isOwnLock(file, text),
    release: () => {
      stopWatching()
      if (!isReleased && isOwnLock(file, text)) {
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

/** One sample: identity, size, times and mode. */
function sampleOf(stats: BigIntStats): string {
  return JSON.stringify([fileReadIdentity(stats), stats.ctimeNs.toString(), stats.mode.toString()])
}

/** How a sample failed: an absence is a mark too. */
function missingMark(error: unknown): string {
  return isMissingPath(error) ? 'absent' : 'unreadable'
}

/**
 * One file's mark: its own entry, and for a link also the file git reads
 * through it (RVM123G3G: a linked configuration file rewritten behind an
 * unchanged link changes the mark).
 */
function markOf(file: string): string {
  let own: BigIntStats
  try {
    own = lstatIdentitySync(file)
  } catch (error: unknown) {
    return missingMark(error)
  }
  if (!own.isSymbolicLink()) {
    return sampleOf(own)
  }
  let target: string
  try {
    target = sampleOf(statIdentitySync(file))
  } catch (error: unknown) {
    target = missingMark(error)
  }
  return JSON.stringify([sampleOf(own), target])
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
