import { createRuntimeScheduleDelivery } from '../../src/runtime/schedules/delivery'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AgentHost, AgentSession } from '../../src/core/agent/agentBackend'
import type { RuntimeScheduleDeliveryPorts } from '../../src/runtime/schedules/delivery'
import type { ScheduledAgentSession } from '../../src/core/schedules/unattended'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import { ScheduleBackgroundTargets } from '../../src/host/schedules/backgroundTarget'
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
import { scheduleEventRunId } from '../../src/shared/scheduleEvents'
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

function fixture(
  input: {
    fs?: MemoryScheduleFs
    backend?: 'museCode' | 'modelApi'
    paid?: RuntimeScheduleDeliveryPorts['paid']
    billing?: RuntimeScheduleDeliveryPorts['billing']
  } = {},
) {
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
    runtimeDeliveryFactory: createRuntimeScheduleDelivery,
    runtimeDelivery: {
      backendFor,
      allowsContributorModels: false,
      row,
      deferQuestions: vi.fn(),
      ...(input.paid !== undefined && { paid: input.paid }),
      ...(input.billing !== undefined && { billing: input.billing }),
    },
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

async function retiredFire(engine: ReturnType<typeof createScheduleEngine>, key: string) {
  const fire = await firstFire(engine, key)
  expect(await engine.store.pending(key)).toEqual([])
  return fire
}

describe('runtime schedule session supplier', () => {
  it('keeps native subscription delivery independent of the Model API billing port', async () => {
    const billing = vi.fn<NonNullable<RuntimeScheduleDeliveryPorts['billing']>>(() =>
      Promise.reject(new Error('no paid key')),
    )
    const rig = fixture({ billing })
    try {
      await rig.engine.runtime.holdWorkspace(root)
      const schedule = rig.job()
      await rig.fire(schedule, 'native-without-key')
      expect(await firstFire(rig.engine, schedule.workspaceKey)).toMatchObject({
        outcome: 'ran',
        cost: noScheduleCost(),
      })
      expect(billing).not.toHaveBeenCalled()
      expect(rig.backendFor.mock.calls.every(([kind]) => kind === 'museCode')).toBe(true)
    } finally {
      await rig.engine.runtime.close()
    }
  })
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

  it.each(['interrupt', 'whenIdle'] as const)(
    'settles %s waiting for backend idle when runtime closes',
    async (delivery) => {
      const rig = fixture()
      const agent = new ScheduledSession('live', 'muse-spark-1.3')
      const listen = vi.spyOn(agent, 'onEvent')
      await rig.borrow(agent, 'user')
      const schedule = rig.job({ delivery })
      await rig.engine.store.create(schedule)
      const run = rig.engine.scheduler.request(
        { method: 'schedules/runNow', workspaceKey: schedule.workspaceKey, id: schedule.id },
        'closing-interrupt',
      )
      try {
        await vi.waitFor(() => {
          if (delivery === 'interrupt') expect(agent.cancel).toHaveBeenCalledOnce()
          else expect(listen.mock.calls.length).toBeGreaterThanOrEqual(2)
        })
        await rig.engine.runtime.close()
        expect(await run).toMatchObject({ kind: 'refused' })
        expect(await firstFire(rig.engine, schedule.workspaceKey)).toMatchObject({
          outcome: 'uncertain',
          reason: expect.any(String),
        })
        expect(await rig.engine.store.pending(schedule.workspaceKey)).toEqual([])
        expect(agent.sendScheduledTurn).not.toHaveBeenCalled()
        expect(agent.dispose).not.toHaveBeenCalled()
      } finally {
        await rig.engine.runtime.close()
      }
    },
  )
  it.each(['close', 'detach', 'late-admission', 'withdrawing'] as const)(
    'withdraws and durably settles borrowed queue on %s without cancelling user work',
    async (exit) => {
      const rig = fixture(),
        agent = new ScheduledSession('live', 'muse-spark-1.3')
      const entered = Promise.withResolvers<undefined>(),
        resume = Promise.withResolvers<undefined>()
      agent.sendScheduledTurn.mockImplementation(async () => {
        entered.resolve(undefined)
        if (exit === 'late-admission') await resume.promise
        return { turnId: 'queued-turn', userMessageId: 'queued-message', disposition: 'queued' }
      })
      if (exit === 'withdrawing')
        agent.withdrawQueued.mockImplementation(async (ref) => {
          await resume.promise
          agent.emit({ type: 'turnWithdrawn', turnId: ref.turnId, reason: 'fixture withdrawn' })
          return { status: 'withdrawn', images: [] }
        })
      const detach = await rig.borrow(agent, 'user'),
        schedule = rig.job({ delivery: 'queue' })
      const request = rig.fire(schedule, 'closing-queue')
      await entered.promise
      const closing = exit === 'detach' ? detach() : rig.engine.runtime.close()
      if (exit === 'withdrawing')
        await vi.waitFor(() => {
          expect(agent.withdrawQueued).toHaveBeenCalledOnce()
        })
      resume.resolve(undefined)
      await closing
      await request
      expect(await retiredFire(rig.engine, schedule.workspaceKey)).toMatchObject({
        outcome: exit === 'detach' ? 'skipped' : 'uncertain',
        reason: expect.any(String),
      })
      await vi.waitFor(() => {
        expect(agent.withdrawQueued).toHaveBeenCalledOnce()
      })
      expect(agent.withdrawQueued).toHaveBeenCalledOnce()
      expect(agent.withdrawQueued).toHaveBeenCalledWith(
        expect.objectContaining({ userMessageId: 'queued-message' }),
      )
      expect(agent.cancel).not.toHaveBeenCalled()
      await rig.engine.runtime.close()
      const restarted = fixture({ fs: rig.fs })
      await restarted.engine.runtime.holdWorkspace(root)
      await restarted.engine.scheduler.recover(schedule.workspaceKey)
      expect(restarted.host.resumeSession).not.toHaveBeenCalled()
      await restarted.engine.runtime.close()
    },
  )
  it.each([
    'backend',
    'readiness',
    'host',
    'models',
    'resume',
    'start',
    'rename',
    'send',
    'steer',
    'cancel',
    'paid',
    'cost',
    'audit',
    'acknowledge',
    'record',
    'root',
    'lookup',
    'advance',
    'load',
    'release',
    'grant-read',
  ] as const)('joins and settles close during %s await', async (stage) => {
    const entered = Promise.withResolvers<undefined>(),
      resume = Promise.withResolvers<undefined>()
    const hold = async <T>(value: T): Promise<T> => {
      entered.resolve(undefined)
      await resume.promise
      return value
    }
    const paid: NonNullable<RuntimeScheduleDeliveryPorts['paid']> = (_schedule, agent) => {
      const value = {
        policy: {
          modelId: agent.modelId,
          accountId: 'fake',
          allows: () => false,
          reserve: () => Promise.reject(new Error('unused reservation')),
        },
        cost: () => (stage === 'cost' ? hold(noScheduleCost()) : Promise.resolve(noScheduleCost())),
      }
      return stage === 'paid' ? hold(value) : Promise.resolve(value)
    }
    const rig = fixture({ ...(['paid', 'cost'].includes(stage) && { paid }) })
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    const backend = await rig.backendFor('museCode')
    switch (stage) {
      case 'root': {
        vi.spyOn(rig.engine.registry, 'root').mockImplementationOnce(() => hold(root))
        break
      }
      case 'lookup': {
        vi.spyOn(rig.engine.store, 'lookupRun').mockImplementationOnce(() =>
          hold({ status: 'absent' }),
        )
        break
      }
      case 'advance': {
        const original = rig.engine.store.advance.bind(rig.engine.store)
        vi.spyOn(rig.engine.store, 'advance').mockImplementationOnce(
          async (intent) => await hold(await original(intent)),
        )

        break
      }
      case 'load':
      case 'grant-read': {
        const original = rig.engine.store.list.bind(rig.engine.store)
        vi.spyOn(rig.engine.store, 'list').mockImplementation(async (key) => {
          const jobs = await original(key)
          if (
            (stage === 'load' && jobs[0]?.fireCount === 1) ||
            (stage === 'grant-read' && rig.owned[0]?.sendScheduledTurn.mock.calls.length === 1)
          )
            await hold(undefined)
          return jobs
        })

        break
      }
      case 'release': {
        const original = ScheduleBackgroundTargets.prototype.fresh
        const fresh = vi.spyOn(ScheduleBackgroundTargets.prototype, 'fresh')
        fresh.mockImplementationOnce(async (job, occurrence) => {
          const receiver = fresh.mock.contexts[0]
          if (!(receiver instanceof ScheduleBackgroundTargets))
            throw new Error('missing target receiver')
          const lease = await original.call(receiver, job, occurrence)
          return {
            ...lease,
            release: async () => {
              await hold(undefined)
              await lease.release()
            },
          }
        })

        break
      }
      case 'backend': {
        rig.backendFor.mockImplementationOnce(() => hold(backend))
        break
      }
      case 'readiness': {
        vi.spyOn(backend, 'readiness').mockImplementationOnce(() =>
          hold({ state: 'ready' as const }),
        )
        break
      }
      case 'host': {
        vi.spyOn(backend, 'hostFor').mockImplementationOnce(() => hold(rig.host))
        break
      }
      case 'models': {
        rig.host.listModels.mockImplementationOnce(() => hold(rig.host.models))
        break
      }
      case 'resume': {
        const loaded = await rig.host.resumeSession('live', agent.modelId)
        rig.host.resumeSession.mockImplementationOnce(() => hold(loaded))

        break
      }
      default: {
        if (['start', 'rename', 'send', 'cost'].includes(stage))
          rig.host.startSession.mockImplementationOnce(async () => {
            rig.owned.push(agent)
            if (stage === 'rename') agent.rename.mockImplementationOnce(() => hold(undefined))
            else if (stage === 'send')
              agent.sendScheduledTurn.mockImplementationOnce(() =>
                hold({ turnId: 'scheduled', disposition: 'started' as const }),
              )
            return stage === 'start' ? await hold(agent) : agent
          })
        else if (stage === 'steer')
          agent.steerScheduledTurn.mockImplementationOnce(() =>
            hold({ turnId: 'user', disposition: 'steered' as const }),
          )
        else if (stage === 'cancel') agent.cancel.mockImplementationOnce(() => hold(undefined))
      }
    }
    const isAfterSettlement = stage === 'acknowledge' || stage === 'record'
    if (isAfterSettlement) {
      const original = rig.engine.store[stage].bind(rig.engine.store)
      vi.spyOn(rig.engine.store, stage).mockImplementationOnce(async (fire) => {
        await hold(undefined)
        await original(fire)
      })
    } else if (stage === 'audit') {
      const original = rig.fs.replace.bind(rig.fs)
      vi.spyOn(rig.fs, 'replace').mockImplementation(async (file, content, guard) => {
        if (file === 'runtime/grant-audits.json') await hold(undefined)
        await original(file, content, guard)
      })
    }
    rig.backendFor.mockResolvedValue(backend)
    let delivery: ScheduleV2['delivery'] = stage === 'steer' ? 'steer' : 'newConversation'
    if (stage === 'cancel') delivery = 'interrupt'
    const isBorrowed = stage === 'steer' || stage === 'cancel'
    await rig.engine.runtime.holdWorkspace(
      root,
      isBorrowed
        ? {
            agent,
            backend: 'museCode',
            row: vi.fn(),
            deferQuestions: vi.fn(),
            activeTurnId: 'user',
          }
        : undefined,
    )
    const schedule = rig.job({
      delivery,
      ...(!isBorrowed && {
        target:
          stage === 'resume'
            ? { kind: 'conversation', backend: 'museCode', sessionId: 'live' }
            : { kind: 'newConversation', backend: 'museCode' },
      }),
      ...(stage === 'resume' && { delivery: 'queue' }),
      ...(stage === 'audit' && {
        grant: {
          rules: [{ id: 'status', kind: 'command', prefix: 'git status' }],
          destinationIds: [],
          paidCapUsd: Usd.from(0).toAmount(),
        },
      }),
    })
    const request = rig.fire(schedule, `close-${stage}`)
    await entered.promise
    const closing = rig.engine.runtime.close()
    resume.resolve(undefined)
    await closing
    await request
    const fires = await rig.engine.store.fires(schedule.workspaceKey)
    expect(fires).toHaveLength(1)
    expect(fires.every((fire) => fire.outcome === 'ran' || typeof fire.reason === 'string')).toBe(
      true,
    )
    expect(await rig.engine.store.pending(schedule.workspaceKey)).toEqual([])
  })
  it.each(['throw', 'tooLate'] as const)(
    'settles target exit and %s withdrawal failure without leaving an admitted claim',
    async (failure) => {
      const rig = fixture(),
        schedule = rig.job({
          delivery: 'newConversation',
          target: { kind: 'newConversation', backend: 'museCode' },
        })
      rig.host.startSession.mockImplementationOnce(() => {
        const agent = new ScheduledSession('background', 'muse-spark-1.3')
        agent.sendScheduledTurn.mockResolvedValue({
          turnId: 'queued',
          userMessageId: 'message',
          disposition: 'queued',
        })
        if (failure === 'throw')
          agent.withdrawQueued.mockRejectedValue(new Error('withdrawal unavailable'))
        else agent.withdrawQueued.mockResolvedValue({ status: 'tooLate' })
        rig.owned.push(agent)
        return Promise.resolve(agent)
      })
      await rig.engine.runtime.holdWorkspace(root)
      const request = rig.fire(schedule, 'target-exit')
      await vi.waitFor(() => {
        expect(rig.owned[0]?.sendScheduledTurn).toHaveBeenCalledOnce()
      })
      rig.host.exit('fixture target closed')
      await request
      expect(await firstFire(rig.engine, schedule.workspaceKey)).toMatchObject({
        outcome: 'uncertain',
      })
      expect(await rig.engine.store.pending(schedule.workspaceKey)).toEqual([])
      await rig.engine.runtime.close()
    },
  )
  it('refuses run-now when another dispatcher still owns a claim without a fire', async () => {
    const rig = fixture(),
      agent = new ScheduledSession('live', 'muse-spark-1.3')
    agent.sendScheduledTurn.mockResolvedValue({ turnId: 'queued', disposition: 'queued' })
    await rig.borrow(agent, 'user')
    const schedule = rig.job({ delivery: 'queue' }),
      request = rig.fire(schedule, 'overlap')
    await vi.waitFor(() => {
      expect(agent.sendScheduledTurn).toHaveBeenCalledOnce()
    })
    expect(
      await rig.engine.scheduler.request(
        { method: 'schedules/runNow', workspaceKey: schedule.workspaceKey, id: schedule.id },
        'overlap',
      ),
    ).toMatchObject({ kind: 'refused' })
    expect(await rig.engine.store.fires(schedule.workspaceKey)).toEqual([])
    await rig.engine.runtime.close()
    await request
  })
  it('keeps the acquired owner lifetime when its ACP target is replaced during borrow', async () => {
    const rig = fixture(),
      old = new ScheduledSession('live', 'muse-spark-1.3'),
      replacement = new ScheduledSession('live', 'muse-spark-1.3')
    const detach = await rig.borrow(old),
      entered = Promise.withResolvers<undefined>(),
      resume = Promise.withResolvers<undefined>()
    const find = ScheduleBackgroundTargets.prototype.find,
      borrow = vi.spyOn(ScheduleBackgroundTargets.prototype, 'find')
    borrow.mockImplementationOnce(async (job) => {
      const receiver = borrow.mock.contexts[0]
      if (!(receiver instanceof ScheduleBackgroundTargets))
        throw new Error('missing borrower receiver')
      const lease = await find.call(receiver, job)
      entered.resolve(undefined)
      await resume.promise
      return lease
    })
    const schedule = rig.job({ whenClosed: 'skip' }),
      request = rig.fire(schedule, 'replace-during-borrow')
    await entered.promise
    await detach()
    await rig.borrow(replacement)
    resume.resolve(undefined)
    await request
    expect(await firstFire(rig.engine, schedule.workspaceKey)).toMatchObject({
      outcome: 'missed',
      reason: expect.any(String),
    })
    expect(old.sendScheduledTurn).not.toHaveBeenCalled()
    expect(replacement.sendScheduledTurn).not.toHaveBeenCalled()
    await rig.engine.runtime.close()
  })
  it('joins a CLI delivery through durable settlement before close returns', async () => {
    const rig = fixture(),
      agent = new ScheduledSession('live', 'muse-spark-1.3'),
      resume = Promise.withResolvers<undefined>()
    rig.host.resumeSession.mockImplementationOnce(() =>
      Promise.resolve({
        session: agent,
        record: { sessionId: 'live', createdAt: '', updatedAt: '', status: 'idle', turnCount: 0 },
        history: { mode: 'inline', items: [], name: undefined, todos: [] },
        activeTurnId: undefined,
      }),
    )
    agent.sendScheduledTurn.mockImplementationOnce(async () => {
      await resume.promise
      return { turnId: 'queued', userMessageId: 'message', disposition: 'queued' }
    })
    const schedule = rig.job({ delivery: 'queue' })
    await rig.engine.registry.add(schedule.workspaceKey, root)
    await rig.engine.store.create(schedule)
    const request = rig.engine.runtime.command(
      { operation: 'run-now', isJson: true, id: schedule.id },
      root,
    )
    await vi.waitFor(() => {
      expect(agent.sendScheduledTurn).toHaveBeenCalledOnce()
    })
    let hasClosed = false
    const closing = (async () => {
      await rig.engine.runtime.close()
      hasClosed = true
    })()
    try {
      await closing
      expect(hasClosed).toBe(true)
      expect(await retiredFire(rig.engine, schedule.workspaceKey)).toMatchObject({
        outcome: 'uncertain',
      })
    } finally {
      resume.resolve(undefined)
      await closing
      await request
      await vi.waitFor(() => {
        expect(agent.withdrawQueued).toHaveBeenCalledOnce()
      })
    }
    expect({
      records: await rig.engine.store.fires(schedule.workspaceKey),
      intents: await rig.engine.store.pending(schedule.workspaceKey),
      withdrawals: agent.withdrawQueued.mock.calls.length,
    }).toMatchObject({
      records: [expect.objectContaining({ outcome: 'uncertain' })],
      intents: [],
      withdrawals: 1,
    })
  })
  it('recovers an abandoned dispatched claim as uncertain without delivering it again', async () => {
    const rig = fixture(),
      schedule = rig.job()
    await rig.engine.store.create(schedule)
    const event = {
      source: 'manual' as const,
      eventKey: 'abandoned',
      kind: 'manual' as const,
      fields: {},
      observedAt: Date.parse('2026-10-08T12:00:00Z'),
    }
    const intent = {
      schedule,
      runId: scheduleEventRunId(schedule.id, event),
      occurrenceMs: event.observedAt,
      event,
      advancesTime: false,
    }
    await rig.engine.store.admit(intent)
    await rig.engine.store.advance(intent)
    await rig.engine.store.startDispatch(intent)
    vi.spyOn(rig.engine.store, 'abandoned').mockResolvedValue([intent])
    await rig.engine.runtime.holdWorkspace(root)
    await rig.engine.scheduler.recover(schedule.workspaceKey)
    expect(await retiredFire(rig.engine, schedule.workspaceKey)).toMatchObject({
      outcome: 'uncertain',
      reason: expect.any(String),
    })
    expect(rig.backendFor).not.toHaveBeenCalled()
    await rig.engine.runtime.close()
  })
  it('retains liability after paid settlement failure and recovers persistence once', async () => {
    const cost = vi.fn(() => Promise.reject(new Error('ledger unavailable')))
    const rig = fixture({
      backend: 'modelApi',
      paid: (_job, agent) =>
        Promise.resolve({
          policy: {
            modelId: agent.modelId,
            accountId: 'fake',
            allows: () => false,
            reserve: () => Promise.reject(new Error('unused reservation')),
          },
          cost,
        }),
    })
    const agent = new ScheduledSession('live', 'muse-spark-1.3')
    await rig.borrow(agent)
    const schedule = rig.job({
      grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from('1').toAmount() },
    })
    const record = rig.engine.store.record.bind(rig.engine.store)
    vi.spyOn(rig.engine.store, 'record')
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockImplementation(record)
    await Promise.allSettled([rig.fire(schedule, 'ledger-failure')])
    await vi.waitFor(() => {
      expect(cost).toHaveBeenCalledOnce()
    })
    await rig.engine.scheduler.recover(schedule.workspaceKey)
    expect(await firstFire(rig.engine, schedule.workspaceKey)).toMatchObject({
      outcome: 'ran',
      cost: { certainty: 'unknown', retainedLiabilityUsd: '1' },
    })
    expect(cost).toHaveBeenCalledOnce()
    expect(agent.sendScheduledTurn).toHaveBeenCalledOnce()
    expect(await rig.engine.store.pending(schedule.workspaceKey)).toEqual([])
    await rig.engine.runtime.close()
  })
  it.each(['acknowledge', 'record'] as const)(
    'settles a transient %s failure during close without replaying on restart',
    async (operation) => {
      const rig = fixture(),
        schedule = rig.job()
      await rig.engine.registry.add(schedule.workspaceKey, root)
      await rig.engine.store.create(schedule)
      const original = rig.engine.store[operation].bind(rig.engine.store)
      vi.spyOn(rig.engine.store, operation)
        .mockRejectedValueOnce(new Error('transient durable write failure'))
        .mockImplementation(original)
      await rig.engine.runtime.command(
        { operation: 'run-now', id: schedule.id, isJson: true },
        root,
      )
      expect(await rig.engine.store.pending(schedule.workspaceKey)).toHaveLength(1)
      await rig.engine.runtime.close()
      expect(await retiredFire(rig.engine, schedule.workspaceKey)).toMatchObject({
        outcome: 'ran',
        cost: noScheduleCost(),
      })
      expect(rig.owned[0]?.sendScheduledTurn).toHaveBeenCalledOnce()
      const restarted = fixture({ fs: rig.fs })
      await restarted.engine.runtime.holdWorkspace(root)
      await restarted.engine.scheduler.recover(schedule.workspaceKey)
      expect(restarted.backendFor).not.toHaveBeenCalled()
      await restarted.engine.runtime.close()
    },
  )
  it.each(['newConversation', 'background', 'borrowed'] as const)(
    'routes %s output only to its owner or stderr with two attached sessions',
    async (target) => {
      const rig = fixture(),
        first = vi.fn(),
        second = vi.fn()
      await rig.borrow(new ScheduledSession('first', 'muse-spark-1.3'), undefined, first)
      await rig.borrow(new ScheduledSession('second', 'muse-spark-1.3'), undefined, second)
      const schedule = rig.job({
        target:
          target === 'newConversation'
            ? { kind: 'newConversation', backend: 'museCode' }
            : {
                kind: 'conversation',
                backend: 'museCode',
                sessionId: target === 'borrowed' ? 'second' : 'unattached',
              },
        delivery: target === 'newConversation' ? 'newConversation' : 'queue',
      })
      rig.host.startSession.mockImplementationOnce(() => {
        const agent = new ScheduledSession('background', 'muse-spark-1.3')
        agent.sendScheduledTurn.mockImplementation(() => {
          agent.emit(
            {
              type: 'itemCompleted',
              item: {
                itemId: 'reply',
                kind: 'agentMessage',
                status: 'completed',
                text: 'private background output',
              },
            },
            { type: 'turnCompleted', turnId: 'scheduled', terminal: 'completed' },
          )
          return Promise.resolve({ turnId: 'scheduled', disposition: 'started' })
        })
        return Promise.resolve(agent)
      })
      await rig.fire(schedule, 'output')
      await firstFire(rig.engine, schedule.workspaceKey)
      expect(first).not.toHaveBeenCalled()
      if (target === 'borrowed') {
        expect(second).toHaveBeenCalledOnce()
        expect(rig.row).not.toHaveBeenCalled()
      } else {
        expect(second).not.toHaveBeenCalled()
        expect(rig.row).toHaveBeenCalled()
        if (target === 'newConversation')
          expect(rig.row).toHaveBeenCalledWith('private background output')
      }
      await rig.engine.runtime.close()
    },
  )
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
