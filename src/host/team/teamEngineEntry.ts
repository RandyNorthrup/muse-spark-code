// Concrete worker workspaces and merge I/O load on the first team host use.
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createEngineTeamPorts, type EngineTeamPortsDeps } from './teamEnginePorts'
export function engineTeamPorts(table: UiText, locale: string, deps: EngineTeamPortsDeps) {
  setUiText(table, locale)
  return createEngineTeamPorts(deps)
}
