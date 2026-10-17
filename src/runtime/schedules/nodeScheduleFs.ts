// Shared by editor hosts and the runtime; no vscode or credential dependency.
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  mkdir,
  open,
  readFile,
  readdir,
  link,
  unlink,
  lstat,
  rename,
  rmdir,
} from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  CHECKPOINT_STORAGE_MODE,
  REPORT_STORAGE_FILE_MODE,
  SCHEDULE_FS_RETRY_ATTEMPTS,
  SCHEDULE_FS_RETRY_BACKOFF_MS,
  SCHEDULE_LEASE_HEARTBEAT_MS,
  SCHEDULE_LEASE_EXPIRES_MS,
  SCHEDULE_LEASE_POLL_MS,
  SCHEDULE_LEASE_RELEASE_TIMEOUT_MS,
  SCHEDULE_QUEUE_COALESCE_MS,
  MILLISECONDS_PER_SECOND,
  SCHEDULE_JOURNAL_MAX_OPS,
} from '../../shared/constants'
import {
  newestScheduleSlots,
  parseScheduleStoredJson,
  type ScheduleFsPort,
  type ScheduleLeaseGuard,
  type ScheduleLockOptions,
} from '../../core/schedules/journal'
import {
  scheduleStorageHash,
  isScheduleProcessAlive,
  type ScheduleQueuePort,
} from '../../core/schedules/store'

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work()
    } catch (error: unknown) {
      if (
        attempt + 1 >= SCHEDULE_FS_RETRY_ATTEMPTS ||
        ['EPERM', 'EBUSY', 'EACCES'].every((code) => !hasCode(error, code))
      )
        throw error
      await scheduleFsOperation('disk.retryWait', () =>
        delay(SCHEDULE_FS_RETRY_BACKOFF_MS * (attempt + 1)),
      )
    }
  }
}
const leaseSchema = z.strictObject({
  pid: z.int().check(z.gte(1)),
  start: z.number().check(z.gte(0)),
  token: z.uuid(),
  heartbeat: z.number().check(z.gte(0)),
  heartbeatSequence: z.optional(z.int().check(z.gte(0))),
  fencingToken: z.optional(z.int().check(z.gte(0))),
})
const processStart = Date.now() - process.uptime() * MILLISECONDS_PER_SECOND

/** All filesystem awaits, including nested writes, inherit exactly one stop rule. */
const leaseOperations = new AsyncLocalStorage<() => void>()
export async function scheduleFsOperation<T>(
  _operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const check = leaseOperations.getStore()
  check?.()
  try {
    return await work()
  } finally {
    // This check and the caller's following decision share the settlement turn.
    check?.()
  }
}

async function scheduleLeaseCleanup<T>(work: () => Promise<T>): Promise<T> {
  const deadlineMs = Date.now() + SCHEDULE_LEASE_RELEASE_TIMEOUT_MS
  return await leaseOperations.run(() => {
    if (Date.now() >= deadlineMs) throw scheduleQueueFailure('scheduleLeaseHeartbeatFailed')
  }, work)
}

/**
 * Proof that one fence candidate belongs to its acquisition. The single
 * factory below issues a handle only for a publication this acquisition
 * proved it owns (direct exclusive success, or an interrupted publication
 * whose stored bytes carry the acquisition's unique token). Release accepts
 * only an issued, unreleased handle for its own candidate: a structural
 * literal can never be issued (the constructor is private and issuance is
 * recorded in a module-private set no other module can reach), so a bare
 * candidate path can never release.
 */
const issuedScheduleFences = new WeakSet<object>()
export class OwnedScheduleFence {
  static issue(candidate: string): OwnedScheduleFence {
    const handle = new OwnedScheduleFence(candidate)
    issuedScheduleFences.add(handle)
    return handle
  }
  private constructor(readonly candidate: string) {}
}

/**
 * The only publisher of fence release markers. A handle that was never
 * issued, was already released, or belongs to another candidate is refused
 * with the ownership word; a future edit that publishes a release marker
 * directly bypasses proof and fails the forge regression test by design.
 */
export async function releaseScheduleFence(
  fs: ScheduleFsPort,
  handle: OwnedScheduleFence,
  candidate: string,
): Promise<void> {
  if (handle.candidate !== candidate || !issuedScheduleFences.has(handle))
    throw scheduleQueueFailure('scheduleQueueOwnershipLost')
  issuedScheduleFences.delete(handle)
  await scheduleFsOperation('cleanup.release', () => fs.publish(`${candidate}.released`, ''))
}

/**
 * Folder fsync exists only where the platform honours it. Production and the
 * lifecycle matrix share this predicate, so the matrix runs exactly the rows
 * that can occur here: Windows runs the rows that exist there, and no row is
 * silently lost elsewhere.
 */
export function canRunScheduleFsOperation(operation: string): boolean {
  const requiresFolderSync = operation === 'disk.openFolder' || operation === 'disk.syncFolder'
  return process.platform !== 'win32' || !requiresFolderSync
}

/**
 * A pulse without a fencing token is a previous-version heartbeat: absence is
 * legacy and compatible. A present token that contradicts the header stays invalid.
 */
function hasFencingContradiction(
  pulseFencingToken: number | undefined,
  headerFencingToken: number | undefined,
): boolean {
  // Absence fills from the header, so a missing pulse token never contradicts.
  return (pulseFencingToken ?? headerFencingToken) !== headerFencingToken
}

/** Queue errors are a closed vocabulary; the reporting table covers this union. */
export type ScheduleQueueFailure =
  | 'scheduleLeaseBusy'
  | 'scheduleQueueOwnershipLost'
  | 'scheduleQueueLeaseInvalid'
  | 'scheduleLeaseHeartbeatFailed'
  | 'scheduleStoragePathRefused'
  | 'scheduleStorageLinkRefused'

function scheduleQueueFailure(word: ScheduleQueueFailure): Error {
  return new Error(word)
}

/** The newest authoritative fence header on a port, read under the stop rule. */
async function readScheduleLeaseHead(
  fs: ScheduleFsPort,
  file: string,
  folder: string,
  parseLease: (content: string) => z.infer<typeof leaseSchema>,
) {
  const folders = await scheduleFsOperation('lease.segments', () => fs.names(folder))
  for (const segment of newestScheduleSlots(folders, /^\d+$/)) {
    const entries = await scheduleFsOperation('lease.entries', () =>
      fs.names(`${folder}/${segment}`),
    )
    const name = newestScheduleSlots(entries, /^\d+\.json$/)[0]
    if (name === undefined) continue
    const header = `${folder}/${segment}/${name}`
    const content = await scheduleFsOperation('lease.header', () => fs.read(header))
    if (content === undefined) throw scheduleQueueFailure('scheduleQueueOwnershipLost')
    const lease = parseLease(content)
    if (
      name !== `${String(lease.fencingToken)}.json` ||
      Number(segment) !== Math.floor((lease.fencingToken ?? -1) / SCHEDULE_JOURNAL_MAX_OPS)
    )
      throw scheduleQueueFailure('scheduleQueueLeaseInvalid')
    return { content, lease, header }
  }
  const content = await scheduleFsOperation('lease.legacy', () => fs.read(file))
  return content === undefined
    ? undefined
    : {
        content,
        lease: parseLease(content),
        header: file,
      }
}

/** The production port and its byte-preserving twin run the same lifecycle. */
export function createScheduleLeaseLock(fs: ScheduleFsPort): ScheduleFsPort['lock'] {
  return async (key, work, options?: ScheduleLockOptions) => {
    const file = `leases/${scheduleStorageHash(key)}.json`
    const folder = `leaseFences/${scheduleStorageHash(key)}`
    const rawDeadline = options?.deadlineMs
    const deadlineMs =
      rawDeadline !== undefined && !Number.isNaN(rawDeadline) ? rawDeadline : undefined
    let isAcquired = false
    const check = () => {
      if (!isAcquired && deadlineMs !== undefined && Date.now() >= deadlineMs)
        throw scheduleQueueFailure('scheduleLeaseBusy')
      options?.signal?.throwIfAborted()
    }
    return await leaseOperations.run(check, async () => {
      const owner = {
        pid: process.pid,
        start: processStart,
        token: randomUUID(),
        heartbeat: Date.now(),
        heartbeatSequence: 0,
      }
      // Parsing is deterministic in the content, so one acquisition parses
      // each distinct fence document once no matter how often the head,
      // the pulse, the guards and the cleanup re-read it. The map dies with
      // the acquisition; a changed document always parses again.
      const parsedLeases = new Map<string, z.infer<typeof leaseSchema>>()
      const parseLease = (content: string) => {
        const cached = parsedLeases.get(content)
        if (cached !== undefined) return cached
        const lease = leaseSchema.parse(parseScheduleStoredJson(content))
        parsedLeases.set(content, lease)
        return lease
      }
      const observations = new Map<string, { content: string; atMs: number }>()
      const expired = (content: string, heartbeatMs: number) => {
        const now = performance.now()
        const observed = observations.get('owner')
        if (observed?.content !== content) observations.set('owner', { content, atMs: now })
        return (
          Date.now() - heartbeatMs > SCHEDULE_LEASE_EXPIRES_MS ||
          (observed?.content === content && now - observed.atMs > SCHEDULE_LEASE_EXPIRES_MS)
        )
      }
      let fencingToken = 0
      // Only a candidate this acquisition published owns a release marker. A
      // candidate can become authoritative even if publication settles after a
      // stop or rejects after linking; its ownership is proved during cleanup.
      // The handle below is issued only at the two proved-publication points.
      let header: OwnedScheduleFence | undefined
      // The last candidate whose publication outcome a stop obscured. It
      // becomes a handle only through the token claim in cleanup; a cleanly
      // lost publication clears it and owns nothing.
      let attempted: string | undefined
      let heartbeat = Promise.resolve()
      let timer: ReturnType<typeof setInterval> | undefined
      let heartbeatError: Error | undefined
      let isCompleted = false
      try {
        for (;;) {
          check()
          const previous = await readScheduleLeaseHead(fs, file, folder, parseLease)
          if (previous !== undefined) {
            const pulse =
              (await scheduleFsOperation('lease.pulse', () =>
                fs.read(`${file}.${previous.lease.token}.heartbeat`),
              )) ?? previous.content
            const refreshed = parseLease(pulse)
            // A token-specific pulse cannot change an immutable owner. Only the
            // heartbeat and its sequence may evolve; fencing identity may not.
            // A pulse without a fencing token is a previous-version heartbeat:
            // absence is legacy and compatible, so release and expiry are
            // judged as before. A present token that contradicts the header
            // stays invalid.
            if (
              refreshed.token !== previous.lease.token ||
              refreshed.pid !== previous.lease.pid ||
              refreshed.start !== previous.lease.start ||
              hasFencingContradiction(refreshed.fencingToken, previous.lease.fencingToken)
            )
              throw scheduleQueueFailure('scheduleQueueLeaseInvalid')
            const released = await scheduleFsOperation('lease.released', () =>
              fs.read(`${previous.header}.released`),
            )
            if (
              released === undefined &&
              isScheduleProcessAlive(previous.lease.pid) &&
              !expired(pulse, refreshed.heartbeat)
            ) {
              const remaining =
                deadlineMs === undefined ? SCHEDULE_LEASE_POLL_MS : deadlineMs - Date.now()
              await scheduleFsOperation('lease.poll', () =>
                delay(Math.max(0, Math.min(SCHEDULE_LEASE_POLL_MS, remaining))),
              )
              continue
            }
            fencingToken = (previous.lease.fencingToken ?? -1) + 1
          }
          owner.heartbeat = Date.now()
          const candidate = `${folder}/${String(Math.floor(fencingToken / SCHEDULE_JOURNAL_MAX_OPS))}/${String(fencingToken)}.json`
          attempted = candidate
          const isPublished = await scheduleFsOperation('lease.fence', () =>
            fs.publish(candidate, JSON.stringify({ ...owner, fencingToken }), () => {
              check()
              return Promise.resolve()
            }),
          )
          attempted = undefined
          // A lost publication owns nothing: keep no handle and loop, so
          // cleanup cannot release the winner's fence.
          if (!isPublished) continue
          header = OwnedScheduleFence.issue(candidate)
          break
        }
        const guard: ScheduleLeaseGuard = Object.assign(
          async () => {
            check()
            if (heartbeatError !== undefined) throw heartbeatError
            const current = await readScheduleLeaseHead(fs, file, folder, parseLease)
            if (current?.lease.token !== owner.token || current.lease.fencingToken !== fencingToken)
              throw scheduleQueueFailure('scheduleQueueOwnershipLost')
          },
          { fencingToken },
        )
        try {
          await scheduleFsOperation('lease.hint', () =>
            fs.replace(file, JSON.stringify({ ...owner, fencingToken }), guard),
          )
        } catch {
          // The legacy hint is debt, but stop/ownership failures still bind.
          await guard()
        }
        const refresh = async () => {
          const previous = heartbeat
          try {
            await previous
            await guard()
            owner.heartbeat = Date.now()
            owner.heartbeatSequence += 1
            await scheduleFsOperation('lease.heartbeat', () =>
              fs.replace(
                `${file}.${owner.token}.heartbeat`,
                JSON.stringify({ ...owner, fencingToken }),
                guard,
              ),
            )
          } catch (error: unknown) {
            heartbeatError =
              error instanceof Error ? error : scheduleQueueFailure('scheduleLeaseHeartbeatFailed')
          }
        }
        timer = setInterval(() => {
          heartbeat = refresh()
        }, SCHEDULE_LEASE_HEARTBEAT_MS).unref()
        const result = await scheduleFsOperation('lease.work', () => {
          // The wrapper's pre-check and this handoff are one synchronous step.
          isAcquired = true
          return work(guard)
        })
        // Completion owns the heartbeat drain too: a pulse still in flight
        // must settle before the final stop/ownership verdict is decided.
        clearInterval(timer)
        timer = undefined
        await heartbeat
        await guard()
        // The guard just proved live ownership with a fresh heartbeat: no
        // successor can exist until the release marker below is published, so
        // only this completed path may retire the hint it wrote.
        isCompleted = true
        return result
      } finally {
        if (timer !== undefined) clearInterval(timer)
        await heartbeat
        const owned = header
        const interrupted = owned === undefined ? attempted : undefined
        if (owned !== undefined || interrupted !== undefined) {
          // This independent scope owns cleanup BEFORE publication begins.
          // Caller cancellation cannot suppress the immutable release marker.
          await scheduleLeaseCleanup(async () => {
            // Ownership proof: the success path holds it by construction, and
            // an interrupted publication earns it only when the stored bytes
            // carry this acquisition's unique token. Anything else — a lost
            // publication, a winner's fence, unreadable bytes — owns nothing
            // and releases nothing.
            let handle = owned
            let candidate = owned?.candidate
            if (handle === undefined && interrupted !== undefined) {
              const content = await scheduleFsOperation('cleanup.header', () =>
                fs.read(interrupted),
              )
              if (content !== undefined) {
                try {
                  if (parseLease(content).token === owner.token) {
                    handle = OwnedScheduleFence.issue(interrupted)
                    candidate = interrupted
                  }
                } catch {
                  // Bytes this acquisition did not write are never its fence.
                }
              }
            }
            if (handle === undefined || candidate === undefined) return
            // The hint is retired before the release marker is published, and
            // only on the completed path whose fresh heartbeat proves no
            // successor can exist yet. An aborted or interrupted acquisition
            // leaves its hint to expiry (a successor overwrites it) rather
            // than risk removing a hint that is no longer its own. The hint's
            // own bytes name the token they belong to, so a successor's hint
            // is always spared even here.
            try {
              if (isCompleted) {
                const hintBytes = await scheduleFsOperation('cleanup.hintRead', () => fs.read(file))
                let isHintOurs = false
                if (hintBytes !== undefined) {
                  try {
                    isHintOurs = parseLease(hintBytes).token === owner.token
                  } catch {
                    isHintOurs = false
                  }
                }
                if (isHintOurs) await scheduleFsOperation('cleanup.hint', () => fs.remove(file))
              }
              await scheduleFsOperation('cleanup.pulse', () =>
                fs.remove(`${file}.${owner.token}.heartbeat`),
              )
            } catch {
              // Hint/pulse retirement is debt; the release is already authoritative.
            }
            await releaseScheduleFence(fs, handle, candidate)
          })
        }
      }
    })
  }
}

export function createNodeScheduleFs(directory: string): ScheduleFsPort {
  const root = path.resolve(directory)
  const cleanup = new Set<string>()
  const resolve = (relative: string) => {
    const file = path.resolve(root, relative)
    const suffix = path.relative(root, file)
    if (suffix === '' || suffix.startsWith('..') || path.isAbsolute(suffix))
      throw scheduleQueueFailure('scheduleStoragePathRefused')
    return file
  }
  const checkParents = async (file: string) => {
    let parent = path.dirname(file)
    while (parent.length >= root.length) {
      const info = await scheduleFsOperation('disk.parentStat', () => lstat(parent))
      if (!info.isDirectory() || info.isSymbolicLink())
        throw scheduleQueueFailure('scheduleStorageLinkRefused')
      if (parent === root) break
      parent = path.dirname(parent)
    }
  }
  const prepare = async (file: string) => {
    const parent = path.dirname(file)
    const volume = path.parse(parent).root
    let current = volume
    for (const part of path.relative(volume, parent).split(path.sep)) {
      current = path.join(current, part)
      try {
        await scheduleFsOperation('disk.mkdir', () =>
          mkdir(current, { mode: CHECKPOINT_STORAGE_MODE }),
        )
      } catch (error: unknown) {
        if (!hasCode(error, 'EEXIST')) throw error
      }
      const info = await scheduleFsOperation('disk.prepareStat', () => lstat(current))
      if (current.length >= root.length && (!info.isDirectory() || info.isSymbolicLink()))
        throw scheduleQueueFailure('scheduleStorageLinkRefused')
    }
  }
  const retireTemporary = async (file: string) => {
    try {
      await retry(async () => {
        await scheduleFsOperation('disk.unlink', () => unlink(file))
      })
      cleanup.delete(file)
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) cleanup.delete(file)
      else cleanup.add(file)
    }
  }
  const write = async (
    relative: string,
    content: string,
    isExclusive: boolean,
    guard?: () => Promise<void>,
  ) => {
    const file = resolve(relative)
    await prepare(file)
    await checkParents(file)
    try {
      const info = await scheduleFsOperation('disk.fileStat', () => lstat(file))
      if (info.isSymbolicLink()) throw scheduleQueueFailure('scheduleStorageLinkRefused')
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error
    }
    for (const owed of cleanup) await retireTemporary(owed)
    const temporary = `${file}.${randomUUID()}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      try {
        await scheduleFsOperation('disk.openTemporary', async () => {
          handle = await open(temporary, 'wx', REPORT_STORAGE_FILE_MODE)
        })
        const opened = handle
        if (opened === undefined) throw scheduleQueueFailure('scheduleLeaseHeartbeatFailed')
        await scheduleFsOperation('disk.write', () => opened.writeFile(content, 'utf8'))
        await scheduleFsOperation('disk.sync', () => opened.sync())
      } finally {
        const opened = handle
        if (opened !== undefined)
          await scheduleLeaseCleanup(() =>
            scheduleFsOperation('cleanup.close', () => opened.close()),
          )
      }
      const isPublished = await retry(async () => {
        await guard?.()
        try {
          if (isExclusive) await scheduleFsOperation('disk.link', () => link(temporary, file))
          else await scheduleFsOperation('disk.rename', () => rename(temporary, file))
        } catch (error: unknown) {
          // Our unique temporary bytes identify a publication already committed.
          if (isExclusive && hasCode(error, 'EEXIST')) {
            try {
              const [destination, staged] = await Promise.all([
                scheduleFsOperation('disk.destinationIdentity', () => lstatIdentity(file)),
                scheduleFsOperation('disk.temporaryIdentity', () => lstatIdentity(temporary)),
              ])
              return sameFile(destination, staged)
            } catch (identityError: unknown) {
              // A competing lease release may remove the destination between
              // EEXIST and lstat. No publication of ours remains to acquire.
              if (hasCode(identityError, 'ENOENT')) return false
              throw identityError
            }
          }
          if ((await scheduleFsOperation('disk.confirm', () => fs.read(relative))) === content)
            return true
          throw error
        }
        if (canRunScheduleFsOperation('disk.openFolder')) {
          let folder: Awaited<ReturnType<typeof open>> | undefined
          try {
            await scheduleFsOperation('disk.openFolder', async () => {
              folder = await open(path.dirname(file), 'r')
            })
            const opened = folder
            if (opened === undefined) throw scheduleQueueFailure('scheduleLeaseHeartbeatFailed')
            await scheduleFsOperation('disk.syncFolder', () => opened.sync())
          } finally {
            const opened = folder
            if (opened !== undefined)
              await scheduleLeaseCleanup(() =>
                scheduleFsOperation('cleanup.closeFolder', () => opened.close()),
              )
          }
        }
        return true
      })
      return { isPublished }
    } finally {
      // Cleanup cannot turn a successful hard-link publication into failure.
      await scheduleLeaseCleanup(() => retireTemporary(temporary))
    }
  }
  const fs: ScheduleFsPort = {
    async read(relative) {
      const file = resolve(relative)
      try {
        return await retry(async () => {
          await checkParents(file)
          const info = await scheduleFsOperation('disk.fileStat', () => lstat(file))
          if (info.isSymbolicLink()) throw scheduleQueueFailure('scheduleStorageLinkRefused')
          return await scheduleFsOperation('disk.read', () => readFile(file, 'utf8'))
        })
      } catch (error: unknown) {
        if (hasCode(error, 'ENOENT')) return
        throw error
      }
    },
    async names(relative) {
      const folder = resolve(relative)
      try {
        await checkParents(path.join(folder, 'entry'))
        return await scheduleFsOperation('disk.names', () => readdir(folder))
      } catch (error: unknown) {
        if (hasCode(error, 'ENOENT')) return []
        throw error
      }
    },
    async publish(relative, content, guard) {
      const result = await write(relative, content, true, guard)
      return result.isPublished
    },
    async replace(relative, content, guard) {
      await write(relative, content, false, guard)
    },
    async remove(relative, canRetryTransient = true) {
      const file = resolve(relative)
      try {
        await checkParents(file)
        const info = await scheduleFsOperation('disk.fileStat', () => lstat(file))
        if (info.isSymbolicLink()) throw scheduleQueueFailure('scheduleStorageLinkRefused')
        const remove = async () => {
          if (info.isDirectory()) await scheduleFsOperation('disk.rmdir', () => rmdir(file))
          else await scheduleFsOperation('disk.unlink', () => unlink(file))
        }
        if (canRetryTransient) await retry(remove)
        else await remove()
      } catch (error: unknown) {
        if (!hasCode(error, 'ENOENT')) throw error
      }
    },
    lock: (key, work, options) => createScheduleLeaseLock(fs)(key, work, options),
  }
  return fs
}

export function createNodeScheduleQueue(directory: string): ScheduleQueuePort {
  const fs = createNodeScheduleFs(directory)
  return {
    async serialize(targetKey, work) {
      // Let concurrent singleton batches publish before the ordered queue pop.
      await delay(SCHEDULE_QUEUE_COALESCE_MS)
      await scheduleFsOperation('queue.lock', () =>
        fs.lock(`target:${targetKey}`, async () => {
          await work()
        }),
      )
    },
  }
}
