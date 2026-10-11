import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost } from './helpers/fakeMsp'
import { unattendedRun } from './helpers/schedules/unattended'
import { createScheduleDeliveryBinding } from '../../src/host/schedules/deliveryBinding'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { memoryToolIo } from './helpers/fakeToolIo'
import path from 'node:path'
import type { ScheduleV2 } from '../../src/shared/scheduleV2'
import { Usd } from '../../src/shared/usd'

const unpublish = () => undefined

async function setup() {
  const handle = fakeMspHost()
  const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel())
  handle.server.handle('session/start', () => ({
    session: { sessionId: 'session-1', modelId: 'muse-spark-1.3', status: 'idle' },
    viewCursor: '',
  }))
  handle.server.handle('session/setApprovalMode', (params) => ({
    commandId: params['commandId'],
    status: 'accepted',
  }))
  let sequence = 0
  handle.server.handle('turn/start', (params) => ({
    commandId: params['commandId'],
    turnId: `turn-${String(++sequence)}`,
    status: 'accepted',
    disposition: 'started',
    startedNewTurn: true,
  }))
  const session = await host.startSession({
    workspaceRoot: '/workspace',
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  const user = await session.sendTurn([{ type: 'text', text: 'User work' }])
  const finish = () => {
    session.emit({ type: 'turnCompleted', turnId: user.turnId, terminal: 'completed' })
  }
  return { host, session, server: handle.server, events, user, finish }
}

function delivery(f: Awaited<ReturnType<typeof setup>>) {
  const schedule = fakeSchedule({
    workspaceKey: workspaceKey(path.resolve('/workspace')),
    target: { kind: 'conversation', backend: 'museCode', sessionId: f.session.sessionId },
    paidCapUsd: Usd.from(1).toAmount(),
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidConsent: {
      scope: 'schedule',
      modelId: f.session.modelId,
      accountId: 'account',
      priceTier: 'tier',
      dailyCapUsd: Usd.from(1).toAmount(),
      sharedDailyBudgetUsd: Usd.from(5).toAmount(),
      grantedAtMs: 0,
      extras: [],
    },
  })
  const state: { current: ScheduleV2; active: boolean } = { current: schedule, active: true }
  const submitted = vi.fn()
  const binding = createScheduleDeliveryBinding(
    {
      workspaceRoot: '/workspace',
      platform: 'linux',
      dialect: 'bash',
      io: memoryToolIo({}, '/workspace'),
      signal: new AbortController().signal,
      isActive: () => state.active,
      host: () => Promise.resolve(f.host),
      options: () =>
        Promise.resolve({
          workspaceRoot: '/workspace',
          modelId: f.session.modelId,
          approvalMode: 'promptUnmatched',
        }),
      publish: () => unpublish,
      findLive: () => ({ agent: f.session, status: 'running', activeTurnId: f.user.turnId }),
      row: () => undefined,
      deferQuestions: () => Promise.resolve(),
      safety: () => undefined,
      submitted,
    },
    {
      read: () => Promise.resolve(state.current),
      commit: () => Promise.resolve(false),
      append: () => Promise.resolve(),
      audit: () => Promise.resolve([]),
    },
  )
  return { binding, schedule, context: fakeRunContext(schedule), state, submitted }
}

async function beginDelivery() {
  const f = await setup()
  const d = delivery(f)
  const lease = await d.binding.targets.find(d.schedule)
  if (lease === undefined) throw new Error('missing native target')
  const send = vi.spyOn(f.session, 'sendScheduledTurn')
  const running = d.binding.runs.run(lease.session, d.schedule, d.context, async () => {
    await lease.session.queue('scheduled', d.context)
  })
  await vi.waitFor(() => {
    expect(d.submitted).toHaveBeenCalledOnce()
  })
  const run = send.mock.calls[0]?.[1]
  if (run === undefined) throw new Error('missing scheduled run')
  return { f, d, lease, running, run }
}
async function interleaveUser(
  f: Awaited<ReturnType<typeof setup>>,
  run: ReturnType<typeof unattendedRun>['run'],
) {
  const check = run.checkParts.bind(run)
  vi.spyOn(run, 'checkParts').mockImplementationOnce(async (parts) => {
    queueMicrotask(() => {
      f.session.emit({ type: 'turnStarted', turnId: 'another-user' })
    })
    await check(parts)
  })
  f.finish()
  await vi.waitFor(() => {
    expect(run.checkParts).toHaveBeenCalledOnce()
  })
}
async function assertPromotion(
  f: Awaited<ReturnType<typeof setup>>,
  queued: { readonly userMessageId?: string | undefined },
  run: ReturnType<typeof unattendedRun>['run'],
) {
  await vi.waitFor(() => {
    expect(f.events).toContainEqual({
      type: 'userMessageTurnChanged',
      userMessageId: queued.userMessageId,
      turnId: 'turn-2',
    })
  })
  expect(f.session.getScheduledRun('turn-2')).toBe(run)
}

describe('native scheduled queue authority', () => {
  it('settles real native delivery after a promotion microtask and accepts the next fire', async () => {
    const { f, d, lease, running, run } = await beginDelivery()
    try {
      await interleaveUser(f, run)
      f.session.emit({ type: 'turnCompleted', turnId: 'another-user', terminal: 'completed' })
      await vi.waitFor(() => {
        expect(f.session.getScheduledRun('turn-2')).toBe(run)
      })
      f.session.emit({ type: 'turnCompleted', turnId: 'turn-2', terminal: 'completed' })
      expect(await running).toMatchObject({ outcome: 'ran' })
      const next = d.binding.runs.run(lease.session, d.schedule, d.context, async () => {
        await lease.session.queue('next', d.context)
      })
      await vi.waitFor(() => {
        expect(f.session.getScheduledRun('turn-3')).toBeDefined()
      })
      f.session.emit({ type: 'turnCompleted', turnId: 'turn-3', terminal: 'completed' })
      expect(await next).toMatchObject({ outcome: 'ran' })
    } finally {
      await lease.release()
      await f.host.close()
    }
  })

  it.each(
    ['parts', 'mode'].flatMap((step) =>
      ['pause', 'grant', 'consent', 'trust', 'signIn', 'model', 'route'].map((change) => ({
        step,
        change,
      })),
    ),
  )('refuses $change changed during awaited $step before native send', async ({ step, change }) => {
    const { f, d, lease, running, run } = await beginDelivery()
    const mutate = () => {
      if (change === 'model') f.session.modelId = 'changed-model'
      else if (['trust', 'signIn', 'route'].includes(change)) d.state.active = false
      else
        d.state.current = {
          ...d.state.current,
          ...(change === 'pause' && { paused: true }),
          ...(change === 'grant' && {
            grant: {
              ...d.state.current.grant,
              rules: [{ id: 'changed', kind: 'tool', name: 'read' }],
            },
          }),
          ...(change === 'consent' && { paidConsent: undefined }),
        }
    }
    try {
      if (step === 'parts') {
        const check = run.checkParts.bind(run)
        vi.spyOn(run, 'checkParts').mockImplementationOnce(async (parts) => {
          await check(parts)
          mutate()
        })
      } else
        f.server.handle('session/setApprovalMode', (params) => {
          mutate()
          return { commandId: params['commandId'], status: 'accepted' }
        })
      f.finish()
      expect(await running).toMatchObject({ outcome: 'refused', reason: expect.any(String) })
      expect(f.server.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1)
    } finally {
      await lease.release()
      await f.host.close()
    }
  })
  it('keeps the queued identity when a user starts during the promotion microtask', async () => {
    const f = await setup()
    try {
      const { run } = unattendedRun()
      const queued = await f.session.sendScheduledTurn([{ type: 'text', text: 'Follow up' }], run)
      await interleaveUser(f, run)
      await Promise.resolve()
      expect(f.events.filter((event) => event.type === 'userMessageTurnChanged')).toEqual([])
      f.session.emit({ type: 'turnCompleted', turnId: 'another-user', terminal: 'completed' })
      await assertPromotion(f, queued, run)
    } finally {
      await f.host.close()
    }
  })
  it('refuses a queued fire after the session mode has failed instead of leaving it pending forever', async () => {
    const f = await setup()
    try {
      f.server.handle('session/setApprovalMode', () => {
        throw new Error('mode update failed')
      })
      await expect(f.session.setApprovalMode('allowAll')).rejects.toThrow()
      await expect(
        f.session.sendScheduledTurn([{ type: 'text', text: 'Follow up' }], unattendedRun().run),
      ).rejects.toThrow()
      expect(f.server.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1)
    } finally {
      await f.host.close()
    }
  })
  it('queues while busy without changing user authority and promotes after the user terminal', async () => {
    const f = await setup()
    try {
      const { run } = unattendedRun()
      const queued = await f.session.sendScheduledTurn([{ type: 'text', text: 'Follow up' }], run)
      expect(queued.disposition).toBe('queued')
      expect(f.session.getScheduledRun()).toBeUndefined()
      expect(f.server.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1)
      expect(f.server.requests.filter((r) => r.method === 'session/setApprovalMode')).toHaveLength(
        0,
      )
      f.finish()
      await assertPromotion(f, queued, run)
      expect(f.server.requests.filter((r) => r.method === 'turn/start')).toHaveLength(2)
    } finally {
      await f.host.close()
    }
  })

  it('withdraws a queued schedule through M87 without cancelling the user turn', async () => {
    const f = await setup()
    try {
      const queued = await f.session.sendScheduledTurn(
        [{ type: 'text', text: 'Follow up' }],
        unattendedRun().run,
      )
      expect(
        await f.session.withdrawQueued({ ...queued, userMessageId: queued.userMessageId }),
      ).toMatchObject({ status: 'withdrawn' })
      expect(f.events).toContainEqual({
        type: 'turnWithdrawn',
        turnId: queued.turnId,
        reason: expect.any(String),
      })
      f.finish()
      await Promise.resolve()
      expect(f.server.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1)
      expect(f.server.requests.filter((r) => r.method === 'turn/cancel')).toHaveLength(0)
    } finally {
      await f.host.close()
    }
  })

  it('rechecks revoked authority before promotion and never dispatches it', async () => {
    const f = await setup()
    try {
      let isActive = true
      const queued = await f.session.sendScheduledTurn(
        [{ type: 'text', text: 'Follow up' }],
        unattendedRun({ isActive: () => isActive }).run,
      )
      isActive = false
      f.finish()
      await vi.waitFor(() => {
        expect(f.events).toContainEqual({
          type: 'turnCompleted',
          turnId: queued.turnId,
          terminal: 'failed',
          reason: expect.any(String),
        })
      })
      expect(f.server.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1)
      expect(f.session.getScheduledRun()).toBeUndefined()
    } finally {
      await f.host.close()
    }
  })
})
