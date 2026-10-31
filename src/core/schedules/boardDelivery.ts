// Role and team targets onto M96c's board (C-M115-8, D95.7): each fire
// becomes one task under the role's charter, through the team core's own
// admission. Worker and node targets stay with G/M110 and refuse here.
// No team import: the host installs its team core through the port below,
// so the schedules bundle never carries the team runtime.
import { createHash } from 'node:crypto'
import { SCHEDULE_MODEL_TEXT, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { minUsd, type UsdAmount } from '../../shared/usd'
import { errorNameForLog } from '../logging'
import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  noScheduleCost,
  scheduleFireRecordSchema,
  scheduleRunContextSchema,
  scheduleV2Schema,
  type ScheduleDeliveryResult,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import type { ScheduleAuthorityStore } from './grantAudit'
import type { ScheduleExternalDelivery } from './delivery'
import { isRunContextOf } from './runIdentity'

/** One fire's admission to a team's board. The shapes mirror
ScheduledBoardTaskInput/Outcome in core/team/teamHostService.ts; the
host's adapter maps them field by field, so a drift breaks the build. */
export interface ScheduleBoardAdmission {
  /** Omitted for a team target: the stored team's first role. */
  readonly roleId?: string | undefined
  readonly brief: string
  /** The fire's idempotency key on the board; resubmission adopts the task. */
  readonly boardKey: string
  /** The parent session the board and ledger name; stable per schedule. */
  readonly parentSessionId: string
  readonly paidCapUsd: UsdAmount
  /** The schedule's paid consent covers this fire's key spend. */
  readonly paidConsented: boolean
}

export type ScheduleBoardAdmissionOutcome =
  | { readonly admitted: true; readonly taskId: string | undefined; readonly roleId: string }
  | { readonly admitted: false; readonly reason: string }

export interface ScheduleTeamBoard {
  admit(input: ScheduleBoardAdmission): Promise<ScheduleBoardAdmissionOutcome>
}

/** The host's team core, by workspace. Undefined where this host runs none. */
export interface ScheduleTeamBoards {
  teamFor(workspaceKey: string): Promise<ScheduleTeamBoard | undefined>
}

/** The fire's board key: the run id hashed, so every run id fits the board's id shape. */
export function scheduleBoardKey(runId: string): string {
  return `schedule-${createHash('sha256').update(runId, 'utf8').digest('hex')}`
}

/** The board's parent session for a schedule's tasks: stable per schedule. */
export function scheduleBoardParent(scheduleId: string): string {
  return `sched-${createHash('sha256').update(scheduleId, 'utf8').digest('hex')}`
}

export interface ScheduleBoardDeliveryDeps {
  readonly boards: ScheduleTeamBoards
  readonly authority: ScheduleAuthorityStore
  readonly now: () => number
}

export class ScheduleBoardDelivery implements ScheduleExternalDelivery {
  constructor(private readonly deps: ScheduleBoardDeliveryDeps) {}

  async deliver(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    const s = scheduleV2Schema.parse(schedule)
    const c = scheduleRunContextSchema.parse(context)
    if (
      s.action.kind !== 'prompt' ||
      !Number.isSafeInteger(occurrenceMs) ||
      occurrenceMs < 0 ||
      !isRunContextOf(s, c)
    )
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const e = event === undefined ? undefined : scheduleEventSchema.parse(event)
    const settle = (
      outcome: ScheduleDeliveryResult['outcome'],
      reason?: string,
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
      })
    // G/M110 bind workers/nodes; this delivery owns role/team only.
    if (s.target.kind !== 'role' && s.target.kind !== 'team')
      return settle('refused', UI_TEXT.scheduleV2.messages.targetUnavailable)
    // The workspace's team is named by the schedule's own workspace key:
    // a fire reaches only the team where a host holds its workspace.
    if (s.target.teamId !== s.workspaceKey)
      return settle('refused', UI_TEXT.scheduleV2.messages.targetUnavailable)
    // Last-at-dispatch currency, as the conversation path's checkDispatch:
    // a schedule edited, paused or deleted since admission refuses here.
    const live = await this.deps.authority.read(s.workspaceKey, s.id)
    if (live === undefined) return settle('refused', UI_TEXT.scheduleV2.messages.scheduleDeleted)
    if (live.paused) return settle('refused', UI_TEXT.scheduleV2.messages.schedulePaused)
    if (JSON.stringify(live.target) !== JSON.stringify(s.target))
      return settle('refused', UI_TEXT.scheduleV2.messages.scheduleEdited)
    if (
      live.mode !== s.mode ||
      JSON.stringify(live.grant) !== JSON.stringify(s.grant) ||
      JSON.stringify(live.paidConsent) !== JSON.stringify(s.paidConsent)
    )
      return settle('refused', UI_TEXT.scheduleV2.messages.changedConsent)
    const team = await this.deps.boards.teamFor(s.workspaceKey)
    if (team === undefined) return settle('refused', UI_TEXT.scheduleV2.messages.targetUnavailable)
    // The consent's cap never exceeds the live paid cap: the schedule
    // schema refines it on every write and the store parses every read, so
    // lowering a cap below the consented spend renews consent first.
    const consent = s.paidConsent
    // The event stays fenced and wholly inside the brief; it cannot become
    // a grant, a system note or a tool list (the conversation path's fence).
    const brief =
      e === undefined
        ? s.action.prompt
        : `${s.action.prompt}\n\n${SCHEDULE_MODEL_TEXT.eventUntrusted}\n\`\`\`json\n${JSON.stringify({ trust: 'untrusted', event: e })}\n\`\`\``
    let admission: ScheduleBoardAdmissionOutcome
    try {
      admission = await team.admit({
        ...(s.target.kind === 'role' && { roleId: s.target.roleId }),
        brief,
        boardKey: scheduleBoardKey(c.runId),
        parentSessionId: scheduleBoardParent(s.id),
        paidCapUsd:
          consent === undefined
            ? minUsd(live.paidCapUsd, live.grant.paidCapUsd)
            : minUsd(live.paidCapUsd, live.grant.paidCapUsd, consent.dailyCapUsd),
        paidConsented: consent !== undefined,
      })
    } catch (error: unknown) {
      return settle(
        'failed',
        fill(UI_TEXT.scheduleV2.messages.deliveryFailed, { reason: errorNameForLog(error) }),
      )
    }
    return admission.admitted ? settle('ran') : settle('refused', admission.reason)
  }
}
