// Shared by editor hosts and the runtime; no vscode or credential dependency.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, link, unlink, lstat } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_STORAGE_MODE,
  REPORT_STORAGE_FILE_MODE,
  SCHEDULE_POLL_INTERVAL_MS,
} from '../../shared/constants'
import {
  createScheduleJournal,
  scheduleStorageHash,
  isScheduleProcessAlive,
  type ScheduleFsPort,
  type ScheduleQueuePort,
} from '../../core/schedules/store'

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export function createNodeScheduleFs(directory: string): ScheduleFsPort {
  const root = path.resolve(directory)
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
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('scheduleStorageLinkRefused')
    }
  }
  return {
    async read(relative) {
      const file = resolve(relative)
      try {
        await checkParents(file)
        const info = await lstat(file)
        if (info.isSymbolicLink()) throw new Error('scheduleStorageLinkRefused')
        return await readFile(file, 'utf8')
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
    async publish(relative, content) {
      const file = resolve(relative)
      await prepare(file)
      await checkParents(file)
      const temporary = `${file}.${randomUUID()}.tmp`
      const handle = await open(temporary, 'wx', REPORT_STORAGE_FILE_MODE)
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        // NTFS and POSIX hard-link publication is exclusive and atomic: readers
        // see the flushed whole file, or ENOENT, never an empty wx placeholder.
        await link(temporary, file)
        if (process.platform !== 'win32') {
          const folder = await open(path.dirname(file), 'r')
          try {
            await folder.sync()
          } finally {
            await folder.close()
          }
        }
        return true
      } catch (error: unknown) {
        if (hasCode(error, 'EEXIST')) return false
        throw error
      } finally {
        await unlink(temporary)
      }
    },
  }
}

const queueSchema = z.strictObject({
  owner: z.optional(z.strictObject({ pid: z.int().check(z.gte(1)), token: z.string() })),
})

export function createNodeScheduleQueue(directory: string): ScheduleQueuePort {
  const fs = createNodeScheduleFs(directory)
  const token = randomUUID()
  return {
    async serialize(targetKey, work) {
      const folder = `queues/${scheduleStorageHash(targetKey)}`
      await fs.publish(`${folder}/ready`, '')
      const journal = createScheduleJournal(fs, folder, (raw) => queueSchema.parse(raw), {})
      let isAcquired = false
      while (!isAcquired) {
        // Subscribe before reading; a release during our CAS cannot be missed.
        const wake = new AbortController()
        const changed = new Promise<void>((resolve) => {
          // Promise.withResolvers is unavailable in VS Code's Node 20 host.
          wake.signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
        })
        const watcher = watch(path.join(directory, folder), () => {
          wake.abort()
        })
        const timer = setTimeout(() => {
          wake.abort()
        }, SCHEDULE_POLL_INTERVAL_MS)
        try {
          const current = await journal.read()
          if (
            current.value.owner === undefined ||
            !isScheduleProcessAlive(current.value.owner.pid)
          ) {
            isAcquired = await journal.replace(current.revision, {
              owner: { pid: process.pid, token },
            })
            if (!isAcquired) continue
          } else await changed
        } finally {
          watcher.close()
          clearTimeout(timer)
        }
      }
      const release = async () => {
        const current = await journal.read()
        if (current.value.owner?.token !== token || !(await journal.replace(current.revision, {})))
          throw new Error('scheduleQueueOwnershipLost')
      }
      try {
        await work()
      } finally {
        await release()
      }
    },
  }
}
