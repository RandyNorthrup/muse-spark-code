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

// The scheduler shares these tools instead of carrying another copy of their
// definitions and model text (M120CAP). No scheduler dispatch occurs here.
export { createSchedulerTeamTools } from './teamTools'

// The `team` MCP server (dist/teamMcp.js) and the team host service
// (dist/teamHost.js) read the same tool definitions, argument parsers and
// roster text from this bundle instead of carrying second copies
// (RLF-TEAMFIT); the build externalises their teamTools and roster imports
// to dist/team.js. No MCP or host dispatch occurs here.
export {
  TeamCommandRegistry,
  cancelArgs,
  clampCollectWait,
  collectArgs,
  delegateArgs,
  isTeamTool,
  mergeArgs,
  parseTeamArgs,
  teamCommandRecordsSchema,
  teamMcpToolList,
} from './teamTools'
export { buildRosterLive, buildStableRosterSection } from './roster'
// The MCP server's JSON-RPC handling rides the same way: the pure handler
// this bundle's tool definitions already type against, read by
// dist/teamMcp.js instead of a second copy.
export { handleMcpMessage, mcpRequestKeys } from '../mcp'

// The runners and the scheduler load only through their team runtime, so
// they read these schemas from this bundle instead of carrying second
// copies of them (the build externalises shared/team and shared/teamView
// to dist/team.js for the runners and scheduler builds only). No runner
// or scheduler dispatch occurs here.
export {
  runnerSchema,
  runnersSchema,
  teamAgentRefSchema,
  teamAttemptRefSchema,
  teamAttemptUsageSchema,
  teamBoardSchema,
  teamBoardTaskSchema,
  teamCapSchema,
  teamModelSettingsSchema,
  teamPoolEntrySchema,
  teamPrioritySchema,
  teamRescheduleSchema,
  teamRoleConfigSchema,
  teamSchedulerEventSchema,
  teamSchedulerFieldsSchema,
  teamSnapshotSchema,
  teamTrafficMetricsSchema,
  teamWriteSetLeaseSchema,
} from '../../shared/team'
export { teamTreeSchema } from '../../shared/teamView'

/** The Node schema proxies load these only when a team payload is present. */
export function createTeamViewSchemas() {
  return { teamTreeSchema, teamUsageSchema, teamItemFields }
}

/** New conversations validate a saved orchestrator override through the team chunk. */
export { validateOrchestratorSettings } from './orchestratorSlot'

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
