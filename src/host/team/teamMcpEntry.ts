// The `team` MCP server Muse Code orchestrators reach (M96 lane T), in
// its own bundle (dist/teamMcp.js): loaded only when a Muse Code
// conversation first asks for its team endpoint, so the team host bundle
// carries the host service alone (RLF-TEAMFIT, D6). The tool definitions
// and roster text are read from dist/team.js, which already carries them.
import { TeamMcpServer } from './teamMcpServer'
import { buildRosterLive, buildStableRosterSection } from '../../core/team/roster'
import type { TeamHostSeams } from '../../core/team/teamHostService'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

/** The `roster` tool's answer text: the stable part with the live numbers. */
export function teamRosterAnswer(
  data: NonNullable<ReturnType<TeamHostSeams['teamRosterData']>>,
): string {
  const stable = buildStableRosterSection(data.stable)
  return data.live === undefined ? stable : `${stable}\n\n${buildRosterLive(data.live)}`
}

export function createTeamMcpRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return { TeamMcpServer, teamRosterAnswer }
}
