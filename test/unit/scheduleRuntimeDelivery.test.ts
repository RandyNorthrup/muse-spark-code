import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AgentHost, AgentSession } from '../../src/core/agent/agentBackend'
import type { RuntimeScheduleDeliveryPorts } from '../../src/runtime/schedules/delivery'
import type { ScheduledAgentSession } from '../../src/core/schedules/unattended'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import { createWorkspaceRegistry } from '../../src/runtime/schedules/registry'
import { FakeScheduleBackground } from './helpers/schedules/background'
import { createAuthorityStore } from '../../src/runtime/schedules/authorityStore'
import { workspaceKey } from '../../src/runtime/dataFolder'
import {
  noScheduleCost,
  type ScheduleV2,
  type ScheduleApprovalAction,
} from '../../src/shared/scheduleV2'
import { Usd } from '../../src/shared/usd'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

const root = mkdtempSync(path.join(tmpdir(), 'm115-runtime-delivery-'))
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

class ScheduledSession extends FakeAgentSession {
  readonly withdrawQueued = vi.fn<NonNullable<AgentSession['withdrawQueued']>>((ref) => {
    this.emit({ type: 'turnWithdrawn', turnId: ref.turnId, reason: 'fixture withdrawn' })
    return Promise.resolve({ status: 'withdrawn', images: [] })
  })
  readonly sendScheduledTurn = vi.fn<ScheduledAgentSession['sendScheduledTurn']>(
    async (_parts, run) => {
      const action: ScheduleApprovalAction = {
        id: 'shell',
        class: 'shell',
        tool: 'shell',
        command: 'git status',
        paths: [],
        requiresAsking: false,
        protectedPath: false,
      }
      await run.decide(action)
      this.emit(
        { type: 'turnStarted', turnId: 'scheduled' },
        { type: 'turnCompleted', turnId: 'scheduled', terminal: 'completed' },
      )
      return { turnId: 'scheduled', disposition: 'started' }
    },
  )
  readonly steerScheduledTurn = vi.fn<ScheduledAgentSession['steerScheduledTurn']>((turnId) => {
    this.emit({ type: 'turnCompleted', turnId, terminal: 'completed' })
    return Promise.resolve({ turnId, disposition: 'steered' })
  })
}

function fixture(input: { fs?: MemoryScheduleFs; backend?: 'museCode' | 'modelApi' } = {}) {
  const fs = input.fs ?? new MemoryScheduleFs()
  const backend = input.backend ?? 'museCode'
  const host = new FakeAgentHost()
  host.info = { ...host.info, kind: backend }
  const owned: ScheduledSession[] = []
  host.startSession.mockImplementation((options) => {
    const session = new ScheduledSession(`background-${String(owned.length)}`, options.modelId)
    owned.push(session)
    return Promise.resolve(session)
  })
  host.resumeSession.mockImplementation((id, modelId) => {
    const session = new ScheduledSession(id, modelId)
    owned.push(session)
    return Promise.resolve({
      session,
      record: { sessionId: id, createdAt: '', updatedAt: '', status: 'idle', turnCount: 0 },
      history: { mode: 'inline', items: [], name: undefined, todos: [] },
      activeTurnId: undefined,
    } satisfies Awaited<ReturnType<AgentHost['resumeSession']>>)
  })
  const backendFor = vi.fn<RuntimeScheduleDeliveryPorts['backendFor']>(() =>
    Promise.resolve({
      kind: backend,
      readiness: () => Promise.resolve({ state: 'ready' as const }),
      hostFor: () => Promise.resolve(host),
    }),
  )
  const row = vi.fn()
  const engine = createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    now: () => Date.parse('2026-10-08T12:00:00Z'),
    runtimeDelivery: { backendFor, allowsContributorModels: false, row, deferQuestions: vi.fn() },
    verifyWake: () => Promise.resolve({ scheduledPrompts: false }),
    platform: 'linux',
    backgroundEntry: new FakeScheduleBackground(),
  })
  const job = (overrides: Partial<ScheduleV2> = {}) =>
    fakeSchedule({
      workspaceKey: workspaceKey(root),
      nextFireAtMs: Date.parse('2026-10-08T12:01:00Z'),
      trigger: { kind: 'once', atMs: Date.parse('2026-10-08T12:01:00Z') },
      target: { kind: 'conversation', backend, sessionId: 'live' },
      whenClosed: 'open',
      ...overrides,
    })
  const borrow = (agent: ScheduledSession, activeTurnId?: string, notice = vi.fn()) =>
    engine.runtime.holdWorkspace(root, {
      agent,
      backend,
      row: notice,
      deferQuestions: vi.fn(),
      ...(activeTurnId !== undefined && { activeTurnId }),
    })
  const fire = async (schedule: ScheduleV2, requestId: string) => {
    await engine.store.create(schedule)
    return await engine.scheduler.request(
      { method: 'schedules/runNow', workspaceKey: schedule.workspaceKey, id: schedule.id },
      requestId,
    )
  }
  return { engine, host, job, owned, backendFor, row, fs, borrow, fire }
}

async function firstFire<T>(
  engine: ReturnType<typeof createScheduleEngine>,
  key: string,
  project?: (fire: Awaited<ReturnType<typeof engine.store.fires>>[number] | undefined) => T,
) {
  await vi.waitFor(async () => {
    expect(await engine.store.fires(key)).toHaveLength(1)
  })
  const [fire] = await engine.store.fires(key)
  return project === undefined ? fire : project(fire)
}

describe('runtime schedule session supplier', () => {
  it('records an unavailable backend without opening a target session', async () => {
    const rig = fixture()
    rig.backendFor.mockResolvedValue({
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'unavailable', message: 'fixture unavailable' }),
      hostFor: () => Promise.resolve(rig.host),
    })
    await rig.engine.runtime.holdWorkspace(root)
    try {
      const schedule = rig.job()
      await rig.engine.store.create(schedule)
      await rig.engine.runtime.command(
        { operation: 'run-now', id: schedule.id, isJson: true },
        root,
      )
      expect(await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.outcome)).toBe(
        'failed',
      )
      expect(rig.host.resumeSession).not.toHaveBeenCalled()
      expect(rig.host.startSession).not.toHaveBeenCalled()
    } finally {
      await rig.engine.runtime.close()
    }
  })

  it('records legacy jobs with no workspace root instead of guessing a backend folder', async () => {
    const rig = fixture()
    const schedule = rig.job({
      trigger: { kind: 'once', atMs: Date.parse('2026-10-08T11:59:00Z') },
      nextFireAtMs: Date.parse('2026-10-08T11:59:00Z'),
    })
    await rig.engine.registry.add(schedule.workspaceKey)
    await rig.engine.store.create(schedule)
    await rig.engine.runtime.command({ operation: 'run-due', isJson: true }, path.dirname(root))
    expect(await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.outcome)).toBe(
      'failed',
    )
    expect(rig.backendFor).not.toHaveBeenCalled()
  })
  it('keeps borrowed parent turn ownership when child turn events arrive', async () => {
    const rig = fixture()
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    await rig.borrow(agent, 'user')
    try {
      agent.emit(
        {
          type: 'itemStarted',
          item: {
            itemId: 'child-item',
            kind: 'subagent',
            status: 'running',
            childSessionId: 'child',
          },
        },
        { type: 'turnStarted', turnId: 'child:turn' },
      )
      const schedule = rig.job({ delivery: 'steer' })
      await rig.fire(schedule, 'parent-steer')
      await firstFire(rig.engine, schedule.workspaceKey)
      expect(agent.steerScheduledTurn).toHaveBeenCalledWith(
        'user',
        expect.any(Array),
        expect.any(Object),
      )
    } finally {
      await rig.engine.runtime.close()
    }
  })
  it('normalizes workspace spellings before holding, routing and borrowing ACP targets', async () => {
    const rig = fixture()
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    const spelling = `${root}${path.sep}.`
    await rig.engine.runtime.holdWorkspace(spelling, {
      agent,
      backend: 'museCode',
      row: vi.fn(),
      deferQuestions: vi.fn(),
    })
    try {
      const dueMs = Date.parse('2026-10-08T11:59:00Z')
      const schedule = rig.job({ trigger: { kind: 'once', atMs: dueMs }, nextFireAtMs: dueMs })
      await rig.engine.store.create(schedule)
      const listed = await rig.engine.runtime.run('/schedule list', {
        cwd: spelling,
        sessionId: 'live',
        backend: 'museCode',
      })
      expect(listed).toContain(schedule.name)
      await rig.engine.scheduler.poll(schedule.workspaceKey)
      await firstFire(rig.engine, schedule.workspaceKey)
      expect(agent.sendScheduledTurn).toHaveBeenCalledOnce()
      expect(rig.host.resumeSession).not.toHaveBeenCalled()
    } finally {
      await rig.engine.runtime.close()
    }
  })
  it('withdraws a queued scheduled message without cancelling its borrowed user turn', async () => {
    const rig = fixture()
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    agent.sendScheduledTurn.mockResolvedValue({
      turnId: 'queued-turn',
      userMessageId: 'queued-message',
      disposition: 'queued',
    })
    await rig.borrow(agent, 'user')
    const schedule = rig.job({ delivery: 'queue' })
    const admitted = rig.fire(schedule, 'queued-fire')
    try {
      await vi.waitFor(async () => {
        const run = agent.sendScheduledTurn.mock.calls[0]?.[1]
        expect(run).toBeDefined()
        if (run !== undefined)
          expect(await rig.engine.delivery.withdraw(run.context.runId)).toBe(true)
      })
      await admitted
      expect(await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.outcome)).toBe(
        'skipped',
      )
      expect(agent.withdrawQueued).toHaveBeenCalledOnce()
      expect(agent.cancel).not.toHaveBeenCalled()
      expect(agent.dispose).not.toHaveBeenCalled()
    } finally {
      await rig.engine.runtime.close()
    }
  })
  it.each(['steer', 'interrupt', 'queue', 'whenIdle', 'newConversation'] as const)(
    'delivers %s through scheduled backend entry points',
    async (delivery) => {
      const rig = fixture()
      const agent = new ScheduledSession('live', 'muse-spark-1.3')
      const listen = vi.spyOn(agent, 'onEvent')
      agent.cancel.mockImplementation(() => {
        agent.emit(
          { type: 'turnCompleted', turnId: 'user', terminal: 'cancelled' },
          { type: 'sessionStatus', status: 'idle' },
        )
        return Promise.resolve()
      })
      await rig.borrow(agent, 'user')
      try {
        const schedule = rig.job({ delivery })
        await rig.engine.store.create(schedule)
        const run = rig.engine.scheduler.request(
          { method: 'schedules/runNow', workspaceKey: schedule.workspaceKey, id: schedule.id },
          'delivery-mode',
        )
        if (delivery === 'whenIdle') {
          await vi.waitFor(() => {
            expect(listen.mock.calls.length).toBeGreaterThanOrEqual(2)
          })
          expect(agent.sendScheduledTurn).not.toHaveBeenCalled()
          agent.emit(
            { type: 'turnCompleted', turnId: 'user', terminal: 'completed' },
            { type: 'sessionStatus', status: 'idle' },
          )
        }
        await run
        expect(await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.outcome)).toBe(
          'ran',
        )
        if (delivery === 'steer') expect(agent.steerScheduledTurn).toHaveBeenCalledOnce()
        else if (delivery === 'newConversation')
          expect(rig.owned[0]?.sendScheduledTurn).toHaveBeenCalledOnce()
        else expect(agent.sendScheduledTurn).toHaveBeenCalledOnce()
        expect(agent.cancel).toHaveBeenCalledTimes(delivery === 'interrupt' ? 1 : 0)
        expect(agent.sendTurn).not.toHaveBeenCalled()
        expect(agent.dispose).not.toHaveBeenCalled()
      } finally {
        await rig.engine.runtime.close()
      }
    },
  )

  it('ends an interrupt waiting for backend idle when the runtime closes', async () => {
    const rig = fixture()
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    await rig.borrow(agent, 'user')
    const schedule = rig.job({ delivery: 'interrupt' })
    await rig.engine.store.create(schedule)
    const run = rig.engine.scheduler.request(
      { method: 'schedules/runNow', workspaceKey: schedule.workspaceKey, id: schedule.id },
      'closing-interrupt',
    )
    try {
      await vi.waitFor(() => {
        expect(agent.cancel).toHaveBeenCalledOnce()
      })
      await rig.engine.runtime.close()
      await run
      expect(agent.sendScheduledTurn).not.toHaveBeenCalled()
      expect(agent.dispose).not.toHaveBeenCalled()
    } finally {
      await rig.engine.runtime.close()
    }
  })
  it('borrows ACP ownership and records refused actions without interactive approval', async () => {
    const rig = fixture()
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    const row = vi.fn()
    const release = await rig.borrow(agent, undefined, row)
    try {
      const schedule = rig.job()
      await rig.fire(schedule, 'test-request')
      const fire = await firstFire(rig.engine, schedule.workspaceKey)
      expect(fire).toMatchObject({
        outcome: 'ran',
        refusedActions: [{ actionClass: 'shell', tool: 'shell' }],
        cost: noScheduleCost(),
      })
      expect(row).toHaveBeenCalledOnce()
      expect(agent.sendTurn).not.toHaveBeenCalled()
      expect(agent.decideApproval).not.toHaveBeenCalled()
      expect(rig.host.startSession).not.toHaveBeenCalled()
      expect(agent.dispose).not.toHaveBeenCalled()
    } finally {
      await release()
      await rig.engine.runtime.close()
    }
  })

  it('honors live grants and audits the matched rule', async () => {
    const rig = fixture()
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    await rig.borrow(agent)
    try {
      const schedule = rig.job({
        grant: {
          rules: [{ id: 'status', kind: 'command', prefix: 'git status' }],
          destinationIds: [],
          paidCapUsd: Usd.from(0).toAmount(),
        },
      })
      await rig.fire(schedule, 'test-request')
      expect(
        await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.refusedActions),
      ).toEqual([])
      expect(await rig.fs.read('runtime/grant-audits.json')).toContain('"ruleId":"status"')
    } finally {
      await rig.engine.runtime.close()
    }
  })

  it('opens a background session in the persisted workspace and settles exactly once across restart', async () => {
    const rig = fixture()
    const schedule = rig.job({
      target: { kind: 'newConversation', backend: 'museCode' },
      delivery: 'newConversation',
      nextFireAtMs: Date.parse('2026-10-08T11:59:00Z'),
      trigger: { kind: 'once', atMs: Date.parse('2026-10-08T11:59:00Z') },
    })
    await rig.engine.registry.add(schedule.workspaceKey, root)
    await rig.engine.store.create(schedule)
    const first = await rig.engine.runtime.command(
      { operation: 'run-due', isJson: true },
      path.dirname(root),
    )
    expect(first.exitCode).toBe(0)
    expect(rig.host.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: root, approvalMode: 'promptUnmatched' }),
    )
    expect(rig.owned[0]?.sendScheduledTurn).toHaveBeenCalledOnce()
    expect(rig.owned[0]?.sendTurn).not.toHaveBeenCalled()
    expect(rig.owned[0]?.dispose).toHaveBeenCalledOnce()
    expect(await rig.engine.store.fires(schedule.workspaceKey)).toHaveLength(1)
    const restarted = fixture({ fs: rig.fs })
    const second = await restarted.engine.runtime.command(
      { operation: 'run-due', isJson: true },
      root,
    )
    expect(second.exitCode).toBe(0)
    expect(restarted.host.startSession).not.toHaveBeenCalled()
    expect(await restarted.engine.store.fires(schedule.workspaceKey)).toHaveLength(1)
  })

  it('holds CLI run-now without enabling a polling lifetime', async () => {
    const rig = fixture()
    const schedule = rig.job()
    await rig.engine.registry.add(schedule.workspaceKey, root)
    await rig.engine.store.create(schedule)
    try {
      const result = await rig.engine.runtime.command(
        { operation: 'run-now', isJson: true, id: schedule.id },
        root,
      )
      expect(result.exitCode).toBe(0)
      expect(rig.host.resumeSession).toHaveBeenCalledOnce()
      expect(await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.outcome)).toBe(
        'ran',
      )
    } finally {
      await rig.engine.runtime.close()
    }
  })

  it('records missing paid authority as refused without submitting a Model API request', async () => {
    const rig = fixture({ backend: 'modelApi' })
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    await rig.borrow(agent)
    try {
      const schedule = rig.job()
      await rig.fire(schedule, 'test-request')
      expect(await firstFire(rig.engine, schedule.workspaceKey)).toMatchObject({
        outcome: 'refused',
        cost: noScheduleCost(),
      })
      expect(agent.sendScheduledTurn).not.toHaveBeenCalled()
      expect(agent.sendTurn).not.toHaveBeenCalled()
    } finally {
      await rig.engine.runtime.close()
    }
  })

  it('skips a closed target without loading its backend', async () => {
    const rig = fixture()
    await rig.engine.runtime.holdWorkspace(root)
    try {
      const schedule = rig.job({ whenClosed: 'skip' })
      await rig.fire(schedule, 'test-request')
      expect(await firstFire(rig.engine, schedule.workspaceKey, (fire) => fire?.outcome)).toBe(
        'missed',
      )
      expect(rig.backendFor).not.toHaveBeenCalled()
    } finally {
      await rig.engine.runtime.close()
    }
  })
})

describe('persisted runtime workspace paths', () => {
  it('keeps every audit entry when schedules use their grants concurrently', async () => {
    const rig = fixture()
    const authority = createAuthorityStore(rig.engine.store, rig.fs, 'runtime/grant-audits.json')
    try {
      await Promise.all(
        ['first', 'second'].map((ruleId) =>
          authority.append({
            scheduleId: 'schedule',
            atMs: 1,
            kind: 'used',
            runId: `schedule:${ruleId}`,
            ruleId,
            actionClass: 'shell',
          }),
        ),
      )
      const audits = await authority.audit(workspaceKey(root), 'schedule')
      expect(audits.map((entry) => entry.ruleId)).toEqual(['first', 'second'])
    } finally {
      await rig.engine.runtime.close()
    }
  })
  it('retains concurrent roots under the shared lock', async () => {
    const fs = new MemoryScheduleFs()
    const registry = createWorkspaceRegistry(fs, 'runtime/workspaces.json')
    const other = path.dirname(root)
    await Promise.all([
      registry.add(workspaceKey(root), root),
      registry.add(workspaceKey(other), other),
    ])
    expect(await registry.list()).toHaveLength(2)
    expect(await registry.root(workspaceKey(root))).toBe(root)
    expect(await registry.root(workspaceKey(other))).toBe(other)
  })

  it('rejects forged persisted path bindings and preserves legacy keys without guessing a root', async () => {
    const fs = new MemoryScheduleFs()
    const registry = createWorkspaceRegistry(fs, 'runtime/workspaces.json')
    await fs.replace(
      'runtime/workspaces.json',
      JSON.stringify({ workspaces: [workspaceKey(root)] }),
    )
    expect(await registry.root(workspaceKey(root))).toBeUndefined()
    await expect(registry.add(workspaceKey(root), path.dirname(root))).rejects.toThrow(
      'scheduleStoredJsonInvalid',
    )
    await fs.replace(
      'runtime/workspaces.json',
      JSON.stringify({
        workspaces: [workspaceKey(root)],
        roots: { [workspaceKey(root)]: path.dirname(root) },
      }),
    )
    await expect(registry.root(workspaceKey(root))).rejects.toThrow('scheduleStoredJsonInvalid')
  })
})
