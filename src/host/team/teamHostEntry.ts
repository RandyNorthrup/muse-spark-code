// The team host service with its engine worker and merge ports (C-M96-3):
// dist/teamHost.js, required only for a workspace that stores a team, so
// neither activation nor a single-model conversation loads it (D6).
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createTeamHostService } from '../../core/team/teamHost'
import type { TeamHostService } from '../../core/team/teamHostService'
import { createEngineTeamPorts, type TeamHostBundleDeps } from './teamEnginePorts'

/** The window's team host service over the editor's ports and the engine's. */
export function createTeamHost(
  table: UiText,
  locale: string,
  deps: TeamHostBundleDeps,
): TeamHostService {
  setUiText(table, locale)
  return createTeamHostService({ ...deps, ...createEngineTeamPorts(deps.engine) })
}

// The lazy file adapter shares this grant authority, including its WeakMap.
export {
  confineWorkerPath,
  MuseWorkerFolderError,
  withWorkerFile,
} from '../../core/team/workers/workerFence'
// Headless installs its lifecycle/merge policy around these same engine ports.
export { createTeamHostService } from '../../core/team/teamHost'
export { createEngineTeamPorts } from './teamEnginePorts'
export { setUiText } from '../../shared/l10n/text'
export { processTeamGit } from './teamEnginePorts'
export { teamProgramFreeGit } from '../../core/team/teamWorkspaces'
