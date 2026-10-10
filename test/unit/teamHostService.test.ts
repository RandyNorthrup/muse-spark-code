// M96 lane X (C-M96-3): the team host service every surface binds to, and
// the window binding that keeps a workspace without a team at zero loads.
// Every port is a fake that records its calls; nothing here touches a model,
// git or the disk.

import { describe, expect, it, vi } from 'vitest'
import { createTeamHostService } from '../../src/core/team/teamHost'
import type {
  TeamCardItem,
  TeamHostServiceDeps,
  TeamMergeOutcome,
  TeamTaskSpec,
  TeamWorkerOutcome,
} from '../../src/core/team/teamHostService'
import type { TeamToolContext, TeamToolResult } from '../../src/core/team/teamSeams'
import type { TeamPoolEntry, TeamRoleConfig, TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS, decideTeamConversationMode } from '../../src/shared/teamConversation'
import { TeamHostBinding } from '../../src/host/teamHostBinding'
import type { EngineTeamPortsDeps } from '../../src/host/team/teamEnginePorts'
import { TEAM_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'

const ORCHESTRATOR = 'muse-spark-1.3'
const WORKER_MODEL = 'other-model-7'

function entry(id: string, model: string | undefined, concurrent = 2): TeamPoolEntry {
  return {
    id,
    concurrent,
    caps: [],
    ...(model !== undefined && {
      agent: { kind: 'engine', agentId: `agent-${id}`, model, pays: 'local' },
    }),
  }
}

function team(
  pool: readonly TeamPoolEntry[],
  extra: Record<string, unknown> = {},
  role: Partial<TeamRoleConfig> = {},
): TeamSnapshot {
  return {
    roles: [{ role: 'engineering', workspace: 'own-branch', ...role, pool: [...pool] }],
    intensity: 'balanced',
    ...extra,
  }
}

interface Harness {
  readonly deps: TeamHostServiceDeps
  readonly started: TeamTaskSpec[]
  readonly signals: AbortSignal[]
  readonly finish: (index: number, outcome?: Partial<TeamWorkerOutcome>) => void
  readonly merged: string[]
  readonly discarded: string[]
  readonly paidAsks: number[]
  readonly probes: string[]
  readonly cards: { readonly sessionId: string; readonly item: TeamCardItem }[]
}

function harness(
  stored: unknown,
  options: {
    readonly trusted?: boolean
    readonly paid?: boolean
    readonly canRun?: boolean
    readonly probe?: boolean
    readonly defaultAgent?: boolean
  } = {},
): Harness {
  const values = new Map<string, unknown>([[TEAM_WORKSPACE_KEYS.team, stored]])
  const started: TeamTaskSpec[] = []
  const signals: AbortSignal[] = []
  const resolvers: ((outcome: TeamWorkerOutcome) => void)[] = []
  const merged: string[] = []
  const discarded: string[] = []
  const paidAsks: number[] = []
  const probes: string[] = []
  const cards: { readonly sessionId: string; readonly item: TeamCardItem }[] = []
  let id = 0
  const deps: TeamHostServiceDeps = {
    state: {
      get: (key) => values.get(key),
      update: async (key, value) => {
        values.set(key, value)
        await Promise.resolve()
      },
    },
    settings: {
      isTeamOn: () => true,
      isTeamWorkersOn: () => true,
      maxWorkers: () => 4,
      isTrusted: () => options.trusted ?? true,
    },
    orchestrator: {
      modelId: () => ORCHESTRATOR,
      backend: () => 'modelApi',
      defaultAgent: (model) =>
        options.defaultAgent === true
          ? { kind: 'engine', agentId: 'default', model, pays: 'key' }
          : undefined,
    },
    workers: {
      canRun: () => options.canRun ?? true,
      probe: (agent) => {
        probes.push(agent.model)
        return Promise.resolve(options.probe ?? true)
      },
      run: (spec, signal) => {
        started.push(spec)
        signals.push(signal)
        return new Promise((resolve) => {
          resolvers.push(resolve)
        })
      },
    },
    merges: {
      merge: (task): Promise<TeamMergeOutcome> => {
        merged.push(task.taskId)
        return Promise.resolve({ status: 'merged', written: ['a.ts'], conflicts: [] })
      },
      discard: (task) => {
        discarded.push(task.taskId)
        return Promise.resolve()
      },
      diff: (outcome) => Promise.resolve(`diff ${outcome.head ?? ''}`),
    },
    cards: {
      show: (sessionId, item) => {
        cards.push({ sessionId, item })
      },
    },
    paid: {
      allowKeyTasks: (tasks) => {
        paidAsks.push(tasks.length)
        return Promise.resolve(options.paid ?? true)
      },
    },
    newId: () => {
      id += 1
      return `task-${String(id)}`
    },
    now: () => 1_000_000,
    log: { info: () => undefined, warn: () => undefined },
  }
  return {
    deps,
    started,
    signals,
    merged,
    discarded,
    paidAsks,
    probes,
    cards,
    finish: (index, outcome = {}) => {
      resolvers[index]?.({
        report: { status: 'done', summary: 'did it' },
        usage: {
          input: 10,
          cachedInput: 0,
          output: 5,
          reasoning: 0,
          modelCalls: 1,
          estimated: false,
        },
        branch: 'agents/engineering/x',
        baseCommit: 'a'.repeat(40),
        head: 'b'.repeat(40),
        changedFiles: ['a.ts'],
        folder: '/copies/x',
        agentsRef: 'refs/heads/agents/engineering/x',
        ...outcome,
      })
    },
  }
}

function context(overrides: Partial<TeamToolContext> = {}): TeamToolContext {
  return {
    sessionId: 's1',
    approvalMode: 'manual',
    signal: new AbortController().signal,
    orchestratorModelId: ORCHESTRATOR,
    ...overrides,
  }
}

const delegateOne = {
  tasks: [{ role: 'engineering', brief: 'fix the bug', reason: { code: 'parallel', detail: 'x' } }],
}

function json(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

async function output(pending: Promise<TeamToolResult>): Promise<string> {
  const result = await pending
  return result.output
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the team host service', () => {
  it('reads no team as no decision, no tree and no roster', () => {
    const service = createTeamHostService(harness(undefined).deps)
    expect(service.teamDecisionSource(ORCHESTRATOR)).toBeUndefined()
    expect(service.tree()).toBeUndefined()
    expect(service.teamRosterData()).toBeUndefined()
  })

  it('stays single-model until the distinct entry is observed loaded by the setup probe', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    const before = service.teamDecisionSource(ORCHESTRATOR)
    expect(before === undefined ? undefined : decideTeamConversationMode(before)).toEqual({
      mode: 'single-model',
      reason: 'not-loaded',
    })
    expect(service.tree()).toBeUndefined()
    await service.probeEntries()
    expect(h.probes).toEqual([WORKER_MODEL])
    const after = service.teamDecisionSource(ORCHESTRATOR)
    expect(after === undefined ? undefined : decideTeamConversationMode(after).mode).toBe('team')
    const tree = service.tree()
    expect(tree?.roles[0]?.entries[0]).toMatchObject({ id: 'e1', state: 'ready', running: 0 })
  })

  it("keeps Default-only and duplicate-model teams single-model with today's map", async () => {
    for (const stored of [team([entry('d', undefined)]), team([entry('same', ORCHESTRATOR)])]) {
      const service = createTeamHostService(harness(stored, { defaultAgent: true }).deps)
      await service.probeEntries()
      const source = service.teamDecisionSource(ORCHESTRATOR)
      expect(source === undefined ? undefined : decideTeamConversationMode(source).mode).toBe(
        'single-model',
      )
      expect(service.tree()).toBeUndefined()
    }
  })

  it('counts an entry this editor cannot run as unavailable, without probing it', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]), { canRun: false })
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    expect(h.probes).toEqual([])
    const source = service.teamDecisionSource(ORCHESTRATOR)
    expect(source === undefined ? undefined : decideTeamConversationMode(source).reason).toBe(
      'unavailable',
    )
  })

  it("delegates, collects the report, and merges only on the user's answer", async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const started = json(await output(service.teamRunner.delegate(delegateOne, context())))
    expect(started['tasks']).toEqual([
      expect.objectContaining({ task_id: 'task-1', entry: 'e1', state: 'running' }),
    ])
    expect(h.started[0]).toMatchObject({ brief: 'fix the bug', parentSessionId: 's1' })
    h.finish(0)
    await settle()
    const collected = json(await output(service.teamRunner.collect({}, context())))
    expect(collected['tasks']).toEqual([
      expect.objectContaining({
        task_id: 'task-1',
        state: 'done',
        report: { status: 'done', summary: 'did it' },
      }),
    ])
    expect(service.tree()?.roles[0]?.unmerged.map((task) => task.taskId)).toEqual(['task-1'])
    const merging = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(h.merged).toEqual([])
    await service.decideMerge('task-1', 'merge')
    const answer = json(await output(merging))
    expect(answer).toMatchObject({ task_id: 'task-1', status: 'merged' })
    expect(h.merged).toEqual(['task-1'])
    expect(await output(service.teamRunner.merge({ task_id: 'task-1' }, context()))).toContain(
      TEAM_MODEL_TEXT.hostMergeNotReady,
    )
  })

  it("refuses merge in Plan mode and another conversation's task", async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    expect(
      await output(
        service.teamRunner.merge({ task_id: 'task-1' }, context({ approvalMode: 'denyUnmatched' })),
      ),
    ).toContain(TEAM_MODEL_TEXT.hostMergePlanMode)
    expect(
      await output(
        service.teamRunner.merge({ task_id: 'task-1' }, context({ sessionId: 'other' })),
      ),
    ).toContain(TEAM_MODEL_TEXT.hostUnknownTask)
    expect(h.merged).toEqual([])
  })

  it('starts no worker in an untrusted workspace', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]), { trusted: false })
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const result = await service.teamRunner.delegate(delegateOne, context())
    expect(result.output).toContain(TEAM_MODEL_TEXT.hostUntrusted)
    expect(h.started).toEqual([])
  })

  it('asks the paid popup once per call for key tasks, and starts nothing when declined', async () => {
    const keyEntry: TeamPoolEntry = {
      id: 'k',
      concurrent: 2,
      caps: [{ measure: 'tokens', window: 'task', amount: 50_000 }],
      agent: { kind: 'engine', agentId: 'meta', model: WORKER_MODEL, pays: 'key' },
    }
    const h = harness(team([keyEntry]), { paid: false })
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const two = { tasks: [delegateOne.tasks[0], delegateOne.tasks[0]] }
    const result = await service.teamRunner.delegate(two, context())
    expect(h.paidAsks).toEqual([2])
    expect(result.output).toContain(TEAM_MODEL_TEXT.hostPaidDeclined)
    expect(h.started).toEqual([])
  })

  it("takes the first entry with headroom and refuses past every entry's concurrency", async () => {
    const h = harness(
      team([entry('a', WORKER_MODEL, 1), entry('b', 'third-model', 1)], {}, { exhausted: 'self' }),
    )
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const three = { tasks: [delegateOne.tasks[0], delegateOne.tasks[0], delegateOne.tasks[0]] }
    const answer = json(await output(service.teamRunner.delegate(three, context())))
    expect(answer['tasks']).toEqual([
      expect.objectContaining({ entry: 'a' }),
      expect.objectContaining({ entry: 'b' }),
      {
        role: 'engineering',
        refused: TEAM_MODEL_TEXT.hostExhausted.replace('{role}', 'engineering'),
      },
    ])
    expect(h.started.map((spec) => spec.entry.id)).toEqual(['a', 'b'])
  })

  it("resolves Default to the conversation's own model once a distinct entry runs the team", async () => {
    const h = harness(team([entry('a', WORKER_MODEL, 1), entry('d', undefined, 1)]), {
      defaultAgent: true,
    })
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const two = { tasks: [delegateOne.tasks[0], delegateOne.tasks[0]] }
    await service.teamRunner.delegate(two, context({ orchestratorModelId: 'picked-model' }))
    expect(h.started.map((spec) => [spec.entry.id, spec.entry.agent.model])).toEqual([
      ['a', WORKER_MODEL],
      ['d', 'picked-model'],
    ])
  })

  it('stops a running task through its signal, and stop all counts what ran', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const trees: unknown[] = []
    service.onTreeChange((tree) => {
      trees.push(tree)
    })
    await service.teamRunner.delegate(
      { tasks: [delegateOne.tasks[0], delegateOne.tasks[0]] },
      context(),
    )
    await service.stopTask('task-1')
    expect(h.signals[0]?.aborted).toBe(true)
    expect(await service.stopAllTasks()).toBe(1)
    expect(h.signals[1]?.aborted).toBe(true)
    expect(trees.length).toBeGreaterThan(0)
    await expect(service.stopTask('missing')).rejects.toThrow(UI_TEXT.teamTaskUnknown)
  })

  it('discards a finished task from the tree without a merge', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    await service.decideMerge('task-1', 'discard')
    expect(h.discarded).toEqual(['task-1'])
    expect(h.merged).toEqual([])
  })
  it('asks the user when every entry is at its limits, and starts on Raise', async () => {
    const h = harness(team([entry('a', WORKER_MODEL, 1)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    const second = service.teamRunner.delegate(delegateOne, context())
    await settle()
    const card = h.cards.at(-1)
    expect(card).toMatchObject({
      sessionId: 's1',
      item: { kind: 'teamWaiting', status: 'inProgress' },
    })
    const waitingId = card?.item.kind === 'teamWaiting' ? card.item.teamWaiting.waitingId : ''
    await service.answerWaiting(waitingId, 'raise')
    const answer = json(await output(second))
    expect(answer['tasks']).toEqual([expect.objectContaining({ entry: 'a', state: 'running' })])
    expect(h.cards.at(-1)?.item).toMatchObject({ status: 'completed', teamDecision: 'raise' })
    await expect(service.answerWaiting(waitingId, 'queue')).rejects.toThrow(
      UI_TEXT.teamWaitingUnknown,
    )
  })

  it("queues on the user's answer and starts the task when headroom returns", async () => {
    const h = harness(team([entry('a', WORKER_MODEL, 1)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    const second = service.teamRunner.delegate(delegateOne, context())
    await settle()
    const card = h.cards.at(-1)
    await service.answerWaiting(
      card?.item.kind === 'teamWaiting' ? card.item.teamWaiting.waitingId : '',
      'queue',
    )
    const queued = json(await output(second))
    expect(queued['tasks']).toEqual([expect.objectContaining({ state: 'queued' })])
    expect(h.started).toHaveLength(1)
    expect(service.tree()?.roles[0]?.queued).toHaveLength(1)
    h.finish(0)
    await settle()
    expect(h.started).toHaveLength(2)
    expect(service.tree()?.roles[0]?.queued).toHaveLength(0)
    await service.dispose()
  })

  it('answers Do it yourself and Cancel as refusals, and the queue policy without a card', async () => {
    for (const choice of ['self', 'cancel'] as const) {
      const h = harness(team([entry('a', WORKER_MODEL, 1)]))
      const service = createTeamHostService(h.deps)
      await service.probeEntries()
      await service.teamRunner.delegate(delegateOne, context())
      const second = service.teamRunner.delegate(delegateOne, context())
      await settle()
      const card = h.cards.at(-1)
      await service.answerWaiting(
        card?.item.kind === 'teamWaiting' ? card.item.teamWaiting.waitingId : '',
        choice,
      )
      expect(await output(second)).toContain(
        choice === 'self' ? TEAM_MODEL_TEXT.hostWaitingSelf : TEAM_MODEL_TEXT.hostWaitingCancelled,
      )
      expect(h.started).toHaveLength(1)
    }
    const h = harness(team([entry('a', WORKER_MODEL, 1)], {}, { exhausted: 'queue' }))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    const queued = json(await output(service.teamRunner.delegate(delegateOne, context())))
    expect(queued['tasks']).toEqual([expect.objectContaining({ state: 'queued' })])
    expect(h.cards).toEqual([])
    await service.dispose()
  })

  it('waits in collect until a task finishes, never past its bound', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    const waited = service.teamRunner.collect({ wait_seconds: 60 }, context())
    await settle()
    h.finish(0)
    const collected = json(await output(waited))
    expect(collected['tasks']).toEqual([expect.objectContaining({ state: 'done' })])
    const started = Date.now()
    const bounded = json(await output(service.teamRunner.collect({ wait_seconds: 0 }, context())))
    expect(Date.now() - started).toBeLessThan(1000)
    expect(bounded['tasks']).toHaveLength(1)
  })

  it('continues a finished task on its own copy, and closes the earlier one', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    const reopened = {
      tasks: [{ ...delegateOne.tasks[0], brief: 'and the tests', continue: 'task-1' }],
    }
    const answer = json(await output(service.teamRunner.delegate(reopened, context())))
    expect(answer['tasks']).toEqual([expect.objectContaining({ task_id: 'task-2' })])
    expect(h.started[1]?.continueFrom).toMatchObject({ folder: '/copies/x', head: 'b'.repeat(40) })
    expect(await output(service.teamRunner.merge({ task_id: 'task-1' }, context()))).toContain(
      TEAM_MODEL_TEXT.hostMergeNotReady,
    )
    expect(await output(service.teamRunner.delegate(reopened, context()))).toContain(
      TEAM_MODEL_TEXT.hostContinueNotReady,
    )
  })

  it('refuses an in-place role at planning', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)], {}, { workspace: 'in-place' }))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    const answer = json(await output(service.teamRunner.delegate(delegateOne, context())))
    expect(answer['tasks']).toEqual([
      { role: 'engineering', refused: TEAM_MODEL_TEXT.hostInPlaceNotOffered },
    ])
    expect(h.started).toEqual([])
  })

  it('shows the merge card in its conversation and answers a failed merge as a refusal', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const failing: TeamHostServiceDeps = {
      ...h.deps,
      merges: { ...h.deps.merges, merge: () => Promise.reject(new Error('refused a moved ref')) },
    }
    const service = createTeamHostService(failing)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    const merging = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(h.cards.at(-1)).toMatchObject({
      sessionId: 's1',
      item: {
        kind: 'teamMerge',
        status: 'inProgress',
        teamMerge: { taskId: 'task-1', affectedFiles: ['a.ts'], review: 'not-reviewed' },
      },
    })
    await service.decideMerge('task-1', 'merge')
    expect(await output(merging)).toContain('refused a moved ref')
    expect(h.cards.at(-1)?.item).toMatchObject({ status: 'completed', teamDecision: 'merge' })
    expect(await service.taskDiff('task-1')).toBe(`diff ${'b'.repeat(40)}`)
  })
})

/** The binding hands these to dist/team.js; the fake factory never builds them. */
const UNUSED_ENGINE: EngineTeamPortsDeps = {
  repositoryRoot: () => undefined,
  storageRoot: '',
  platform: process.platform,
  isTrusted: () => false,
  listModels: () => Promise.reject(new Error('not used')),
  startWorker: () => Promise.reject(new Error('not used')),
  now: () => 0,
  log: {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
}

function binding(stored: unknown, factory = vi.fn()) {
  const h = harness(stored)
  const trees: unknown[] = []
  const diffs: string[] = []
  const bound = new TeamHostBinding({
    ports: { ...h.deps, engine: UNUSED_ENGINE },
    loadFactory: () => {
      factory()
      // The fakes stand in for the engine ports dist/team.js would build.
      return Promise.resolve(() => createTeamHostService(h.deps))
    },
    uiText: () => UI_TEXT,
    uiLocale: () => 'en',
    showTree: (tree) => {
      trees.push(tree)
    },
    openRoles: () => Promise.resolve(),
    showDiff: (taskId, diff) => {
      diffs.push(`${taskId}: ${diff}`)
      return Promise.resolve()
    },
  })
  return { bound, factory, h, trees, diffs }
}

describe('the window binding', () => {
  it('never loads the team bundle or probes for a workspace without a team', async () => {
    const { bound, factory, h } = binding(undefined)
    await bound.open()
    expect(factory).not.toHaveBeenCalled()
    expect(h.probes).toEqual([])
    expect(bound.seams.teamDecisionSource(ORCHESTRATOR)).toBeUndefined()
    expect(bound.tree()).toBeUndefined()
    const refused = await bound.seams.teamRunner.collect({}, context())
    expect(refused.output).toContain('collect')
  })

  it("loads once for a stored team, probes at the surface's opening, and shows the tree", async () => {
    const { bound, factory, h, trees } = binding(team([entry('e1', WORKER_MODEL)]))
    await bound.open()
    await bound.open()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(h.probes).toEqual([WORKER_MODEL, WORKER_MODEL])
    const source = bound.seams.teamDecisionSource(ORCHESTRATOR)
    expect(source === undefined ? undefined : decideTeamConversationMode(source).mode).toBe('team')
    expect(trees.at(-1)).toEqual(bound.tree())
    await bound.dispose()
  })

  it("opens a finished task's diff, and refuses a transcript the window does not keep", async () => {
    const { bound, h, diffs } = binding(team([entry('e1', WORKER_MODEL)]))
    await bound.open()
    await bound.seams.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    await bound.handle({ type: 'reviewTeamDiff', taskId: 'task-1' })
    expect(diffs).toEqual([`task-1: diff ${'b'.repeat(40)}`])
    await expect(
      bound.handle({ type: 'openTeamTaskTranscript', taskId: 'task-1' }),
    ).rejects.toThrow(UI_TEXT.teamTranscriptNotKept)
    await bound.dispose()
  })
})
