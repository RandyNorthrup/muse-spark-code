// Board, reservations and scheduler tools load only for a scheduled team (M96c X2).
import { TaskBoard } from './scheduler/board'
import { SchedulerSlots } from './scheduler/slots'
import { TeamScheduler } from './teamPool'
import { createSchedulerTeamTools } from './teamTools'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createTeamSchedulerRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return { TaskBoard, SchedulerSlots, TeamScheduler, createSchedulerTeamTools }
}
