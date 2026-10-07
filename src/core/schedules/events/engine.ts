import { randomUUID } from 'node:crypto'
import { SCHEDULE_EVENT_DEBOUNCE_MS } from '../../../shared/constants'
import {
  scheduleEventRunId,
  scheduleEventTriggerSchema,
  type ScheduleEvent,
  type ScheduleEventBlock,
} from '../../../shared/scheduleEvents'
import { isEventMatch } from './conditions'
import type { ScheduleEventPrivacy } from './privacy'

export interface ScheduleEventOccurrence {
  readonly scheduleId: string
  readonly runId: string
  readonly event: ScheduleEvent
  readonly block: ScheduleEventBlock
  readonly text: string
  readonly coalescedCount: number
}
interface PendingEvent {
  event: ScheduleEvent
  readyAt: number
  count: number
  readonly owner: string
  readonly runId: string
}
export interface ScheduleEventClaimState {
  readonly receipts: Set<string>
  readonly legacyReceipts: ReadonlySet<string>
  open?: PendingEvent
  ready: PendingEvent[]
}
/** S persists the entire mutation under one cross-process lock, before return.
 * Receipts include migrated legacy ids and never expire; only safe data is stored.
 */
export interface ScheduleEventClaimStore {
  schedules(): Promise<readonly string[]>
  transact<T>(scheduleId: string, update: (state: ScheduleEventClaimState) => T): Promise<T>
}
/** S supplies durable shared transactions and a clock comparable across hosts. */
export class ScheduleEventEngine {
  private readonly owner = randomUUID()
  private readonly generations = new Map<string, symbol>()
  constructor(
    private readonly now: () => number,
    private readonly claims: ScheduleEventClaimStore,
    private readonly privacy: ScheduleEventPrivacy,
  ) {}

  async enqueue(scheduleId: string, trigger: unknown, input: ScheduleEvent): Promise<boolean> {
    const rule = scheduleEventTriggerSchema.parse(trigger)
    // Validate the schedule identity with the source identifier's frozen schema.
    scheduleEventTriggerSchema.parse({
      kind: 'event',
      source: scheduleId,
      event: rule.event,
      conditions: [],
    })
    if (
      !isEventMatch(rule, input) ||
      (input.kind === 'manual' && input.fields['scheduleId'] !== scheduleId)
    )
      return false
    const generation = this.generations.get(scheduleId) ?? Symbol()
    this.generations.set(scheduleId, generation)
    const { event, legacyEventKey } = await this.privacy.admission(input)
    if (this.generations.get(scheduleId) !== generation) return false
    const runId = scheduleEventRunId(scheduleId, event)
    const legacyRunId = scheduleEventRunId(scheduleId, { ...event, eventKey: legacyEventKey })
    const isAdmitted = await this.claims.transact(scheduleId, (state) => {
      if (
        this.generations.get(scheduleId) !== generation ||
        state.receipts.has(runId) ||
        state.legacyReceipts.has(legacyRunId)
      )
        return false
      state.receipts.add(runId)
      const now = this.now()
      if (state.open && now >= state.open.readyAt) {
        state.ready.push(state.open)
        delete state.open
      }
      const current = state.open
      if (current) {
        // Joining never transfers ownership or combines different members' fields.
        if (
          event.observedAt < current.event.observedAt ||
          (event.observedAt === current.event.observedAt && event.eventKey < current.event.eventKey)
        )
          current.event = event
        current.readyAt = now + SCHEDULE_EVENT_DEBOUNCE_MS
        current.count += 1
      } else
        state.open = {
          event,
          readyAt: now + SCHEDULE_EVENT_DEBOUNCE_MS,
          count: 1,
          owner: this.owner,
          runId,
        }
      return true
    })
    return isAdmitted && this.generations.get(scheduleId) === generation
  }

  async drain(): Promise<ScheduleEventOccurrence[]> {
    const occurrences: ScheduleEventOccurrence[] = []
    const scheduleIds = await this.claims.schedules()
    for (const scheduleId of scheduleIds) {
      const generation = this.generations.get(scheduleId) ?? Symbol()
      this.generations.set(scheduleId, generation)
      const batches = await this.claims.transact(scheduleId, (state) => {
        if (this.generations.get(scheduleId) !== generation) return []
        const now = this.now()
        if (state.open && now >= state.open.readyAt) {
          state.ready.push(state.open)
          delete state.open
        }
        const taken: PendingEvent[] = []
        state.ready = state.ready.filter((burst) => {
          // A disappeared owner's lease lasts one debounce interval past its window.
          if (burst.owner !== this.owner && now < burst.readyAt + SCHEDULE_EVENT_DEBOUNCE_MS)
            return true
          taken.push(burst)
          return false
        })
        // Durable removal and permanent member receipts precede delivery/takeover.
        return taken
      })
      if (this.generations.get(scheduleId) !== generation) continue
      for (const pending of batches) {
        const safe = this.privacy.block(pending.event)
        occurrences.push({
          scheduleId,
          runId: pending.runId,
          event: pending.event,
          ...safe,
          coalescedCount: pending.count,
        })
      }
    }
    return occurrences
  }

  /** S awaits this on pause, removal, authority edits and trigger replacement. */
  async discard(scheduleId: string): Promise<void> {
    this.generations.delete(scheduleId)
    await this.claims.transact(scheduleId, (state) => {
      delete state.open
      state.ready = []
    })
  }
}
