// One native Git transaction per repository (M123 lane G, PLAN.md D104;
// RVM123G2 R1, R2, R7, R8, R9): the lock that serializes the service's
// mutations across every editor and runtime process, and the seal that
// carries a revalidated plan to the moment its git starts.
//
// - LOCKLIB holds the file in git's common directory: exclusive create,
//   a process-birth-bound owner, a monotonic lease and an increasing fence.
//   Renewal runs every third of the lease, only on the owned instance. A
//   removed, expired or taken lock is lost, never re-made. Takeover uses
//   LOCKLIB's watched, proven retirement; no newcomer settle wait.
// - The synchronous dispatch gate checks the instance, lease and highest
//   fence beside the seal, with no await before spawning. Fencing refuses
//   later dispatch by a lost holder; it cannot stop an already-running git.
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

import { type BigIntStats } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  fileReadIdentity,
  lstatIdentitySync,
  statIdentitySync,
} from '../../../core/fs/fileIdentity'
import { acquireFileLease, type FileLeaseEnv } from '../../../core/locks/fileLease'
import { nodeLeasePort } from '../../../core/locks/nodeLeasePort'
import { currentProcessOwner, isProcessOwnerGone } from '../../../core/locks/processOwner'
import { isMissingPath } from '../../../host/canonicalPath'
import {
  GIT_TRANSACTION_LOCK_FILE,
  GIT_TRANSACTION_LOCK_POLL_MS,
  GIT_TRANSACTION_LOCK_REFRESH_MS,
  GIT_TRANSACTION_LOCK_STALE_MS,
} from '../../../shared/constants'

/** A repository lease, checked synchronously at every Git dispatch. */
export interface RepositoryLock {
  readonly isHeldSync: () => boolean
  /** Stops renewal, waits for a renewal in flight, then retires only this instance. */
  readonly release: () => Promise<void>
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

/** Takes LOCKLIB's repository lease, waiting until acquired or the operation closes. */
export async function acquireRepositoryLock(
  commonDir: string,
  signal: AbortSignal,
  check: () => void,
): Promise<RepositoryLock> {
  check()
  const owner = await currentProcessOwner()
  check()
  const env: FileLeaseEnv = {
    port: nodeLeasePort,
    now: Date.now,
    monotonic: () => performance.now(),
    sleep: async (ms) => {
      check()
      await pause(ms, signal)
      check()
    },
    owner,
    isOwnerGone: async (other) => {
      const isGone = await isProcessOwnerGone(other)
      check()
      return isGone
    },
    leaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
    honoredLeaseMs: GIT_TRANSACTION_LOCK_STALE_MS,
    unreadableMs: GIT_TRANSACTION_LOCK_STALE_MS,
    // Preserve the service's wait-until-Cancel contract; the lease itself
    // and takeover observation remain bounded on the monotonic clock.
    timeoutMs: Infinity,
    pollMs: GIT_TRANSACTION_LOCK_POLL_MS,
  }
  const lease = await acquireFileLease(path.join(commonDir, GIT_TRANSACTION_LOCK_FILE), env)
  try {
    check()
  } catch (error: unknown) {
    await lease.release()
    throw error
  }
  let isReleased = false
  let isLost = false
  let renewing: Promise<void> | undefined
  const lose = (): void => {
    isLost = true
    clearInterval(timer)
  }
  const renew = async (): Promise<void> => {
    try {
      if (!(await lease.renew()) || !lease.isHeldSync()) {
        lose()
      }
    } catch {
      lose()
    } finally {
      renewing = undefined
    }
  }
  const timer = setInterval(() => {
    renewing ??= renew()
  }, GIT_TRANSACTION_LOCK_REFRESH_MS)
  timer.unref()
  return {
    isHeldSync: () => {
      if (isReleased || isLost) {
        return false
      }
      if (!lease.isHeldSync()) {
        // A failed sample may overlap our own rewrite. Refuse this check,
        // then let renewal's settled ownership check decide permanent loss.
        if (renewing === undefined) lose()
        return false
      }
      return true
    },
    release: async () => {
      isReleased = true
      clearInterval(timer)
      await renewing
      await lease.release()
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
