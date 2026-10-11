// U1's controller and derived views load only for an enabled Roles/Agents panel.
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createTeamPanelController, type TeamPanelDeps } from './teamPanel'

export function createTeamPanel(table: UiText, locale: string, deps: TeamPanelDeps) {
  setUiText(table, locale)
  return createTeamPanelController(deps)
}

export { readTeamRoleRecords } from './teamTaskState'

export { readOrchestratorOverride } from './orchestratorSlot'
