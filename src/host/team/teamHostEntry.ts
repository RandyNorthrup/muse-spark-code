// The team host service with its engine worker and merge ports (C-M96-3):
// dist/teamHost.js, required only for a workspace that stores a team, so
// neither activation nor a single-model conversation loads it (D6).
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createTeamHostService } from '../../core/team/teamHost'
import type { TeamHostService } from '../../core/team/teamHostService'
import type { TeamHostBundleDeps } from './teamEnginePorts'

/** The window's team host service over the editor's ports and the engine's. */
export async function createTeamHost(
  table: UiText,
  locale: string,
  deps: TeamHostBundleDeps,
): Promise<TeamHostService> {
  setUiText(table, locale)
  const { engineTeamPorts } = await import('./teamEngineEntry')
  return createTeamHostService({ ...deps, ...engineTeamPorts(table, locale, deps.engine) })
}

// The lazy file adapter shares this grant authority, including its WeakMap.
export {
  confineWorkerPath,
  MuseWorkerFolderError,
  withWorkerFile,
} from '../../core/team/workers/workerFence'
