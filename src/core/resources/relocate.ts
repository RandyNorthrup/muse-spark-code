import { RESOURCE_RELOCATION_PROBE_MS } from '../../shared/constants'
import {
  deviceResourceSchema,
  resourceLevelSchema,
  resourceStatusSchema,
  type ResourceClock,
  type ResourceEvent,
  type ResourceKind,
  type ResourceLevel,
  type ResourceLinkedDevice,
  type ResourceStatus,
} from '../../shared/resources'
import { unlessAborted } from '../timeouts'
import type { ResourceEvents } from './events'

interface RelocationMetadata {
  readonly reason: 'machineBusy'
  readonly level: ResourceLevel
}
type RelocationResult = 'kept' | 'admitted' | 'uncertain'
type RelocatedEvent = Extract<ResourceEvent, { type: 'relocated' }>

export interface ResourceRelocationWork {
  readonly repository: string
  readonly kind: ResourceKind
  readonly heavy: boolean
  phase(): 'queued' | 'running'
  /** Exclusive M96c/M100 attempt ownership, held across every await. */
  claim(): boolean
  /** Uncertain retains occupancy; kept does not prove local retirement. */
  settle(result: RelocationResult): void
  /** M96c's local complete-attempt retirement proof, never just a kill receipt. */
  retire?: () => Promise<boolean>
}

export interface ResourceRelocationTarget {
  readonly id: string
  readonly type: 'paired' | 'ssh'
  /** Untrusted headroom; validate without acquiring offer authority. */
  resource(): Promise<unknown>
  /** Also checks the existing exact role/check, snapshot and repository grants. */
  hasOffer: ResourceLinkedDevice['hasOffer']
  /**
   * Bound to the existing task/attempt and transport; metadata is the only addition.
   * Receiver rechecks its own governor and permissions at durable admission.
   * Abort requests Keep here. Refused proves no admission, including cancellation;
   * loss of that proof is uncertain. Admitted wins over a late abort.
   */
  dispatch(
    metadata: RelocationMetadata,
    signal: AbortSignal,
  ): Promise<'admitted' | 'refused' | 'uncertain'>
}

export interface ResourceRelocationOptions {
  clock: ResourceClock
  events: ResourceEvents
  status(): ResourceStatus
  headless: boolean
  devicesEnabled(): boolean
  /** Lazy task-bound offers/dispatch: never evaluated when disabled or ineligible. */
  devices(work: ResourceRelocationWork): readonly ResourceRelocationTarget[]
  runnersEnabled(): boolean
  runners(work: ResourceRelocationWork): readonly ResourceRelocationTarget[]
  ask(work: ResourceRelocationWork, target: ResourceRelocationTarget): Promise<boolean>
  /** Must install the task row with target and reason before returning. */
  row(
    work: ResourceRelocationWork,
    target: ResourceRelocationTarget,
    metadata: RelocationMetadata,
  ): void
  notice(target: ResourceRelocationTarget): void
  traffic(target: ResourceRelocationTarget, event: RelocatedEvent): void
  onError(error: unknown): void
}

/** Receiver calls this immediately before its existing durable admission, not a probe. */
export function canAdmitResourceRelocation(level: unknown): boolean {
  const parsed = resourceLevelSchema.safeParse(level)
  return parsed.success && parsed.data === 'normal'
}

export interface ResourceRelocationAttempt {
  /** No id means automatic routing; an id is the user's explicit Move to choice. */
  run(targetId?: string): Promise<RelocationResult>
  /** True only after confirming that no receiver admitted this attempt. */
  keepHere(): Promise<boolean>
}

/** One per conversation; does not load devices, start work, or replace M100 consent. */
export class ResourceRelocator {
  private noticed = false

  constructor(private readonly options: ResourceRelocationOptions) {}

  private status(signal: AbortSignal, isManual: boolean): ResourceStatus | null {
    if (signal.aborted || this.options.headless) return null
    const status = resourceStatusSchema.parse(this.options.status())
    if (!status.settings.enabled || status.settings.relocate === 'off') return null
    return status.level === 'normal' || (!isManual && status.level === 'throttle') ? null : status
  }

  private offered(work: ResourceRelocationWork, target: ResourceRelocationTarget): boolean {
    if (work.kind !== 'worker' && work.kind !== 'check') return false
    if (target.type === 'paired') {
      if (!this.options.devicesEnabled()) return false
    } else if (!this.options.runnersEnabled() || work.kind !== 'check' || !work.heavy) {
      return false
    }
    return target.hasOffer(work.repository, work.kind)
  }

  private async headroom(
    work: ResourceRelocationWork,
    target: ResourceRelocationTarget,
    signal: AbortSignal,
  ): Promise<'ample' | 'some' | null> {
    if (signal.aborted || !this.offered(work, target)) return null
    let clear: (() => void) | undefined
    const expired = new Promise<null>((resolve) => {
      clear = this.options.clock.setTimeout(() => {
        resolve(null)
      }, RESOURCE_RELOCATION_PROBE_MS)
    })
    try {
      const parsed = deviceResourceSchema.safeParse(
        await unlessAborted(Promise.race([target.resource(), expired]), signal),
      )
      return !parsed.success ||
        !canAdmitResourceRelocation(parsed.data.level) ||
        parsed.data.headroom === 'none'
        ? null
        : parsed.data.headroom
    } finally {
      clear?.()
    }
  }

  private async select(
    work: ResourceRelocationWork,
    signal: AbortSignal,
    targetId: string | undefined,
  ): Promise<ResourceRelocationTarget | undefined> {
    const targets = [
      ...(this.options.devicesEnabled() ? this.options.devices(work) : []),
      ...(work.kind === 'check' && work.heavy && this.options.runnersEnabled()
        ? this.options.runners(work)
        : []),
    ]
    const rooms = await Promise.all(
      targets.map(async (target) => {
        if (targetId !== undefined && target.id !== targetId) return null
        try {
          return await this.headroom(work, target, signal)
        } catch (error) {
          this.options.onError(error)
          return null
        }
      }),
    )
    if (signal.aborted) return undefined
    const room = rooms.includes('ample') ? 'ample' : 'some'
    return targets.find((_target, index) => rooms[index] === room)
  }

  private report(
    target: ResourceRelocationTarget,
    kind: 'worker' | 'check',
    level: ResourceLevel,
  ): void {
    const event: RelocatedEvent = {
      type: 'relocated',
      atMs: this.options.clock.now(),
      kind,
      level,
      reason: 'machineBusy',
    }
    // Independent reporting failures cannot change already-admitted ownership.
    const reports = [
      () => {
        if (this.noticed) {
          return
        }

        this.options.notice(target)
        this.noticed = true
      },
      () => {
        this.options.traffic(target, structuredClone(event))
      },
      () => {
        this.options.events.publish(event)
      },
    ]
    for (const report of reports) {
      try {
        report()
      } catch (error) {
        this.options.onError(error)
      }
    }
  }

  private async move(
    work: ResourceRelocationWork,
    signal: AbortSignal,
    targetId: string | undefined,
    state: { isDispatched: boolean },
  ): Promise<RelocationResult> {
    await Promise.resolve()
    let isClaimed = false
    let result: RelocationResult = 'kept'
    try {
      const isManual = targetId !== undefined
      const isRunning = work.phase() === 'running'
      if (
        (work.kind !== 'worker' && work.kind !== 'check') ||
        (isRunning && (!isManual || work.kind !== 'check' || work.retire === undefined)) ||
        this.status(signal, isManual) === null
      )
        return result
      isClaimed = work.claim()
      if (!isClaimed || this.status(signal, isManual) === null) return result
      const target = await this.select(work, signal, targetId)
      let status = this.status(signal, isManual)
      if (target === undefined || status === null) return result
      let isApproved = isManual
      if (!isApproved && status.settings.relocate === 'ask') {
        isApproved = await this.options.ask(work, target)
        if (!isApproved) return result
      }
      if (isRunning) {
        result = 'uncertain'
        if ((await work.retire?.()) !== true) return result
        result = 'kept'
      }
      if (this.status(signal, isManual) === null) return result
      if ((await this.headroom(work, target, signal)) === null) return result
      status = this.status(signal, isManual)
      if (status === null || (!isRunning && work.phase() !== 'queued')) return result
      if (!isApproved && status.settings.relocate === 'ask') {
        isApproved = await this.options.ask(work, target)
        if (!isApproved || (await this.headroom(work, target, signal)) === null) return result
        status = this.status(signal, isManual)
        if (status === null || (!isRunning && work.phase() !== 'queued')) return result
      }
      const metadata: RelocationMetadata = Object.freeze({
        reason: 'machineBusy',
        level: status.level,
      })
      this.options.row(work, target, metadata)
      // Synchronous row/offer ports may revoke permission or cancel re-entrantly.
      if (!this.offered(work, target) || (!isRunning && work.phase() !== 'queued')) return result
      const final = this.status(signal, isManual)
      if (final?.level !== metadata.level || (!isApproved && final.settings.relocate === 'ask'))
        return result
      state.isDispatched = true
      const admission = await target.dispatch(metadata, signal)
      if (admission === 'refused') return result
      result = admission === 'admitted' ? 'admitted' : 'uncertain'
      if (result === 'admitted') this.report(target, work.kind, metadata.level)
      return result
    } catch (error) {
      if (result !== 'admitted' && state.isDispatched) result = 'uncertain'
      this.options.onError(error)
      return result
    } finally {
      if (isClaimed) work.settle(result)
    }
  }

  create(work: ResourceRelocationWork): ResourceRelocationAttempt {
    const cancel = new AbortController()
    const state = { isDispatched: false }
    let pending: Promise<RelocationResult> | undefined
    return {
      run: (targetId) => {
        // Install the shared result before any injected port can re-enter.
        pending ??= this.move(work, cancel.signal, targetId, state)
        return pending
      },
      keepHere: async () => {
        cancel.abort()
        if (pending === undefined) return true
        const result = await pending
        return !state.isDispatched || result === 'kept'
      },
    }
  }
}
