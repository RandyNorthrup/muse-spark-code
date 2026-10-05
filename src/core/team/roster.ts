// Scheduler data is appended to tool answers and the state-change tail only.
// M96 supplies stable roster/rubric bytes; no live count enters that prefix.
import * as z from 'zod/mini'
import { TEAM_SCHED_HISTORY_MAX } from '../../shared/constants'
import {
  teamBoardSchema,
  teamMergeOptionsSchema,
  teamSchedulerEventSchema,
  teamWriteSetLeaseSchema,
  type TeamSchedulerEvent,
} from '../../shared/team'

const liveSchema = z.strictObject({
  board: teamBoardSchema,
  leases: z.array(teamWriteSetLeaseSchema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
  mergeQueue: z
    .array(
      z.strictObject({
        taskId: teamMergeOptionsSchema.shape.task_id,
        position: z.int().check(z.gte(1)),
        reason: z.string(),
      }),
    )
    .check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
  events: z.array(teamSchedulerEventSchema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
})

/** Required adapters over S/C/Q's live snapshots; no placeholder snapshot is
 * used when a lane is unavailable. Base entry headroom/budget/report data is
 * preserved in the M96 tool's result. These reads do not dispatch work. */
export interface SchedulerRosterSource {
  read(): unknown
}

export function schedulerToolAnswer(
  result: string | undefined,
  source: SchedulerRosterSource,
): string {
  const scheduler = liveSchema.parse(source.read())
  const workspace = scheduler.board.workspaceId
  if (
    scheduler.leases.some((lease) => lease.workspaceId !== workspace) ||
    scheduler.events.some((event) => event.workspaceId !== workspace)
  ) {
    throw new Error('schedulerWorkspaceMismatch')
  }
  return JSON.stringify({ kind: 'data', result, scheduler })
}

/** M96's note drains once per orchestrator conversation, at a request tail.
 * Usage changes wait for the next tool answer. Event text is JSON data, never
 * promoted to an instruction, and earlier instruction bytes are untouched. */
export class SchedulerStateNote {
  private readonly pending: TeamSchedulerEvent[] = []
  private readonly seen: string[] = []

  constructor(private readonly workspaceId: string) {}

  record(input: unknown): void {
    const event = teamSchedulerEventSchema.parse(input)
    if (event.workspaceId !== this.workspaceId) throw new Error('schedulerWorkspaceMismatch')
    if (event.kind === 'usage') return
    // Identical deliveries of one state transition must announce it once.
    const identity = JSON.stringify(event)
    if (this.seen.includes(identity)) return
    if (this.pending.length >= TEAM_SCHED_HISTORY_MAX) throw new Error('schedulerNoteFull')
    this.pending.push(event)
    this.seen.push(identity)
    if (this.seen.length > TEAM_SCHED_HISTORY_MAX) this.seen.shift()
  }

  take(): string | undefined {
    if (this.pending.length === 0) return undefined
    const note = JSON.stringify({ kind: 'data', events: this.pending })
    this.pending.length = 0
    return note
  }
}
