import path from 'node:path'
import type { ScheduleAuthorityStore } from './grantAudit'
import type {
  ReportScheduleAuthorityPort,
  ScheduledReportAction,
} from '../reporting/destinations/types'

export interface ScheduleReportAuthorityDeps {
  /** The live grant: reads observe other holders, so a revocation or edit
  between claim and run refuses. */
  readonly authority: Pick<ScheduleAuthorityStore, 'read'>
  readonly workspaceKey: string
  readonly workspaceRoot: string
}

/** The static path prefix of a grant glob: up to its first wildcard. */
function globRoot(glob: string): string {
  const segments = glob.split(/[\\/]/)
  const kept: string[] = []
  for (const segment of segments) {
    if (segment.includes('*') || segment.includes('?') || segment.includes('[')) break
    kept.push(segment)
  }
  return kept.join('/')
}

/**
M115's live full-destination authority for M113 Q's runner: the run's
destinations are allowed only while the live schedule exists, runs a
report action, is not paused, and its live grant still names every run
destination id. Roots come from the live path rules; v2 grants name no
network permission, so scheduled reports never use network sources.
The adapter translates from the live schedule at run time, so an edited
target runs only under the live grant that covers it.
*/
export function createScheduleReportAuthority(
  deps: ScheduleReportAuthorityDeps,
): ReportScheduleAuthorityPort {
  return {
    async authorize(scheduleId: string, action: ScheduledReportAction) {
      const denied = {
        allowed: false as const,
        roots: [],
        network: false,
        creator: 'user' as const,
      }
      const schedule = await deps.authority.read(deps.workspaceKey, scheduleId)
      if (schedule === undefined || schedule.paused || schedule.action.kind !== 'report')
        return denied
      const covered = new Set(schedule.grant.destinationIds)
      if (action.destinations.some((item) => !covered.has(item.id))) return denied
      const roots = schedule.grant.rules
        .filter((rule) => rule.kind === 'path')
        .map((rule) => path.resolve(deps.workspaceRoot, globRoot(rule.glob)))
      return {
        allowed: true,
        roots: [...new Set(roots)],
        network: false,
        creator: schedule.creator.kind,
      }
    },
  }
}
