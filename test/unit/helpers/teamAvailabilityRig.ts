// One availability rig for the latch's halves: the unit binding assertions
// and the extension-host panel proof share the stored team, the silent log,
// the never-running engine stub and the binding shell, so neither copies
// the other.
import { TeamHostBinding } from '../../../src/host/teamHostBinding'
import { UI_TEXT } from '../../../src/shared/constants'
import { TEAM_WORKSPACE_KEYS } from '../../../src/shared/teamConversation'

function availabilityTeamStore(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      TEAM_WORKSPACE_KEYS.team,
      {
        template: 'Team',
        roles: [
          {
            role: 'engineering',
            pool: [
              {
                id: 'entry-1',
                agent: { kind: 'engine', agentId: 'openai', model: 'other-model', pays: 'key' },
                concurrent: 1,
                caps: [],
              },
            ],
          },
        ],
      },
    ],
  ])
}

function availabilityLog() {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

export function availabilityState(store: Map<string, unknown>) {
  return {
    get: (key: string) => store.get(key),
    update: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
}

function availabilityEngine(log: ReturnType<typeof availabilityLog>) {
  return {
    repositoryRoot: () => undefined,
    storageRoot: '/tmp/team-availability',
    platform: 'linux' as const,
    isTrusted: () => true,
    listModels: () => Promise.resolve([] as readonly string[]),
    startWorker: () => Promise.reject(new Error('no worker here')),
    now: () => 0,
    log,
  }
}

export function availabilityBinding(
  isTeamOn: boolean,
  surface: {
    openRoles: (roleId: string | undefined) => Promise<void>
    showDiff: (taskId: string, diff: string) => Promise<void>
  },
) {
  const values = availabilityTeamStore()
  const log = availabilityLog()
  const factoryCalls: unknown[][] = []
  const bound = new TeamHostBinding({
    ports: availabilityPorts(isTeamOn, values, log),
    canRunKind: (kind) => kind === 'engine',
    loadFactory: () => {
      factoryCalls.push([])
      return Promise.resolve(() => undefined as never)
    },
    uiText: () => UI_TEXT,
    uiLocale: () => 'en',
    showTree: () => undefined,
    openRoles: surface.openRoles,
    showDiff: surface.showDiff,
  })
  return { bound, factoryCalls }
}

function availabilityPorts(
  isTeamOn: boolean,
  store: Map<string, unknown>,
  log: ReturnType<typeof availabilityLog>,
) {
  return {
    hooks: undefined,
    state: availabilityState(store),
    settings: {
      isTeamOn: () => isTeamOn,
      isTeamWorkersOn: () => true,
      maxWorkers: () => 2,
      isTrusted: () => true,
    },
    orchestrator: {
      modelId: () => 'muse-spark-1.2',
      backend: () => 'modelApi',
    },
    paid: {
      allowKeyTasks: () => Promise.resolve(false),
    },
    cards: {
      show: () => undefined,
    },
    newId: () => 'id-1',
    now: () => 0,
    log,
    engine: availabilityEngine(log),
  }
}
