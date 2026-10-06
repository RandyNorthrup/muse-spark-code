import { constants, open, readFile, readdir, realpath, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { handleIdentity, lstatIdentity, sameFile } from '../../fs/fileIdentity'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import {
  LINUX_PID_IDENTITY_MIN_PID_MAX,
  WORKSPACE_IDENTITY_ZERO,
  RESOURCE_TREE_STOP_POLL_MS,
  RESOURCE_TREE_STOP_TIMEOUT_MS,
} from '../../../shared/constants'
import {
  resourceProcessIdentitySchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
} from '../../../shared/resources'
import { PosixResourceTreeReader, type PosixTreeSnapshot, type PosixTreeSource } from './posix'
import { parseLinuxStat, type ProcessSample } from './posixTable'
import { coalescedTreeRead, runTreeProgram, type ResourceTreeRun } from './run'
import {
  signalVerifiedPosix,
  type ResourceActionResult,
  type ResourceSignal,
  type ResourceTreeKillResult,
} from './actions'

interface LinuxCgroupHandle {
  readonly path: string
  matches(): Promise<boolean>
  close(): Promise<void>
}

export async function pinLinuxCgroupDirectory(directory: string): Promise<LinuxCgroupHandle> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    const identity = await handleIdentity(handle)
    return {
      path: `/proc/self/fd/${String(handle.fd)}`,
      async matches() {
        const observed = await lstatIdentity(directory)
        const pinned = await handleIdentity(handle)
        return (
          observed.isDirectory() &&
          pinned.nlink > WORKSPACE_IDENTITY_ZERO &&
          sameFile(observed, identity)
        )
      },
      close: () => handle.close(),
    }
  } catch (error: unknown) {
    await handle.close()
    throw error
  }
}

export interface LinuxTreeDeps {
  /** Trusted delegated harness scope, supplied by M96 K; never a workspace setting. */
  readonly ownedCgroupRoot?: string
  readonly pinDirectory?: (directory: string) => Promise<LinuxCgroupHandle>
  readonly read?: (file: string) => Promise<string>
  readonly list?: (directory: string) => Promise<readonly string[]>
  readonly canonical?: (file: string) => Promise<string>
  readonly run?: ResourceTreeRun
  readonly sendSignal?: (pid: number, signal: ResourceSignal) => void
  readonly write?: (file: string, value: string) => Promise<void>
  readonly remove?: (directory: string) => Promise<void>
  readonly directories?: (directory: string) => Promise<readonly string[]>
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
  pin(ticket: ResourceTicket): Promise<void> {
    return this.linux.pin(ticket)
  }
  override forget(ticket: ResourceTicket): void {
    super.forget(ticket)
    this.linux.forget(ticket)
  }
  completed(ticket: ResourceTicket, isRegistered: () => boolean): Promise<boolean> {
    return this.linux.completed(ticket, isRegistered)
  }
  killCgroup(
    ticket: ResourceTicket,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceTreeKillResult> {
    return this.linux.killCgroup(ticket, signal, isRegistered)
  }
}

class LinuxTreeSource implements PosixTreeSource {
  private readonly handles = new Map<
    string,
    { signature: string; directory: string; handle: Promise<LinuxCgroupHandle> }
  >()
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
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['ENOENT', 'ESRCH'].includes(String(error.code))
      )
        return null
      throw error
    }
  }

  private async cgroup(ticket: ResourceTicket): Promise<string | null> {
    if (ticket.scope.type !== 'cgroup') return null
    await this.pin(ticket)
    const pinned = this.handles.get(ticket.id)
    if (pinned?.signature !== JSON.stringify(ticket)) return null
    const handle = await pinned.handle
    if (!(await this.matches(handle))) throw new Error('Cgroup directory changed')
    return this.handles.get(ticket.id) === pinned ? handle.path : null
  }

  private async directory(scope: string): Promise<string> {
    for (const pinned of this.handles.values()) {
      const handle = await pinned.handle
      if (scope === handle.path || scope.startsWith(`${handle.path}/`)) {
        if (!(await this.matches(handle))) throw new Error('Cgroup directory changed')
        return `${pinned.directory}${scope.slice(handle.path.length)}`
      }
    }
    throw new Error('Unpinned cgroup')
  }

  private async inCgroup(pid: number, scope: string): Promise<boolean> {
    try {
      const member = /^0::(\/[^\r\n]*)$/m.exec(await this.read(`/proc/${String(pid)}/cgroup`))?.[1]
      if (member === undefined) return false
      scope = await this.directory(scope)
      const current = path.resolve('/sys/fs/cgroup', `.${member}`)
      return current === scope || current.startsWith(`${scope}/`)
    } catch (error: unknown) {
      // /proc rows may disappear after stat; other failures leave the whole sample unknown.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['ENOENT', 'ESRCH'].includes(String(error.code))
      )
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

  private async groupIdentityIsUsable(): Promise<boolean> {
    const { hz } = await this.getUnits()
    const text = await this.read('/proc/sys/kernel/pid_max')
    const pidMax = Number(text.trim())
    return hz > 0 && Number.isSafeInteger(pidMax) && pidMax >= LINUX_PID_IDENTITY_MIN_PID_MAX
  }

  private async directories(scope: string): Promise<readonly string[]> {
    if (this.deps.directories !== undefined) return await this.deps.directories(scope)
    const entries = await readdir(scope, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  }

  private async waitEvent(
    scope: string,
    event: 'populated' | 'frozen',
    value: number,
    isRegistered: () => boolean,
  ): Promise<void> {
    const deadline = Date.now() + RESOURCE_TREE_STOP_TIMEOUT_MS
    while (isRegistered()) {
      const text = await this.read(`${scope}/cgroup.events`)
      if (!/^populated [01]$/m.test(text) || !/^frozen [01]$/m.test(text))
        throw new Error('Invalid cgroup events')
      if (!isRegistered()) break
      if (text.split('\n').includes(`${event} ${String(value)}`)) return
      if (Date.now() >= deadline) break
      await setTimeout(RESOURCE_TREE_STOP_POLL_MS)
    }
    throw new Error('Cgroup completion unavailable')
  }

  private async cgroupPids(scope: string): Promise<readonly number[]> {
    const raw = await this.read(`${scope}/cgroup.procs`)
    const text = raw.trim()
    if (text !== '' && !/^\d+(?:\s+\d+)*$/.test(text)) throw new Error('Invalid cgroup members')
    const pids = text === '' ? [] : text.split(/\s+/).map(Number)
    if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid))
      throw new Error('Unsafe cgroup member')
    const children = await this.directories(scope)
    for (const child of children) pids.push(...(await this.cgroupPids(path.join(scope, child))))
    return pids
  }

  private async removeCgroup(scope: string, isRegistered: () => boolean): Promise<void> {
    const children = await this.directories(scope)
    for (const child of children) await this.removeCgroup(path.join(scope, child), isRegistered)
    if (!isRegistered()) throw new Error('Cgroup removal retired')
    await (this.deps.remove ?? rmdir)(await this.directory(scope))
  }

  private async matches(handle: LinuxCgroupHandle): Promise<boolean> {
    try {
      return await handle.matches()
    } catch {
      return false
    }
  }

  private async close(pending: Promise<LinuxCgroupHandle>): Promise<void> {
    try {
      const handle = await pending
      await handle.close()
    } catch {
      return
    }
  }

  async pin(ticket: ResourceTicket): Promise<void> {
    if (ticket.scope.type !== 'cgroup' || this.handles.has(ticket.id)) return
    const directory = ticket.scope.path
    const root = this.deps.ownedCgroupRoot
    if (root === undefined) throw new Error('Unowned cgroup')
    const canonicalRoot = await this.canonical(root)
    const canonicalScope = await this.canonical(directory)
    const userSlice = `/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/`
    if (
      canonicalRoot !== path.resolve(root) ||
      !canonicalRoot.startsWith(userSlice) ||
      !canonicalScope.startsWith(`${canonicalRoot}/`) ||
      canonicalScope !== path.resolve(directory)
    )
      throw new Error('Unowned cgroup')
    if (!this.handles.has(ticket.id)) {
      this.handles.set(ticket.id, {
        signature: JSON.stringify(ticket),
        directory,
        handle: (this.deps.pinDirectory ?? pinLinuxCgroupDirectory)(directory),
      })
    }
    await this.handles.get(ticket.id)?.handle
  }

  forget(ticket: ResourceTicket): void {
    const pinned = this.handles.get(ticket.id)
    if (pinned?.signature !== JSON.stringify(ticket)) return
    this.handles.delete(ticket.id)
    void this.close(pinned.handle)
  }

  async completed(ticket: ResourceTicket, isRegistered: () => boolean): Promise<boolean> {
    try {
      const scope = await this.cgroup(ticket)
      if (scope === null) return false
      const root = await this.stat(ticket.root.pid)
      if (root !== null && !root.exited && root.startTime === ticket.root.startTime) return false
      const events = await this.read(`${scope}/cgroup.events`)
      if (!/^populated 0$/m.test(events) || !/^frozen [01]$/m.test(events)) return false
      await this.removeCgroup(scope, isRegistered)
      return isRegistered()
    } catch {
      return false
    }
  }

  async identity(pid: number): Promise<ResourceProcessIdentity | null> {
    if (!resourceProcessIdentitySchema.safeParse({ pid, startTime: '0' }).success) return null
    try {
      const row = await this.stat(pid)
      return row === null || row.exited ? null : { pid: row.pid, startTime: row.startTime }
    } catch {
      return null
    }
  }

  async containsNow(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    isEnrolled = false,
    parent?: ResourceProcessIdentity,
  ): Promise<boolean> {
    try {
      const current = await this.stat(identity.pid)
      if (current?.exited !== false || current.startTime !== identity.startTime) return false
      if (ticket.scope.type === 'cgroup') {
        const scope = await this.cgroup(ticket)
        const isMember = scope !== null && (await this.inCgroup(identity.pid, scope))
        const latest = isMember ? await this.stat(identity.pid) : null
        return latest?.exited === false && latest.startTime === identity.startTime
      }
      if (ticket.scope.type !== 'group' || !(await this.groupIdentityIsUsable())) return false
      if (parent !== undefined) {
        const ancestor = await this.stat(parent.pid)
        const latest = await this.stat(identity.pid)
        return (
          ancestor?.exited === false &&
          ancestor.startTime === parent.startTime &&
          latest?.exited === false &&
          latest.startTime === identity.startTime &&
          latest.parent === parent.pid
        )
      }
      return isEnrolled || current.pgid === ticket.scope.pgid
    } catch {
      return false
    }
  }

  async signalNow(
    identity: ResourceProcessIdentity,
    signal: ResourceSignal,
    isRegistered: () => boolean,
    ticket: ResourceTicket,
  ): Promise<ResourceActionResult> {
    try {
      if (ticket.scope.type === 'group' && !(await this.groupIdentityIsUsable())) return 'refused'
      const current = await this.stat(identity.pid)
      if (
        current?.startTime === identity.startTime &&
        !current.exited &&
        !(await this.containsNow(ticket, identity, true))
      )
        return 'refused'
      const latest = current === null || current.exited ? current : await this.stat(identity.pid)
      if (
        ticket.scope.type === 'cgroup' &&
        latest?.startTime === identity.startTime &&
        !latest.exited
      ) {
        const scope = await this.cgroup(ticket)
        if (scope === null || !(await this.inCgroup(identity.pid, scope))) return 'refused'
      }
      return signalVerifiedPosix(identity, latest, signal, isRegistered, this.deps.sendSignal)
    } catch {
      return 'refused'
    }
  }

  async killCgroup(
    ticket: ResourceTicket,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceTreeKillResult> {
    try {
      const scope = await this.cgroup(ticket)
      if (scope === null || !isRegistered()) return { status: 'refused', members: [] }
      await this.cgroupPids(scope)
      if (!isRegistered()) return { status: 'refused', members: [] }
      const write = this.deps.write ?? writeFile
      let isUseFreeze = signal !== 'SIGKILL'
      if (!isUseFreeze) {
        try {
          await write(`${scope}/cgroup.kill`, '1')
        } catch (error: unknown) {
          if (
            typeof error !== 'object' ||
            error === null ||
            !('code' in error) ||
            !['ENOENT', 'EOPNOTSUPP'].includes(String(error.code))
          )
            throw error
          isUseFreeze = true
        }
      }
      if (isUseFreeze) {
        if (!isRegistered()) return { status: 'refused', members: [] }
        await write(`${scope}/cgroup.freeze`, '1')
        try {
          await this.waitEvent(scope, 'frozen', 1, isRegistered)
          const pids = await this.cgroupPids(scope)
          for (const pid of pids) {
            if (!(await this.inCgroup(pid, scope)) || !isRegistered())
              throw new Error('Cgroup action retired')
            try {
              ;(this.deps.sendSignal ?? process.kill)(pid, signal)
            } catch (error: unknown) {
              if (
                typeof error !== 'object' ||
                error === null ||
                !('code' in error) ||
                error.code !== 'ESRCH'
              )
                throw error
            }
          }
        } finally {
          await write(`${scope}/cgroup.freeze`, '0')
        }
      }
      await this.waitEvent(scope, 'populated', 0, isRegistered)
      await this.removeCgroup(scope, isRegistered)
      return { status: 'done', members: [] }
    } catch (error: unknown) {
      return {
        status:
          error instanceof Error && error.message === 'Cgroup directory changed'
            ? 'cgroup_changed'
            : 'refused',
        members: [],
      }
    }
  }

  async snapshot(ticket: ResourceTicket): Promise<PosixTreeSnapshot | null> {
    if (ticket.scope.type === 'job') return null
    try {
      const scope = ticket.scope.type === 'cgroup' ? await this.cgroup(ticket) : null
      if (scope === null && ticket.scope.type === 'cgroup') return null
      const rows: ProcessSample[] = []
      const table: ProcessSample[] = []
      if (scope === null) table.push(...(await this.table()))
      else {
        const pids = await this.cgroupPids(scope)
        for (const pid of pids) {
          const row = await this.stat(pid)
          if (row !== null) table.push(row)
        }
      }
      for (const row of table) {
        if (ticket.scope.type === 'group') {
          rows.push(row)
          continue
        }
        if (scope === null || !(await this.inCgroup(row.pid, scope))) continue
        // Re-read stat after membership so a PID reused between those reads cannot be admitted.
        const current = await this.stat(row.pid)
        if (current?.startTime === row.startTime && (await this.inCgroup(row.pid, scope)))
          rows.push(current)
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
