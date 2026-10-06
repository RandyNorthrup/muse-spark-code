import type { ResourceGovernor } from '../../resources/governor'
import type {
  ResourceLaunchRequest,
  ResourcePermit,
  ResourceQueue,
  ResourceRunningWork,
} from '../../resources/queue'

type TeamKind = 'worker' | 'check'
type TeamSlotRequest = Omit<ResourceLaunchRequest, 'kind' | 'class'> & { kind: TeamKind }

export interface TeamCapacityPort {
  governor: Pick<ResourceGovernor, 'capacity'>
  running: ResourceRunningWork
  configured(kind: TeamKind): number
  occupied(kind: TeamKind): number
}

/** Existing scheduler occupancy includes its reservations, not just spawned roots. */
export function isResourceSlotAvailable(
  port: TeamCapacityPort,
  kind: TeamKind,
  hasSlot = false,
): boolean {
  const configured = port.configured(kind)
  const capacity = port.governor.capacity(kind)
  const limit = capacity === null ? configured : Math.min(configured, capacity)
  // A slot awaiting final admission already owns one local reservation, not a running tree.
  const occupied = Math.max(0, port.occupied(kind) - (hasSlot ? 1 : 0))
  if (occupied >= limit) return false
  if (capacity === null) return true
  const running = port.running.backgroundCount(kind)
  return running !== null && Math.max(occupied, running) < limit
}

interface SchedulerSlot {
  /** Withdraw unstarted reservations; otherwise require proved retirement. */
  release(): void
}

/** M96c supplies its existing child reservation/preflight and slot queue. */
export interface SchedulerSlotPort {
  preflight(request: ResourceLaunchRequest): void
  acquire(request: ResourceLaunchRequest, signal: AbortSignal): Promise<SchedulerSlot>
}

export interface GovernedTeamSlot {
  /** Preserve the queue's exact object as the child's parent permit. */
  readonly permit: ResourcePermit
  release(): void
}

/** Adds G's limit to M96c's slots without changing their caps or retirement authority. */
export class GovernedTeamSlots {
  constructor(
    private readonly queue: Pick<ResourceQueue, 'request'>,
    private readonly slots: SchedulerSlotPort,
    private readonly capacity: TeamCapacityPort,
  ) {}

  request(request: TeamSlotRequest, signal?: AbortSignal) {
    const copy: ResourceLaunchRequest & { kind: TeamKind } = { ...request, class: 'background' }
    // A delegating parent must fail before accepting an impossible wait.
    this.slots.preflight(copy)
    const stop = new AbortController()
    const combined = signal === undefined ? stop.signal : AbortSignal.any([signal, stop.signal])
    let admission = this.queue.request(copy, combined)
    const acquire = async (): Promise<GovernedTeamSlot> => {
      for (;;) {
        const permit = await admission.ready
        let slot: SchedulerSlot | undefined
        let isAdmitted = false
        try {
          combined.throwIfAborted()
          this.slots.preflight(copy)
          slot = await this.slots.acquire(copy, combined)
          combined.throwIfAborted()
          if (isResourceSlotAvailable(this.capacity, copy.kind, true)) {
            const acquired = slot
            let isReleased = false
            isAdmitted = true
            return {
              permit,
              release: () => {
                if (isReleased) return
                isReleased = true
                try {
                  acquired.release()
                } finally {
                  permit.release()
                }
              },
            }
          }
        } finally {
          if (!isAdmitted) {
            try {
              slot?.release()
            } finally {
              permit.release()
            }
          }
        }
        // Withdraw unstarted reservations before waiting again on the live governor.
        admission = this.queue.request(copy, combined)
      }
    }
    return {
      ready: acquire(),
      cancel: () => {
        stop.abort()
        admission.cancel()
      },
    }
  }
}
