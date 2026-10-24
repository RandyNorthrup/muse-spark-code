// The team host service with its engine worker and merge ports (C-M96-3):
// dist/teamHost.js, required only for a workspace that stores a team, so
// neither activation nor a single-model conversation loads it (D6).
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createTeamHostService } from '../../core/team/teamHost'
import type { TeamHostService } from '../../core/team/teamHostService'
import { dispatchHeadReader } from '../../core/team/teamWorkspaces'
import type { TeamHostBundleDeps } from './teamEnginePorts'

/** The window's team host service over the editor's ports and the engine's. */
export async function createTeamHost(
  table: UiText,
  locale: string,
  deps: TeamHostBundleDeps,
): Promise<TeamHostService> {
  setUiText(table, locale)
  const { engineTeamPorts } = await import('./teamEngineEntry')
  const engine = engineTeamPorts(table, locale, deps.engine)
  // The playbook's dispatch-base read rides the engine's git; the rounds are
  // the window's. Apart, neither governs: the binding needs both halves.
  const { git, ...ports } = engine
  const { playbook: rounds, ...rest } = deps
  return createTeamHostService({
    ...rest,
    ...ports,
    ...(rounds !== undefined && {
      playbook: { ...rounds, head: dispatchHeadReader(git, deps.engine.repositoryRoot) },
    }),
  })
}

// The lazy file adapter shares this grant authority, including its WeakMap.
// The engine chunk reads the rest of the authority surface through this
// bundle, so every fence member it imports is exported here: the split
// gate fails a member this list lacks.
export {
  assertWorkerRoot,
  bindWorkerPathIo,
  confineWorkerPath,
  MuseWorkerFolderError,
  recheckWorkerRoot,
  withWorkerFile,
  WORKER_NATIVE_IO,
} from '../../core/team/workers/workerFence'
// Headless installs its lifecycle/merge policy around the same engine ports
// (dist/teamEngine.js, loaded through teamEngineEntry as the editor loads it).
export { createTeamHostService } from '../../core/team/teamHost'
export { setUiText } from '../../shared/l10n/text'
export { teamProgramFreeGit } from '../../core/team/teamWorkspaces'
