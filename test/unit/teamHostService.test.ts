// M96 lane X (C-M96-3): the team host service every surface binds to, and
// the window binding that keeps a workspace without a team at zero loads.
// Every port is a fake that records its calls; nothing here touches a model,
// git or the disk.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTeamHostService, TEAM_TASKS_STATE_KEY } from '../../src/core/team/teamHost'
import type {
  TeamCardItem,
  TeamHostServiceDeps,
  TeamHostService,
  TeamMergeOutcome,
  TeamTaskSpec,
  TeamWorkerOutcome,
} from '../../src/core/team/teamHostService'
import type { TeamToolContext, TeamToolResult } from '../../src/core/team/teamSeams'
import type { TeamCap, TeamPoolEntry, TeamRoleConfig, TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS, decideTeamConversationMode } from '../../src/shared/teamConversation'
import { TeamHostBinding } from '../../src/host/teamHostBinding'
import type { EngineTeamPortsDeps } from '../../src/host/team/teamEnginePorts'
import { TEAM_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

const ORCHESTRATOR = 'muse-spark-1.3'
const WORKER_MODEL = 'other-model-7'
const LIFETIME_SPEND_CAP = { measure: 'spendUsd', window: 'lifetime', amount: 2 } satisfies TeamCap

// The first merge loads the lazy merge flow; warm it so no test's settle
// budget pays the transform cost (production loads the built chunk instead).
beforeAll(async () => {
  await import('../../src/core/team/teamMergeFlow')
})

// D217: no release latch stands before teams any more; the two-model rule
// and the person's off switch gate them (teamAvailability.test.ts).

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

interface Controls {
  isTrusted: boolean
  isTeamWorkersOn: boolean
  /** The conversation's wire mode a tree Merge reads; undefined is no open surface. */
  mode: string | undefined
  isPaidAllowed: boolean
  isPaidHeld: boolean
  isMergeHeld: boolean
  /** The setup probe's answer per model. */
  isLoaded: (model: string) => boolean
}

interface Harness {
  readonly deps: TeamHostServiceDeps
  readonly values: Map<string, unknown>
  readonly controls: Controls
  readonly started: TeamTaskSpec[]
  readonly signals: AbortSignal[]
  readonly finish: (index: number, outcome?: Partial<TeamWorkerOutcome>) => void
  readonly fail: (index: number, error: Error) => void
  readonly merged: string[]
  readonly mergeOptions: { readonly allowProtected: boolean }[]
  readonly discarded: string[]
  readonly paidAsks: number[]
  readonly probes: string[]
  readonly cards: { readonly sessionId: string; readonly item: TeamCardItem }[]
  readonly releasePaid: (isAllowed: boolean) => void
  readonly releaseMerge: () => void
}

function harness(
  stored: unknown,
  options: {
    readonly trusted?: boolean
    readonly paid?: boolean
    readonly canRun?: boolean
    readonly probe?: boolean
    readonly defaultAgent?: boolean
    readonly values?: Map<string, unknown>
    readonly maxWorkers?: number
  } = {},
): Harness {
  const values = options.values ?? new Map<string, unknown>()
  values.set(TEAM_WORKSPACE_KEYS.team, stored)
  const controls: Controls = {
    isTrusted: options.trusted ?? true,
    isTeamWorkersOn: true,
    mode: 'promptUnmatched',
    isPaidAllowed: options.paid ?? true,
    isPaidHeld: false,
    isMergeHeld: false,
    isLoaded: () => options.probe ?? true,
  }
  const started: TeamTaskSpec[] = []
  const signals: AbortSignal[] = []
  const resolvers: ((outcome: TeamWorkerOutcome) => void)[] = []
  const rejecters: ((error: Error) => void)[] = []
  const merged: string[] = []
  const mergeOptions: { readonly allowProtected: boolean }[] = []
  const discarded: string[] = []
  const paidAsks: number[] = []
  const probes: string[] = []
  const cards: { readonly sessionId: string; readonly item: TeamCardItem }[] = []
  const heldPaid: ((isAllowed: boolean) => void)[] = []
  const heldMerges: (() => void)[] = []
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
      isTeamWorkersOn: () => controls.isTeamWorkersOn,
      maxWorkers: () => options.maxWorkers ?? 4,
      isTrusted: () => controls.isTrusted,
    },
    orchestrator: {
      modelId: () => ORCHESTRATOR,
      backend: () => 'modelApi',
      defaultAgent: (model) =>
        options.defaultAgent === true
          ? { kind: 'engine', agentId: 'default', model, pays: 'key' }
          : undefined,
      approvalMode: () => controls.mode,
    },
    workers: {
      canRun: () => options.canRun ?? true,
      probe: (agent) => {
        probes.push(agent.model)
        return Promise.resolve(controls.isLoaded(agent.model))
      },
      run: (spec, signal) => {
        started.push(spec)
        signals.push(signal)
        return new Promise((resolve, reject) => {
          resolvers.push(resolve)
          rejecters.push(reject)
        })
      },
    },
    merges: {
      merge: async (task, _signal, mergeOption): Promise<TeamMergeOutcome> => {
        merged.push(task.taskId)
        mergeOptions.push(mergeOption)
        if (controls.isMergeHeld)
          await new Promise<void>((resolve) => {
            heldMerges.push(resolve)
          })
        return { status: 'merged', written: ['a.ts'], conflicts: [] }
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
        if (!controls.isPaidHeld) return Promise.resolve(controls.isPaidAllowed)
        return new Promise<boolean>((resolve) => {
          heldPaid.push(resolve)
        })
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
    values,
    controls,
    started,
    signals,
    merged,
    mergeOptions,
    discarded,
    paidAsks,
    probes,
    cards,
    releasePaid: (isAllowed) => {
      for (const resolve of heldPaid.splice(0)) resolve(isAllowed)
    },
    releaseMerge: () => {
      for (const resolve of heldMerges.splice(0)) resolve()
    },
    fail: (index, error) => {
      rejecters[index]?.(error)
    },
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

async function delegatedTeam() {
  const h = harness(team([entry('e1', WORKER_MODEL)]))
  const service = createTeamHostService(h.deps)
  await service.probeEntries()
  await service.teamRunner.delegate(delegateOne, context())
  return { h, service }
}

async function finishedTeam() {
  const { h, service } = await delegatedTeam()
  h.finish(0)
  await settle()
  return { h, service }
}

describe('the team host service', () => {
  it('runs a complete saved custom charter and refuses an incomplete custom role before dispatch', async () => {
    for (const isComplete of [true, false]) {
      const role: TeamRoleConfig = {
        role: 'custom-audit',
        workspace: 'read-only',
        tools: ['read', 'report'],
        report: 'summary',
        pool: [entry('custom-entry', WORKER_MODEL)],
        ...(isComplete && {
          purpose: 'Audit the policy',
          done: 'Evidence recorded',
          guidance: 'Read only',
        }),
      }
      const h = harness({ intensity: 'minimal', roles: [role] })
      const service = createTeamHostService(h.deps)
      try {
        await service.probeEntries()
        const result = await service.teamRunner.delegate(
          {
            tasks: [
              {
                role: role.role,
                brief: 'Audit',
                reason: { code: 'specialty', detail: 'Saved charter' },
              },
            ],
          },
          context(),
        )
        if (isComplete) {
          expect(h.started[0]?.role).toMatchObject({
            purpose: role.purpose,
            done: role.done,
            guidance: role.guidance,
          })
          h.finish(0)
          await settle()
        } else {
          expect(result.output).toContain('not offered')
          expect(h.started).toEqual([])
        }
      } finally {
        await service.dispose()
      }
    }
  })

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
    const { h, service } = await finishedTeam()

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

  it('reports the settled engine costs as exact decimals on the team tally', async () => {
    const { h, service } = await delegatedTeam()
    // 12 input + 3 output tokens at the standard tariff: exact, never float.
    h.finish(0, {
      usage: {
        input: 12,
        cachedInput: 0,
        output: 3,
        reasoning: 0,
        modelCalls: 1,
        estimated: false,
        costUsd: Usd.from(0.00002775).toAmount(),
      },
    })
    await settle()
    await service.teamRunner.collect({}, context())
    expect(service.tree()?.spentUsdToday).toBe('0.00002775')
    expect(service.tree()?.budgetUsdToday).toBe('0.00002775')
  })

  it('shows no tally for a costless team', async () => {
    const { service } = await finishedTeam()
    expect(service.tree()?.spentUsdToday).toBeUndefined()
    expect(service.tree()?.budgetUsdToday).toBeUndefined()
  })

  it("labels an override conversation's real slot across the stored boundary", async () => {
    const stored = team([entry('e1', WORKER_MODEL)], {
      orchestrator: {
        agent: { kind: 'engine', agentId: 'override', model: 'override-model', pays: 'key' },
      },
    })
    const h = harness(stored)
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    expect(service.tree()?.orchestrator.slot).toBe('override')
    // A new conversation over the same stored snapshot keeps the label.
    const reopened = createTeamHostService(h.deps)
    expect(reopened.tree()?.orchestrator.slot).toBe('override')
    const plain = harness(team([entry('e1', WORKER_MODEL)]))
    const plainService = createTeamHostService(plain.deps)
    await plainService.probeEntries()
    await plainService.teamRunner.delegate(delegateOne, context())
    expect(plainService.tree()?.orchestrator.slot).toBe('default')
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
    const { h, service } = await finishedTeam()

    await service.decideMerge('task-1', 'discard')
    expect(h.discarded).toEqual(['task-1'])
    expect(h.merged).toEqual([])
  })
  it('asks the user when every entry is at its limits, and starts on Raise', async () => {
    const h = harness(
      team([
        {
          ...entry('a', WORKER_MODEL, 1),
          caps: [{ measure: 'tasks', window: 'lifetime', amount: 1 }],
        },
      ]),
    )
    const service = await startedTask(h)
    h.finish(0)
    await settle()
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
    const service = await startedTask(h)
    const answered = await waitingDecision(h, service, 'queue')
    const queued = json(answered.output)
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
      const answered = await waitingDecision(h, service, choice)
      expect(answered.output).toContain(
        choice === 'self' ? TEAM_MODEL_TEXT.hostWaitingSelf : TEAM_MODEL_TEXT.hostWaitingCancelled,
      )
      expect(h.started).toHaveLength(1)
    }
    const h = harness(team([entry('a', WORKER_MODEL, 1)], {}, { exhausted: 'queue' }))
    const service = await startedTask(h)
    const queued = json(await output(service.teamRunner.delegate(delegateOne, context())))
    expect(queued['tasks']).toEqual([expect.objectContaining({ state: 'queued' })])
    expect(h.cards).toEqual([])
    await service.dispose()
  })

  it('waits in collect until a task finishes, never past its bound', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await startedTask(h)
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
    const service = await startedTask(h)
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
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow('refused a moved ref')
    expect(await output(merging)).toContain('refused a moved ref')
    expect(h.cards.at(-1)?.item).toMatchObject({
      status: 'completed',
      teamDecision: 'refused a moved ref',
    })
    expect(await service.taskDiff('task-1')).toBe(`diff ${'b'.repeat(40)}`)
  })
})

/** The binding hands these engine ports to dist/team.js; the window tests below never reach them. */
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

function binding(
  stored: unknown,
  options: {
    isTeamOn?: () => boolean
    canRunKind?: (kind: string) => boolean
    create?: () => TeamHostService | Promise<TeamHostService>
  } = {},
) {
  const h = harness(stored)
  const trees: unknown[] = []
  const diffs: string[] = []
  const factoryCalls: unknown[][] = []
  const bound = new TeamHostBinding({
    ports: {
      ...h.deps,
      engine: UNUSED_ENGINE,
      settings: {
        ...h.deps.settings,
        ...(options.isTeamOn !== undefined && { isTeamOn: options.isTeamOn }),
      },
    },
    canRunKind: options.canRunKind ?? ((kind) => kind === 'engine'),
    loadFactory: () => {
      // The binding's own engine ports stay inert: these window tests never
      // reach the engine; the loaded service carries the harness's engine.
      factoryCalls.push([])
      return Promise.resolve(options.create ?? (() => createTeamHostService(h.deps)))
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
  return { bound, factoryCalls, h, trees, diffs }
}

describe('the window binding', () => {
  it('disposes an asynchronous team factory that finishes after the window closes', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    let disposeCalls = 0
    const innerDispose = service.dispose
    const lateService: TeamHostService = {
      ...service,
      dispose: async (): Promise<void> => {
        disposeCalls += 1
        await innerDispose()
      },
    }
    const gate = Promise.withResolvers<TeamHostService>()
    let isCreating = false
    const t = binding(team([entry('e1', WORKER_MODEL)]), {
      create: () => {
        isCreating = true
        return gate.promise
      },
    })
    const opening = t.bound.open()
    await vi.waitFor(() => {
      expect(isCreating).toBe(true)
    })
    await t.bound.dispose()
    gate.resolve(lateService)
    await opening
    expect(disposeCalls).toBe(1)
    expect(h.probes).toEqual([])
    expect(t.bound.tree()).toBeUndefined()
  })

  it('allows first-time configuration without a stored team, loading or probing', async () => {
    const { bound, factoryCalls, h } = binding(undefined)
    expect(bound.canConfigure()).toBe(true)
    expect(bound.seams.teamDecisionSource()).toBeUndefined()
    expect(factoryCalls).toEqual([])
    expect(h.probes).toEqual([])
    h.controls.isTrusted = false
    expect(bound.canConfigure()).toBe(false)
    h.controls.isTrusted = true
    await bound.dispose()
    expect(bound.canConfigure()).toBe(false)
  })

  it('refuses configuration when the team switch or engine support is absent', () => {
    let isTeamOn = false
    let canRunEngine = true
    const { bound } = binding(undefined, {
      isTeamOn: () => isTeamOn,
      canRunKind: () => canRunEngine,
    })
    expect(bound.canConfigure()).toBe(false)
    isTeamOn = true
    canRunEngine = false
    expect(bound.canConfigure()).toBe(false)
  })

  it('never loads the team bundle or probes for a workspace without a team', async () => {
    const { bound, factoryCalls, h } = binding(undefined)
    await bound.open()
    expect(factoryCalls).toEqual([])
    expect(h.probes).toEqual([])
    expect(bound.seams.teamDecisionSource(ORCHESTRATOR)).toBeUndefined()
    expect(bound.tree()).toBeUndefined()
    const refused = await bound.seams.teamRunner.collect({}, context())
    expect(refused.output).toContain('collect')
  })

  it("loads once for a stored team, probes at the surface's opening, and shows the tree", async () => {
    const { bound, factoryCalls, h, trees } = binding(team([entry('e1', WORKER_MODEL)]))
    await bound.open()
    await bound.open()
    expect(factoryCalls).toHaveLength(1)
    expect(h.probes).toEqual([WORKER_MODEL, WORKER_MODEL])
    const source = bound.seams.teamDecisionSource(ORCHESTRATOR)
    expect(source === undefined ? undefined : decideTeamConversationMode(source).mode).toBe('team')
    expect(trees.at(-1)).toEqual(bound.tree())
    await bound.dispose()
  })

  it('notifies the Roles and Agents subscriber and stops notifying after unsubscribe', async () => {
    const { bound } = binding(team([entry('e1', WORKER_MODEL)]))
    const changedCalls: unknown[][] = []
    const changed = (): void => {
      changedCalls.push([])
    }
    const unsubscribe = bound.onTreeChange(changed)
    await bound.open()
    expect(changedCalls.length).toBeGreaterThan(0)
    unsubscribe()
    changedCalls.length = 0
    bound.reload()
    expect(changedCalls).toEqual([])
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

function keyEntry(
  id: string,
  model: string,
  concurrent = 1,
  caps: TeamPoolEntry['caps'] = [],
): TeamPoolEntry {
  return {
    id,
    concurrent,
    caps,
    agent: { kind: 'engine', agentId: `agent-${id}`, model, pays: 'key' },
  }
}

function usage(input: number, output = 0): TeamWorkerOutcome['usage'] {
  return { input, cachedInput: 0, output, reasoning: 0, modelCalls: 1, estimated: false }
}

function tokenCappedTeam(): TeamSnapshot {
  return team([
    { ...entry('e1', WORKER_MODEL), caps: [{ measure: 'tokens', window: 'lifetime', amount: 10 }] },
  ])
}

async function waitingDecision(
  h: Harness,
  service: ReturnType<typeof createTeamHostService>,
  choice: 'queue' | 'self' | 'cancel',
) {
  const pending = service.teamRunner.delegate(delegateOne, context())
  await settle()
  const card = h.cards.at(-1)
  await service.answerWaiting(
    card?.item.kind === 'teamWaiting' ? card.item.teamWaiting.waitingId : '',
    choice,
  )
  return await pending
}

async function finishedReview(h: Harness, report?: TeamWorkerOutcome['report']) {
  const service = await finishedTask(h)
  await service.teamRunner.merge({ task_id: 'task-1' }, context())
  h.finish(1, {
    report: report ?? { status: 'done', summary: 'review complete' },
    folder: undefined,
  })
  await settle()
  return service
}

async function startedTask(h: Harness) {
  const service = createTeamHostService(h.deps)
  await service.probeEntries()
  await service.teamRunner.delegate(delegateOne, context())
  return service
}

/** A finished own-branch task, ready for a merge. */
async function finishedTask(h: Harness) {
  const service = await startedTask(h)
  h.finish(0)
  await settle()
  return service
}

describe('RVCM963 review findings', () => {
  it('1+4: a running task asks the service before every request: trust, the paid switch', async () => {
    const h = harness(team([keyEntry('k', WORKER_MODEL)]))
    await startedTask(h)
    const meter = h.started[0]?.meter
    expect(() => meter?.admitRequest()).not.toThrow()
    h.controls.isTeamWorkersOn = false
    expect(() => meter?.admitRequest()).toThrow(TEAM_MODEL_TEXT.hostPaidOff)
    h.controls.isTeamWorkersOn = true
    h.controls.isTrusted = false
    expect(() => meter?.admitRequest()).toThrow(TEAM_MODEL_TEXT.hostUntrusted)
  })

  it('2: token caps stop the next request, mark the entry capped and show what was used', async () => {
    const capped = {
      ...entry('e1', WORKER_MODEL),
      caps: [
        { measure: 'tokens' as const, window: 'task' as const, amount: 100 },
        { measure: 'tokens' as const, window: 'day' as const, amount: 150 },
      ],
    }
    const h = harness(team([capped], {}, { exhausted: 'self' }))
    const service = await startedTask(h)
    const meter = h.started[0]?.meter
    await meter?.noteUsage(usage(60, 30))
    expect(() => meter?.admitRequest()).not.toThrow()
    await meter?.noteUsage(usage(80, 40))
    expect(() => meter?.admitRequest()).toThrow(
      TEAM_MODEL_TEXT.hostCapReached.split('{', 1)[0] ?? '',
    )
    h.finish(0, { usage: usage(80, 40) })
    await settle()
    const tree = service.tree()
    expect(tree?.roles[0]?.entries[0]?.caps).toEqual([
      expect.objectContaining({ label: 'tokens/task', used: 0, amount: 100 }),
      expect.objectContaining({ label: 'tokens/day', used: 120, amount: 150 }),
    ])
    const collected = json(await output(service.teamRunner.collect({}, context())))
    expect(collected['tasks']).toEqual([expect.objectContaining({ state: 'capped' })])
    // 120 of 150 used: another task still fits; at 160 the entry is capped.
    await service.teamRunner.delegate(delegateOne, context())
    await h.started[1]?.meter.noteUsage(usage(40))
    h.finish(1, { usage: usage(40) })
    await settle()
    expect(service.tree()?.roles[0]?.entries[0]?.state).toBe('capped')
    expect(await output(service.teamRunner.delegate(delegateOne, context()))).toContain(
      TEAM_MODEL_TEXT.hostExhausted.replace('{role}', 'engineering'),
    )
    expect(h.started).toHaveLength(2)
  })

  it('3: a queued key task is named in the one popup, and never starts on an unapproved model', async () => {
    const h = harness(
      team([keyEntry('a', WORKER_MODEL), keyEntry('b', 'third-model')], {}, { exhausted: 'queue' }),
      { probe: false },
    )
    const service = createTeamHostService(h.deps)
    // Only `a` is loaded when the tasks are delegated.
    h.controls.isLoaded = (model) => model === WORKER_MODEL
    await service.probeEntries()
    const two = { tasks: [delegateOne.tasks[0], delegateOne.tasks[0]] }
    const answer = json(await output(service.teamRunner.delegate(two, context())))
    expect(answer['tasks']).toEqual([
      expect.objectContaining({ entry: 'a', state: 'running' }),
      expect.objectContaining({ state: 'queued' }),
    ])
    expect(h.paidAsks).toEqual([2])
    // `b` becomes ready later: the queued task's consent never named it.
    h.controls.isLoaded = () => true
    await service.probeEntries()
    await settle()
    expect(h.started).toHaveLength(1)
    // When `a` frees up, the approved model runs it.
    h.finish(0)
    await settle()
    expect(h.started.map((spec) => spec.entry.id)).toEqual(['a', 'a'])
    await service.dispose()
  })

  it('5: the tree Merge is gated like the model merge and still decided on the card', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await finishedTask(h)
    h.controls.mode = undefined
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow(
      UI_TEXT.teamMergeNeedsConversation,
    )
    h.controls.mode = 'denyUnmatched'
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow(UI_TEXT.teamMergePlanMode)
    h.controls.mode = 'promptUnmatched'
    h.controls.isTrusted = false
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow(UI_TEXT.teamMergeUntrusted)
    h.controls.isTrusted = true
    await service.decideMerge('task-1', 'merge')
    expect(h.merged).toEqual([])
    expect(h.cards.at(-1)?.item).toMatchObject({ kind: 'teamMerge', status: 'inProgress' })
    // Trust withdrawn while the card waits: the answer merges nothing.
    h.controls.isTrusted = false
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow(
      TEAM_MODEL_TEXT.hostUntrusted,
    )
    await settle()
    expect(h.merged).toEqual([])
    h.controls.isTrusted = true
    await service.decideMerge('task-1', 'merge')
    await service.decideMerge('task-1', 'merge')
    await settle()
    expect(h.merged).toEqual(['task-1'])
  })

  it('6: two calls awaiting consent cannot both take one free slot', async () => {
    const h = harness(team([keyEntry('k', WORKER_MODEL)], {}, { exhausted: 'self' }), {
      maxWorkers: 1,
    })
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    h.controls.isPaidHeld = true
    const first = service.teamRunner.delegate(delegateOne, context())
    await settle()
    const second = service.teamRunner.delegate(delegateOne, context({ sessionId: 's2' }))
    await settle()
    h.releasePaid(true)
    await first
    expect(await output(second)).toContain(
      TEAM_MODEL_TEXT.hostExhausted.replace('{role}', 'engineering'),
    )
    expect(h.started).toHaveLength(1)
  })

  it('7: consent answered after disposal starts nothing', async () => {
    const h = harness(team([keyEntry('k', WORKER_MODEL)]))
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    h.controls.isPaidHeld = true
    const pending = service.teamRunner.delegate(delegateOne, context())
    await settle()
    await service.dispose()
    h.releasePaid(true)
    expect(await output(pending)).toContain(TEAM_MODEL_TEXT.hostStopped)
    expect(h.started).toEqual([])
  })

  it('8: Solo, same-model and key entries with teamWorkers off load and probe nothing', async () => {
    const cases: [unknown, boolean][] = [
      [{ ...team([entry('e1', WORKER_MODEL)]), template: 'Solo' }, true],
      [team([entry('same', ORCHESTRATOR)]), true],
      [team([keyEntry('k', WORKER_MODEL)]), false],
    ]
    for (const [stored, isTeamWorkersOn] of cases) {
      const { bound, factoryCalls, h } = binding(stored)
      h.controls.isTeamWorkersOn = isTeamWorkersOn
      await bound.open()
      expect(factoryCalls).toEqual([])
      expect(h.probes).toEqual([])
    }
    // The service itself never probes those entries either.
    const h = harness(team([entry('same', ORCHESTRATOR), keyEntry('k', WORKER_MODEL)]))
    h.controls.isTeamWorkersOn = false
    await createTeamHostService(h.deps).probeEntries()
    expect(h.probes).toEqual([])
  })

  it('9: reload loads a first saved team, and a changed model needs a new probe', async () => {
    const { bound, factoryCalls, h } = binding(undefined)
    await bound.open()
    expect(factoryCalls).toEqual([])
    h.values.set(TEAM_WORKSPACE_KEYS.team, team([entry('e1', WORKER_MODEL)]))
    bound.reload()
    await settle()
    expect(factoryCalls).toHaveLength(1)
    const ready = bound.seams.teamDecisionSource(ORCHESTRATOR)
    expect(ready === undefined ? undefined : decideTeamConversationMode(ready).mode).toBe('team')
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    h.values.set(TEAM_WORKSPACE_KEYS.team, team([entry('e1', 'replacement-model')]))
    service.reload()
    const changed = service.teamDecisionSource(ORCHESTRATOR)
    expect(changed === undefined ? undefined : decideTeamConversationMode(changed).reason).toBe(
      'not-loaded',
    )
    await bound.dispose()
  })

  it('10: a failed writer keeps its copy to discard, and a failed continuation hands the copy back', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await startedTask(h)
    h.finish(0, { report: { status: 'failed', summary: 'broke' } })
    await settle()
    expect(service.tree()?.roles[0]?.unmerged).toEqual([
      expect.objectContaining({ taskId: 'task-1', status: 'failed' }),
    ])
    await service.stopTask('task-1')
    expect(h.discarded).toEqual(['task-1'])
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(1)
    await settle()
    const reopened = { tasks: [{ ...delegateOne.tasks[0], continue: 'task-2' }] }
    await service.teamRunner.delegate(reopened, context())
    h.fail(2, new Error('worker crashed'))
    await settle()
    expect(service.tree()?.roles[0]?.unmerged.map((task) => task.taskId)).toEqual(['task-2'])
  })

  it('11: tasks survive a window reload; running ones come back interrupted and discardable', async () => {
    const values = new Map<string, unknown>()
    const h = harness(team([entry('e1', WORKER_MODEL)]), { values })
    const service = await finishedTask(h)
    await service.teamRunner.delegate(delegateOne, context())
    await h.started[1]?.meter.noteWorkspace({ folder: '/copies/y', baseCommit: 'c'.repeat(40) })
    await settle()
    const again = harness(team([entry('e1', WORKER_MODEL)]), { values })
    const reloaded = createTeamHostService(again.deps)
    const collected = json(await output(reloaded.teamRunner.collect({}, context())))
    expect(collected['tasks']).toEqual([
      expect.objectContaining({ task_id: 'task-1', state: 'done' }),
      expect.objectContaining({ task_id: 'task-2', state: 'interrupted' }),
    ])
    expect(reloaded.tree()?.roles[0]?.interrupted.map((task) => task.taskId)).toEqual(['task-2'])
    await reloaded.decideMerge('task-2', 'discard')
    expect(again.discarded).toEqual(['task-2'])
  })

  it('12: one merge or discard runs on a task at a time', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await finishedTask(h)
    h.controls.mode = 'promptUnmatched'
    h.controls.isMergeHeld = true
    await service.decideMerge('task-1', 'merge')
    const committing = service.decideMerge('task-1', 'merge')
    await settle()
    expect(h.merged).toEqual(['task-1'])
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow(UI_TEXT.teamTaskBusy)
    await expect(service.decideMerge('task-1', 'discard')).rejects.toThrow(UI_TEXT.teamTaskBusy)
    h.releaseMerge()
    await committing
    await settle()
    expect(h.merged).toEqual(['task-1'])
    expect(h.discarded).toEqual([])
  })

  it('13: a configured reviewer with headroom reviews the branch head before the merge', async () => {
    const stored: TeamSnapshot = {
      roles: [
        { role: 'engineering', workspace: 'own-branch', pool: [entry('e1', WORKER_MODEL)] },
        { role: 'code-review', pool: [entry('r1', 'reviewer-model')] },
      ],
      intensity: 'balanced',
    }
    const h = harness(stored)
    const service = await finishedTask(h)
    expect(await output(service.teamRunner.merge({ task_id: 'task-1' }, context()))).toContain(
      TEAM_MODEL_TEXT.hostReviewStarted.replace('{task}', 'task-2').split(';', 1)[0] ?? '',
    )
    expect(h.started[1]).toMatchObject({ role: { role: 'code-review' }, entry: { id: 'r1' } })
    expect(h.started[1]?.reviewOf?.head).toBe('b'.repeat(40))
    h.finish(1, { report: { status: 'done', summary: 'looks right' } })
    await settle()
    const merging = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(h.cards.at(-1)?.item).toMatchObject({
      kind: 'teamMerge',
      teamMerge: { review: 'reviewed', reviewerFindings: ['looks right'] },
    })
    await service.decideMerge('task-1', 'merge')
    expect(json(await output(merging))).toMatchObject({ status: 'merged' })
  })

  it('14: the merge card approves the protected paths it lists', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await startedTask(h)
    h.finish(0, { changedFiles: ['.github/workflows/ci.yml'] })
    await settle()
    const merging = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(h.cards.at(-1)?.item).toMatchObject({
      teamMerge: { protectedPaths: ['.github/workflows/ci.yml'] },
    })
    await service.decideMerge('task-1', 'merge')
    await merging
    expect(h.mergeOptions).toEqual([{ allowProtected: true }])
  })
})

describe('RVCM963C probe ownership', () => {
  it('R4-18: an old probe cannot replace the readiness of a new model', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const deferred = Promise.withResolvers<boolean>()
    const service = createTeamHostService({
      ...h.deps,
      workers: {
        ...h.deps.workers,
        probe: (agent) => (agent.model === WORKER_MODEL ? deferred.promise : Promise.resolve(true)),
      },
    })
    const old = service.probeEntries()
    h.values.set(TEAM_WORKSPACE_KEYS.team, team([entry('e1', 'replacement-model')]))
    service.reload()
    await service.probeEntries()
    deferred.resolve(false)
    await old
    expect(service.tree()?.roles[0]?.entries[0]?.state).toBe('ready')
    await service.dispose()
  })

  it('R4-19: a probe finishing after disposal cannot launch queued work', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL, 1)], {}, { exhausted: 'queue' }))
    let isHeld = false
    const deferred = Promise.withResolvers<boolean>()
    const service = createTeamHostService({
      ...h.deps,
      workers: {
        ...h.deps.workers,
        probe: () => (isHeld ? deferred.promise : Promise.resolve(true)),
      },
    })
    await service.probeEntries()
    await service.teamRunner.delegate(
      { tasks: [...delegateOne.tasks, ...delegateOne.tasks] },
      context(),
    )
    isHeld = true
    const probing = service.probeEntries()
    await service.dispose()
    h.finish(0)
    await settle()
    deferred.resolve(true)
    await probing
    expect(h.started).toHaveLength(1)
  })
})

function reviewedTeam(reviewers = [entry('r1', 'reviewer-model')]): TeamSnapshot {
  return {
    roles: [
      { role: 'engineering', workspace: 'own-branch', pool: [entry('e1', WORKER_MODEL)] },
      { role: 'code-review', pool: reviewers },
    ],
    intensity: 'balanced',
  }
}

describe('RVCM963C ownership redesign', () => {
  it('R5-4: Raise cannot borrow a second concurrent slot on the same entry', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL, 1)]), { maxWorkers: 4 })
    const service = createTeamHostService(h.deps)
    try {
      await service.probeEntries()
      await service.teamRunner.delegate(delegateOne, context())
      const pending = service.teamRunner.delegate(delegateOne, context())
      await settle()
      const card = h.cards.at(-1)?.item
      if (card?.kind !== 'teamWaiting') throw new Error('waiting card missing')
      await service.answerWaiting(card.teamWaiting.waitingId, 'raise')
      const result = await pending
      expect(h.started).toHaveLength(1)
      expect(result.output).toContain('refused')
      expect(h.signals[0]?.aborted).toBe(false)
    } finally {
      await service.dispose()
    }
  })

  it('R4-2: reserves concurrent requests and retains unreported liability', async () => {
    const h = harness(
      team([keyEntry('e1', WORKER_MODEL, 2, [{ measure: 'spendUsd', window: 'day', amount: 1 }])]),
    )
    const service = createTeamHostService(h.deps)
    await service.probeEntries()
    await service.teamRunner.delegate(
      { tasks: [...delegateOne.tasks, ...delegateOne.tasks] },
      context(),
    )
    const first = h.started[0]
    const second = h.started[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    await first?.meter.reserveRequest({ ...usage(50), costUsd: Usd.from(0.75).toAmount() })
    await expect(
      second?.meter.reserveRequest({ ...usage(50), costUsd: Usd.from(0.75).toAmount() }),
    ).rejects.toThrow()
    h.fail(0, new Error('response lost'))
    await settle()
    expect(service.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBe(0.75)
    await expect(
      second?.meter.reserveRequest({ ...usage(1), costUsd: Usd.from(0.5).toAmount() }),
    ).rejects.toThrow()
    await service.dispose()
  })

  it('R4-3: counts requests by their admission day when a task crosses midnight', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)], {}, {}))
    const capped = team([
      { ...entry('e1', WORKER_MODEL), caps: [{ measure: 'tokens', window: 'day', amount: 100 }] },
    ])
    h.values.set(TEAM_WORKSPACE_KEYS.team, capped)
    let now = new Date(2026, 9, 9, 23, 59).getTime()
    const service = createTeamHostService({ ...h.deps, now: () => now })
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    const meter = h.started[0]?.meter
    await meter?.reserveRequest(usage(30))
    await meter?.noteUsage(usage(30))
    now = new Date(2026, 9, 10, 0, 1).getTime()
    await meter?.reserveRequest(usage(80))
    await meter?.noteUsage(usage(110))
    expect(service.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBe(80)
    await expect(meter?.reserveRequest(usage(21))).rejects.toThrow()
    await service.dispose()
  })

  it('R4-4: queued launches and automatic reviews obey the global ceiling', async () => {
    const h = harness(reviewedTeam(), { maxWorkers: 1 })
    const service = await finishedTask(h)
    await service.teamRunner.delegate(delegateOne, context())
    const merging = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(h.started).toHaveLength(2)
    await service.decideMerge('task-1', 'discard')
    await merging
    await service.dispose()
    const q = harness(team([entry('e1', WORKER_MODEL, 1)], {}, { exhausted: 'queue' }), {
      maxWorkers: 1,
    })
    const queued = createTeamHostService(q.deps)
    await queued.probeEntries()
    await queued.teamRunner.delegate(
      { tasks: [...delegateOne.tasks, ...delegateOne.tasks] },
      context(),
    )
    await queued.resetEntry('e1')
    expect(q.started).toHaveLength(1)
    await queued.dispose()
  })

  it('R4-5: a continuation reserves the source copy before paid consent', async () => {
    const h = harness(team([keyEntry('e1', WORKER_MODEL, 2)]))
    const service = await finishedTask(h)
    h.controls.isPaidHeld = true
    const args = { tasks: [{ ...delegateOne.tasks[0], continue: 'task-1' }] }
    const first = service.teamRunner.delegate(args, context())
    await settle()
    const second = service.teamRunner.delegate(args, context())
    await settle()
    h.releasePaid(true)
    await first
    const refused = await second
    expect(refused.output).toContain(TEAM_MODEL_TEXT.hostContinueNotReady)
    expect(h.started.filter((spec) => spec.continueFrom?.folder === '/copies/x')).toHaveLength(1)
    await service.dispose()
  })

  it('R4-6: reload preserves the running continuation copy for discard', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await finishedTask(h)
    await service.teamRunner.delegate(
      { tasks: [{ ...delegateOne.tasks[0], continue: 'task-1' }] },
      context(),
    )
    let discarded: TeamWorkerOutcome | undefined
    const restored = createTeamHostService({
      ...h.deps,
      merges: {
        ...h.deps.merges,
        discard: (task) => {
          discarded = task.outcome
          return Promise.resolve()
        },
      },
    })
    await restored.decideMerge('task-2', 'discard')
    expect(discarded?.folder).toBe('/copies/x')
    await restored.dispose()
    await service.dispose()
  })

  it('R4-7: delayed or failed durable saves gate launch and workspace use', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const saved = Promise.withResolvers<undefined>()
    let isHeld = false
    let hasFailed = false
    const service = createTeamHostService({
      ...h.deps,
      state: {
        ...h.deps.state,
        update: async (key, value) => {
          if (hasFailed) throw new Error('durable store unavailable')
          if (isHeld) await saved.promise
          await h.deps.state.update(key, value)
        },
      },
    })
    await service.probeEntries()
    isHeld = true
    const delegated = service.teamRunner.delegate(delegateOne, context())
    await settle()
    try {
      expect(h.started).toHaveLength(0)
    } finally {
      isHeld = false
      saved.resolve(undefined)
    }
    await delegated
    hasFailed = true
    await expect(
      h.started[0]?.meter.noteWorkspace({ folder: '/copies/new', baseCommit: 'x' }),
    ).rejects.toThrow('durable store unavailable')
    const next = await service.teamRunner.delegate(delegateOne, context())
    expect(next.output).toContain('durable store unavailable')
    expect(h.started).toHaveLength(1)
    await service.dispose()
  })

  it('R4-8: closing the live parent cancels its open merge card', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await finishedTask(h)
    h.controls.mode = 'promptUnmatched'
    await service.decideMerge('task-1', 'merge')
    h.controls.mode = undefined
    await expect(service.decideMerge('task-1', 'merge')).rejects.toThrow()
    expect(h.merged).toEqual([])
    await service.dispose()
  })

  it('R4-9: parallel merges own only one decision waiter', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await finishedTask(h)
    const first = service.teamRunner.merge({ task_id: 'task-1' }, context())
    const second = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(
      h.cards.filter(({ item }) => item.kind === 'teamMerge' && item.status === 'inProgress'),
    ).toHaveLength(1)
    await service.decideMerge('task-1', 'merge')
    const secondResult = await second
    expect(secondResult.output).toContain('Error:')
    const firstResult = await first
    expect(firstResult.output).toContain('merged')
    await service.dispose()
  })

  it('R4-10: cancellation while reviewer consent waits starts no paid review', async () => {
    const h = harness(reviewedTeam([keyEntry('r1', 'reviewer-model')]))
    const service = await finishedTask(h)
    const abort = new AbortController()
    h.controls.isPaidHeld = true
    const merging = service.teamRunner.merge(
      { task_id: 'task-1' },
      context({ signal: abort.signal }),
    )
    await settle()
    abort.abort()
    h.releasePaid(true)
    await merging
    expect(h.started).toHaveLength(1)
    await service.dispose()
  })

  it('R4-11: structured findings keep severity, location and detail through the card', async () => {
    const h = harness(reviewedTeam())
    const service = await finishedReview(h, {
      status: 'done',
      summary: 'review complete',
      findings: [{ file: 'a.ts', line: 2, severity: 'P1', title: 'unsafe', detail: 'race detail' }],
    })
    const merging = service.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    const card = h.cards.at(-1)?.item
    expect(card?.kind === 'teamMerge' ? card.teamMerge.reviewerFindings?.join('\n') : '').toContain(
      'a.ts:2',
    )
    expect(card?.kind === 'teamMerge' ? card.teamMerge.reviewerFindings?.join('\n') : '').toContain(
      'race detail',
    )
    await service.decideMerge('task-1', 'discard')
    await merging
    await service.dispose()
  })

  it.each(['blocked', 'partial', 'capped'] as const)(
    'R4-12: a %s review cannot certify the head',
    async (status) => {
      const h = harness(reviewedTeam())
      const service = await finishedTask(h)
      await service.teamRunner.merge({ task_id: 'task-1' }, context())
      h.finish(1, {
        report: { status, summary: 'unfinished', questions: ['need input'] },
        folder: undefined,
      })
      await settle()
      const retry = service.teamRunner.merge({ task_id: 'task-1' }, context())
      await settle()
      expect(h.started).toHaveLength(3)
      expect(h.cards.filter(({ item }) => item.kind === 'teamMerge')).toHaveLength(0)
      await service.dispose()
      await retry
    },
  )

  it('R4-13: reviewer selection excludes every writer in continuation provenance', async () => {
    const stored = reviewedTeam([entry('r1', WORKER_MODEL), entry('r2', 'independent-model')])
    stored.roles[0]?.pool.push(entry('e2', 'second-writer'))
    const h = harness(stored)
    const service = await finishedTask(h)
    await service.teamRunner.delegate(
      { tasks: [{ ...delegateOne.tasks[0], entry: 'e2', continue: 'task-1' }] },
      context(),
    )
    h.finish(1, { head: 'c'.repeat(40) })
    await settle()
    await service.teamRunner.merge({ task_id: 'task-2' }, context())
    expect(h.started[2]?.entry.id).toBe('r2')
    await service.dispose()
  })

  it('R4-14: reset boundaries survive reload without erasing uncertain requests', async () => {
    const h = harness(tokenCappedTeam())
    const service = await finishedTask(h)
    await service.resetEntry('e1')
    const restored = createTeamHostService(h.deps)
    await restored.probeEntries()
    expect(restored.tree()?.roles[0]?.entries[0]?.state).toBe('ready')
    await restored.dispose()
    await service.dispose()
  })

  it('R4-15: Raise carries its one-task ceiling exception through request admission', async () => {
    const h = harness(tokenCappedTeam())
    const service = await finishedTask(h)
    const delegated = service.teamRunner.delegate(delegateOne, context())
    await settle()
    const card = h.cards.at(-1)?.item
    expect(card?.kind).toBe('teamWaiting')
    if (card?.kind === 'teamWaiting')
      await service.answerWaiting(card.teamWaiting.waitingId, 'raise')
    await delegated
    expect(() => h.started[1]?.meter.admitRequest()).not.toThrow()
    await h.started[1]?.meter.reserveRequest(usage(100))
    await service.dispose()
  })

  it('R4-16: a rejecting card discard reports failure and retains cleanup ownership', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = createTeamHostService({
      ...h.deps,
      merges: { ...h.deps.merges, discard: () => Promise.reject(new Error('discard failed')) },
    })
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    await service.decideMerge('task-1', 'merge')
    await expect(service.decideMerge('task-1', 'discard')).rejects.toThrow('discard failed')
    expect(service.tree()?.roles[0]?.unmerged).toHaveLength(1)
    await service.dispose()
  })

  it('R4-17: Stop racing the final outcome retains a discardable copy', async () => {
    const h = harness(team([entry('e1', WORKER_MODEL)]))
    const service = await startedTask(h)
    h.finish(0)
    await service.stopTask('task-1')
    await settle()
    expect(service.tree()?.roles[0]?.interrupted).toHaveLength(1)
    await service.stopTask('task-1')
    expect(h.discarded).toEqual(['task-1'])
    await service.dispose()
  })

  it('R4-20: rejected consent releases both delegation and review leases', async () => {
    const h = harness(reviewedTeam([keyEntry('r1', 'reviewer-model')]), { maxWorkers: 1 })
    let shouldReject = false
    const service = createTeamHostService({
      ...h.deps,
      paid: {
        allowKeyTasks: (...args) =>
          shouldReject
            ? Promise.reject(new Error('lazy import failed'))
            : h.deps.paid.allowKeyTasks(...args),
      },
    })
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    h.finish(0)
    await settle()
    shouldReject = true
    const refusedMerge = await service.teamRunner.merge({ task_id: 'task-1' }, context())
    expect(refusedMerge.output).toContain('lazy import failed')
    expect(service.tree()?.roles[1]?.entries[0]?.running).toBe(0)
    h.values.set(TEAM_WORKSPACE_KEYS.team, team([keyEntry('e1', WORKER_MODEL)]))
    service.reload()
    await service.probeEntries()
    const refusedDelegate = await service.teamRunner.delegate(delegateOne, context())
    expect(refusedDelegate.output).toContain('lazy import failed')
    expect(service.tree()?.roles[0]?.entries[0]?.running).toBe(0)
    shouldReject = false
    await service.teamRunner.delegate(delegateOne, context())
    expect(h.started).toHaveLength(2)
    await service.dispose()
  })

  it('R4-21: completed review verdict and findings survive reload', async () => {
    const h = harness(reviewedTeam())
    const service = await finishedReview(h)
    const restored = createTeamHostService(h.deps)
    const merging = restored.teamRunner.merge({ task_id: 'task-1' }, context())
    await settle()
    expect(h.cards.at(-1)?.item).toMatchObject({ teamMerge: { reviewVerdict: 'done' } })
    await restored.decideMerge('task-1', 'discard')
    await merging
    await restored.dispose()
    await service.dispose()
  })
})

it('R4-2: late per-request settlement preserves known tokens and other uncertain requests', async () => {
  const h = harness(team([keyEntry('e1', WORKER_MODEL, 1, [LIFETIME_SPEND_CAP])]))
  const service = createTeamHostService(h.deps)
  await service.probeEntries()
  await service.teamRunner.delegate(delegateOne, context())
  const meter = h.started[0]?.meter
  expect(meter).toBeDefined()
  if (meter === undefined) throw new Error('worker missing')
  const first = await meter.reserveRequest({ ...usage(80), costUsd: Usd.from(0.75).toAmount() })
  await meter.settleRequest(first, usage(80))
  const second = await meter.reserveRequest({ ...usage(10), costUsd: Usd.from(0.5).toAmount() })
  await meter.settleRequest(first, { ...usage(80), costUsd: Usd.from(0.3).toAmount() })
  expect(service.tree()?.roles[0]?.entries[0]?.caps[0]).toMatchObject({
    used: 0.8,
    estimated: true,
  })
  await meter.settleRequest(second, { ...usage(5), costUsd: Usd.from(0.1).toAmount() })
  expect(service.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBeCloseTo(0.4)
  const collected = await service.teamRunner.collect({}, context())
  expect(JSON.parse(collected.output)).toMatchObject({ tasks: [{ usage: { input: 85 } }] })
  await service.dispose()
})

it("R4-4: resetting a queued entry cannot borrow another role's global slot", async () => {
  const h = harness(
    {
      roles: [
        {
          role: 'engineering',
          workspace: 'own-branch',
          exhausted: 'queue',
          pool: [
            {
              ...entry('e1', WORKER_MODEL, 1),
              caps: [{ measure: 'tasks', window: 'lifetime', amount: 1 }],
            },
          ],
        },
        { role: 'research', pool: [entry('a1', 'analyst-model', 1)] },
      ],
      intensity: 'balanced',
    },
    { maxWorkers: 1 },
  )
  const service = await finishedTask(h)
  await service.teamRunner.delegate(
    { tasks: [{ ...delegateOne.tasks[0], role: 'research' }] },
    context(),
  )
  await service.teamRunner.delegate(delegateOne, context())
  await service.resetEntry('e1')
  expect(h.started).toHaveLength(2)
  await service.dispose()
})

it('R6 release: revocation during durable admission releases the never-dispatched claim', async () => {
  const h = harness(team([keyEntry('e1', WORKER_MODEL, 1, [LIFETIME_SPEND_CAP])]))
  let isRevoked = false
  const service = createTeamHostService({
    ...h.deps,
    state: {
      ...h.deps.state,
      update: async (key, value) => {
        await h.deps.state.update(key, value)
        if (isRevoked) h.controls.isTrusted = false
      },
    },
  })
  try {
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    isRevoked = true
    await expect(
      h.started[0]?.meter.reserveRequest({ ...usage(80), costUsd: Usd.from(0.75).toAmount() }),
    ).rejects.toThrow()
    expect(service.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBe(0)
    expect(h.values.get(TEAM_TASKS_STATE_KEY)).toMatchObject({ tasks: [{ claims: [] }] })
  } finally {
    await service.dispose()
  }
})

it('R6 final claims: unknown-priced receipt retains labelled liability with no open reservation', async () => {
  const h = harness(team([keyEntry('e1', WORKER_MODEL, 1, [LIFETIME_SPEND_CAP])]))
  const service = createTeamHostService(h.deps)
  try {
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    const meter = h.started[0]?.meter
    if (meter === undefined) throw new Error('worker missing')
    const claim = await meter.reserveRequest({
      ...usage(80, 20),
      estimated: true,
      costUsd: Usd.from(0.75).toAmount(),
    })
    await meter.settleRequest(claim, usage(12, 3), true)
    h.finish(0, { usage: { ...usage(0), modelCalls: 0, costUsd: Usd.from(0).toAmount() } })
    await settle()
    expect(service.tree()?.roles[0]?.entries[0]?.caps[0]).toMatchObject({
      used: 0.75,
      estimated: true,
    })
    expect(h.values.get(TEAM_TASKS_STATE_KEY)).toMatchObject({
      tasks: [{ claims: [{ isSettled: true }] }],
    })
    const restored = createTeamHostService(h.deps)
    try {
      expect(restored.tree()?.roles[0]?.entries[0]?.caps[0]).toMatchObject({
        used: 0.75,
        estimated: true,
      })
      await restored.resetEntry('e1')
      expect(restored.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBe(0)
    } finally {
      await restored.dispose()
    }
  } finally {
    await service.dispose()
  }
})

const hookRig = (stored: TeamSnapshot, shouldRefuseSwitch = false) => {
  const h = harness(stored)
  const events: { event: string; fields: Readonly<Record<string, unknown>> }[] = []
  const service = createTeamHostService({
    ...h.deps,
    // The person's own Stop-continuation bound (M127, D121); the bound test
    // below sets 8 continuations through it.
    settings: { ...h.deps.settings, maxStopContinuations: () => 8 },
    hooks: {
      relativePath: () => 'agents/task',
      fire: (_session, event, fields) => {
        events.push({ event, fields })
        return Promise.resolve({
          keepWorking: event === 'TeammateIdle',
          refusedReason:
            shouldRefuseSwitch && event === 'TeamAgentSwitch' ? 'refused switch' : undefined,
        })
      },
    },
  })
  return { h, service, events }
}

async function delegateCeilingPair(isCeilingReached: boolean): Promise<ReturnType<typeof hookRig>> {
  const t = hookRig(team([entry('one', WORKER_MODEL)]))
  await t.service.probeEntries()
  await t.service.teamRunner.delegate(
    { tasks: [delegateOne.tasks[0], delegateOne.tasks[0]] },
    context(),
  )
  await settle()
  t.h.finish(0, { isCeilingReached })
  await settle()
  return t
}

describe('team lifecycle hook firing', () => {
  it('fires Start once and Stop once with the actual child session after cancellation', async () => {
    const t = hookRig(team([entry('one', WORKER_MODEL)]))
    await t.service.probeEntries()
    await t.service.teamRunner.delegate(delegateOne, context())
    await settle()
    t.h.started[0]?.meter.noteSession?.('actual-child')
    await t.service.stopTask('task-1')
    t.h.finish(0)
    await settle()
    expect(t.events.map((item) => item.event)).toEqual(['SubagentStart', 'SubagentStop'])
    expect(t.events[0]?.fields).not.toHaveProperty('child_session_id')
    expect(t.events[1]?.fields).toMatchObject({
      child_session_id: 'actual-child',
      task_id: 'task-1',
      parent_session_id: 's1',
      role_id: 'engineering',
    })
    await t.service.dispose()
  })
  it('never repeats Stop when its first hook completion fails', async () => {
    const h = harness(team([entry('one', WORKER_MODEL)]))
    let stops = 0
    const service = createTeamHostService({
      ...h.deps,
      hooks: {
        relativePath: () => 'agents/task',
        fire: (_session, event) => {
          if (event === 'SubagentStop') {
            stops += 1
            if (stops === 1) return Promise.reject(new Error('hook failed'))
          }
          return Promise.resolve({ keepWorking: false })
        },
      },
    })
    await service.probeEntries()
    await service.teamRunner.delegate(delegateOne, context())
    await settle()
    h.finish(0)
    await settle()
    expect(stops).toBe(1)
    await service.dispose()
  })
  it('records and refuses one switch, exhausting the role without a third fallback', async () => {
    const first = {
      ...entry('one', WORKER_MODEL),
      caps: [{ measure: 'tasks', window: 'day', amount: 1 }],
    } satisfies TeamPoolEntry
    const t = hookRig(
      team([first, entry('two', 'second-model'), entry('three', 'third-model')]),
      true,
    )
    await t.service.probeEntries()
    await t.service.teamRunner.delegate(delegateOne, context())
    await settle()
    t.h.finish(0)
    await settle()
    await t.service.teamRunner.delegate(delegateOne, context())
    await settle()
    await t.service.teamRunner.delegate(delegateOne, context())
    await settle()
    expect(t.h.started).toHaveLength(1)
    expect(t.events.filter((item) => item.event === 'TeamAgentSwitch')).toHaveLength(1)
    expect(t.events.find((item) => item.event === 'TeamAgentSwitch')?.fields).toMatchObject({
      from_entry_id: 'one',
      to_entry_id: 'two',
      reason: 'cap',
      role_id: 'engineering',
    })
    expect(t.h.cards.filter((item) => item.item.kind === 'teamSwitch')).toHaveLength(1)
    await t.service.dispose()
  })
  it('does not fire Idle after a worker reaches its request ceiling', async () => {
    const t = await delegateCeilingPair(true)
    expect(t.events.filter((item) => item.event === 'TeammateIdle')).toEqual([])
    t.h.finish(1)
    await settle()
    await t.service.dispose()
  })
  it('re-admits Idle continuations on the same copy and bounds them', async () => {
    const t = await delegateCeilingPair(false)
    expect(t.h.started[2]?.continueFrom?.folder).toBe('/copies/x')
    for (let index = 2; index < 2 + 8; index += 1) {
      t.h.finish(index, { isCeilingReached: false })
      await settle()
    }
    expect(t.events.filter((item) => item.event === 'TeammateIdle')).toHaveLength(8)
    expect(t.events.filter((item) => item.event === 'SubagentStart')).toHaveLength(2)
    t.h.finish(1)
    await settle()
    expect(t.events.filter((item) => item.event === 'SubagentStop')).toHaveLength(2)
    await t.service.dispose()
  })
  it('keeps Idle siblings within their delegate call', async () => {
    const t = hookRig(team([entry('one', WORKER_MODEL)]))
    await t.service.probeEntries()
    await t.service.teamRunner.delegate({ ...delegateOne, pipeline: 'shared' }, context())
    await t.service.teamRunner.delegate({ ...delegateOne, pipeline: 'shared' }, context())
    await settle()
    t.h.finish(0, { isCeilingReached: false })
    await settle()
    expect(t.events.filter((item) => item.event === 'TeammateIdle')).toEqual([])
    t.h.finish(1)
    await settle()
    await t.service.dispose()
  })
})
