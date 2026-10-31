// Final admission, the ordered merge queue and plan-before-card on real
// parts (RLF-TEAMFIT): the real `createTeamHostService`, the real window
// scheduler, the real engine merge ports (`createEngineTeamPorts`' plan,
// merge, diff and discard over the real git binary), a real git repository
// and a real state file in temporary folders. No model conversation runs:
// the worker port's hands are a real child process that writes the task's
// files inside the real working copy the production workspace helpers
// (`startTeamWorkspace`, `commitTaskBranch`, `publishTaskRef`) made, so
// every commit, ref, plan and landing the assertions read is real. The
// card port records what the person's surface would show; `listModels`,
// `startWorker` and the paid port are tripwires, because none of these
// behaviours may reach them (the entries pay locally). The full dispatch
// through a real worker turn stays the live drill's
// (test/e2e/team.live.e2e.test.ts).
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createTeamHostService } from '../../src/core/team/teamHost'
import type {
  TeamCardItem,
  TeamHostService,
  TeamHostServiceDeps,
  TeamStatePort,
  TeamTaskSpec,
  TeamWorkerOutcome,
  TeamWorkerPort,
} from '../../src/core/team/teamHostService'
import { createWindowTeamScheduler } from '../../src/core/team/scheduler/window'
import { TEAM_TASKS_STATE_KEY, storedTasksSchema } from '../../src/core/team/teamTaskState'
import {
  commitTaskBranch,
  publishTaskRef,
  resolveBaseCommit,
  startTeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import type { TeamToolContext } from '../../src/core/team/teamSeams'
import { createEngineTeamPorts } from '../../src/host/team/teamEnginePorts'
import type { TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { silentCoreLog } from './helpers/memoryLogs'
import { fixtureGit } from './helpers/teamLandingFixture'
import { realTeamGit } from './helpers/realTeamGit'

const ORCHESTRATOR = 'orchestrator-model'
const ZERO_USAGE = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  modelCalls: 0,
  estimated: false,
} as const

function tripwireError(name: string): Error {
  return new Error(`test: the ports never call ${name} here`)
}

/** One staffed engineering role on a local engine entry; no review role. */
function storedTeam(): TeamSnapshot {
  return {
    roles: [
      {
        role: 'engineering',
        workspace: 'own-branch',
        pool: [
          {
            id: 'e1',
            concurrent: 2,
            caps: [],
            agent: { kind: 'engine', agentId: 'agent-e1', model: 'worker-model', pays: 'local' },
          },
        ],
      },
    ],
    intensity: 'balanced',
  }
}

interface WorkPlan {
  /** Files the worker process writes in its copy, path → contents. */
  readonly files: Readonly<Record<string, string>>
  /** Changed files the outcome withholds, to prove the card reads the plan. */
  readonly omit?: readonly string[]
}

interface RealRig {
  readonly service: TeamHostService
  readonly repo: string
  readonly storage: string
  readonly stateValues: Map<string, unknown>
  readonly cards: TeamCardItem[]
  readonly started: string[]
  readonly plans: Map<string, WorkPlan>
  trusted: boolean
  dispose(): Promise<void>
}

const rigs: RealRig[] = []

afterAll(async () => {
  for (const rig of rigs.splice(0)) await rig.dispose()
})

/** The worker's hands: one real child process writing the planned files. */
function runWorkerChild(folder: string, marker: string, plan: WorkPlan): Promise<void> {
  const script = [
    "const { mkdirSync, writeFileSync } = require('node:fs')",
    "const path = require('node:path')",
    `const folder = ${JSON.stringify(folder)}`,
    `const marker = ${JSON.stringify(marker)}`,
    `const files = ${JSON.stringify(plan.files)}`,
    'writeFileSync(marker, String(process.pid))',
    'for (const [name, contents] of Object.entries(files)) {',
    '  const target = path.join(folder, name)',
    '  mkdirSync(path.dirname(target), { recursive: true })',
    '  writeFileSync(target, contents)',
    '}',
  ].join('\n')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`worker process exited ${String(code)}`))
    })
  })
}

/**
The worker port over real processes and the production workspace helpers:
the copy, the end-of-task commit and the published ref are the same real
git work the engine ports do around a model conversation.
*/
function processWorkers(rig: {
  readonly repo: string
  readonly storage: string
  readonly plans: Map<string, WorkPlan>
  readonly started: string[]
}): TeamWorkerPort {
  return {
    canRun: (agent) => agent.kind === 'engine',
    // The declared setup probe: the worker runtime observably starts.
    probe: () =>
      new Promise((resolve) => {
        execFile(process.execPath, ['--version'], (error) => {
          resolve(error === null)
        })
      }),
    run: async (spec: TeamTaskSpec, signal: AbortSignal): Promise<TeamWorkerOutcome> => {
      signal.throwIfAborted()
      const plan = rig.plans.get(spec.taskId) ?? rig.plans.get(spec.brief)
      if (plan === undefined) throw new Error(`no work plan for ${spec.taskId}`)
      const baseCommit = await resolveBaseCommit(realTeamGit, rig.repo)
      const workspace = await startTeamWorkspace(realTeamGit, rig.storage, process.platform, {
        repositoryRoot: rig.repo,
        role: spec.role.role,
        taskId: spec.taskId,
        mode: 'own-branch',
        baseCommit,
      })
      await spec.meter.noteWorkspace({
        folder: workspace.folder,
        baseCommit,
        branch: workspace.branch,
        agentsRef: workspace.agentsRef,
      })
      spec.meter.admitRequest()
      rig.started.push(spec.taskId)
      await runWorkerChild(workspace.folder, path.join(rig.storage, `started-${spec.taskId}`), plan)
      signal.throwIfAborted()
      const branch = workspace.branch ?? ''
      const committed = await commitTaskBranch(realTeamGit, workspace.folder, {
        branch,
        role: spec.role.role,
        taskId: spec.taskId,
        entryId: spec.entry.id,
      })
      if (committed.committed && workspace.agentsRef !== undefined) {
        await publishTaskRef(
          realTeamGit,
          rig.repo,
          workspace.folder,
          branch,
          workspace.agentsRef,
          baseCommit,
        )
      }
      const changed = new TextDecoder()
        .decode(
          await realTeamGit(
            ['diff', '--name-only', '-z', '--no-renames', baseCommit, committed.head, '--'],
            workspace.folder,
          ),
        )
        .split('\0')
        .filter((name) => name !== '' && !(plan.omit ?? []).includes(name))
      await spec.meter.noteUsage({ ...ZERO_USAGE })
      return {
        report: { status: 'done', summary: `wrote ${Object.keys(plan.files).join(', ')}` },
        usage: { ...ZERO_USAGE },
        branch,
        baseCommit,
        head: committed.head,
        changedFiles: changed,
        folder: workspace.folder,
        agentsRef: workspace.agentsRef,
      }
    },
  }
}

/** A real JSON state file behind the state port, as the ACP agent keeps one. */
function fileState(
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

async function makeRig(
  options: {
    readonly onStateUpdate?: (rig: RealRig, key: string, value: unknown) => void
  } = {},
): Promise<RealRig> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-teamfit-'))
  const repo = path.join(root, 'repo')
  const storage = path.join(root, 'storage')
  await mkdir(storage, { recursive: true })
  await fixtureGit(root, ['init', '-b', 'main', repo])
  await writeFile(path.join(repo, 'file.txt'), 'before\n')
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-m', 'base'])
  const stateValues = new Map<string, unknown>([[TEAM_WORKSPACE_KEYS.team, storedTeam()]])
  const cards: TeamCardItem[] = []
  const started: string[] = []
  const plans = new Map<string, WorkPlan>()
  const rig: RealRig = {
    // Filled in below, before any delegate can run.
    service: undefined as unknown as TeamHostService,
    repo,
    storage,
    stateValues,
    cards,
    started,
    plans,
    trusted: true,
    dispose: async () => {
      await rig.service.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
  const engine = createEngineTeamPorts({
    repositoryRoot: () => repo,
    storageRoot: storage,
    platform: process.platform,
    isTrusted: () => rig.trusted,
    listModels: () => Promise.reject(tripwireError('listModels')),
    startWorker: () => Promise.reject(tripwireError('startWorker')),
    runGit: realTeamGit,
    now: () => Date.now(),
    log: silentCoreLog(),
  })
  let counter = 0
  const deps: TeamHostServiceDeps = {
    state: fileState(path.join(root, 'state.json'), stateValues, (key, value) => {
      options.onStateUpdate?.(rig, key, value)
    }),
    settings: {
      isTeamOn: () => true,
      isTeamWorkersOn: () => true,
      maxWorkers: () => 4,
      isTrusted: () => rig.trusted,
      scheduler: () => ({ integrationFlow: 'manual', onStall: 'stop', sharedFiles: [] }),
    },
    orchestrator: { modelId: () => ORCHESTRATOR, backend: () => 'modelApi' },
    workers: processWorkers({ repo, storage, plans, started }),
    merges: engine.merges,
    paid: { allowKeyTasks: () => Promise.reject(tripwireError('paid.allowKeyTasks')) },
    cards: {
      show: (_sessionId, item) => {
        cards.push(item)
      },
    },
    createScheduler: (scheduling) => createWindowTeamScheduler(scheduling),
    workspaceId: 'ws',
    windowInstanceId: 'window-a',
    ownerBirth: { windowStartedAt: Date.now(), pid: process.pid, processStart: 'teamfit-start' },
    probeOwner: () => Promise.resolve(false),
    newId: () => {
      counter += 1
      return `task-${String(counter)}`
    },
    now: () => Date.now(),
    log: silentCoreLog(),
  }
  rigs.push(rig)
  const service = createTeamHostService(deps)
  Object.assign(rig, { service })
  // The declared setup probe a surface runs when it opens: the custom
  // entry is usable only once its runtime observably starts.
  await service.probeEntries()
  return rig
}

function context(): TeamToolContext {
  return {
    sessionId: 's1',
    approvalMode: 'manual',
    signal: new AbortController().signal,
    orchestratorModelId: ORCHESTRATOR,
  }
}

/** Delegates the given briefs to engineering; returns the minted task ids. */
async function delegate(
  rig: RealRig,
  tasks: readonly { brief: string; priority?: 'urgent' | 'high' | 'normal' | 'low' }[],
): Promise<string[]> {
  const result = await rig.service.teamRunner.delegate(
    {
      tasks: tasks.map((task) => ({
        role: 'engineering',
        brief: task.brief,
        ...(task.priority !== undefined && { priority: task.priority }),
        reason: { code: 'parallel', detail: 'independent work' },
      })),
    },
    context(),
  )
  const answer = JSON.parse(result.output) as { tasks?: { task_id?: string }[] }
  const ids = (answer.tasks ?? []).map((task) => task.task_id)
  if (ids.includes(undefined))
    throw new Error(`The delegation did not start every task: ${result.output}`)
  return ids as string[]
}

function storedTask(rig: RealRig, taskId: string) {
  const saved = storedTasksSchema.parse(rig.stateValues.get(TEAM_TASKS_STATE_KEY))
  const tasks = Array.isArray(saved) ? saved : saved.tasks
  return tasks.find((task) => task.taskId === taskId)
}

function storedPhase(rig: RealRig, taskId: string): string | undefined {
  return storedTask(rig, taskId)?.phase
}

async function waitDone(rig: RealRig, taskId: string): Promise<void> {
  await expect
    .poll(
      () => {
        const task = storedTask(rig, taskId)
        // Surface the recorded failure instead of timing out past it.
        if (task?.phase === 'failed') throw new Error(`task failed: ${task.failure ?? ''}`)
        return task?.phase
      },
      { timeout: 30_000 },
    )
    .toBe('done')
}

type MergeCard = Extract<TeamCardItem, { kind: 'teamMerge' }>

/** The merge cards still waiting for the person's answer, in show order. */
function openMergeCards(rig: RealRig): MergeCard[] {
  return rig.cards.filter(
    (card): card is MergeCard => card.kind === 'teamMerge' && card.status === 'inProgress',
  )
}

/** The file's contents, or '' while it does not exist yet. */
async function readOrEmpty(file: string): Promise<string> {
  return existsSync(file) ? await readFile(file, 'utf8') : ''
}

/** True once a tasks update first records the task as running. */
function hasRunningRecord(value: unknown, taskId: string): boolean {
  const tasks = (value as { tasks?: { taskId: string; phase: string }[] } | undefined)?.tasks
  return (
    Array.isArray(tasks) && tasks.some((task) => task.taskId === taskId && task.phase === 'running')
  )
}

describe('final admission (real host, real scheduler, real processes)', () => {
  it('refuses after persistence when trust flips during it: no worker, refunded, then runs', async () => {
    let isFlipped = false
    const rig = await makeRig({
      // Trust is withdrawn in the middle of launch's own persistence await:
      // the update that first records the task running flips it, so only
      // the second, post-await admission can refuse the launch.
      onStateUpdate: (holder, key, value) => {
        if (isFlipped || key !== TEAM_TASKS_STATE_KEY || !hasRunningRecord(value, 'task-1')) return
        isFlipped = true
        holder.trusted = false
      },
    })
    rig.plans.set('write the feature file', { files: { 'feature.ts': 'export const x = 1\n' } })
    const [taskId] = await delegate(rig, [{ brief: 'write the feature file' }])
    expect(taskId).toBe('task-1')
    // The refusal settles the task back to queued with its admission refunded:
    // no process ever started, and the board counts no live attempt.
    await expect.poll(() => storedPhase(rig, 'task-1'), { timeout: 30_000 }).toBe('queued')
    expect(isFlipped).toBe(true)
    expect(rig.started).toEqual([])
    expect(existsSync(path.join(rig.storage, 'started-task-1'))).toBe(false)
    const boarded = rig.service.scheduler?.snapshot().tasks.find((task) => task.id === 'task-1')
    expect(boarded?.state).not.toBe('running')
    expect(boarded?.attempts.filter((attempt) => attempt.state === 'running')).toEqual([])

    // A refunded admission is spendable again: with trust back, the same
    // task launches and finishes through a real process.
    rig.trusted = true
    await rig.service.scheduler?.wake()
    await waitDone(rig, 'task-1')
    expect(rig.started).toEqual(['task-1'])
    expect(existsSync(path.join(rig.storage, 'started-task-1'))).toBe(true)
    // Real git and scheduling work exceeds the 5 s default on this rig class.
  }, 60_000)
})

describe('the ordered merge queue (real host, real git)', () => {
  it('lands the higher-priority task first and one card at a time, in recorded order', async () => {
    const rig = await makeRig()
    rig.plans.set('low task work', { files: { 'low.txt': 'low\n' } })
    rig.plans.set('high task work', { files: { 'high.txt': 'high\n' } })
    const [low, high] = await delegate(rig, [
      { brief: 'low task work', priority: 'low' },
      { brief: 'high task work', priority: 'high' },
    ])
    if (low === undefined || high === undefined) throw new Error('delegation minted no ids')
    await waitDone(rig, low)
    await waitDone(rig, high)

    // Hold landing, enqueue low first: the queue still orders high ahead.
    await rig.service.setLandingPaused(true)
    await rig.service.teamRunner.merge({ task_id: low }, context())
    const second = await rig.service.teamRunner.merge({ task_id: high }, context())
    expect(JSON.parse(second.output)).toMatchObject({ task_id: high, position: 1 })
    expect(rig.service.mergeQueue?.()).toEqual([
      { taskId: high, position: 1 },
      { taskId: low, position: 2 },
    ])
    expect(openMergeCards(rig)).toEqual([])

    // Release: the head's card opens first, alone.
    await rig.service.setLandingPaused(false)
    await rig.service.teamRunner.merge({ task_id: low }, context())
    await expect.poll(() => openMergeCards(rig).length, { timeout: 30_000 }).toBe(1)
    expect(openMergeCards(rig)[0]?.teamMerge.taskId).toBe(high)
    await rig.service.decideMerge(high, 'merge')
    await expect
      .poll(() => readOrEmpty(path.join(rig.repo, 'high.txt')), { timeout: 30_000 })
      .toBe('high\n')
    // Only then does the next card open.
    await expect
      .poll(() => openMergeCards(rig).filter((card) => card.teamMerge.taskId === low).length, {
        timeout: 30_000,
      })
      .toBe(1)
    await rig.service.decideMerge(low, 'merge')
    await expect
      .poll(() => readOrEmpty(path.join(rig.repo, 'low.txt')), { timeout: 30_000 })
      .toBe('low\n')
    expect(rig.service.mergeEvents?.().map((event) => `${event.kind}:${event.taskId}`)).toEqual([
      `enqueued:${low}`,
      `enqueued:${high}`,
      `landed:${high}`,
      `landed:${low}`,
    ])
    // Two real worker processes, copies and landings exceed the 5 s default.
  }, 90_000)
})

describe('plan before card (real host, real planner, real git)', () => {
  it('cards the planner’s files, and a moved ref refuses before any waiting card', async () => {
    const rig = await makeRig()
    // The worker changes two files but its outcome names only one: the card
    // must list what the planner reads from the real branch, not the outcome.
    rig.plans.set('planned work', {
      files: {
        'feature.ts': 'export const answer = 42\n',
        '.github/workflows/ci.yml': 'name: ci\n',
      },
      omit: ['.github/workflows/ci.yml'],
    })
    const [plannedTask] = await delegate(rig, [{ brief: 'planned work' }])
    if (plannedTask === undefined) throw new Error('delegation minted no id')
    await waitDone(rig, plannedTask)
    await rig.service.teamRunner.merge({ task_id: plannedTask }, context())
    await expect.poll(() => openMergeCards(rig).length, { timeout: 30_000 }).toBe(1)
    const card = openMergeCards(rig)[0]
    expect(card?.teamMerge.affectedFiles?.toSorted((a, b) => a.localeCompare(b))).toEqual([
      '.github/workflows/ci.yml',
      'feature.ts',
    ])
    expect(card?.teamMerge.protectedPaths).toEqual(['.github/workflows/ci.yml'])
    await rig.service.decideMerge(plannedTask, 'discard')
    await expect.poll(() => storedPhase(rig, plannedTask), { timeout: 30_000 }).toBe('discarded')

    // A moved agents ref refuses at plan time: no waiting card ever opens,
    // the queue records the return, and the tree keeps its base bytes.
    rig.plans.set('moved ref work', { files: { 'moved.txt': 'moved\n' } })
    const [movedTask] = await delegate(rig, [{ brief: 'moved ref work' }])
    if (movedTask === undefined) throw new Error('delegation minted no id')
    await waitDone(rig, movedTask)
    const baseOut = await fixtureGit(rig.repo, ['rev-parse', 'HEAD'])
    const base = baseOut.trim()
    const agentsRef = storedTask(rig, movedTask)?.outcome?.agentsRef
    if (agentsRef === undefined) throw new Error(`no agents ref recorded for ${movedTask}`)
    await fixtureGit(rig.repo, ['update-ref', agentsRef, base])
    const before = openMergeCards(rig).length
    await rig.service.teamRunner.merge({ task_id: movedTask }, context())
    await expect
      .poll(
        () =>
          rig.service
            .mergeEvents?.()
            .some((event) => event.kind === 'returned' && event.taskId === movedTask),
        { timeout: 30_000 },
      )
      .toBe(true)
    expect(openMergeCards(rig).length).toBe(before)
    expect(existsSync(path.join(rig.repo, 'moved.txt'))).toBe(false)
    expect(await readFile(path.join(rig.repo, 'file.txt'), 'utf8')).toBe('before\n')
    // Real worker processes, plans and a discard exceed the 5 s default.
  }, 90_000)
})
