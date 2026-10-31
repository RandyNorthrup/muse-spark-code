// Shared board rig for the C-M115-8 suites: a real schedule engine, a real
// team host service and the real window scheduler, with tripwires proving
// no model, consent-card or popup path is touched. The cross-process claim
// suite's bundled child builds the same rig over the shared store, so the
// rig lives here rather than cloned between the two files.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTeamHostService } from '../../../src/core/team/teamHost'
import type { TeamHostService, TeamTaskSpec } from '../../../src/core/team/teamHostService'
import {
  createWindowTeamScheduler,
  TEAM_BOARD_STATE_KEY,
} from '../../../src/core/team/scheduler/window'
import type { ScheduleTeamBoards } from '../../../src/core/schedules/boardDelivery'
import { createEngineTeamPorts } from '../../../src/host/team/teamEnginePorts'
import { workspaceKey } from '../../../src/runtime/dataFolder'
import { createScheduleEngine } from '../../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../../src/runtime/schedules/nodeScheduleFs'
import { teamBoardSchema, type TeamCap, type TeamSnapshot } from '../../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../../src/shared/teamConversation'
import { silentCoreLog } from './memoryLogs'
import { realTeamGit } from './realTeamGit'

export const ORCHESTRATOR = 'muse-spark-1.3'

export const QUEUE_CAPS: readonly TeamCap[] = [{ measure: 'tasks', window: 'lifetime', amount: 0 }]

function tripwireError(operation: string): Error {
  return new Error(`No ${operation} in this test: no model conversations run here.`)
}

function teamSnapshot(entryCaps: readonly TeamCap[], pays: 'local' | 'key'): TeamSnapshot {
  return {
    roles: [
      {
        role: 'engineering',
        workspace: 'own-branch',
        pool: [{ id: 'e1', concurrent: 1, caps: [...entryCaps] }],
      },
      { role: 'qa', workspace: 'own-branch', pool: [] },
    ],
    intensity: 'balanced',
    orchestrator: { agent: { kind: 'engine', agentId: 'slot', model: ORCHESTRATOR, pays } },
  }
}

export interface BoardRig {
  readonly root: string
  readonly cwd: string
  readonly storage: string
  readonly key: string
  readonly engine: Awaited<ReturnType<typeof createScheduleEngine>>
  readonly service: TeamHostService
  readonly runs: TeamTaskSpec[]
  readonly state: Map<string, unknown>
  readonly hold: () => Promise<void>
  readonly owned: readonly string[]
  readonly calls: {
    readonly teamFor: string[]
    readonly startWorker: unknown[]
    readonly listModels: unknown[]
    readonly allowKeyTasks: unknown[]
    readonly cards: unknown[]
  }
}

export async function boardRig(options: {
  readonly pays: 'local' | 'key'
  readonly caps: readonly TeamCap[]
  readonly boards?: boolean
  readonly root?: string
  readonly cwd?: string
  readonly storage?: string
}): Promise<BoardRig> {
  // Folders the caller shares (the claim child's store) are not ours to
  // remove; only folders this rig made are owned.
  const owned: string[] = []
  const take = (provided: string | undefined, prefix: string): string => {
    if (provided !== undefined) return provided
    const folder = mkdtempSync(path.join(tmpdir(), prefix))
    owned.push(folder)
    return folder
  }
  const root = take(options.root, 'sched-board-store-')
  const cwd = take(options.cwd, 'sched-board-ws-')
  const storage = take(options.storage, 'sched-board-team-')
  const key = workspaceKey(cwd)
  const calls = {
    teamFor: [] as string[],
    startWorker: [] as unknown[],
    listModels: [] as unknown[],
    allowKeyTasks: [] as unknown[],
    cards: [] as unknown[],
  }
  const ports = createEngineTeamPorts({
    repositoryRoot: () => undefined,
    storageRoot: storage,
    platform: process.platform,
    isTrusted: () => true,
    listModels: () => {
      calls.listModels.push(true)
      return Promise.reject(tripwireError('listModels'))
    },
    startWorker: () => {
      calls.startWorker.push(true)
      return Promise.reject(tripwireError('startWorker'))
    },
    runGit: realTeamGit,
    now: () => Date.now(),
    log: silentCoreLog(),
  })
  const state = new Map<string, unknown>([
    [TEAM_WORKSPACE_KEYS.team, teamSnapshot(options.caps, options.pays)],
  ])
  const runs: TeamTaskSpec[] = []
  const service = createTeamHostService({
    state: {
      get: (stateKey) => state.get(stateKey),
      update: async (stateKey, value) => {
        state.set(stateKey, value)
        await Promise.resolve()
      },
    },
    settings: {
      isTeamOn: () => true,
      isTeamWorkersOn: () => true,
      maxWorkers: () => 4,
      isTrusted: () => true,
    },
    orchestrator: {
      modelId: () => ORCHESTRATOR,
      backend: () => 'modelApi',
      defaultAgent: (model) => ({ kind: 'engine', agentId: 'default', model, pays: options.pays }),
    },
    createScheduler: (scheduling) => createWindowTeamScheduler(scheduling),
    workers: {
      ...ports.workers,
      run: async (spec, signal) => {
        runs.push(spec)
        return await ports.workers.run(spec, signal)
      },
    },
    merges: ports.merges,
    paid: {
      allowKeyTasks: (...args) => {
        calls.allowKeyTasks.push(args)
        return Promise.reject(tripwireError('paid.allowKeyTasks'))
      },
    },
    cards: {
      show: (...args) => {
        calls.cards.push(args)
        throw tripwireError('cards.show')
      },
    },
    newId: (() => {
      let counter = 0
      return () => {
        counter += 1
        return `task-${String(counter)}`
      }
    })(),
    now: () => Date.now(),
    log: silentCoreLog(),
  })
  const boards: ScheduleTeamBoards = {
    teamFor: (workspace) => {
      calls.teamFor.push(workspace)
      return Promise.resolve(
        workspace === key ? { admit: (input) => service.delegateScheduled(input) } : undefined,
      )
    },
  }
  const engine = await createScheduleEngine({
    log: silentCoreLog(),
    fs: createNodeScheduleFs(root),
    queue: createNodeScheduleQueue(root),
    // Production boards ride with conversation delivery; these tripwires
    // prove board targets never consult it.
    delivery: () =>
      Promise.resolve({
        targets: {
          find: () => Promise.reject(tripwireError('conversation targets')),
          open: () => Promise.reject(tripwireError('conversation targets')),
          fresh: () => Promise.reject(tripwireError('conversation targets')),
        },
        runs: {
          run: () => Promise.reject(tripwireError('conversation runs')),
        },
        prompt: () => {
          throw tripwireError('conversation prompt')
        },
      }),
    ...(options.boards !== false && { boards }),
  })
  const hold = await engine.runtime.holdWorkspace(cwd)
  return { root, cwd, storage, key, engine, service, runs, state, calls, hold, owned }
}

export async function closeEngine(engine: BoardRig['engine']): Promise<void> {
  try {
    await engine.runtime.close()
  } catch (error: unknown) {
    // Pre-existing engine close (base bug, not this lane): close aborts
    // the combined stop before the trailing background reconcile reads
    // the consent file, so close always rejects with the abort. The
    // engine's own teardown (timer, intakes, scheduler) already ran.
    if (!(error instanceof Error) || error.name !== 'AbortError') throw error
  }
}

export async function closeRig(rig: BoardRig): Promise<void> {
  await rig.service.dispose()
  await rig.hold()
  await closeEngine(rig.engine)
  for (const folder of rig.owned) rmSync(folder, { recursive: true, force: true })
}

export function boardTasks(rig: BoardRig) {
  const stored = rig.state.get(TEAM_BOARD_STATE_KEY)
  return stored === undefined ? [] : teamBoardSchema.parse(stored).tasks
}
