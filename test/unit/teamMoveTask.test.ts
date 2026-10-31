// Move to… on the real team host service (M120 lane P, merged into int in
// CC-INT2): the real `createTeamHostService` over the real engine worker and
// merge ports (`createEngineTeamPorts`), a stored team and the real task
// store schema. A task waits because its entry has a lifetime task cap of
// zero (the role's `queue` policy), so no model conversation is ever needed:
// `listModels` and `startWorker` are tripwires that fail loudly if the
// product calls them. The launch after a move reaches the real worker port,
// which refuses a workspace without a repository before it creates anything.
// The full dispatch through a real worker turn stays the live drill's
// (test/e2e/team.live.e2e.test.ts).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createTeamHostService } from '../../src/core/team/teamHost'
import type {
  TeamHostService,
  TeamHostServiceDeps,
  TeamTaskSpec,
} from '../../src/core/team/teamHostService'
import { TEAM_TASKS_STATE_KEY, storedTasksSchema } from '../../src/core/team/teamTaskState'
import type { TeamToolContext } from '../../src/core/team/teamSeams'

import { TEAM_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { TeamRoleConfig, TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { silentCoreLog } from './helpers/memoryLogs'
import { enginePortsWithoutWorker, tripwireError } from './helpers/realTeamGit'

const ORCHESTRATOR = 'muse-spark-1.3'

/** Engineering holds a zero task cap, so its tasks wait; code review has room. */
function movableTeam(hasUnstaffedRole = false): TeamSnapshot {
  const roles: TeamRoleConfig[] = [
    {
      role: 'engineering',
      workspace: 'own-branch',
      exhausted: 'queue',
      pool: [
        { id: 'a', concurrent: 1, caps: [{ measure: 'tasks', window: 'lifetime', amount: 0 }] },
      ],
    },
    { role: 'code-review', workspace: 'read-only', pool: [{ id: 'r', concurrent: 1, caps: [] }] },
  ]
  if (hasUnstaffedRole) roles.push({ role: 'documentation', workspace: 'own-branch', pool: [] })
  return { roles, intensity: 'balanced' }
}

interface MoveRig {
  readonly service: TeamHostService
  readonly state: Map<string, unknown>
  /** Every spec the real worker port was asked to run, in order. */
  readonly runs: TeamTaskSpec[]
  /** Lets the held worker start proceed into the real port. */
  readonly release: () => void
}

function moveRig(stored: TeamSnapshot, options: { readonly isHeld: boolean }): MoveRig {
  const storage = mkdtempSync(path.join(tmpdir(), 'team-move-storage-'))
  onTestFinished(() => {
    rmSync(storage, { recursive: true, force: true })
  })
  const ports = enginePortsWithoutWorker({
    repositoryRoot: () => undefined,
    storageRoot: storage,
    isTrusted: () => true,
  })
  const state = new Map<string, unknown>([[TEAM_WORKSPACE_KEYS.team, stored]])
  const runs: TeamTaskSpec[] = []
  const gate = Promise.withResolvers<undefined>()
  if (!options.isHeld) gate.resolve(undefined)
  let counter = 0
  const deps: TeamHostServiceDeps = {
    state: {
      get: (key) => state.get(key),
      update: async (key, value) => {
        state.set(key, value)
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
      defaultAgent: (model) => ({ kind: 'engine', agentId: 'default', model, pays: 'local' }),
    },
    workers: {
      ...ports.workers,
      run: async (spec, signal) => {
        runs.push(spec)
        await gate.promise
        return await ports.workers.run(spec, signal)
      },
    },
    merges: ports.merges,
    paid: { allowKeyTasks: () => Promise.reject(tripwireError('paid.allowKeyTasks')) },
    cards: {
      show: () => {
        throw tripwireError('cards.show')
      },
    },
    newId: () => {
      counter += 1
      return `task-${String(counter)}`
    },
    now: () => Date.now(),
    log: silentCoreLog(),
  }
  const service = createTeamHostService(deps)
  onTestFinished(async () => {
    await service.dispose()
  })
  return {
    service,
    state,
    runs,
    release: () => {
      gate.resolve(undefined)
    },
  }
}

function context(): TeamToolContext {
  return {
    sessionId: 's1',
    approvalMode: 'manual',
    signal: new AbortController().signal,
    orchestratorModelId: ORCHESTRATOR,
  }
}

/** Delegates one task to `role`; returns the id the service minted. */
async function delegate(service: TeamHostService, role: string): Promise<string> {
  const result = await service.teamRunner.delegate(
    { tasks: [{ role, brief: 'fix the bug', reason: { code: 'parallel', detail: 'x' } }] },
    context(),
  )
  const answer = JSON.parse(result.output) as { tasks?: { task_id?: string }[] }
  const taskId = answer.tasks?.[0]?.task_id
  if (taskId === undefined) throw new Error(`The delegation did not start a task: ${result.output}`)
  return taskId
}

function queuedIds(service: TeamHostService, roleId: string): string[] {
  const role = service.tree()?.roles.find((item) => item.id === roleId)
  return role?.queued.map((worker) => worker.taskId) ?? []
}

function storedTask(rig: MoveRig, taskId: string) {
  const saved = storedTasksSchema.parse(rig.state.get(TEAM_TASKS_STATE_KEY))
  const tasks = Array.isArray(saved) ? saved : saved.tasks
  return tasks.find((task) => task.taskId === taskId)
}

describe('Move to… on the team host service', () => {
  it('moves a waiting task, chains the move with the user trigger, and launches it under its new role', async () => {
    const rig = moveRig(movableTeam(), { isHeld: false })
    const queued = await delegate(rig.service, 'engineering')
    expect(queuedIds(rig.service, 'engineering')).toEqual([queued])
    expect(rig.runs).toEqual([])

    await rig.service.moveTask(queued, 'code-review')
    expect(queuedIds(rig.service, 'engineering')).toEqual([])
    expect(queuedIds(rig.service, 'code-review')).toEqual([queued])
    // The record the next window restores carries the role and the chain.
    const moved = storedTask(rig, queued)
    expect(moved?.role.role).toBe('code-review')
    expect(moved?.handoff?.chain).toEqual([
      expect.objectContaining({
        kind: 'move',
        trigger: 'user',
        fromCandidateId: 'engineering',
        toCandidateId: 'r',
      }),
    ])

    // Resetting the entry frees the pool's launch pass: the moved task starts
    // on code review's entry and reaches the real worker port, which refuses
    // the missing repository before any copy or model conversation exists.
    await rig.service.resetEntry('r')
    expect(rig.runs.map((spec) => [spec.taskId, spec.role.role, spec.entry.id])).toEqual([
      [queued, 'code-review', 'r'],
    ])
    await expect.poll(() => storedTask(rig, queued)?.phase).toBe('failed')
    expect(storedTask(rig, queued)?.failure).toContain(TEAM_MODEL_TEXT.hostNoRepository)
    expect(storedTask(rig, queued)?.entry?.id).toBe('r')
  })

  it('says each refusal: running, finished, unknown, unstaffed, same role', async () => {
    const rig = moveRig(movableTeam(true), { isHeld: true })
    const queued = await delegate(rig.service, 'engineering')
    // Code review has room, so this task starts at once and the held worker
    // keeps it running.
    const running = await delegate(rig.service, 'code-review')
    expect(queuedIds(rig.service, 'engineering')).toEqual([queued])
    expect(rig.runs.map((spec) => spec.taskId)).toEqual([running])

    await expect(rig.service.moveTask(running, 'engineering')).rejects.toThrow(
      UI_TEXT.teamMoveRunning,
    )
    await expect(rig.service.moveTask(queued, 'ghost')).rejects.toThrow(
      fill(UI_TEXT.teamRoleUnknown, { role: 'ghost' }),
    )
    await expect(rig.service.moveTask('ghost', 'code-review')).rejects.toThrow(
      UI_TEXT.teamTaskUnknown,
    )
    await expect(rig.service.moveTask(queued, 'engineering')).rejects.toThrow(
      UI_TEXT.teamMoveSettled,
    )
    await expect(rig.service.moveTask(queued, 'documentation')).rejects.toThrow(
      fill(UI_TEXT.teamPoolNotStaffed, { role: 'documentation' }),
    )
    // A refused move changes nothing.
    expect(queuedIds(rig.service, 'engineering')).toEqual([queued])
    expect(storedTask(rig, queued)?.handoff).toBeUndefined()

    // Once the worker ends (the real port refuses the missing repository) the
    // task is finished, and a finished task never moves.
    rig.release()
    await expect.poll(() => storedTask(rig, running)?.phase).toBe('failed')
    await expect(rig.service.moveTask(running, 'engineering')).rejects.toThrow(
      UI_TEXT.teamMoveSettled,
    )
  })
})
