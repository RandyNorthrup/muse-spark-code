import { performance } from 'node:perf_hooks'
import { UI_TEXT } from '../../shared/constants'
import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import type { ScheduleReportDeliveryPort } from '../../core/schedules/reportAction'
import { isRunContextOf } from '../../core/schedules/runIdentity'
import {
  scheduleV2Schema,
  scheduleRunContextSchema,
  scheduleFireRecordSchema,
  noScheduleCost,
  type ScheduleDeliveryState,
  type ScheduleHostPort,
  type ScheduleV2,
  type ScheduleRunContext,
  type ScheduleDeliveryResult,
} from '../../shared/scheduleV2'

export interface RuntimeScheduleHostDeps {
  readonly isAvailable?: () => boolean
  readonly signal?: AbortSignal
  lookupRun?(workspaceKey: string, runId: string): Promise<ScheduleDeliveryState>
  readonly reports?: ScheduleReportDeliveryPort
  readonly deliver: (
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ) => Promise<unknown>
  readonly now?: () => number
  readonly monotonicNow?: () => number
}

/** Native, companion and ACP sessions hold a reference to the same workspace. */
export class RuntimeScheduleHost implements ScheduleHostPort {
  private readonly workspaces = new Map<string, number>()
  constructor(private readonly deps: RuntimeScheduleHostDeps) {}
  get signal(): AbortSignal | undefined {
    return this.deps.signal
  }
  async lookupRun(runId: string): Promise<ScheduleDeliveryState> {
    for (const workspace of this.workspaces.keys()) {
      const state = await this.deps.lookupRun?.(workspace, runId)
      if (state !== undefined && state.status !== 'absent') return state
    }
    return { status: 'absent' }
  }
  now(): number {
    return (this.deps.now ?? Date.now)()
  }
  monotonicNow(): number {
    return (this.deps.monotonicNow ?? (() => performance.now()))()
  }
  holds(workspaceKey: string): boolean {
    return (this.deps.isAvailable?.() ?? true) && (this.workspaces.get(workspaceKey) ?? 0) > 0
  }
  hold(workspaceKey: string): () => void {
    this.workspaces.set(workspaceKey, (this.workspaces.get(workspaceKey) ?? 0) + 1)
    let isReleased = false
    return () => {
      if (isReleased) return
      isReleased = true
      const count = (this.workspaces.get(workspaceKey) ?? 1) - 1
      if (count === 0) this.workspaces.delete(workspaceKey)
      else this.workspaces.set(workspaceKey, count)
    }
  }
  async deliver(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    const s = scheduleV2Schema.parse(schedule)
    // A released hold refuses synchronously at the boundary, before anything
    // is sent. The core matches this sentence to record a known not-sent fire
    // with its liability released, never an uncertain one.
    if (!this.holds(s.workspaceKey)) throw new Error(UI_TEXT.scheduleV2.messages.workspaceNotHeld)
    const c = scheduleRunContextSchema.parse(context)
    if (!isRunContextOf(s, c) || !Number.isSafeInteger(occurrenceMs) || occurrenceMs < 0)
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const e = event === undefined ? undefined : scheduleEventSchema.parse(event)
    let result: ScheduleDeliveryResult
    {
      if (s.action.kind === 'report' && this.deps.reports === undefined)
        result = scheduleFireRecordSchema.parse({
          runId: c.runId,
          scheduleId: s.id,
          workspaceKey: s.workspaceKey,
          occurrenceMs,
          observedAtMs: this.now(),
          target: s.target,
          delivery: s.delivery,
          outcome: 'refused',
          reason: UI_TEXT.scheduleV2.reportAction.unavailable,
          refusedActions: [],
          cost: noScheduleCost(),
          ...(e !== undefined && { event: e }),
        })
      else
        result = scheduleFireRecordSchema.parse(
          s.action.kind === 'report' && this.deps.reports !== undefined
            ? await this.deps.reports.run(s, c, occurrenceMs, e)
            : await this.deps.deliver(s, c, occurrenceMs, e),
        )
      if (
        result.runId !== c.runId ||
        result.scheduleId !== s.id ||
        result.workspaceKey !== s.workspaceKey ||
        result.occurrenceMs !== occurrenceMs ||
        result.delivery !== s.delivery ||
        JSON.stringify(result.target) !== JSON.stringify(s.target) ||
        JSON.stringify(result.event) !== JSON.stringify(e)
      )
        throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
      if (
        s.action.kind === 'report' &&
        (result.cost.usd !== '0' ||
          result.cost.certainty !== 'exact' ||
          result.cost.retainedLiabilityUsd !== '0' ||
          (result.outcome === 'ran' &&
            (result.report === undefined ||
              Object.values(result.report).some((item) => item.status !== 'delivered'))) ||
          (result.report !== undefined &&
            (Object.keys(result.report).length !== s.action.destinations.length ||
              s.action.destinations.some((item) => !Object.hasOwn(result.report ?? {}, item.id)))))
      )
        throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
    }
    return result
  }
}
