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
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createTeamHostService } from '../../src/core/team/teamHost'
import { projectTeamTraffic } from '../../src/host/team/teamTrafficProjection'
import type {
  TeamCardItem,
  TeamHostService,
  TeamHostServiceDeps,
  TeamTaskSpec,
  TeamWorkerOutcome,
  TeamWorkerPort,
} from '../../src/core/team/teamHostService'
import { TEAM_TASKS_STATE_KEY } from '../../src/core/team/teamTaskState'
import { TEAM_HANDOFF_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  commitTaskBranch,
  publishTaskRef,
  resolveBaseCommit,
  startTeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import type { TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { fixtureGit } from './helpers/teamLandingFixture'
import {
  fileState,
  initRigFolders,
  realServiceDeps,
  storedTaskOf,
  toolContext,
} from './helpers/teamRealRig'
import { enginePortsWithoutWorker, realTeamGit, tripwireError } from './helpers/realTeamGit'

const ORCHESTRATOR = 'orchestrator-model'
const ZERO_USAGE = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  modelCalls: 0,
  estimated: false,
} as const

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
  /** D261: entries whose run ends refused, as a worker's refused turn hands it back. */
  readonly refuseOn?: readonly string[]
}

/** D261: what each run was handed: its entry and its brief. */
interface WorkerRun {
  readonly entryId: string
  readonly brief: string
}

const RUN_USAGE = { ...ZERO_USAGE, input: 10, output: 5, modelCalls: 1 } as const

interface RealRig {
  readonly service: TeamHostService
  readonly repo: string
  readonly storage: string
  readonly stateValues: Map<string, unknown>
  readonly cards: TeamCardItem[]
  readonly started: string[]
  readonly plans: Map<string, WorkPlan>
  readonly runs: WorkerRun[]
  trusted: boolean
  /** D261's toggle, read live by the host. */
  refusalFallback: boolean
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
  readonly runs: WorkerRun[]
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
      const plan =
        rig.plans.get(spec.taskId) ??
        [...rig.plans].find(([brief]) => spec.brief.endsWith(brief))?.[1]
      if (plan === undefined) throw new Error(`no work plan for ${spec.taskId}`)
      rig.runs.push({ entryId: spec.entry.id, brief: spec.brief })
      if (plan.refuseOn?.includes(spec.entry.id) === true) {
        // A refused turn: one request spent, nothing written, the refusal's
        // own words as the summary (the engine port's `refusal` report).
        spec.meter.admitRequest()
        await spec.meter.noteUsage({ ...RUN_USAGE })
        return {
          report: { status: 'failed', summary: `${spec.entry.id}: I can't help with that.` },
          usage: { ...RUN_USAGE },
          isRefused: true,
        }
      }
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

async function makeRig(
  options: {
    readonly onStateUpdate?: (rig: RealRig, key: string, value: unknown) => void
    readonly team?: TeamSnapshot
    readonly refusalFallback?: boolean
    /** D261: the service each provider record was added from. */
    readonly providerService?: (record: string) => string | undefined
    /** What the surface brings to the checked landing; `repo` is this rig's tree. */
    readonly landing?: (repo: string) => Parameters<typeof enginePortsWithoutWorker>[0]['landing']
  } = {},
): Promise<RealRig> {
  // Resolved: the team copy must be inside canonical storage, and macOS's /var is a link.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-teamfit-')))
  const { repo, storage } = await initRigFolders(root)
  const stateValues = new Map<string, unknown>([
    [TEAM_WORKSPACE_KEYS.team, options.team ?? storedTeam()],
  ])
  const cards: TeamCardItem[] = []
  const started: string[] = []
  const plans = new Map<string, WorkPlan>()
  const runs: WorkerRun[] = []
  const rig: RealRig = {
    // Filled in below, before any delegate can run.
    service: undefined as unknown as TeamHostService,
    repo,
    storage,
    stateValues,
    cards,
    started,
    plans,
    runs,
    trusted: true,
    refusalFallback: options.refusalFallback === true,
    dispose: async () => {
      await rig.service.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
  const engine = enginePortsWithoutWorker({
    repositoryRoot: () => repo,
    storageRoot: storage,
    isTrusted: () => rig.trusted,
    landing: options.landing?.(repo),
  })
  const real = realServiceDeps({
    orchestrator: ORCHESTRATOR,
    isTrusted: () => rig.trusted,
    cards,
    state: fileState(path.join(root, 'state.json'), stateValues, (key, value) => {
      options.onStateUpdate?.(rig, key, value)
    }),
  })
  const deps: TeamHostServiceDeps = {
    ...real,
    settings: { ...real.settings, isRefusalFallbackOn: () => rig.refusalFallback },
    workers: {
      ...processWorkers({ repo, storage, plans, started, runs }),
      providerService: options.providerService,
    },
    merges: engine.merges,
    paid: { allowKeyTasks: () => Promise.reject(tripwireError('paid.allowKeyTasks')) },
  }
  rigs.push(rig)
  const service = createTeamHostService(deps)
  Object.assign(rig, { service })
  // The declared setup probe a surface runs when it opens: the custom
  // entry is usable only once its runtime observably starts.
  await service.probeEntries()
  return rig
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
    toolContext(ORCHESTRATOR),
  )
  const answer = JSON.parse(result.output) as { tasks?: { task_id?: string }[] }
  const ids = (answer.tasks ?? []).map((task) => task.task_id)
  if (ids.includes(undefined))
    throw new Error(`The delegation did not start every task: ${result.output}`)
  return ids as string[]
}

function storedTask(rig: RealRig, taskId: string) {
  return storedTaskOf(rig.stateValues, taskId)
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

/** D261: one engine entry of the refusal role, on its own model (`<record>/` names its provider). */
function refusalEntry(id: string, record?: string) {
  return {
    id,
    concurrent: 1,
    caps: [],
    agent: {
      kind: 'engine' as const,
      agentId: `agent-${id}`,
      model: record === undefined ? `model-${id}` : `${record}/model-${id}`,
      pays: 'local' as const,
    },
  }
}

/** D261: one engineering role whose list is r1, r2, r3, each on its own model. */
function refusalTeam(records: readonly (string | undefined)[] = []): TeamSnapshot {
  return {
    roles: [
      {
        role: 'engineering',
        workspace: 'own-branch',
        pool: ['r1', 'r2', 'r3'].map((id, index) => refusalEntry(id, records[index])),
      },
    ],
    intensity: 'balanced',
  }
}

/** D261: a solo chat on `modelId` hands its refused turn ("fix the chat bug") to the team's move. */
function takeOver(rig: RealRig, modelId: string) {
  const takeOverRefused = rig.service.teamRunner.takeOverRefused
  if (takeOverRefused === undefined) throw new Error('the host offers no chat takeover')
  return takeOverRefused(
    {
      modelId,
      refusal: "I can't help with that.",
      request: 'fix the chat bug',
      work: ['read: {"path":"a.ts"}'],
    },
    toolContext(modelId),
  )
}

function claimedInputByEntry(rig: RealRig, taskId: string): Record<string, number> {
  const totals: Record<string, number> = {}
  const claims = storedTask(rig, taskId)?.claims ?? []
  for (const claim of claims) {
    const key = claim.entryId ?? 'none'
    totals[key] = (totals[key] ?? 0) + claim.usage.input
  }
  return totals
}

describe('a refused task moves down its role (D261, real host, real scheduler)', () => {
  it('moves once per candidate in role order, says why, and keeps each run on its own entry', async () => {
    const rig = await makeRig({ team: refusalTeam(), refusalFallback: true })
    rig.plans.set('write the refused file', {
      files: { 'refused.ts': 'export const y = 2\n' },
      refuseOn: ['r1'],
    })
    const [taskId = ''] = await delegate(rig, [{ brief: 'write the refused file' }])
    await waitDone(rig, taskId)
    expect(rig.runs.map((run) => run.entryId)).toEqual(['r1', 'r2'])
    // D103's handoff: the taking agent reads the refusal as data, then the brief.
    expect(rig.runs[1]?.brief.startsWith(TEAM_HANDOFF_MODEL_TEXT.handoff)).toBe(true)
    expect(rig.runs[1]?.brief).toContain("r1: I can't help with that.")
    const row = rig.cards.find((card) => card.kind === 'teamSwitch')
    expect(row?.teamSwitch).toEqual({
      roleId: 'engineering',
      fromEntry: 'r1',
      toEntry: 'r2',
      reason: UI_TEXT.teamSwitchReasonRefused,
    })
    // Each run is counted as itself: r1's refused request stays on r1.
    expect(claimedInputByEntry(rig, taskId)).toMatchObject({ r1: 10 })
    // Real git and scheduling work exceeds the 5 s default on this rig class.
  }, 60_000)

  it('gives each candidate one try, then ends with the last true refusal', async () => {
    const rig = await makeRig({ team: refusalTeam(), refusalFallback: true })
    rig.plans.set('refuse everywhere', { files: {}, refuseOn: ['r1', 'r2', 'r3'] })
    const [taskId = ''] = await delegate(rig, [{ brief: 'refuse everywhere' }])
    await expect.poll(() => storedPhase(rig, taskId), { timeout: 30_000 }).toBe('failed')
    await expect.poll(() => rig.runs.length, { timeout: 30_000 }).toBe(3)
    expect(rig.runs.map((run) => run.entryId)).toEqual(['r1', 'r2', 'r3'])
    expect(storedTask(rig, taskId)?.outcome?.report.summary).toBe("r3: I can't help with that.")
    expect(claimedInputByEntry(rig, taskId)).toMatchObject({ r1: 10, r2: 10, r3: 10 })
  }, 60_000)

  it('with the toggle off, a refusal ends the task on its first agent, as before', async () => {
    const rig = await makeRig({ team: refusalTeam() })
    rig.plans.set('refuse once', { files: {}, refuseOn: ['r1'] })
    const [taskId = ''] = await delegate(rig, [{ brief: 'refuse once' }])
    await expect.poll(() => storedPhase(rig, taskId), { timeout: 30_000 }).toBe('failed')
    expect(rig.runs.map((run) => run.entryId)).toEqual(['r1'])
    expect(rig.cards.some((card) => card.kind === 'teamSwitch')).toBe(false)
    expect(storedTask(rig, taskId)?.outcome?.report.summary).toBe("r1: I can't help with that.")
  }, 60_000)
})

describe('a refused solo chat turn moves down the main role of its agent (D261, real host)', () => {
  it('stands while off or with no role, then the next agent answers from the handoff', async () => {
    const rig = await makeRig({ team: refusalTeam() })
    rig.plans.set('fix the chat bug', { files: { 'chat.ts': 'export const fixed = true\n' } })
    // Off: the refusal stands, as before; nothing runs.
    expect(await takeOver(rig, 'model-r1')).toEqual({ kind: 'stands' })
    rig.refusalFallback = true
    // No role holds the chat's agent: the refusal stands.
    expect(await takeOver(rig, 'model-x')).toEqual({ kind: 'stands' })
    expect(rig.runs).toEqual([])
    const answer = await takeOver(rig, 'model-r1')
    // The chat's own agent never runs again; the next in its main role does.
    expect(rig.runs.map((run) => run.entryId)).toEqual(['r2'])
    const brief = rig.runs[0]?.brief ?? ''
    expect(brief.startsWith(TEAM_HANDOFF_MODEL_TEXT.handoff)).toBe(true)
    expect(brief).toContain(
      `${TEAM_HANDOFF_MODEL_TEXT.handoffDataOpen}I can't help with that.\nread: {"path":"a.ts"}${TEAM_HANDOFF_MODEL_TEXT.handoffDataClose}`,
    )
    expect(brief.endsWith('\nfix the chat bug')).toBe(true)
    if (answer.kind !== 'answered') throw new Error(`no takeover: ${JSON.stringify(answer)}`)
    expect(answer.model).toBe('model-r2')
    expect(answer.text).toBe(storedTask(rig, answer.taskId)?.outcome?.report.summary)
    // The team path's own words name who refused and who took over.
    expect(rig.cards.find((card) => card.kind === 'teamSwitch')?.teamSwitch).toEqual({
      roleId: 'engineering',
      fromEntry: 'r1',
      toEntry: 'r2',
      reason: UI_TEXT.teamSwitchReasonRefused,
    })
    // Real git and a real worker process exceed the 5 s default on this rig class.
  }, 60_000)

  it('never moves to another account of the refusing provider, and says so', async () => {
    const services: Record<string, string> = { acme: 'acme', 'acme-two': 'acme' }
    const rig = await makeRig({
      team: refusalTeam(['acme', 'acme-two', undefined]),
      refusalFallback: true,
      providerService: (record) => services[record],
    })
    rig.plans.set('fix the chat bug', { files: { 'chat.ts': 'export const fixed = true\n' } })
    const answer = await takeOver(rig, 'acme/model-r1')
    // r2 runs on the same provider under another account: passed over for r3.
    expect(rig.runs.map((run) => run.entryId)).toEqual(['r3'])
    expect(answer).toMatchObject({ kind: 'answered', model: 'model-r3' })
    // With no other provider left, the refusal stands and the sentence says why.
    const lone = await makeRig({
      team: refusalTeam(['acme', 'acme-two', 'acme-two']),
      refusalFallback: true,
      providerService: (record) => services[record],
    })
    expect(await takeOver(lone, 'acme/model-r1')).toEqual({
      kind: 'declined',
      text: fill(UI_TEXT.refusalOtherAccountSkipped, {
        from: 'acme/model-r1',
        models: 'acme-two/model-r2, acme-two/model-r3',
      }),
    })
    expect(lone.runs).toEqual([])
    // Real git and a real worker process exceed the 5 s default on this rig class.
  }, 60_000)
})

describe('a file saved while a task lands (real host, real git)', () => {
  it('the card names it, Traffic offers Undo Merge, and Undo puts back only the landing', async () => {
    const state = { isSaved: false }
    const rig = await makeRig({
      // The person saves b.txt while its replacement stands staged, second of three.
      landing: (repo) => ({
        validateTarget: async (target) => {
          if (state.isSaved || path.basename(target) !== 'b.txt') return
          const names = await readdir(path.dirname(target))
          if (names.every((name) => !name.startsWith('b.txt.'))) return
          state.isSaved = true
          await writeFile(path.join(repo, 'b.txt'), 'the person\n')
        },
      }),
    })
    rig.plans.set('three files', { files: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' } })
    const [task] = await delegate(rig, [{ brief: 'three files', priority: 'normal' }])
    if (task === undefined) throw new Error('delegation minted no id')
    await waitDone(rig, task)
    await rig.service.teamRunner.merge({ task_id: task }, toolContext(ORCHESTRATOR))
    await expect.poll(() => openMergeCards(rig).length, { timeout: 30_000 }).toBe(1)
    await rig.service.decideMerge(task, 'merge')
    await expect
      .poll(() => rig.service.mergeRefusal?.(task)?.kind, { timeout: 60_000 })
      .toBe('changed')

    // Not merged, and the card says why, with its Undo.
    expect(
      rig.service
        .tree()
        ?.roles.flatMap((role) => role.unmerged)
        .map((row) => row.taskId),
    ).toContain(task)
    const card = rig.cards.findLast((item) => item.kind === 'teamMerge')
    if (card?.kind !== 'teamMerge') throw new Error('no merge card')
    expect(card.teamMerge.changedDuringLanding).toEqual(['b.txt', 'c.txt'])
    expect(await readFile(path.join(rig.repo, 'a.txt'), 'utf8')).toBe('a\n')
    expect(await readFile(path.join(rig.repo, 'b.txt'), 'utf8')).toBe('the person\n')

    // Traffic names it too, in the person's words, and offers the same Undo.
    const traffic = projectTeamTraffic(rig.service, 2)
    const row = traffic.mergeQueue.find((candidate) => candidate.taskId === task)
    expect(row?.reason).toBe(
      fill(UI_TEXT.teamTrafficNotices.changedDuringLanding, { path: 'b.txt, c.txt' }),
    )
    expect(row?.actions).toContain('undoBatch')

    await rig.service.decideMerge(task, 'undo')
    expect(existsSync(path.join(rig.repo, 'a.txt'))).toBe(false)
    expect(await readFile(path.join(rig.repo, 'b.txt'), 'utf8')).toBe('the person\n')
    expect(existsSync(path.join(rig.repo, 'c.txt'))).toBe(false)
    expect(rig.service.mergeRefusal?.(task)).toBeUndefined()
    const after = rig.cards.findLast((item) => item.kind === 'teamMerge')
    if (after?.kind !== 'teamMerge') throw new Error('no merge card')
    expect(after.teamMerge.changedDuringLanding).toBeUndefined()
    expect(after.teamDecision).toBe(fill(UI_TEXT.teamTrafficNotices.undoKept, { path: 'b.txt' }))
    // Once is all there is.
    await expect(rig.service.decideMerge(task, 'undo')).rejects.toThrow(
      UI_TEXT.teamTrafficDetails.changedSinceOpened,
    )
    // Real git, a real worker process and a real landing.
  }, 120_000)
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
    await rig.service.teamRunner.merge({ task_id: low }, toolContext(ORCHESTRATOR))
    const second = await rig.service.teamRunner.merge({ task_id: high }, toolContext(ORCHESTRATOR))
    expect(JSON.parse(second.output)).toMatchObject({ task_id: high, position: 1 })
    expect(rig.service.mergeQueue?.()).toEqual([
      { taskId: high, position: 1 },
      { taskId: low, position: 2 },
    ])
    expect(openMergeCards(rig)).toEqual([])

    // Release: the head's card opens first, alone.
    await rig.service.setLandingPaused(false)
    await rig.service.teamRunner.merge({ task_id: low }, toolContext(ORCHESTRATOR))
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
    await rig.service.teamRunner.merge({ task_id: plannedTask }, toolContext(ORCHESTRATOR))
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
    await rig.service.teamRunner.merge({ task_id: movedTask }, toolContext(ORCHESTRATOR))
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
