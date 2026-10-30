// Board, reservations and scheduler tools load only for a scheduled team (M96c X2).
import { TaskBoard } from './scheduler/board'
import { SchedulerSlots } from './scheduler/slots'
import { TeamScheduler } from './teamPool'
import { TeamLiveAvailability, selectTeamEntry } from './selection'
import { pickReviewer } from './reviewerPick'
import { createSchedulerTeamTools } from './teamTools'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

// The window scheduler bundle (dist/teamWindow.js) rides this bundle's
// board, slots, pool and write-set code through the deferred cohort, so
// every member it imports is exported here: the split gate fails a member
// this list lacks.
export { BoardRefusal, TaskBoard } from './scheduler/board'
export { SchedulerSlots, isResourceSlotAvailable } from './scheduler/slots'
export { TeamScheduler } from './teamPool'

export function createTeamSchedulerRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    TaskBoard,
    SchedulerSlots,
    TeamScheduler,
    TeamLiveAvailability,
    selectTeamEntry,
    pickReviewer,
    createSchedulerTeamTools,
  }
}
