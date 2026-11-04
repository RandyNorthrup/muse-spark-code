// The team host service with its engine worker and merge ports (C-M96-3):
// dist/teamHost.js, required only for a workspace that stores a team, so
// neither activation nor a single-model conversation loads it (D6).
import { setUiText } from '../../shared/l10n/text'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { UiText } from '../../shared/l10n/en'
import { createTeamHostService } from '../../core/team/teamHost'
import type {
  TeamHostService,
  TeamStatePort,
  TeamWorkerPort,
} from '../../core/team/teamHostService'
import type { TeamGit } from '../../core/team/teamGit'
import { createCompositeTeamWorkerPort } from '../../core/team/workers/compositeWorkerPort'
import type { ProcessTeamPorts } from './teamProcessEntry'
import { dispatchHeadReader } from '../../core/team/teamWorkspaces'
import {
  TEAM_WINDOW_SETTINGS_KEY,
  teamWindowSettingsSchema,
  type TeamWindowSettings,
} from '../../shared/teamWindowProtocol'
import type { TeamHostBundleDeps } from './teamEnginePorts'

/** The workspace's scheduler settings, defaulted; malformed state reads as unset. */
export function readTeamWindowSettings(state: TeamStatePort): TeamWindowSettings {
  const parsed = teamWindowSettingsSchema.safeParse(state.get(TEAM_WINDOW_SETTINGS_KEY) ?? {})
  return parsed.success ? parsed.data : teamWindowSettingsSchema.parse({})
}

/**
The Muse Code and external-agent worker port: it answers `canRun` for those
kinds without loading anything, and loads dist/teamProcess.js on the first
probe or task. Nothing starts until a worker of those kinds runs.
*/
function lazyProcessWorkers(
  table: UiText,
  locale: string,
  deps: NonNullable<TeamHostBundleDeps['processWorkers']>,
  runGit: TeamGit,
  state: TeamStatePort,
): {
  readonly workers: TeamWorkerPort
  readonly dispose: () => Promise<void>
  readonly runChecks: ProcessTeamPorts['runLandingChecks']
} {
  let loading: Promise<ProcessTeamPorts> | undefined
  let loaded: ProcessTeamPorts | undefined
  const start = async (): Promise<ProcessTeamPorts> => {
    try {
      const { createTeamProcessRuntime } = await import('./teamProcessEntry')
      loaded = createTeamProcessRuntime(table, locale).createProcessTeamPorts({
        ...deps,
        runGit,
        // The check slots' setup, as the Roles section saved it for this workspace.
        checkSetup: () => {
          const { setupCommand, cacheKey } = readTeamWindowSettings(state)
          return { setupCommand, cacheKey }
        },
      })
      return loaded
    } catch (error: unknown) {
      // A bundle that failed to load is tried again by the next task.
      loading = undefined
      throw error
    }
  }
  const load = async (): Promise<ProcessTeamPorts> => await (loading ??= start())
  const loadWorkers = async (): Promise<TeamWorkerPort> => {
    const ports = await load()
    return ports.workers
  }
  return {
    workers: {
      canRun: (agent) => agent.kind === 'museCode' || agent.kind === 'external',
      probe: async (agent) => {
        const workers = await loadWorkers()
        return await workers.probe(agent)
      },
      run: async (spec, signal) => {
        const workers = await loadWorkers()
        return await workers.run(spec, signal)
      },
      retirement: (taskId) => loaded?.workers.retirement?.(taskId),
    },
    dispose: async () => {
      await loaded?.dispose()
    },
    runChecks: async (folder, signal) => {
      const ports = await load()
      return await ports.runLandingChecks(folder, signal)
    },
  }
}

/** What a landing's admission is bound to: the person's checks and the slots' setup. */
function landingChecks(deps: TeamHostBundleDeps) {
  const { setupCommand, cacheKey } = readTeamWindowSettings(deps.state)
  return {
    commands: (deps.processWorkers?.checks() ?? []).map((check) => ({
      name: check.name,
      command: check.command,
      timeoutSeconds: check.timeoutSeconds ?? 0,
    })),
    platform: deps.engine.platform,
    setupCommand,
    cacheKey,
  }
}

/** The window's team host service over the editor's ports and the engine's. */
export async function createTeamHost(
  table: UiText,
  locale: string,
  deps: TeamHostBundleDeps,
): Promise<TeamHostService> {
  setUiText(table, locale)
  const { engineTeamPorts } = await import('./teamEngineEntry')
  // Filled in once the engine's git exists; a landing cannot start before that.
  const processSlot: { workers?: ReturnType<typeof lazyProcessWorkers> } = {}
  const engine = engineTeamPorts(table, locale, {
    ...deps.engine,
    landing: {
      ...deps.engine.landing,
      ...(deps.processWorkers !== undefined && {
        checks: () => landingChecks(deps),
        runChecks: async (folder, signal) =>
          (await processSlot.workers?.runChecks(folder, signal)) ?? { passed: false },
      }),
    },
  })
  // The playbook's dispatch-base read rides the engine's git; the rounds are
  // the window's. Apart, neither governs: the binding needs both halves.
  const { git, ...ports } = engine
  // What a window that died left open settles before this one claims anything. Another window's
  // record waits for the person's Recover in Traffic, and the landing refuses until it has run.
  try {
    if (deps.engine.repositoryRoot() !== undefined) await ports.merges.recoverLandings?.(false)
    const open =
      deps.engine.repositoryRoot() === undefined
        ? []
        : ((await ports.merges.openLandings?.()) ?? [])
    if (open.length > 0)
      deps.log.warn(`A team landing is still open: ${open.flatMap((row) => row.paths).join(', ')}`)
  } catch (error: unknown) {
    deps.log.warn(`The open team landings could not be read: ${failureForLog(error)}`)
  }
  const { playbook: rounds, processWorkers, ...rest } = deps
  // The window scheduler (M96c) loads with its own bundle, only for a team
  // workspace: the host service drives admission, the merge queue and the
  // board through it. A caller may supply its own factory (headless runs).
  let createScheduler = deps.createScheduler
  if (createScheduler === undefined) {
    const { createTeamWindowRuntime } = await import('../../core/team/scheduler/teamWindowEntry')
    const runtime = await createTeamWindowRuntime(table, locale)
    createScheduler = (scheduling) => runtime.createWindowTeamScheduler(scheduling)
  }
  const settings =
    deps.settings.scheduler === undefined
      ? {
          ...deps.settings,
          scheduler: () => readTeamWindowSettings(deps.state),
        }
      : deps.settings
  // Beside the engine port, in order: an agent no port can run stays unavailable.
  const process =
    processWorkers === undefined
      ? undefined
      : lazyProcessWorkers(table, locale, processWorkers, git, deps.state)
  if (process !== undefined) processSlot.workers = process
  const service = createTeamHostService({
    ...rest,
    settings,
    createScheduler,
    ...ports,
    ...(process !== undefined && {
      workers: createCompositeTeamWorkerPort([ports.workers, process.workers]),
    }),
    ...(rounds !== undefined && {
      playbook: { ...rounds, head: dispatchHeadReader(git, deps.engine.repositoryRoot) },
    }),
  })
  if (process === undefined) return service
  // The team's Muse Code hosts and external agents stop with the team.
  return {
    ...service,
    dispose: async (options) => {
      await service.dispose(options)
      await process.dispose()
    },
  }
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
// The `team` MCP server Muse Code orchestrators reach (M96 lane T) loads
// with its own bundle (dist/teamMcp.js, teamMcpEntry) on the first team
// endpoint request, not with the host service (RLF-TEAMFIT).
