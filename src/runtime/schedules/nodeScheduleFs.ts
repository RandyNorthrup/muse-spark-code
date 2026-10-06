// Shared by editor hosts and the runtime; no vscode or credential dependency.
import { randomUUID } from 'node:crypto'
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
  SCHEDULE_QUEUE_COALESCE_MS,
  MILLISECONDS_PER_SECOND,
} from '../../shared/constants'
import { parseScheduleStoredJson, type ScheduleFsPort } from '../../core/schedules/journal'
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
      await delay(SCHEDULE_FS_RETRY_BACKOFF_MS * (attempt + 1))
    }
  }
}
const leaseSchema = z.strictObject({
  pid: z.int().check(z.gte(1)),
  start: z.number().check(z.gte(0)),
  token: z.uuid(),
  heartbeat: z.number().check(z.gte(0)),
  heartbeatSequence: z.optional(z.int().check(z.gte(0))),
})
const processStart = Date.now() - process.uptime() * MILLISECONDS_PER_SECOND

export function createNodeScheduleFs(directory: string): ScheduleFsPort {
  const root = path.resolve(directory)
  const cleanup = new Set<string>()
  const resolve = (relative: string) => {
    const file = path.resolve(root, relative)
    const suffix = path.relative(root, file)
    if (suffix === '' || suffix.startsWith('..') || path.isAbsolute(suffix))
      throw new Error('scheduleStoragePathRefused')
    return file
  }
  const checkParents = async (file: string) => {
    let parent = path.dirname(file)
    while (parent.length >= root.length) {
      const info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('scheduleStorageLinkRefused')
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
        await mkdir(current, { mode: CHECKPOINT_STORAGE_MODE })
      } catch (error: unknown) {
        if (!hasCode(error, 'EEXIST')) throw error
      }
      const info = await lstat(current)
      if (current.length >= root.length && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error('scheduleStorageLinkRefused')
    }
  }
  const retireTemporary = async (file: string) => {
    try {
      await retry(async () => {
        await unlink(file)
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
      const info = await lstat(file)
      if (info.isSymbolicLink()) throw new Error('scheduleStorageLinkRefused')
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error
    }
    for (const owed of cleanup) await retireTemporary(owed)
    const temporary = `${file}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', REPORT_STORAGE_FILE_MODE)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      const isPublished = await retry(async () => {
        await guard?.()
        try {
          if (isExclusive) await link(temporary, file)
          else await rename(temporary, file)
        } catch (error: unknown) {
          // Our unique temporary bytes identify a publication already committed.
          if (isExclusive && hasCode(error, 'EEXIST')) {
            try {
              const [destination, staged] = await Promise.all([
                lstatIdentity(file),
                lstatIdentity(temporary),
              ])
              return sameFile(destination, staged)
            } catch (identityError: unknown) {
              // A competing lease release may remove the destination between
              // EEXIST and lstat. No publication of ours remains to acquire.
              if (hasCode(identityError, 'ENOENT')) return false
              throw identityError
            }
          }
          if ((await fs.read(relative)) === content) return true
          throw error
        }
        if (process.platform !== 'win32') {
          const folder = await open(path.dirname(file), 'r')
          try {
            await folder.sync()
          } finally {
            await folder.close()
          }
        }
        return true
      })
      return { isPublished }
    } finally {
      // Cleanup cannot turn a successful hard-link publication into failure.
      await retireTemporary(temporary)
    }
  }
  const fs: ScheduleFsPort = {
    async read(relative) {
      const file = resolve(relative)
      try {
        return await retry(async () => {
          await checkParents(file)
          const info = await lstat(file)
          if (info.isSymbolicLink()) throw new Error('scheduleStorageLinkRefused')
          return await readFile(file, 'utf8')
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
        return await readdir(folder)
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
        const info = await lstat(file)
        if (info.isSymbolicLink()) throw new Error('scheduleStorageLinkRefused')
        const remove = async () => {
          if (info.isDirectory()) await rmdir(file)
          else await unlink(file)
        }
        if (canRetryTransient) await retry(remove)
        else await remove()
      } catch (error: unknown) {
        if (!hasCode(error, 'ENOENT')) throw error
      }
    },
    async lock(key, work) {
      const file = `leases/${scheduleStorageHash(key)}.json`
      const owner = {
        pid: process.pid,
        start: processStart,
        token: randomUUID(),
        heartbeat: Date.now(),
        heartbeatSequence: 0,
      }
      const observations = new Map<string, { content: string; atMs: number }>()
      const expired = (name: string, content: string, heartbeatMs: number) => {
        const now = performance.now()
        const observed = observations.get(name)
        if (observed?.content !== content) observations.set(name, { content, atMs: now })
        return (
          Date.now() - heartbeatMs > SCHEDULE_LEASE_EXPIRES_MS ||
          (observed?.content === content && now - observed.atMs > SCHEDULE_LEASE_EXPIRES_MS)
        )
      }
      for (;;) {
        owner.heartbeat = Date.now()
        if (await fs.publish(file, JSON.stringify(owner))) break
        const content = await fs.read(file)
        if (content === undefined) continue
        const previous = leaseSchema.parse(parseScheduleStoredJson(content))
        if (
          previous.token === owner.token &&
          previous.pid === owner.pid &&
          previous.start === owner.start
        )
          break
        const heartbeatFile = `${file}.${previous.token}.heartbeat`
        const pulse = (await fs.read(heartbeatFile)) ?? content
        const refreshed = leaseSchema.parse(parseScheduleStoredJson(pulse))
        if (
          refreshed.token !== previous.token ||
          refreshed.pid !== previous.pid ||
          refreshed.start !== previous.start
        )
          throw new Error('scheduleQueueOwnershipLost')
        if (!isScheduleProcessAlive(previous.pid) || expired('owner', pulse, refreshed.heartbeat)) {
          // One taker handles an exact owner token. It never removes a renewed
          // or replacement owner; the old owner's guarded writes then fail.
          const takeover = `${file}.${previous.token}.takeover`
          const debt = await fs.read(takeover)
          if (debt !== undefined) {
            const taker = leaseSchema.parse(parseScheduleStoredJson(debt))
            if (!isScheduleProcessAlive(taker.pid) || expired('takeover', debt, taker.heartbeat))
              await fs.remove(takeover)
          }
          if (await fs.publish(takeover, JSON.stringify(owner))) {
            try {
              if (
                (await fs.read(file)) === content &&
                ((await fs.read(heartbeatFile)) ?? content) === pulse
              )
                await fs.remove(file)
            } finally {
              await fs.remove(takeover)
            }
          }
        } else await delay(SCHEDULE_LEASE_POLL_MS)
      }
      const guard = async () => {
        const bytes = await fs.read(file)
        if (
          bytes === undefined ||
          leaseSchema.parse(parseScheduleStoredJson(bytes)).token !== owner.token
        )
          throw new Error('scheduleQueueOwnershipLost')
      }
      let heartbeat = Promise.resolve()
      let heartbeatError: Error | undefined
      const refresh = async () => {
        const previous = heartbeat
        try {
          await previous
          await guard()
          owner.heartbeat = Date.now()
          owner.heartbeatSequence += 1
          // A paused heartbeat rename can only touch its own token's pulse.
          // It cannot replace the new owner's authoritative lease file.
          await fs.replace(`${file}.${owner.token}.heartbeat`, JSON.stringify(owner), guard)
        } catch (error: unknown) {
          heartbeatError =
            error instanceof Error ? error : new Error('scheduleLeaseHeartbeatFailed')
        }
      }
      const timer = setInterval(() => {
        heartbeat = refresh()
      }, SCHEDULE_LEASE_HEARTBEAT_MS).unref()
      try {
        const result = await work(async () => {
          if (heartbeatError !== undefined) throw heartbeatError
          await guard()
        })
        await guard()
        return result
      } finally {
        clearInterval(timer)
        await heartbeat
        // Stop heartbeating even on persistent release failure: another caller
        // repairs the expired lease while this PID remains alive.
        try {
          await guard()
          await fs.remove(file)
          await fs.remove(`${file}.${owner.token}.heartbeat`)
        } catch {
          /* Expiry owns release recovery. */
        }
      }
    },
  }
  return fs
}

export function createNodeScheduleQueue(directory: string): ScheduleQueuePort {
  const fs = createNodeScheduleFs(directory)
  return {
    async serialize(targetKey, work) {
      // Let concurrent singleton batches publish before the ordered queue pop.
      await delay(SCHEDULE_QUEUE_COALESCE_MS)
      await fs.lock(`target:${targetKey}`, async () => {
        await work()
      })
    },
  }
}
