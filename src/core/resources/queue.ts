import { RESOURCE_FOREGROUND_WAIT_MS } from '../../shared/constants'
import {
  resourceClassSchema,
  resourceKindSchema,
  type ResourceClass,
  type ResourceClock,
  type ResourceKind,
  type ResourceStatus,
} from '../../shared/resources'
import { type ResourceEvents } from './events'
import { ResourcePausedError } from './launch'

/** T/C1 bind the registry here. null is unknown, so throttle cannot admit. */
export interface ResourceRunningWork {
  backgroundCount(kind: ResourceKind): number | null
}
export interface ResourcePermit {
  readonly kind: ResourceKind
  readonly class: ResourceClass
  /** Release only after failed spawn or observed retirement, never merely cancel. */
  release(): void
}
export interface ResourceLaunchRequest {
  kind: ResourceKind
  class: ResourceClass
  /** M96c's scheduling priority: lower first, FIFO within each priority/kind. */
  priority: number
  /** Tests/builds/installs/worktrees/downloads never use the foreground deadline. */
  diskHeavy?: boolean | undefined
  /** Only the checkpoint saving a pause; its own destination is checked by the host. */
  checkpoint?: boolean | undefined
  parent?: ResourcePermit
}
export interface ResourceAdmission {
  ready: Promise<ResourcePermit>
  /** Only a waiting foreground spawn can bypass its twenty-second wait. */
  runNow(): boolean
  cancel(): void
}
export interface ResourceQueueOptions {
  clock: ResourceClock
  events: ResourceEvents
  capacity: (kind: ResourceKind) => number | null
  running: ResourceRunningWork
  diskBlocked?: (() => boolean) | undefined
}
interface Entry {
  id: symbol
  request: ResourceLaunchRequest
  resolve: (permit: ResourcePermit) => void
  reject: (error: unknown) => void
  cleanup: (() => void) | undefined
}

function aborted(): Error {
  return new DOMException('Resource admission cancelled', 'AbortError')
}

/** Reservations cover the admission-to-registration gap and stay until retirement. */
export class ResourceQueue {
  private readonly waiting = new Map<symbol, Entry>()
  private readonly held = new Set<ResourcePermit>()
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(private readonly options: ResourceQueueOptions) {
    this.unsubscribe = options.events.subscribe((event) => {
      if (event.type === 'levelChanged') this.wake()
    })
  }

  private grant(entry: Entry): void {
    if (!this.waiting.delete(entry.id)) return
    entry.cleanup?.()
    const permit: ResourcePermit = Object.freeze({
      kind: entry.request.kind,
      class: entry.request.class,
      release: () => {
        if (this.held.delete(permit)) this.wake()
      },
    })
    this.held.add(permit)
    entry.resolve(permit)
  }

  private reject(entry: Entry, error: unknown): void {
    if (!this.waiting.delete(entry.id)) return
    entry.cleanup?.()
    entry.reject(error)
  }

  request(request: ResourceLaunchRequest, signal?: AbortSignal): ResourceAdmission {
    if (this.disposed) throw new Error('Resource queue disposed')
    const copy = {
      ...request,
      kind: resourceKindSchema.parse(request.kind),
      class: resourceClassSchema.parse(request.class),
    }
    if (!Number.isSafeInteger(copy.priority)) throw new RangeError('Invalid resource priority')
    const id = Symbol()
    const cancel = () => {
      const pending = this.waiting.get(id)
      if (pending !== undefined) this.reject(pending, aborted())
    }
    const ready = new Promise<ResourcePermit>((resolve, reject) => {
      const pending: Entry = {
        id,
        request: copy,
        resolve,
        reject,
        cleanup: undefined,
      }
      this.waiting.set(id, pending)
      if (signal?.aborted === true) {
        cancel()
        return
      }
      signal?.addEventListener('abort', cancel, { once: true })
      const cancelTimer =
        copy.class === 'foreground'
          ? this.options.clock.setTimeout(() => {
              if (!copy.diskHeavy || this.options.diskBlocked?.() !== true) this.grant(pending)
            }, RESOURCE_FOREGROUND_WAIT_MS)
          : undefined
      pending.cleanup = () => {
        signal?.removeEventListener('abort', cancel)
        cancelTimer?.()
      }
      this.wake()
      if (this.waiting.has(id))
        this.options.events.publish({
          type: 'deferred',
          atMs: this.options.clock.now(),
          kind: copy.kind,
          class: copy.class,
        })
    })
    return {
      ready,
      runNow: () => {
        const pending = this.waiting.get(id)
        if (
          pending === undefined ||
          copy.class !== 'foreground' ||
          (copy.diskHeavy === true && this.options.diskBlocked?.() === true)
        )
          return false
        this.grant(pending)
        return true
      },
      cancel,
    }
  }

  counts(): ResourceStatus['queued'] {
    const counts: ResourceStatus['queued'] = []
    for (const { request } of this.waiting.values()) {
      const existing = counts.find(
        (row) => row.kind === request.kind && row.class === request.class,
      )
      if (existing === undefined)
        counts.push({ kind: request.kind, class: request.class, count: 1 })
      else existing.count++
    }
    return counts
  }

  /** Registry retirement/changes call this; it never concludes that a process ended. */
  wake(): void {
    if (this.disposed) return
    const entries = this.waiting.values()
    const ordered = [...entries].toSorted(
      (left, right) => left.request.priority - right.request.priority,
    )
    for (const entry of ordered) {
      if (!this.waiting.has(entry.id)) continue
      try {
        if (entry.request.checkpoint === true) {
          this.grant(entry)
          continue
        }
        const limit = this.options.capacity(entry.request.kind)
        if (limit !== null && limit !== 0 && limit !== 1)
          throw new RangeError('Invalid resource capacity')
        const { parent } = entry.request
        if (parent !== undefined && !this.held.has(parent))
          throw new Error('Resource parent permit is not active')
        if (limit === 0 && entry.request.class === 'background') {
          this.options.events.publish({
            type: 'paused',
            atMs: this.options.clock.now(),
            kind: entry.request.kind,
          })
          this.reject(entry, new ResourcePausedError())
          continue
        }
        if (entry.request.diskHeavy === true && this.options.diskBlocked?.() === true) continue
        if (limit === null || (entry.request.class === 'foreground' && limit > 0)) {
          this.grant(entry)
          continue
        }
        // Foreground's independent deadline must not depend on a tree reading.
        if (entry.request.class === 'foreground') continue
        const count = limit === 0 ? null : this.options.running.backgroundCount(entry.request.kind)
        if (count !== null && (!Number.isSafeInteger(count) || count < 0))
          throw new RangeError('Invalid resource running count')
        const reservations = [...this.held].filter(
          (permit) => permit.class === 'background' && permit.kind === entry.request.kind,
        ).length
        // Registry counts may already include a reservation. Taking the maximum
        // is sufficient for D87's only finite nonzero capacity: one per kind.
        if (count !== null && Math.max(count, reservations) < limit) this.grant(entry)
        else if (parent?.class === 'background' && parent.kind === entry.request.kind)
          this.reject(entry, new Error('Resource child cannot wait on its parent slot'))
      } catch (error) {
        this.reject(entry, error)
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    for (const entry of this.waiting.values()) this.reject(entry, aborted())
  }
}
