import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  RESOURCE_TREE_PROCESS_CAP,
  RESOURCE_TREE_SPAWN_CAP,
  RESOURCE_TREE_SPAWN_WINDOW_MS,
  RESOURCE_TREE_SAMPLE_MS,
  RESOURCE_TEMP_KEEP_MS,
} from '../../shared/constants'
import type {
  ResourceClass,
  ResourceClock,
  ResourceKind,
  ResourceSettings,
  ResourceTicket,
  ResourceTreeUsage,
} from '../../shared/resources'
import type { ResourceGovernor } from './governor'
import type { ResourceDiskSampler } from './disk'
import type { CreatedRegistry, CreatedCleanup } from './createdRegistry'
import type { ResourceEvents } from './events'
import { ResourceQueue, type ResourcePermit } from './queue'
import { ResourceTreeRegistry } from './trees/registry'
import type {
  ResourceAdmissionPort,
  ResourceLease,
  ResourceProcessLaunch,
  ResourceTreeBinding,
  ResourceTempRoots,
  ResourceTempRoot,
} from './launch'

interface Work {
  kind: ResourceKind
  class: ResourceClass
  permit: ResourcePermit
  process: ResourceProcessLaunch | undefined
  binding: ResourceTreeBinding | undefined
  registry: ResourceTreeRegistry | undefined
  ticket: ResourceTicket | undefined
  known: boolean
  ended: boolean
  owner: string
  temp: ResourceTempRoot | undefined
  failed: boolean
  checkpoint: boolean
  members: Set<string>
  births: number[]
  limited: boolean
  /** The last verified tree reading, reused by J's history (no extra OS query). */
  usage: ResourceTreeUsage | undefined
}
/** J's work source row: a registered tree and its last verified reading. */
export interface ResourceTreeUsageRow {
  readonly ticket: ResourceTicket
  readonly usage: ResourceTreeUsage | null
}
// Retired trees' final readings wait here for the next history read.
const RETIRED_USAGE_MAX = 256
export interface ResourceLaunchHostOptions {
  readonly governor: ResourceGovernor
  readonly events: ResourceEvents
  readonly clock: ResourceClock
  readonly settings: () => ResourceSettings
  readonly bindTree: (process: ResourceProcessLaunch) => Promise<ResourceTreeBinding | null>
  readonly onError: () => void
  readonly disks?: ResourceDiskSampler | undefined
  readonly tempRoots?: ResourceTempRoots | undefined
  readonly created?: Pick<CreatedRegistry, 'finish' | 'clean'> | undefined
  readonly onCleanup?: ((result: CreatedCleanup) => void) | undefined
}

/** C1: admission reservations plus OS-proved registry entries, shared by the window. */
export class ResourceLaunchHost implements ResourceAdmissionPort {
  private readonly context = new AsyncLocalStorage<ResourceClass>()
  private readonly work = new Set<Work>()
  private readonly queue: ResourceQueue
  private cancelTreeSample: (() => void) | undefined
  private pending: Promise<void> | undefined
  private disposed = false
  private settings: string | undefined
  private readonly retired = new Set<string>()
  private readonly safePointCancels = new Set<() => void>()
  private readonly admissionCancels = new Set<() => void>()
  private readonly cleanupTimers = new Set<() => void>()
  private readonly unsubscribe: () => void
  private readonly unsubscribeSample: () => void
  private readonly retiredUsage: ResourceTreeUsageRow[] = []
  private isUsageObserved = false

  constructor(private readonly options: ResourceLaunchHostOptions) {
    this.queue = new ResourceQueue({
      clock: options.clock,
      events: options.events,
      capacity: (kind) => options.governor.capacity(kind),
      diskBlocked: () => options.governor.diskBlocked(),
      running: {
        backgroundCount: (kind) => {
          const entries = [...this.work].filter(
            (work) => work.kind === kind && work.class === 'background',
          )
          return entries.some((work) => !work.known) ? null : entries.length
        },
      },
    })
    this.unsubscribeSample = options.governor.onSample(() => {
      this.queue.wake()
    })
    this.unsubscribe = options.events.subscribe((event) => {
      if (event.type === 'levelChanged' && event.to !== 'normal') {
        void options.created
          ?.clean()
          .then((result) => options.onCleanup?.(result))
          .catch(options.onError)
      }
    })
  }

  private finishTemp(work: Work): void {
    if (work.checkpoint) return
    this.retired.add(work.owner)
    const finish =
      work.temp === undefined
        ? this.options.created?.finish(work.owner, work.failed)
        : work.temp.finish(work.failed)
    if (finish === undefined) this.retired.delete(work.owner)
    else
      void finish
        .then(() => {
          if (!work.failed || this.options.created === undefined || this.disposed) return
          // Start retention after the durable exit record, never before it.
          const cancel = this.options.clock.setTimeout(() => {
            this.cleanupTimers.delete(cancel)
            void this.options.created
              ?.clean()
              .then((result) => this.options.onCleanup?.(result))
              .catch(this.options.onError)
          }, RESOURCE_TEMP_KEEP_MS)
          this.cleanupTimers.add(cancel)
        })
        .catch(this.options.onError)
        .finally(() => {
          this.retired.delete(work.owner)
        })
  }

  private async finishPendingTemp(work: Work, creating: Promise<ResourceTempRoot>): Promise<void> {
    try {
      work.temp = await creating
    } catch {
      work.failed = true
    }
    this.finishTemp(work)
  }

  private retire(work: Work, isTreeGone = true): void {
    if (!this.work.delete(work)) return
    if (this.isUsageObserved && work.ticket !== undefined && work.usage !== undefined) {
      // The final verified reading, so history keeps the tree's last CPU time.
      this.retiredUsage.push({ ticket: work.ticket, usage: work.usage })
      if (this.retiredUsage.length > RETIRED_USAGE_MAX) this.retiredUsage.shift()
    }
    if (work.ticket !== undefined) work.registry?.unregister(work.ticket)
    work.permit.release()
    if (isTreeGone) this.finishTemp(work)
    if ([...this.work].some((entry) => entry.process !== undefined)) {
      return
    }

    this.cancelTreeSample?.()
    this.cancelTreeSample = undefined
  }

  private scheduleTrees(): void {
    if (this.disposed || this.cancelTreeSample !== undefined) return
    this.cancelTreeSample = this.options.clock.setTimeout(() => {
      this.cancelTreeSample = undefined
      void this.refreshTrees().finally(() => {
        if ([...this.work].some((work) => work.process !== undefined)) this.scheduleTrees()
      })
    }, RESOURCE_TREE_SAMPLE_MS)
  }

  private async sampleTree(work: Work): Promise<void> {
    if (work.process === undefined || !this.work.has(work)) return
    try {
      work.binding ??= (await this.options.bindTree(work.process)) ?? undefined
      if (!this.work.has(work)) return
      if (work.binding === undefined) {
        work.known = false
        return
      }
      if (work.ended && (await work.binding.gone())) {
        this.retire(work)
        return
      }
      if (work.binding.root === null) {
        work.binding = undefined
        work.known = false
        return
      }
      if (work.ticket === undefined) {
        work.registry = new ResourceTreeRegistry(work.binding.reader)
        const ticket = {
          id: randomUUID(),
          root: work.binding.root,
          scope: work.binding.scope,
          kind: work.kind,
          class: work.class,
          sessionId: null,
        }
        // Install before awaiting so retirement cancels the registry's pending epoch.
        work.ticket = ticket
        await work.registry.register(ticket)
        if (!this.work.has(work)) {
          work.registry.unregister(ticket)
          return
        }
      }
      const members = await work.registry?.members(work.ticket)
      if (!this.work.has(work)) return
      if (members !== undefined && !work.limited) {
        const now = this.options.clock.now()
        const current = new Set(
          members.map((member) => `${String(member.pid)}:${member.startTime}`),
        )
        work.births = work.births.filter((atMs) => now - atMs < RESOURCE_TREE_SPAWN_WINDOW_MS)
        for (const key of current) if (!work.members.has(key)) work.births.push(now)
        work.members = current
        if (
          current.size > RESOURCE_TREE_PROCESS_CAP ||
          work.births.length > RESOURCE_TREE_SPAWN_CAP
        ) {
          // D100 G13 is an independent offending-job stop, never a machine-wide actuator.
          work.failed = true
          work.ended = true
          const result = await work.registry?.kill(work.ticket)
          work.limited = result?.status === 'done'
          if (!work.limited) this.options.onError()
        }
      }
      const usage = await work.registry?.usage(work.ticket)
      work.known = usage !== undefined && usage !== null
      if (work.known) work.usage = usage ?? undefined
    } catch {
      work.known = false
      if (work.ticket !== undefined) work.registry?.unregister(work.ticket)
      work.ticket = undefined
      work.usage = undefined
      this.options.onError()
    }
  }

  private async sampleAll(): Promise<void> {
    await Promise.resolve()
    try {
      await Promise.all(
        [...this.work].map(async (work) => {
          await this.sampleTree(work)
        }),
      )
      this.queue.wake()
    } finally {
      this.pending = undefined
    }
  }

  private isClosed(): boolean {
    return this.disposed
  }

  private async waitAdmission<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    let cancel: (() => void) | undefined
    try {
      return await Promise.race([
        new Promise<never>((_resolve, reject) => {
          cancel = () => {
            reject(new DOMException('Resource admission cancelled', 'AbortError'))
          }
          this.admissionCancels.add(cancel)
          signal?.addEventListener('abort', cancel, { once: true })
          if (signal?.aborted === true || this.disposed) cancel()
        }),
        pending,
      ])
    } finally {
      if (cancel !== undefined) {
        this.admissionCancels.delete(cancel)
        signal?.removeEventListener('abort', cancel)
      }
    }
  }

  refreshTrees(): Promise<void> {
    this.pending ??= this.sampleAll()
    return this.pending
  }

  async admit(
    kind: ResourceKind,
    signal?: AbortSignal,
    workClass?: ResourceClass | 'checkpoint',
    isDiskHeavy = kind === 'check' || kind === 'browserCheck',
    checkpointDestination?: string,
  ): Promise<ResourceLease> {
    if (this.disposed) throw new Error('Resource launch host disposed')
    const settings = this.options.settings()
    const signature = JSON.stringify(settings)
    if (signature !== this.settings) {
      this.options.governor.updateSettings(settings)
      this.settings = signature
    }
    this.options.governor.start()
    const isCheckpoint = workClass === 'checkpoint'
    if (isCheckpoint) {
      if (checkpointDestination === undefined) throw new Error('Checkpoint destination unavailable')
      await this.waitAdmission(this.assertWrite(checkpointDestination), signal)
    } else if (this.options.disks !== undefined)
      await this.waitAdmission(this.options.governor.refresh(), signal)
    const selectedClass = isCheckpoint
      ? 'foreground'
      : (workClass ?? this.context.getStore() ?? 'foreground')
    const permit = await this.queue.request(
      { kind, class: selectedClass, priority: 0, diskHeavy: isDiskHeavy, checkpoint: isCheckpoint },
      signal,
    ).ready
    const work: Work = {
      kind,
      class: selectedClass,
      permit,
      process: undefined,
      binding: undefined,
      registry: undefined,
      ticket: undefined,
      known: true,
      ended: false,
      owner: randomUUID(),
      temp: undefined,
      failed: false,
      checkpoint: isCheckpoint,
      members: new Set(),
      births: [],
      limited: false,
      usage: undefined,
    }
    this.work.add(work)
    let creating: Promise<ResourceTempRoot> | undefined
    try {
      if (!isCheckpoint) creating = this.options.tempRoots?.create(work.owner)
      if (creating !== undefined) work.temp = await this.waitAdmission(creating, signal)
    } catch (error: unknown) {
      if (creating !== undefined && (signal?.aborted === true || this.isClosed())) {
        this.retire(work, false)
        // Cancellation returns promptly; the private creation still drains into owned cleanup.
        void this.finishPendingTemp(work, creating).catch(this.options.onError)
      } else {
        work.failed = true
        if (this.work.has(work)) this.retire(work)
        else this.finishTemp(work)
      }
      throw error
    }
    if (signal?.aborted === true || this.isClosed()) {
      if (this.work.has(work)) this.retire(work)
      else this.finishTemp(work)
      throw new DOMException('Resource admission cancelled', 'AbortError')
    }
    return {
      temp: work.temp,
      failed: () => {
        work.failed = true
      },
      isTreeGone: async () => {
        await this.refreshTrees()
        return (await work.binding?.gone()) ?? false
      },
      kill: async () => {
        await this.refreshTrees()
        if (!this.work.has(work) || work.ticket === undefined) return false
        const result = await work.registry?.kill(work.ticket)
        return result?.status === 'done'
      },
      register: (process) => {
        if (!this.work.has(work)) return
        work.process = process
        work.known = false
        this.scheduleTrees()
        void this.refreshTrees()
      },
      complete: (isTreeGone) => {
        if (isTreeGone) this.retire(work)
        else {
          if (work.process === undefined) work.known = false
          work.ended = true
          void this.refreshTrees()
        }
      },
      background: () => {
        if (!this.work.has(work)) return
        if (work.ticket !== undefined) work.registry?.unregister(work.ticket)
        work.ticket = undefined
        work.usage = undefined
        work.kind = 'backgroundTask'
        work.class = 'background'
        work.known = false
        void this.refreshTrees()
      },
    }
  }

  async run<T>(kind: ResourceKind, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const lease = await this.admit(kind, signal, 'background')
    try {
      return await this.context.run('background', action)
    } catch (error: unknown) {
      lease.failed?.()
      throw error
    } finally {
      lease.complete(true)
    }
  }

  inClass<T>(workClass: ResourceClass, action: () => Promise<T>): Promise<T> {
    return this.context.run(workClass, action)
  }

  recordTransportResult(wasSuccessful: boolean): void {
    this.options.governor.recordTransportResult(wasSuccessful)
  }

  hasRetired(owner: string): boolean {
    return this.retired.has(owner)
  }

  async assertWrite(file: string): Promise<void> {
    if (this.options.disks === undefined) throw new Error('Disk write guard unavailable')
    await this.options.disks.assertWrite(file)
  }

  /** C2/H call this between lane operations, never while a process is mid-write. */
  async safePoint(kind: ResourceKind, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true || this.disposed)
      throw new DOMException('Resource safe point cancelled', 'AbortError')
    if (this.options.governor.level() !== 'pause') return
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        cleanup()
        reject(new DOMException('Resource safe point cancelled', 'AbortError'))
      }
      const unsubscribe = this.options.events.subscribe((event) => {
        if (event.type !== 'levelChanged' || event.to === 'pause') {
          return
        }

        cleanup()
        resolve()
      })
      const cleanup = () => {
        unsubscribe()
        this.safePointCancels.delete(cancel)
        signal?.removeEventListener('abort', cancel)
      }
      this.safePointCancels.add(cancel)
      signal?.addEventListener('abort', cancel, { once: true })
      this.options.events.publish({ type: 'paused', atMs: this.options.clock.now(), kind })
    })
  }

  tickets(): readonly ResourceTicket[] {
    return [...this.work].flatMap((work) => work.registry?.tickets() ?? [])
  }

  /**
   * J's history work source: each registered tree's last verified reading from
   * the tree sampler, then retired trees' final readings once. No OS query.
   */
  treeUsage(): readonly ResourceTreeUsageRow[] {
    this.isUsageObserved = true
    const retired = this.retiredUsage.splice(0)
    const live = [...this.work].flatMap((work) =>
      work.ticket === undefined ? [] : [{ ticket: work.ticket, usage: work.usage ?? null }],
    )
    return [...retired, ...live]
  }

  dispose(): void {
    this.disposed = true
    this.cancelTreeSample?.()
    this.unsubscribe()
    this.unsubscribeSample()
    for (const cancel of this.safePointCancels) cancel()
    for (const cancel of this.admissionCancels) cancel()
    for (const cancel of this.cleanupTimers) cancel()
    this.queue.dispose()
    this.options.governor.dispose()
    for (const work of this.work) this.retire(work, false)
  }
}
