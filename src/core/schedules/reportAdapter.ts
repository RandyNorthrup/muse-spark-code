import { UI_TEXT } from '../../shared/constants'
import {
  scheduleActionSchema,
  type ScheduleReportAction,
  type ScheduleStoreV2,
} from '../../shared/scheduleV2'
import { ScheduledReportRunner, type ScheduledReportPorts } from '../reporting/destinations/runner'
import type {
  ReportOccurrencePort,
  ScheduledReportAction as RunnerReportAction,
} from '../reporting/destinations/types'
import type { ScheduleAuthorityStore } from './grantAudit'
import { createScheduleReportAuthority } from './reportAuthority'
import type { ScheduleReportPort } from './reportAction'

/**
M113 Q's side of a scheduled report: its arg parser and address book
translate the live v2 action, and its generation, locale, redaction and
destination transports run it. Unbound until M113's lane binds it; the
adapter refuses with the pending sentence while it is.
*/
export interface ScheduleReportBackendPort {
  translate(
    action: ScheduleReportAction,
    context: ScheduleReportTranslateContext,
  ): Promise<RunnerReportAction>
  runner: Omit<ScheduledReportPorts, 'authority' | 'occurrences'>
}

export interface ScheduleReportTranslateContext {
  readonly locale: string
  readonly workspaceKey: string
  readonly workspaceRoot: string
  readonly asOf: string
}

export interface ScheduleReportBindingDeps {
  readonly store: ScheduleStoreV2
  readonly authorityStore: Pick<ScheduleAuthorityStore, 'read'>
  readonly occurrences: ReportOccurrencePort
  readonly backend?: ScheduleReportBackendPort
  readonly locale: string
  readonly roots: (workspaceKey: string) => Promise<string | undefined>
}

/**
RA's production binding for M113 Q's runner: the ScheduleReportPort the
delivery runner calls after its grant checks. The v2 action is validated,
the live schedule is re-read (an unknown schedule throws), the backend
translates the LIVE action, and the runner runs with M115's authority
and occurrences. Nothing runs while M113's backend is unbound.
*/
export function createScheduleReportPort(deps: ScheduleReportBindingDeps): ScheduleReportPort {
  return {
    availability() {
      return deps.backend === undefined
        ? { available: false, reason: UI_TEXT.scheduleV2.reportAction.destinationsPending }
        : { available: true }
    },
    async run(schedule, _context, asOf) {
      scheduleActionSchema.parse(schedule.action)
      const jobs = await deps.store.list(schedule.workspaceKey)
      const live = jobs.find((item) => item.id === schedule.id)
      if (live === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
      const liveAction = scheduleActionSchema.parse(live.action)
      if (liveAction.kind !== 'report') throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
      const backend = deps.backend
      if (backend === undefined)
        throw new Error(UI_TEXT.scheduleV2.reportAction.destinationsPending)
      const workspaceRoot = await deps.roots(schedule.workspaceKey)
      if (workspaceRoot === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
      const translated = await backend.translate(liveAction, {
        locale: deps.locale,
        workspaceKey: schedule.workspaceKey,
        workspaceRoot,
        asOf,
      })
      const runner = new ScheduledReportRunner({
        authority: createScheduleReportAuthority({
          authority: deps.authorityStore,
          workspaceKey: schedule.workspaceKey,
          workspaceRoot,
        }),
        occurrences: deps.occurrences,
        ...backend.runner,
      })
      return await runner.run(schedule.id, asOf, translated)
    },
  }
}

export type ScheduleReportDestinationVerdict =
  boolean | { readonly allowed: false; readonly reason: string }

/**
G's structural destination check for the schedule_report tool: a
destination is allowed only when it names its complete target. Opaque
root, recipient and connection ids resolve with M113's address book;
GitLab posts, cloud and SMS have no runner at all.
*/
function destinationVerdict(
  destination: ScheduleReportAction['destinations'][number],
): ScheduleReportDestinationVerdict | undefined {
  if (destination.kind === 'save' || destination.kind === 'email') return pendingVerdict()
  if (destination.kind === 'cloud' || destination.kind === 'sms') return pendingVerdict()
  if (destination.kind === 'browser') return undefined
  if (destination.provider !== 'github') return pendingVerdict()
  return isPostRepository(destination.repository) ? undefined : pendingVerdict()
}

function isPostRepository(repository: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(repository)
}

function pendingVerdict(): ScheduleReportDestinationVerdict {
  return { allowed: false, reason: UI_TEXT.scheduleV2.reportAction.destinationsPending }
}

export function reportDestinationsAllowed(
  action: ScheduleReportAction,
): ScheduleReportDestinationVerdict {
  const refused = action.destinations
    .map((destination) => destinationVerdict(destination))
    .find((verdict) => verdict !== undefined)
  return refused ?? true
}
