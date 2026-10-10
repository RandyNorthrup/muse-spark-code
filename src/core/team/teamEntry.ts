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
import { buildStableRosterSection, buildRosterLive, appendTeamEvents } from './roster'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { teamWorkerPrice, teamWorkerQuestion, canUseTeam } from './teamPaid'
import { teamTreeSchema, teamUsageSchema, teamItemFields } from '../../shared/teamView'
import { createTeamHostService } from './teamHost'
import type { TeamHostService, TeamHostServiceDeps } from './teamHostService'

/** The Node schema proxies load these only when a team payload is present. */
export function createTeamViewSchemas() {
  return { teamTreeSchema, teamUsageSchema, teamItemFields }
}

/** The window's team host service (C-M96-3): loads only for a workspace that stores a team. */
export function createTeamHost(
  table: UiText,
  locale: string,
  deps: TeamHostServiceDeps,
): TeamHostService {
  setUiText(table, locale)
  return createTeamHostService(deps)
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
    appendTeamEvents,
    teamWorkerPrice,
    teamWorkerQuestion,
    canUseTeam,
  }
}
