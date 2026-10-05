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
import {
  buildStableRosterSection,
  buildRosterLive,
  formatStateChangeNote,
  formatTeamEditNote,
} from './roster'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createTeamRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
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
    formatTeamEditNote,
  }
}
