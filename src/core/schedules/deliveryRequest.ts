// The delivery-call preamble the report and board runners share: parse
// and validate the call, and settle the fire record. One shape, so a
// drift breaks one build instead of two behaviours.
import { UI_TEXT } from '../../shared/constants'
import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  noScheduleCost,
  scheduleFireRecordSchema,
  scheduleRunContextSchema,
  scheduleV2Schema,
  type ScheduleDeliveryResult,
  type ScheduleReportResults,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import { isRunContextOf } from './runIdentity'

export interface ParsedDeliveryCall<Action extends ScheduleV2['action'] = ScheduleV2['action']> {
  readonly schedule: ScheduleV2 & { readonly action: Action }
  readonly context: ScheduleRunContext
  readonly event: ScheduleEvent | undefined
  readonly settle: (
    outcome: ScheduleDeliveryResult['outcome'],
    reason?: string,
    report?: ScheduleReportResults,
  ) => ScheduleDeliveryResult
}

interface DeliveryCallOptions<Action extends 'prompt' | 'report'> {
  readonly schedule: ScheduleV2
  readonly context: ScheduleRunContext
  readonly occurrenceMs: number
  readonly event?: ScheduleEvent
  readonly action: Action
  readonly now: () => number
}

export function parseDeliveryCall<Action extends 'prompt' | 'report'>(
  options: DeliveryCallOptions<Action>,
): ParsedDeliveryCall<Extract<ScheduleV2['action'], { kind: Action }>>
export function parseDeliveryCall(
  options: DeliveryCallOptions<'prompt' | 'report'>,
): ParsedDeliveryCall {
  const s = scheduleV2Schema.parse(options.schedule)
  const c = scheduleRunContextSchema.parse(options.context)
  if (
    s.action.kind !== options.action ||
    !Number.isSafeInteger(options.occurrenceMs) ||
    options.occurrenceMs < 0 ||
    !Number.isFinite(new Date(options.occurrenceMs).getTime()) ||
    !isRunContextOf(s, c)
  )
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  const e = options.event === undefined ? undefined : scheduleEventSchema.parse(options.event)
  const settle = (
    outcome: ScheduleDeliveryResult['outcome'],
    reason?: string,
    report?: ScheduleReportResults,
  ): ScheduleDeliveryResult =>
    scheduleFireRecordSchema.parse({
      runId: c.runId,
      scheduleId: s.id,
      workspaceKey: s.workspaceKey,
      occurrenceMs: options.occurrenceMs,
      observedAtMs: options.now(),
      target: s.target,
      delivery: s.delivery,
      outcome,
      ...(reason !== undefined && { reason }),
      refusedActions: [],
      cost: noScheduleCost(),
      ...(e !== undefined && { event: e }),
      ...(report !== undefined && { report }),
    })
  return { schedule: s, context: c, event: e, settle }
}
