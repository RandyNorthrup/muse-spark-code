import { randomUUID } from 'node:crypto'
import type {
  ScheduleEvent,
  ScheduleEventKind,
  ScheduleHistoryRange,
  ScheduleSubscribedEventSource,
  ScheduleSourceCapability,
} from '../../../shared/scheduleEvents'
import { scheduleRequestSchema } from '../../../shared/scheduleV2'
import { sourceEvent } from './registry'
import { noEventHistory, unavailableSource, type ScheduleSignalPort } from './ports'

export class ScheduleSignalSource implements ScheduleSubscribedEventSource {
  constructor(
    readonly id: string,
    readonly kinds: readonly ScheduleEventKind[],
    private readonly dependency: string,
    private readonly port: ScheduleSignalPort | undefined,
    private readonly onRejected: (id: string) => void,
  ) {}
  capability(): ScheduleSourceCapability {
    return this.port?.capability() ?? unavailableSource(this.dependency)
  }
  history(range: ScheduleHistoryRange) {
    const capability = this.capability()
    return capability.available
      ? (this.port?.history?.(range) ?? noEventHistory())
      : Promise.resolve(capability)
  }
  subscribe(listener: (event: ScheduleEvent) => void): { dispose(): void } {
    const capability = this.capability()
    if (!capability.available || !this.port)
      throw new Error(capability.available ? this.dependency : capability.reason)
    let isDisposed = false
    const subscription = this.port.subscribe((input) => {
      if (isDisposed || !this.capability().available) return
      let event: ScheduleEvent
      try {
        event = sourceEvent(this, input)
      } catch {
        this.onRejected(this.id)
        return
      }
      listener(event)
    })
    return {
      dispose: () => {
        isDisposed = true
        subscription.dispose()
      },
    }
  }
}

/** Hosts publish their own parsed finish/answer events through this shared hub. */
export class ScheduleHostEvents implements ScheduleSubscribedEventSource {
  private readonly listeners = new Set<(event: ScheduleEvent) => void>()
  constructor(
    readonly id: string,
    readonly kinds: readonly ScheduleEventKind[],
  ) {}
  capability(): ScheduleSourceCapability {
    return { available: true }
  }
  history() {
    return noEventHistory()
  }
  publish(input: unknown): void {
    const event = sourceEvent(this, input)
    for (const listener of this.listeners) listener(structuredClone(event))
  }
  subscribe(listener: (event: ScheduleEvent) => void): { dispose(): void } {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }
}

export class ScheduleManualSource extends ScheduleHostEvents {
  constructor(
    private readonly workspaceKey: string,
    private readonly now: () => number,
  ) {
    super('manual', ['manual'])
  }
  fire(scheduleId: string): void {
    scheduleRequestSchema.parse({
      method: 'schedules/fire',
      workspaceKey: this.workspaceKey,
      id: scheduleId,
    })
    this.publish({
      source: this.id,
      kind: 'manual',
      eventKey: randomUUID(),
      observedAt: this.now(),
      fields: { scheduleId },
    })
  }
}
