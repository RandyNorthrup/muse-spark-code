// The team host service with its engine worker and merge ports (C-M96-3):
// dist/teamHost.js, required only for a workspace that stores a team, so
// neither activation nor a single-model conversation loads it (D6).
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createTeamHostService } from '../../core/team/teamHost'
import type { TeamHostService, TeamStatePort } from '../../core/team/teamHostService'
import {
  TEAM_WINDOW_SETTINGS_KEY,
  teamWindowSettingsSchema,
  type TeamWindowSettings,
} from '../../shared/teamWindowProtocol'

/** The workspace's scheduler settings, defaulted; malformed state reads as unset. */
export function readTeamWindowSettings(state: TeamStatePort): TeamWindowSettings {
  const parsed = teamWindowSettingsSchema.safeParse(state.get(TEAM_WINDOW_SETTINGS_KEY) ?? {})
  return parsed.success ? parsed.data : teamWindowSettingsSchema.parse({})
}
import type { TeamHostBundleDeps } from './teamEnginePorts'

/** The window's team host service over the editor's ports and the engine's. */
export async function createTeamHost(
  table: UiText,
  locale: string,
  deps: TeamHostBundleDeps,
): Promise<TeamHostService> {
  setUiText(table, locale)
  const { engineTeamPorts } = await import('./teamEngineEntry')
  // The window scheduler (M96c) loads with its own bundle, only for a team
  // workspace: the host service drives admission, the merge queue and the
  // board through it. A caller may supply its own factory (headless runs).
  let createScheduler = deps.createScheduler
  if (createScheduler === undefined) {
    const { createTeamSchedulerRuntime } = await import('../../core/team/teamSchedulerEntry')
    const runtime = createTeamSchedulerRuntime(table, locale)
    createScheduler = (scheduling) => runtime.createWindowTeamScheduler(scheduling)
  }
  const settings =
    deps.settings.scheduler === undefined
      ? {
          ...deps.settings,
          scheduler: () => readTeamWindowSettings(deps.state),
        }
      : deps.settings
  return createTeamHostService({
    ...deps,
    settings,
    createScheduler,
    ...engineTeamPorts(table, locale, deps.engine),
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
// Checked, journalled landing and owner-store recovery (M96c K/I/X2), loaded
// with the team host bundle; the engine entry binds them to the merges port.
export { landTeamTask, recoverOpenLandings } from './teamLandingEntry'
export { setUiText } from '../../shared/l10n/text'
export { teamProgramFreeGit } from '../../core/team/teamWorkspaces'
