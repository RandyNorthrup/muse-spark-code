import path from 'node:path'
import * as z from 'zod/mini'
import {
  resourceProcessIdentitySchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
} from '../../../shared/resources'
import { PosixResourceTreeReader, type PosixTreeSnapshot, type PosixTreeSource } from './posix'
import { parseMacProcessTable, processSampleSchema, type ProcessSample } from './posixTable'
import { coalescedTreeRead, runTreeProgram, type ResourceTreeRun } from './run'

const macIdentitySchema = z.extend(resourceProcessIdentitySchema, {
  pgid: processSampleSchema.shape.pgid,
  parent: z.optional(processSampleSchema.shape.parent),
  exited: z.optional(processSampleSchema.shape.exited),
})
const unavailableSchema = z.strictObject({
  pid: resourceProcessIdentitySchema.shape.pid,
  unavailable: z.literal(true),
})

export interface MacTreeDeps {
  /** The already shipped, signed muse-dictate executable; no PATH search/fallback. */
  readonly helperPath?: string
  /** Optional native seam for hosts/tests; production uses helperPath's proc-identity mode. */
  readonly inspect?: (pid: number) => Promise<
    | (ResourceProcessIdentity & {
        readonly pgid: number
        readonly parent?: number
        readonly exited?: boolean
      })
    | null
  >
  readonly run?: ResourceTreeRun
}

export class MacResourceTreeReader extends PosixResourceTreeReader {
  private readonly mac: MacTreeSource
  constructor(deps: MacTreeDeps) {
    const mac = new MacTreeSource(deps)
    super(mac)
    this.mac = mac
  }
  identity(pid: number): Promise<ResourceProcessIdentity | null> {
    return this.mac.identity(pid)
  }
}

class MacTreeSource implements PosixTreeSource {
  private readonly table: () => Promise<ReturnType<typeof parseMacProcessTable>>
  constructor(private readonly deps: MacTreeDeps) {
    if (
      deps.inspect === undefined &&
      (deps.helperPath === undefined || !path.isAbsolute(deps.helperPath))
    )
      throw new Error('An absolute native process helper is required')
    this.table = coalescedTreeRead(() => this.readTable())
  }

  private async readTable(): Promise<ReturnType<typeof parseMacProcessTable>> {
    const text = await (this.deps.run ?? runTreeProgram)('/bin/ps', [
      '-axo',
      'pid=,ppid=,pgid=,state=,time=,rss=',
    ])
    return parseMacProcessTable(text)
  }

  private async inspect(
    pids: readonly number[],
  ): Promise<
    readonly (z.infer<typeof macIdentitySchema> | z.infer<typeof unavailableSchema> | null)[]
  > {
    if (this.deps.inspect !== undefined)
      return await Promise.all(
        pids.map(async (pid) => {
          const raw = await this.deps.inspect?.(pid)
          return raw === null ? null : macIdentitySchema.parse(raw)
        }),
      )
    if (this.deps.helperPath === undefined) throw new Error('Native process helper unavailable')
    const text = await (this.deps.run ?? runTreeProgram)(this.deps.helperPath, [
      'proc-identity',
      ...pids.map(String),
    ])
    const raw: unknown = JSON.parse(text)
    const native = z.extend(resourceProcessIdentitySchema, {
      pgid: processSampleSchema.shape.pgid,
      parent: processSampleSchema.shape.parent,
      exited: processSampleSchema.shape.exited,
    })
    const rows = z.array(z.nullable(z.union([native, unavailableSchema]))).parse(raw)
    if (
      rows.length !== pids.length ||
      rows.some((row, index) => row !== null && row.pid !== pids[index])
    )
      throw new Error('Native process identity mismatch')
    return rows
  }

  async identity(pid: number): Promise<ResourceProcessIdentity | null> {
    if (!resourceProcessIdentitySchema.safeParse({ pid, startTime: '0' }).success) return null
    try {
      const rows = await this.inspect([pid])
      const info = rows[0]
      return info?.pid === pid && !('unavailable' in info) && info.exited !== true
        ? { pid: info.pid, startTime: info.startTime }
        : null
    } catch {
      return null
    }
  }

  async containsNow(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    if (ticket.scope.type !== 'group') return false
    try {
      const rows = await this.inspect([identity.pid])
      const current = rows[0]
      return (
        current !== undefined &&
        current !== null &&
        !('unavailable' in current) &&
        current.exited !== true &&
        current.pid === identity.pid &&
        current.startTime === identity.startTime &&
        current.pgid === ticket.scope.pgid
      )
    } catch {
      return false
    }
  }

  async snapshot(ticket: ResourceTicket): Promise<PosixTreeSnapshot | null> {
    if (ticket.scope.type !== 'group') return null
    try {
      const table = await this.table()
      if (table === null) return null
      const rows: ProcessSample[] = []
      if (table.length === 0) return { rows, cpuSeconds: null }
      const infos = await this.inspect(table.map((row) => row.pid))
      for (const [index, row] of table.entries()) {
        const info = infos[index]
        if (
          info?.pid === row.pid &&
          !('unavailable' in info) &&
          info.pgid === row.pgid &&
          (info.parent === undefined || info.parent === row.parent)
        )
          rows.push({
            ...row,
            ...info,
            parent: info.parent ?? row.parent,
            exited: info.exited ?? row.exited,
          })
      }
      return { rows, cpuSeconds: null }
    } catch {
      return null
    }
  }
}
