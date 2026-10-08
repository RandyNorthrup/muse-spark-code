import { UI_TEXT } from '../../shared/constants'
import { isRunContextOf } from './runIdentity'
import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  scheduleV2Schema,
  scheduleRunContextSchema,
  scheduleFireRecordSchema,
  noScheduleCost,
  scheduleReportResultsSchema,
  scheduleGrantAuditSchema,
  scheduleDraftSchema,
  scheduleResponseSchema,
  type ScheduleV2,
  type ScheduleRunContext,
  type ScheduleReportAction,
  type ScheduleDeliveryResult,
  type ScheduleStoreV2,
  type ScheduleDraft,
  type ScheduleGrant,
  type ScheduleNoEscalation,
} from '../../shared/scheduleV2'

export interface ScheduleReportPort {
  /** M113 Q binding: resolve only configured root/recipient/connection ids,
   * validate its ScheduledReportAction, then call ScheduledReportRunner.run
   * (schedule.id, asOf, action). Bind Q's live full-destination authority,
   * durable occurrence/root leases, previews and scrub before enabling it.
   * This port has no prompt backend or paid-reservation dependency. */
  run(
    schedule: ScheduleV2 & { action: ScheduleReportAction },
    context: ScheduleRunContext,
    asOf: string,
  ): Promise<unknown>
}

export interface ScheduleReportDeliveryPort {
  run(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult>
}

export interface ScheduleReportDeps {
  readonly store: ScheduleStoreV2
  readonly reports: ScheduleReportPort
  readonly audit: (entry: ReturnType<typeof scheduleGrantAuditSchema.parse>) => Promise<void>
  readonly now: () => number
}

/** S calls this after the ordinary permanent claim and per-target admission.
 * No second scheduler, prompt turn, interactive question or money reservation. */
export class ScheduleReportActionRunner implements ScheduleReportDeliveryPort {
  constructor(private readonly deps: ScheduleReportDeps) {}

  private async isCurrent(schedule: ScheduleV2): Promise<boolean> {
    const schedules = await this.deps.store.list(schedule.workspaceKey)
    const current = schedules.find((item) => item.id === schedule.id)
    return (
      current !== undefined &&
      !current.paused &&
      JSON.stringify(scheduleV2Schema.parse(current)) === JSON.stringify(schedule)
    )
  }

  async run(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    const s = scheduleV2Schema.parse(schedule)
    const c = scheduleRunContextSchema.parse(context)
    if (
      s.action.kind !== 'report' ||
      !Number.isSafeInteger(occurrenceMs) ||
      occurrenceMs < 0 ||
      !Number.isFinite(new Date(occurrenceMs).getTime()) ||
      !isRunContextOf(s, c)
    )
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const e = event === undefined ? undefined : scheduleEventSchema.parse(event)
    const settle = (
      outcome: ScheduleDeliveryResult['outcome'],
      reason?: string,
      report?: ReturnType<typeof scheduleReportResultsSchema.parse>,
    ): ScheduleDeliveryResult =>
      scheduleFireRecordSchema.parse({
        runId: c.runId,
        scheduleId: s.id,
        workspaceKey: s.workspaceKey,
        occurrenceMs,
        observedAtMs: this.deps.now(),
        target: s.target,
        delivery: s.delivery,
        outcome,
        ...(reason !== undefined && { reason }),
        refusedActions: [],
        cost: noScheduleCost(),
        ...(e !== undefined && { event: e }),
        ...(report !== undefined && { report }),
      })
    try {
      if (!(await this.isCurrent(s)))
        return settle('refused', UI_TEXT.scheduleV2.reportAction.grantRequired)
      if (s.action.destinations.some((item) => !s.grant.destinationIds.includes(item.id)))
        return settle('refused', UI_TEXT.scheduleV2.reportAction.grantRequired)
      if (s.action.destinations.some((item) => item.kind === 'cloud' || item.kind === 'sms'))
        return settle('refused', UI_TEXT.scheduleV2.messages.plannedDestination)
      // Audit the admitted use before dispatch; no destination arguments or content.
      for (const destination of s.action.destinations)
        await this.deps.audit(
          scheduleGrantAuditSchema.parse({
            scheduleId: s.id,
            atMs: this.deps.now(),
            kind: 'used',
            runId: c.runId,
            destinationId: destination.id,
          }),
        )
      if (!(await this.isCurrent(s)))
        return settle('refused', UI_TEXT.scheduleV2.reportAction.grantRequired)
      const report = scheduleReportResultsSchema.safeParse(
        await this.deps.reports.run(
          { ...s, action: s.action },
          c,
          new Date(occurrenceMs).toISOString(),
        ),
      )
      if (
        !report.success ||
        Object.keys(report.data).length !== s.action.destinations.length ||
        s.action.destinations.some((item) => !Object.hasOwn(report.data, item.id))
      )
        return settle('failed', UI_TEXT.scheduleV2.reportAction.invalidResult)
      const results = Object.values(report.data)
      if (results.some((item) => item.status === 'failed' || item.status === 'uncertain'))
        return settle('failed', UI_TEXT.scheduleV2.reportAction.failed, report.data)
      if (results.some((item) => item.status === 'refused'))
        return settle('refused', UI_TEXT.scheduleV2.reportAction.grantRequired, report.data)
      return results.some((item) => item.status === 'deferred')
        ? settle('skipped', UI_TEXT.scheduleV2.messages.openWhenBack, report.data)
        : settle('ran', undefined, report.data)
    } catch {
      // Report/provider errors may contain paths, recipients or credentials.
      return settle('failed', UI_TEXT.scheduleV2.reportAction.failed)
    }
  }
}

/** G's port must enforce charter, full destination authority (including creator
 * roots and verified recipients), consent, caps, depth and creator lifetime.
 * Tool arguments never provide the creator, consent or rescheduling permission. */
export interface ScheduleReportAgentPort {
  /** Resolve complete targets under the creator's canonical roots and verified
   * recipient/post permissions. Matching an opaque id alone is insufficient. */
  destinationsAllowed(action: ScheduleReportAction): Promise<boolean>
  admit(draft: ScheduleDraft): Promise<unknown>
}

export function scheduleReportTool(
  port: ScheduleReportAgentPort,
  noEscalation: ScheduleNoEscalation,
  creatorGrant: () => ScheduleGrant,
) {
  return {
    name: 'schedule_report',
    async execute(input: unknown): Promise<ReturnType<typeof scheduleResponseSchema.parse>> {
      const parsed = scheduleDraftSchema.safeParse(input)
      if (!parsed.success)
        return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidRequest }
      try {
        const action = parsed.data.action
        if (action.kind !== 'report')
          return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidRequest }
        if (!(await port.destinationsAllowed(action)))
          return { kind: 'refused', reason: UI_TEXT.scheduleV2.reportAction.grantRequired }
        const draft = parsed.data
        const creator = creatorGrant()
        const bounded = noEscalation.bounded(draft.grant, creator)
        if (
          action.destinations.some(
            (item) =>
              !bounded.destinationIds.includes(item.id) ||
              !draft.grant.destinationIds.includes(item.id) ||
              !creator.destinationIds.includes(item.id),
          )
        )
          return { kind: 'refused', reason: UI_TEXT.scheduleV2.reportAction.grantRequired }
        const response = scheduleResponseSchema.safeParse(
          await port.admit(
            scheduleDraftSchema.parse({
              ...draft,
              grant: { ...bounded, destinationIds: action.destinations.map((item) => item.id) },
            }),
          ),
        )
        return response.success &&
          (response.data.kind === 'accepted' || response.data.kind === 'refused')
          ? response.data
          : { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidResponse }
      } catch {
        return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.unavailable }
      }
    },
  }
}
