import { readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  resourceProcessIdentitySchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
} from '../../../shared/resources'
import { PosixResourceTreeReader, type PosixTreeSnapshot, type PosixTreeSource } from './posix'
import { parseLinuxStat, type ProcessSample } from './posixTable'
import { coalescedTreeRead, runTreeProgram, type ResourceTreeRun } from './run'

export interface LinuxTreeDeps {
  /** Trusted delegated harness scope, supplied by M96 K; never a workspace setting. */
  readonly ownedCgroupRoot?: string
  readonly read?: (file: string) => Promise<string>
  readonly list?: (directory: string) => Promise<readonly string[]>
  readonly canonical?: (file: string) => Promise<string>
  readonly run?: ResourceTreeRun
}

const MICROSECONDS_PER_SECOND = 1_000_000

export class LinuxResourceTreeReader extends PosixResourceTreeReader {
  private readonly linux: LinuxTreeSource
  constructor(deps: LinuxTreeDeps = {}) {
    const linux = new LinuxTreeSource(deps)
    super(linux)
    this.linux = linux
  }
  identity(pid: number): Promise<ResourceProcessIdentity | null> {
    return this.linux.identity(pid)
  }

  childIdentity(pid: number, parentPid: number): Promise<ResourceProcessIdentity | null> {
    return this.linux.childIdentity(pid, parentPid)
  }
}

class LinuxTreeSource implements PosixTreeSource {
  private units: Promise<{ hz: number; page: number }> | undefined
  private readonly table: () => Promise<readonly ProcessSample[]>
  private readonly read: (file: string) => Promise<string>
  private readonly list: (directory: string) => Promise<readonly string[]>
  private readonly canonical: (file: string) => Promise<string>
  private readonly run: ResourceTreeRun
  constructor(private readonly deps: LinuxTreeDeps) {
    this.table = coalescedTreeRead(() => this.readTable())
    this.read = deps.read ?? ((file) => readFile(file, 'utf8'))
    this.list = deps.list ?? readdir
    this.canonical = deps.canonical ?? realpath
    this.run = deps.run ?? runTreeProgram
  }

  private async loadUnits(): Promise<{ hz: number; page: number }> {
    const ticks = await this.run('/usr/bin/getconf', ['CLK_TCK'])
    const pages = await this.run('/usr/bin/getconf', ['PAGESIZE'])
    const hz = Number(ticks.trim())
    const page = Number(pages.trim())
    if ([hz, page].some((value) => !(Number.isSafeInteger(value) && value > 0)))
      throw new Error('Invalid process accounting units')
    return { hz, page }
  }

  private async getUnits(): Promise<{ hz: number; page: number }> {
    const pending = (this.units ??= this.loadUnits())
    try {
      return await pending
    } catch (error: unknown) {
      if (this.units === pending) this.units = undefined
      throw error
    }
  }

  private async stat(pid: number): Promise<ProcessSample | null> {
    try {
      const { hz, page } = await this.getUnits()
      const row = parseLinuxStat(await this.read(`/proc/${String(pid)}/stat`), hz, page)
      if (row?.pid !== pid) throw new Error('Invalid process stat')
      return row
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    }
  }

  private async cgroup(ticket: ResourceTicket): Promise<string | null> {
    if (ticket.scope.type !== 'cgroup' || this.deps.ownedCgroupRoot === undefined) return null
    const root = await this.canonical(this.deps.ownedCgroupRoot)
    const scope = await this.canonical(ticket.scope.path)
    // Both the delegated root and scope must be under this user's slice; no path aliases.
    const userSlice = `/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/`
    return !root.startsWith(userSlice) ||
      !scope.startsWith(`${root}/`) ||
      scope !== path.posix.resolve(ticket.scope.path)
      ? null
      : scope
  }

  private async inCgroup(pid: number, scope: string): Promise<boolean> {
    try {
      const member = /^0::(\/[^\r\n]*)$/m.exec(await this.read(`/proc/${String(pid)}/cgroup`))?.[1]
      if (member === undefined) return false
      const current = path.posix.resolve('/sys/fs/cgroup', `.${member}`)
      return current === scope || current.startsWith(`${scope}/`)
    } catch (error: unknown) {
      // /proc rows may disappear after stat; other failures leave the whole sample unknown.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return false
      throw error
    }
  }

  private async readTable(): Promise<readonly ProcessSample[]> {
    const entries = await this.list('/proc')
    const rows: ProcessSample[] = []
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue
      const row = await this.stat(Number(entry))
      if (row !== null) rows.push(row)
    }
    return rows
  }

  async identity(pid: number): Promise<ResourceProcessIdentity | null> {
    if (!resourceProcessIdentitySchema.safeParse({ pid, startTime: '0' }).success) return null
    try {
      const row = await this.stat(pid)
      return row === null ? null : { pid: row.pid, startTime: row.startTime }
    } catch {
      return null
    }
  }

  async childIdentity(pid: number, parentPid: number): Promise<ResourceProcessIdentity | null> {
    if (
      [pid, parentPid].some(
        (value) => !resourceProcessIdentitySchema.safeParse({ pid: value, startTime: '0' }).success,
      )
    )
      return null
    try {
      const text = await this.read(`/proc/${String(pid)}/stat`)
      const parent = text
        .slice(text.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/, 2)[1]
      const units = await this.getUnits()
      const row = parseLinuxStat(text, units.hz, units.page)
      return row?.pid === pid && row.pgid === pid && parent === String(parentPid)
        ? { pid: row.pid, startTime: row.startTime }
        : null
    } catch {
      return null
    }
  }

  async containsNow(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    try {
      const current = await this.stat(identity.pid)
      if (current?.startTime !== identity.startTime) return false
      if (ticket.scope.type === 'group') return current.pgid === ticket.scope.pgid
      const scope = await this.cgroup(ticket)
      const isMember = scope !== null && (await this.inCgroup(identity.pid, scope))
      const latest = isMember ? await this.stat(identity.pid) : null
      return latest?.startTime === identity.startTime
    } catch {
      return false
    }
  }

  async snapshot(ticket: ResourceTicket): Promise<PosixTreeSnapshot | null> {
    if (ticket.scope.type === 'job') return null
    try {
      const scope = ticket.scope.type === 'cgroup' ? await this.cgroup(ticket) : null
      if (scope === null && ticket.scope.type === 'cgroup') return null
      const rows: ProcessSample[] = []
      const table = await this.table()
      for (const row of table) {
        if (ticket.scope.type === 'group') {
          if (row.pgid === ticket.scope.pgid) rows.push(row)
          continue
        }
        if (scope === null || !(await this.inCgroup(row.pid, scope))) continue
        // Re-read stat after membership so a PID reused between those reads cannot be admitted.
        const current = await this.stat(row.pid)
        if (current?.startTime === row.startTime) rows.push(current)
      }
      let cpuSeconds: number | null = null
      if (scope !== null) {
        const usec = /^usage_usec (\d+)$/m.exec(await this.read(`${scope}/cpu.stat`))?.[1]
        if (usec === undefined) return null
        cpuSeconds = Number(usec) / MICROSECONDS_PER_SECOND
      }
      return { rows, cpuSeconds }
    } catch {
      return null
    }
  }
}
