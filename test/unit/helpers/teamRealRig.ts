// Shared parts of the suites that run the real team host service over real
// repositories, a real state file and real worker processes: one place for
// the state port, the scratch repository, the service's ordinary ports and
// the orchestrator's tool context, so the suites cannot drift apart.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createWindowTeamScheduler } from '../../../src/core/team/scheduler/window'
import type {
  TeamCardItem,
  TeamHostServiceDeps,
  TeamStatePort,
} from '../../../src/core/team/teamHostService'
import type { TeamToolContext } from '../../../src/core/team/teamSeams'
import { TEAM_TASKS_STATE_KEY, storedTasksSchema } from '../../../src/core/team/teamTaskState'
import { silentCoreLog } from './memoryLogs'
import { fixtureGit } from './teamLandingFixture'

/** A real JSON state file behind the state port, as the ACP agent keeps one. */
export function fileState(
  file: string,
  seed: Map<string, unknown>,
  onUpdate?: (key: string, value: unknown) => void,
): TeamStatePort {
  return {
    get: (key) => seed.get(key),
    update: async (key, value) => {
      if (value === undefined) seed.delete(key)
      else seed.set(key, value)
      onUpdate?.(key, value)
      await writeFile(file, JSON.stringify(Object.fromEntries(seed)))
    },
  }
}

/** A repository with one commit holding `file.txt`, and an empty storage folder beside it. */
export async function initRigFolders(root: string): Promise<{ repo: string; storage: string }> {
  const repo = path.join(root, 'repo')
  const storage = path.join(root, 'storage')
  await mkdir(storage, { recursive: true })
  await fixtureGit(root, ['init', '-b', 'main', repo])
  await writeFile(path.join(repo, 'file.txt'), 'before\n')
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-m', 'base'])
  return { repo, storage }
}

/** The service's ordinary ports over real parts: the window scheduler, ids, clock and a manual integration flow. */
export function realServiceDeps(input: {
  readonly orchestrator: string
  readonly isTrusted: () => boolean
  readonly cards: TeamCardItem[]
  readonly state: TeamStatePort
}): Pick<
  TeamHostServiceDeps,
  | 'state'
  | 'settings'
  | 'orchestrator'
  | 'cards'
  | 'createScheduler'
  | 'workspaceId'
  | 'windowInstanceId'
  | 'ownerBirth'
  | 'probeOwner'
  | 'newId'
  | 'now'
  | 'log'
> {
  let counter = 0
  return {
    state: input.state,
    settings: {
      isTeamOn: () => true,
      isTeamWorkersOn: () => true,
      maxWorkers: () => 4,
      isTrusted: input.isTrusted,
      scheduler: () => ({ integrationFlow: 'manual', onStall: 'stop', sharedFiles: [] }),
    },
    orchestrator: { modelId: () => input.orchestrator, backend: () => 'modelApi' },
    cards: {
      show: (_sessionId, item) => {
        input.cards.push(item)
      },
    },
    createScheduler: (scheduling) => createWindowTeamScheduler(scheduling),
    workspaceId: 'ws',
    windowInstanceId: 'window-a',
    ownerBirth: { windowStartedAt: Date.now(), pid: process.pid, processStart: 'rig-start' },
    probeOwner: () => Promise.resolve(false),
    newId: () => {
      counter += 1
      return `task-${String(counter)}`
    },
    now: () => Date.now(),
    log: silentCoreLog(),
  }
}

/** The orchestrator's call context for one conversation. */
export function toolContext(orchestratorModelId: string): TeamToolContext {
  return {
    sessionId: 's1',
    approvalMode: 'manual',
    signal: new AbortController().signal,
    orchestratorModelId,
  }
}

/** Whether a process is still running, by signal 0. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

/** One task's stored record, as the service persisted it in the state file. */
export function storedTaskOf(values: ReadonlyMap<string, unknown>, taskId: string) {
  const saved = storedTasksSchema.parse(values.get(TEAM_TASKS_STATE_KEY))
  const tasks = Array.isArray(saved) ? saved : saved.tasks
  return tasks.find((task) => task.taskId === taskId)
}
