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
})

export interface MacTreeDeps {
  /** proc_pidinfo(PROC_PIDTBSDINFO): exact start microseconds AND current pgid from one native read.
   * M96 K / W bind this port; ps lstart's whole seconds are insufficient for PID-reuse safety. */
  readonly inspect: (
    pid: number,
  ) => Promise<(ResourceProcessIdentity & { readonly pgid: number }) | null>
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
    this.table = coalescedTreeRead(() => this.readTable())
  }

  private async readTable(): Promise<ReturnType<typeof parseMacProcessTable>> {
    const text = await (this.deps.run ?? runTreeProgram)('/bin/ps', [
      '-axo',
      'pid=,pgid=,time=,rss=',
    ])
    return parseMacProcessTable(text)
  }

  async identity(pid: number): Promise<ResourceProcessIdentity | null> {
    if (!resourceProcessIdentitySchema.safeParse({ pid, startTime: '0' }).success) return null
    try {
      const info = macIdentitySchema.parse(await this.deps.inspect(pid))
      return info.pid === pid ? { pid: info.pid, startTime: info.startTime } : null
    } catch {
      return null
    }
  }

  async containsNow(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    if (ticket.scope.type !== 'group') return false
    try {
      const current = macIdentitySchema.parse(await this.deps.inspect(identity.pid))
      return (
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
      for (const row of table) {
        if (row.pgid !== ticket.scope.pgid) continue
        const raw = await this.deps.inspect(row.pid)
        if (raw === null) continue
        const info = macIdentitySchema.parse(raw)
        if (info.pid === row.pid && info.pgid === row.pgid) rows.push({ ...row, ...info })
      }
      return { rows, cpuSeconds: null }
    } catch {
      return null
    }
  }
}
