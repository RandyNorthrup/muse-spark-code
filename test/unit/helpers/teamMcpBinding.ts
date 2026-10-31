// One window binding over the team bundle's real factory and the real MCP
// server, for the suites that drive the `team` endpoint (the wiring suite,
// the bridge and the external orchestrator): the stored team, the silent
// log and the never-running engine stub live here once. No worker runs: a
// roster call never reaches one.
import { TeamHostBinding } from '../../../src/host/teamHostBinding'
import { TeamMcpServer } from '../../../src/host/team/teamMcpServer'
import { createTeamHost } from '../../../src/host/team/teamHostEntry'
import { teamRosterAnswer } from '../../../src/host/team/teamMcpEntry'
import { UI_TEXT } from '../../../src/shared/constants'
import { TEAM_WORKSPACE_KEYS } from '../../../src/shared/teamConversation'
import { availabilityState } from './teamAvailabilityRig'

export const silentLog = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** One engineering role with one local engine entry: a runnable stored team. */
export const STORED_ENGINE_TEAM = {
  roles: [
    {
      role: 'engineering',
      workspace: 'own-branch',
      pool: [
        {
          id: 'e1',
          concurrent: 2,
          caps: [],
          agent: { kind: 'engine', agentId: 'agent-e1', model: 'other-model-7', pays: 'local' },
        },
      ],
    },
  ],
  intensity: 'balanced',
}

export interface TeamBindingOptions {
  /** The stored team, or none (a single-model conversation). */
  readonly stored: unknown
  /** What the conversation's orchestrator is, as the binding's port says. */
  readonly orchestrator: { readonly modelId: string; readonly backend: 'museCode' | 'external' }
}

export function makeTeamBinding(options: TeamBindingOptions): TeamHostBinding {
  const store = new Map<string, unknown>()
  if (options.stored !== undefined) store.set(TEAM_WORKSPACE_KEYS.team, options.stored)
  return new TeamHostBinding({
    ports: {
      state: availabilityState(store),
      settings: {
        isTeamOn: () => true,
        isTeamWorkersOn: () => true,
        maxWorkers: () => 2,
        isTrusted: () => true,
      },
      orchestrator: {
        modelId: () => options.orchestrator.modelId,
        backend: () => options.orchestrator.backend,
      },
      paid: { allowKeyTasks: () => Promise.resolve(false) },
      cards: { show: () => undefined },
      newId: () => 'id-1',
      now: () => 0,
      log: silentLog,
      engine: {
        repositoryRoot: () => undefined,
        storageRoot: '',
        platform: process.platform,
        isTrusted: () => true,
        // The declared setup probe finds the stored entry's model served.
        listModels: () => Promise.resolve(['other-model-7']),
        // No worker is wanted: a start is the failure the roster call must not cause.
        startWorker: () => Promise.reject(new Error('the roster call must not start a worker')),
        now: () => 0,
        log: silentLog,
      },
    },
    canRunKind: (kind) => kind === 'engine',
    loadFactory: () => Promise.resolve(createTeamHost),
    loadTeamMcp: () =>
      Promise.resolve({ server: new TeamMcpServer(silentLog), rosterAnswer: teamRosterAnswer }),
    uiText: () => UI_TEXT,
    uiLocale: () => 'en',
    showTree: () => undefined,
    openRoles: () => Promise.resolve(),
    showDiff: () => Promise.resolve(),
  })
}

/** The opened binding of a conversation an external agent leads (D250), on the runnable stored team. */
export async function openExternalLeadBinding(): Promise<TeamHostBinding> {
  const binding = makeTeamBinding({
    stored: STORED_ENGINE_TEAM,
    orchestrator: { modelId: 'm1', backend: 'external' },
  })
  await binding.open()
  return binding
}
