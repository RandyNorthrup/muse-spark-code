import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { constants } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import * as z from 'zod/mini'
import {
  RESOURCE_ESCALATE_MS,
  RESOURCE_ID_MAX_LENGTH,
  RESOURCE_TREE_SAMPLE_MS,
} from '../../../shared/constants'
import type {
  ResourceProcessIdentity,
  ResourceTicket,
  ResourceTreeReader,
} from '../../../shared/resources'
import type { ResourceActuatorPort, ResourceControl, ResourceControlName } from './controls'

const prioritySchema = z.strictObject({
  nice: z
    .number()
    .check(
      z.int(),
      z.gte(constants.priority.PRIORITY_HIGHEST),
      z.lte(constants.priority.PRIORITY_LOW),
    ),
  ioClass: z.enum(['none', 'bestEffort', 'idle']),
  ioPriority: z.string().check(z.regex(/^[0-7]$/)),
})
type LinuxPriority = z.infer<typeof prioritySchema>

/** M96 K's native boundary must check group/cgroup AND exact start identity before each syscall.
 * It must use absolute renice/ionice paths, credential-free environments, no elevation,
 * and return null on failed readback. */
export interface LinuxProcessPriorityPort {
  read(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<LinuxPriority | null>
  nice(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    value: number,
  ): Promise<LinuxPriority | null>
  io(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    value: Pick<LinuxPriority, 'ioClass' | 'ioPriority'>,
  ): Promise<LinuxPriority | null>
}

export interface LinuxActuatorDeps {
  readonly registry: ResourceTreeReader
  /** The actual delegated harness parent; never read from workspace configuration. */
  readonly ownedCgroupRoot?: string
  /** Scope's soft memory target from the governor/lifetime binding, never memory.max. */
  readonly memoryHighBytes: number
  readonly processes?: LinuxProcessPriorityPort
  readonly files?: LinuxCgroupFiles
}

/** Pinned controls, not path-based writes; the default implementation keeps kernel file handles. */
export interface LinuxCgroupFiles {
  userId(): number
  canonical(file: string): Promise<string>
  owner(directory: string): Promise<number>
  open(file: string): Promise<{
    read(): Promise<string>
    write(row: string): Promise<boolean>
    close(): Promise<void>
  }>
}

const nativeFiles: LinuxCgroupFiles = {
  userId: () => {
    const uid = process.getuid?.()
    if (uid === undefined) throw new Error('Linux user identity unavailable')
    return uid
  },
  canonical: realpath,
  owner: async (directory) => {
    const info = await stat(directory)
    return info.uid
  },
  open: async (file) => {
    const handle = await open(file, 'r+')
    return {
      read: () => readControl(handle),
      write: async (row) => {
        const { bytesWritten } = await handle.write(`${row}\n`, 0, 'utf8')
        return bytesWritten === Buffer.byteLength(`${row}\n`)
      },
      close: () => handle.close(),
    }
  },
}

async function readControl(handle: FileHandle): Promise<string> {
  const buffer = Buffer.alloc(RESOURCE_ID_MAX_LENGTH)
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  if (bytesRead === buffer.length) throw new Error('Resource control exceeds read bound')
  return buffer.subarray(0, bytesRead).toString('utf8').trim()
}

function normalize(name: ResourceControlName, value: string): string {
  if (name === 'ioWeight') {
    const rows = value.split('\n').map((row) => row.trim())
    if (rows.some((row) => !/^(default|\d+:\d+) [1-9]\d*$/.test(row)))
      throw new Error('Invalid I/O weight')
    return rows.join('\n')
  }
  if (name === 'memoryHigh' && (value === 'max' || /^\d+$/.test(value))) return value
  if (/^[1-9]\d*$/.test(value)) return value
  throw new Error('Invalid resource control')
}

/** Cgroup files stay open: scope/path reuse cannot redirect a saved control to another tree. */
export class LinuxResourceActuator implements ResourceActuatorPort {
  constructor(private readonly deps: LinuxActuatorDeps) {
    z.number().check(z.int(), z.gt(0), z.lte(Number.MAX_SAFE_INTEGER)).parse(deps.memoryHighBytes)
  }

  private async cgroup(ticket: ResourceTicket): Promise<readonly ResourceControl[]> {
    if (ticket.scope.type !== 'cgroup' || this.deps.ownedCgroupRoot === undefined)
      throw new Error('Delegated harness scope unavailable')
    const files = this.deps.files ?? nativeFiles
    const parent = await files.canonical(this.deps.ownedCgroupRoot)
    const scope = await files.canonical(ticket.scope.path)
    const userId = files.userId()
    const userSlice = `/sys/fs/cgroup/user.slice/user-${String(userId)}.slice/`
    if (
      !parent.startsWith(userSlice) ||
      !scope.startsWith(`${parent}/`) ||
      scope !== path.posix.resolve(ticket.scope.path)
    )
      throw new Error('Resource scope outside delegated harness parent')
    if ((await files.owner(scope)) !== userId) throw new Error('Resource scope not owned')
    const names = [
      ['cpuWeight', 'cpu.weight'],
      ['ioWeight', 'io.weight'],
      ['memoryHigh', 'memory.high'],
    ] as const
    const controls: ResourceControl[] = []
    try {
      for (const [name, file] of names) {
        const location = `${scope}/${file}`
        let held: Awaited<ReturnType<LinuxCgroupFiles['open']>> | undefined
        let retryAtMs = 0
        let retryDelayMs = RESOURCE_TREE_SAMPLE_MS
        let isClosed = false
        controls.push({
          key: `${scope}/${file}`,
          name,
          identity: null,
          reversible: true,
          minimumLevel: 'throttle',
          read: async () => {
            if (isClosed) return null
            if (held === undefined && performance.now() >= retryAtMs) {
              try {
                if ((await files.canonical(location)) !== location)
                  throw new Error('Aliased resource control')
                held = await files.open(location)
              } catch {
                retryAtMs = performance.now() + retryDelayMs
                retryDelayMs = Math.min(retryDelayMs * 2, RESOURCE_ESCALATE_MS)
              }
            }
            return held === undefined ? null : normalize(name, await held.read())
          },
          lower: (_level, original) => {
            if (name === 'cpuWeight') return '1'
            if (name === 'ioWeight')
              return original
                .split('\n')
                .map((row) => `${row.slice(0, row.indexOf(' '))} 1`)
                .join('\n')
            return String(
              Math.min(original === 'max' ? Infinity : Number(original), this.deps.memoryHighBytes),
            )
          },
          write: async (value, identity) => {
            if (held === undefined) return null
            normalize(name, value)
            for (const row of value.split('\n')) {
              if (
                !(await this.deps.registry.contains(ticket, identity)) ||
                !(await held.write(row))
              )
                return null
            }
            return normalize(name, await held.read())
          },
          close: async () => {
            await held?.close()
            held = undefined
            isClosed = true
          },
        })
      }
      return controls
    } catch (error: unknown) {
      for (const control of controls) await control.close()
      throw error
    }
  }

  async controls(ticket: ResourceTicket): Promise<readonly ResourceControl[]> {
    if (ticket.scope.type === 'cgroup') return await this.cgroup(ticket)
    if (ticket.scope.type !== 'group' || this.deps.processes === undefined)
      throw new Error('Identity-bound Linux priority port unavailable')
    const port = this.deps.processes
    const controls: ResourceControl[] = []
    const members = await this.deps.registry.members(ticket)
    for (const identity of members) {
      const read = async () => {
        const value = await port.read(ticket, identity)
        return value === null ? null : prioritySchema.parse(value)
      }
      controls.push(
        {
          key: `nice/${String(identity.pid)}/${identity.startTime}`,
          name: 'nice',
          identity,
          reversible: false,
          minimumLevel: 'pause',
          read: async () => {
            const value = await read()
            return value === null ? null : String(value.nice)
          },
          lower: (_level, original) =>
            String(Math.max(Number(original), constants.priority.PRIORITY_LOW)),
          write: async (value) => {
            const actual = await port.nice(ticket, identity, Number(value))
            return actual === null ? null : String(prioritySchema.parse(actual).nice)
          },
          close: () => Promise.resolve(),
        },
        {
          key: `ionice/${String(identity.pid)}/${identity.startTime}`,
          name: 'ionice',
          identity,
          reversible: true,
          minimumLevel: 'pause',
          read: async () => {
            const value = await read()
            return value === null ? null : `${value.ioClass}/${value.ioPriority}`
          },
          lower: () => 'idle/0',
          write: async (value) => {
            const [ioClass, ioPriority] = value.split('/', 2)
            const desired = prioritySchema.parse({ nice: 0, ioClass, ioPriority })
            const actual = await port.io(ticket, identity, {
              ioClass: desired.ioClass,
              ioPriority: desired.ioPriority,
            })
            return actual === null
              ? null
              : `${prioritySchema.parse(actual).ioClass}/${actual.ioPriority}`
          },
          close: () => Promise.resolve(),
        },
      )
    }
    return controls
  }
}
