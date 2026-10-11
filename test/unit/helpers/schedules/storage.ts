import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../../../src/core/schedules/journal'
import type { ScheduleQueuePort } from '../../../../src/core/schedules/store'
import type { ScheduleV2 } from '../../../../src/shared/scheduleV2'
import { scheduleStorageHash } from '../../../../src/core/schedules/store'
import { SCHEDULE_JOURNAL_MAX_OPS } from '../../../../src/shared/constants'

/** Fault-injectable disk with real serialized bytes, shared by production clients. */
export class MemoryScheduleFs implements ScheduleFsPort {
  readonly files = new Map<string, string>()
  readonly tails = new Map<string, Promise<undefined>>()
  readonly faults = new Map<string, number>()
  readonly directories = new Map<string, Set<string>>()
  private put(file: string, content: string): void {
    this.files.set(file, content)
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join('/')
      const entries = this.directories.get(folder) ?? new Set<string>()
      entries.add(parts[index]!)
      this.directories.set(folder, entries)
    }
  }
  fail(operation: string, file: string): void {
    const key = `${operation}:${file}`
    const remaining = this.faults.get(key) ?? 0
    if (remaining <= 0) return
    this.faults.set(key, remaining - 1)
    throw new Error('injected storage failure')
  }
  read(file: string): Promise<string | undefined> {
    this.fail('read', file)
    return Promise.resolve(this.files.get(file))
  }
  names(directory: string): Promise<readonly string[]> {
    return Promise.resolve([...(this.directories.get(directory) ?? [])])
  }
  async publish(file: string, content: string, guard?: () => Promise<void>): Promise<boolean> {
    await guard?.()
    this.fail('publish', file)
    if (this.files.has(file)) return false
    this.put(file, content)
    return true
  }
  async replace(file: string, content: string, guard?: () => Promise<void>): Promise<void> {
    await guard?.()
    this.fail('replace', file)
    this.put(file, content)
  }
  remove(file: string): Promise<void> {
    this.fail('remove', file)
    this.files.delete(file)
    this.directories.delete(file)
    const slash = file.lastIndexOf('/')
    this.directories.get(file.slice(0, slash))?.delete(file.slice(slash + 1))
    return Promise.resolve()
  }
  async lock<T>(key: string, work: (guard: () => Promise<void>) => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve(undefined)
    const next = Promise.withResolvers<undefined>()
    this.tails.set(key, next.promise)
    await previous
    try {
      return await work(() => Promise.resolve())
    } finally {
      next.resolve(undefined)
    }
  }
  bytes(prefix = ''): number {
    return [...this.files]
      .filter(([file]) => file.startsWith(prefix))
      .reduce((total, [, content]) => total + Buffer.byteLength(content), 0)
  }
}

/** The scheduler queue over the fake fs lease, shared by the store tests. */
export function memoryScheduleQueue(fs: MemoryScheduleFs): ScheduleQueuePort {
  return {
    serialize: async (key: string, work: () => Promise<void>) => {
      await delay(0)
      await fs.lock(key, async () => {
        await work()
      })
    },
  }
}

export async function scheduleStateFile(fs: ScheduleFsPort, workspace = 'workspace-1') {
  const pointer = z
    .object({ generation: z.string() })
    .parse(JSON.parse((await fs.read(`${workspace}/index/current.json`)) ?? 'null'))
  return `${workspace}/index/${pointer.generation}/state.json`
}
export async function seedScheduleIndex(
  fs: ScheduleFsPort,
  jobs: readonly ScheduleV2[],
  revision = 0,
) {
  const generation = randomUUID()
  await fs.publish(
    `workspace-1/index/${generation}/state.json`,
    JSON.stringify({
      revision,
      value: {
        schedules: Object.fromEntries(jobs.map((job) => [job.id, job])),
        pending: {},
        timeCursors: {},
        migrations: {},
        retirements: {},
      },
    }),
  )
  const activation = JSON.stringify({ generation, revision, epoch: 0 })
  await fs.replace('workspace-1/index/current.json', activation)
  await fs.publish(
    `generationFences/${scheduleStorageHash('workspace-1/index')}/0/0.json`,
    activation,
  )
}
export async function schedulePointerFence(fs: ScheduleFsPort) {
  const pointer = z
    .object({ epoch: z.number() })
    .parse(JSON.parse((await fs.read('workspace-1/index/current.json')) ?? 'null'))
  return `generationFences/${scheduleStorageHash('workspace-1/index')}/${String(Math.floor(pointer.epoch / SCHEDULE_JOURNAL_MAX_OPS))}/${String(pointer.epoch)}.json`
}
