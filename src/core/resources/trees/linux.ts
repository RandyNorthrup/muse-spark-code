import {
  type FileHandle,
  constants,
  open,
  readFile,
  readdir,
  realpath,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT } from '../../../shared/l10n/text'
import { handleIdentity, lstatIdentity, sameFile } from '../../fs/fileIdentity'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import {
  LINUX_PID_IDENTITY_MIN_PID_MAX,
  WORKSPACE_IDENTITY_ZERO,
  RESOURCE_TREE_STOP_POLL_MS,
  RESOURCE_HARNESS_PLACEMENT_ATTEMPTS,
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
  /** Removal resolves the leaf through a separately retained parent descriptor. */
  readonly removalPath: string
  matches(): Promise<boolean>
  close(): Promise<void>
}

export async function pinLinuxCgroupDirectory(directory: string): Promise<LinuxCgroupHandle> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  let parent: FileHandle
  try {
    parent = await open(
      path.posix.dirname(directory),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
  } catch (error: unknown) {
    await handle.close()
    throw error
  }
  try {
    const identity = await handleIdentity(handle)
    const removalPath = `/proc/self/fd/${String(parent.fd)}/${path.posix.basename(directory)}`
    return {
      path: `/proc/self/fd/${String(handle.fd)}`,
      removalPath,
      async matches() {
        const observed = await lstatIdentity(directory)
        const leaf = await lstatIdentity(removalPath)
        const pinned = await handleIdentity(handle)
        return (
          observed.isDirectory() &&
          leaf.isDirectory() &&
          pinned.nlink > WORKSPACE_IDENTITY_ZERO &&
          sameFile(observed, identity) &&
          sameFile(leaf, identity)
        )
      },
      async close() {
        try {
          await handle.close()
        } finally {
          await parent.close()
        }
      },
    }
  } catch (error: unknown) {
    await handle.close()
    await parent.close()
    throw error
  }
}

export interface LinuxTreeDeps {
  /** Trusted delegated harness scope, supplied by M96 K; never a workspace setting. */
  readonly ownedCgroupRoot?: string
  readonly homeCgroup?: string
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

  childIdentity(pid: number, parentPid: number): Promise<ResourceProcessIdentity | null> {
    return this.linux.childIdentity(pid, parentPid)
  }
  pinHome(): Promise<void> {
    return this.linux.pinHome()
  }
  async pin(ticket: ResourceTicket): Promise<string> {
    const scope = await this.linux.pin(ticket)
    if (scope === null) throw new Error('Unowned cgroup')
    // The gated child opens the same held directory through the harness's proc entry.
    return scope.replace('/proc/self/', () => `/proc/${String(process.pid)}/`)
  }
  override forget(ticket: ResourceTicket): void {
    super.forget(ticket)
    this.linux.forget(ticket)
  }
  releaseHome(): void {
    this.linux.releaseHome()
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
  private readonly retired = new Set<string>()
  private readonly activeKills = new Map<string, number>()
  private readonly handles = new Map<
    string,
    { signature: string; directory: string; handle: Promise<LinuxCgroupHandle> }
  >()
  private home: Promise<{ directory: string; handle: LinuxCgroupHandle }> | undefined
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
      const current = path.posix.resolve('/sys/fs/cgroup', `.${member}`)
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

  private async cgroupPids(scope: string, isIncludeHarness = false): Promise<readonly number[]> {
    const raw = await this.read(`${scope}/cgroup.procs`)
    const text = raw.trim()
    if (text !== '' && !/^\d+(?:\s+\d+)*$/.test(text)) throw new Error('Invalid cgroup members')
    const pids = text === '' ? [] : text.split(/\s+/).map(Number)
    if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
      throw new Error('Unsafe cgroup member')
    if (!isIncludeHarness && pids.includes(process.pid)) throw new Error('Harness in cgroup')
    const children = await this.directories(scope)
    for (const child of children)
      pids.push(...(await this.cgroupPids(path.posix.join(scope, child), isIncludeHarness)))
    return pids
  }

  private async reassertHome(): Promise<void> {
    await this.pinHome()
    const home = await this.home
    if (home === undefined || !(await this.matches(home.handle)))
      throw new Error('Harness home unavailable')
    try {
      await (this.deps.write ?? writeFile)(`${home.handle.path}/cgroup.procs`, String(process.pid))
    } catch (error: unknown) {
      // A root-owned login scope denies even a no-op write; accept only its confirmed placement.
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        !['EACCES', 'EPERM'].includes(String(error.code))
      )
        throw error
      const member = /^0::(\/[^\r\n]*)$/m.exec(await this.read('/proc/self/cgroup'))?.[1]
      if (member === undefined || `/sys/fs/cgroup${member}` !== home.directory)
        throw new Error('Harness in cgroup', { cause: error })
    }
  }

  private async excludeHarness(scope: string, isRegistered: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < RESOURCE_HARNESS_PLACEMENT_ATTEMPTS; attempt++) {
      if (!isRegistered()) throw new Error('Cgroup action retired')
      await this.reassertHome()
      const pids = await this.cgroupPids(scope, true)
      if (!pids.includes(process.pid)) return
    }
    throw new Error('Harness in cgroup')
  }

  private async removeCgroup(scope: string, isRegistered: () => boolean): Promise<void> {
    const children = await this.directories(scope)
    for (const child of children)
      await this.removeCgroup(path.posix.join(scope, child), isRegistered)
    if (!isRegistered()) throw new Error('Cgroup removal retired')
    await this.directory(scope)
    let removalPath = scope
    for (const pinned of this.handles.values()) {
      const handle = await pinned.handle
      if (scope === handle.path) removalPath = handle.removalPath
    }
    if (!isRegistered()) throw new Error('Cgroup removal retired')
    await (this.deps.remove ?? rmdir)(removalPath)
  }

  private async matches(handle: LinuxCgroupHandle): Promise<boolean> {
    try {
      return await handle.matches()
    } catch {
      return false
    }
  }

  private async close(
    pending: Promise<LinuxCgroupHandle | { handle: LinuxCgroupHandle }>,
  ): Promise<void> {
    try {
      const pinned = await pending
      const handle = 'handle' in pinned ? pinned.handle : pinned
      await handle.close()
    } catch {
      return
    }
  }

  async pinHome(): Promise<void> {
    this.home ??= (async () => {
      const member =
        this.deps.homeCgroup === undefined
          ? /^0::(\/[^\r\n]*)$/m.exec(await this.read('/proc/self/cgroup'))?.[1]
          : undefined
      const directory =
        this.deps.homeCgroup ?? (member === undefined ? undefined : `/sys/fs/cgroup${member}`)
      if (directory === undefined) throw new Error('Harness home unavailable')
      const handle = await (this.deps.pinDirectory ?? pinLinuxCgroupDirectory)(directory)
      return { directory, handle }
    })()
    await this.home
  }

  async pin(ticket: ResourceTicket): Promise<string | null> {
    if (this.retired.has(JSON.stringify(ticket))) throw new Error('Cgroup ticket retired')
    if (ticket.scope.type !== 'cgroup') return null
    const existing = this.handles.get(ticket.id)
    if (existing !== undefined) {
      if (existing.signature !== JSON.stringify(ticket)) return null
      const handle = await existing.handle
      return handle.path
    }
    await this.pinHome()
    const directory = ticket.scope.path
    const root = this.deps.ownedCgroupRoot
    if (root === undefined) throw new Error('Unowned cgroup')
    const canonicalRoot = await this.canonical(root)
    const canonicalScope = await this.canonical(directory)
    const userSlice = `/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/`
    if (
      canonicalRoot !== path.posix.resolve(root) ||
      !canonicalRoot.startsWith(userSlice) ||
      !canonicalScope.startsWith(`${canonicalRoot}/`) ||
      canonicalScope !== path.posix.resolve(directory)
    )
      throw new Error('Unowned cgroup')
    if (this.retired.has(JSON.stringify(ticket))) throw new Error('Cgroup ticket retired')
    if (!this.handles.has(ticket.id)) {
      this.handles.set(ticket.id, {
        signature: JSON.stringify(ticket),
        directory,
        handle: (this.deps.pinDirectory ?? pinLinuxCgroupDirectory)(directory),
      })
    }
    const pinned = this.handles.get(ticket.id)
    if (pinned?.signature !== JSON.stringify(ticket)) return null
    const handle = await pinned.handle
    return handle.path
  }

  forget(ticket: ResourceTicket): void {
    this.retired.add(JSON.stringify(ticket))
    const pinned = this.handles.get(ticket.id)
    if (
      pinned?.signature !== JSON.stringify(ticket) ||
      (this.activeKills.get(pinned.signature) ?? 0) > 0
    )
      return
    this.handles.delete(ticket.id)
    void this.close(pinned.handle)
    this.releaseHome()
  }

  releaseHome(): void {
    if (this.handles.size > 0 || this.home === undefined) return
    void this.close(this.home)
    this.home = undefined
  }

  async completed(ticket: ResourceTicket, isRegistered: () => boolean): Promise<boolean> {
    try {
      if (!isRegistered() || (this.activeKills.get(JSON.stringify(ticket)) ?? 0) > 0) return false
      const root = await this.stat(ticket.root.pid)
      if (
        !isRegistered() ||
        (root !== null && !root.exited && root.startTime === ticket.root.startTime)
      )
        return false
      const scope = await this.cgroup(ticket)
      if (scope === null) return false
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
      return row?.pid === pid && !row.exited && row.pgid === pid && parent === String(parentPid)
        ? { pid: row.pid, startTime: row.startTime }
        : null
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
    const signature = JSON.stringify(ticket)
    this.activeKills.set(signature, (this.activeKills.get(signature) ?? 0) + 1)
    try {
      const scope = await this.cgroup(ticket)
      if (scope === null || !isRegistered()) return { status: 'refused', members: [] }
      await this.excludeHarness(scope, isRegistered)
      if (!isRegistered()) return { status: 'refused', members: [] }
      const write = this.deps.write ?? writeFile
      let isUseFreeze = signal !== 'SIGKILL'
      if (!isUseFreeze) {
        try {
          await this.reassertHome()
          if (!isRegistered()) throw new Error('Cgroup action retired')
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
        await this.excludeHarness(scope, isRegistered)
        await this.reassertHome()
        if (!isRegistered()) throw new Error('Cgroup action retired')
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
      if (error instanceof Error && error.message === 'Harness in cgroup')
        return { status: 'harness_in_tree', members: [], message: UI_TEXT.resourceHarnessInTree }
      if (error instanceof Error && error.message === 'Cgroup directory changed')
        return { status: 'cgroup_changed', members: [], message: UI_TEXT.resourceCgroupChanged }
      return {
        status: 'refused',
        members: [],
      }
    } finally {
      const remaining = (this.activeKills.get(signature) ?? 1) - 1
      if (remaining > 0) this.activeKills.set(signature, remaining)
      else {
        this.activeKills.delete(signature)
        if (this.retired.has(signature)) this.forget(ticket)
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
