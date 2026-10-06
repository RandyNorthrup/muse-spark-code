// The Model API team's tools and roster load only for a team conversation (D6).
import {
  TEAM_TOOL_DEFINITIONS,
  TeamCommandRegistry,
  parseTeamArgs,
  collectArgs,
  clampCollectWait,
  delegateArgs,
  singleModelAgainRefusal,
  teamRunnerMissing,
} from './teamTools'
import { buildStableRosterSection, buildRosterLive, formatStateChangeNote } from './roster'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { teamWorkerPrice, teamWorkerQuestion, canUseTeam } from './teamPaid'
import { teamTreeSchema, teamUsageSchema, teamItemFields } from '../../shared/teamView'

/** The Node schema proxies load these only when a team payload is present. */
export function createTeamViewSchemas() {
  return { teamTreeSchema, teamUsageSchema, teamItemFields }
}

export function createTeamRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    async loadScheduler() {
      const { createTeamSchedulerRuntime } = await import('./teamSchedulerEntry')
      return createTeamSchedulerRuntime(table, locale)
    },
    async loadRunners() {
      const { createTeamRunnersRuntime } = await import('../../host/runners/teamRunnersEntry')
      return createTeamRunnersRuntime(table, locale)
    },
    TEAM_TOOL_DEFINITIONS,
    TeamCommandRegistry,
    parseTeamArgs,
    collectArgs,
    clampCollectWait,
    delegateArgs,
    singleModelAgainRefusal,
    teamRunnerMissing,
    buildStableRosterSection,
    buildRosterLive,
    formatStateChangeNote,
    teamWorkerPrice,
    teamWorkerQuestion,
    canUseTeam,
  }
}
