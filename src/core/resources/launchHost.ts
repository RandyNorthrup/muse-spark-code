import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { RESOURCE_TREE_SAMPLE_MS } from '../../shared/constants'
import type {
  ResourceClass,
  ResourceClock,
  ResourceKind,
  ResourceSettings,
  ResourceTicket,
} from '../../shared/resources'
import type { ResourceGovernor } from './governor'
import type { ResourceEvents } from './events'
import { ResourceQueue, type ResourcePermit } from './queue'
import { ResourceTreeRegistry } from './trees/registry'
import type {
  ResourceAdmissionPort,
  ResourceLease,
  ResourceProcessLaunch,
  ResourceTreeBinding,
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
}
export interface ResourceLaunchHostOptions {
  readonly governor: ResourceGovernor
  readonly events: ResourceEvents
  readonly clock: ResourceClock
  readonly settings: () => ResourceSettings
  readonly bindTree: (process: ResourceProcessLaunch) => Promise<ResourceTreeBinding | null>
  readonly onError: () => void
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

  constructor(private readonly options: ResourceLaunchHostOptions) {
    this.queue = new ResourceQueue({
      clock: options.clock,
      events: options.events,
      capacity: (kind) => options.governor.capacity(kind),
      running: {
        backgroundCount: (kind) => {
          const entries = [...this.work].filter(
            (work) => work.kind === kind && work.class === 'background',
          )
          return entries.some((work) => !work.known) ? null : entries.length
        },
      },
    })
  }

  private retire(work: Work): void {
    if (!this.work.delete(work)) return
    if (work.ticket !== undefined) work.registry?.unregister(work.ticket)
    work.permit.release()
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
      const usage = await work.registry?.usage(work.ticket)
      work.known = usage !== undefined && usage !== null
    } catch {
      work.known = false
      if (work.ticket !== undefined) work.registry?.unregister(work.ticket)
      work.ticket = undefined
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

  refreshTrees(): Promise<void> {
    this.pending ??= this.sampleAll()
    return this.pending
  }

  async admit(
    kind: ResourceKind,
    signal?: AbortSignal,
    workClass?: ResourceClass,
  ): Promise<ResourceLease> {
    if (this.disposed) throw new Error('Resource launch host disposed')
    const settings = this.options.settings()
    const signature = JSON.stringify(settings)
    if (signature !== this.settings) {
      this.options.governor.updateSettings(settings)
      this.settings = signature
    }
    this.options.governor.start()
    const selectedClass = workClass ?? this.context.getStore() ?? 'foreground'
    const permit = await this.queue.request({ kind, class: selectedClass, priority: 0 }, signal)
      .ready
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
    }
    this.work.add(work)
    if (signal?.aborted === true || this.isClosed()) {
      this.retire(work)
      throw new DOMException('Resource admission cancelled', 'AbortError')
    }
    return {
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
    } finally {
      lease.complete(true)
    }
  }

  inClass<T>(workClass: ResourceClass, action: () => Promise<T>): Promise<T> {
    return this.context.run(workClass, action)
  }

  tickets(): readonly ResourceTicket[] {
    return [...this.work].flatMap((work) => work.registry?.tickets() ?? [])
  }

  dispose(): void {
    this.disposed = true
    this.cancelTreeSample?.()
    this.queue.dispose()
    this.options.governor.dispose()
    for (const work of this.work) this.retire(work)
  }
}
