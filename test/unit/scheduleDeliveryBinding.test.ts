import { describe, expect, it, vi } from 'vitest'
import type { ScheduledAgentSession, ScheduleRunDeps } from '../../src/core/schedules/unattended'
import type { ScheduleAuthorityStore } from '../../src/core/schedules/grantAudit'
import {
  createScheduleDeliveryBinding,
  type ScheduleEditorDeliveryPorts,
} from '../../src/host/schedules/deliveryBinding'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { UI_TEXT } from '../../src/shared/constants'
import path from 'node:path'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import type {
  AgentSession,
  TurnSubmission,
  WithdrawOutcome,
} from '../../src/core/agent/agentBackend'
import { FakeScheduleApprovalStream } from './helpers/schedules/approvals'

function queuedSubmission(): Promise<TurnSubmission> {
  return Promise.resolve({ turnId: 'admitted', userMessageId: 'message', disposition: 'queued' })
}
function unusedSteer(): Promise<never> {
  return Promise.reject(new Error('unused steer'))
}
function unusedPaidPolicy(modelId: string): NonNullable<ScheduleRunDeps['paid']> {
  return {
    modelId,
    accountId: 'test-account',
    allows: () => false,
    reserve: () => Promise.reject(new Error('unused reservation')),
  }
}

function withdrawnSubmission(): Promise<WithdrawOutcome> {
  return Promise.resolve({ status: 'withdrawn', images: [] })
}

class ScheduledSession extends FakeAgentSession implements ScheduledAgentSession {
  readonly withdrawQueued = vi.fn<NonNullable<AgentSession['withdrawQueued']>>(withdrawnSubmission)
  readonly getScheduledRun = vi.fn<ScheduledAgentSession['getScheduledRun']>()
  readonly sendScheduledTurn = vi.fn<ScheduledAgentSession['sendScheduledTurn']>(queuedSubmission)
  readonly steerScheduledTurn = vi.fn<ScheduledAgentSession['steerScheduledTurn']>(unusedSteer)
}

async function waitForSubmission(agent: ScheduledSession) {
  await vi.waitFor(() => {
    expect(agent.sendScheduledTurn).toHaveBeenCalledOnce()
  })
}

async function fixture(backend: 'museCode' | 'modelApi' = 'museCode') {
  const agent = new ScheduledSession('session-1', 'chosen-model')
  const host = new FakeAgentHost()
  const schedule = fakeSchedule({
    workspaceKey: workspaceKey(path.resolve('/test/workspace')),
    target: { kind: 'conversation', backend, sessionId: agent.sessionId },
  })
  const context = fakeRunContext(schedule)
  const abort = new AbortController()
  const authority: ScheduleAuthorityStore = {
    read: vi.fn(() => Promise.resolve(schedule)),
    commit: vi.fn(() => Promise.resolve(false)),
    append: vi.fn(() => Promise.resolve()),
    audit: vi.fn(() => Promise.resolve([])),
  }
  const ports: ScheduleEditorDeliveryPorts = {
    workspaceRoot: '/test/workspace',
    platform: 'linux',
    dialect: 'bash',
    io: memoryToolIo({}, '/test/workspace'),
    signal: abort.signal,
    isActive: () => true,
    host: () => Promise.resolve(host),
    options: () =>
      Promise.resolve({
        workspaceRoot: '/test/workspace',
        modelId: agent.modelId,
        approvalMode: 'promptUnmatched',
      }),
    publish: vi.fn(() => vi.fn()),
    findLive: () => ({ agent, status: 'idle' }),
    row: vi.fn(),
    deferQuestions: vi.fn(() => Promise.resolve()),
    safety: () => undefined,
  }
  const binding = createScheduleDeliveryBinding(ports, authority)
  const lease = await binding.targets.find(schedule)
  if (lease === undefined) throw new Error('missing fake target')
  const run = () =>
    binding.runs.run(lease.session, schedule, context, async () => {
      await lease.session.queue('scheduled prompt', context)
    })
  return { agent, schedule, context, abort, authority, ports, binding, lease, run }
}

async function expectRefused(rig: Awaited<ReturnType<typeof fixture>>) {
  rig.agent.sendScheduledTurn.mockImplementation(() => {
    rig.agent.emit({ type: 'turnCompleted', turnId: 'admitted', terminal: 'completed' })
    return Promise.resolve({ turnId: 'admitted', disposition: 'started' })
  })
  try {
    expect(await rig.run()).toMatchObject({ outcome: 'failed', cost: noScheduleCost() })
    expect(rig.agent.sendScheduledTurn).not.toHaveBeenCalled()
    expect(rig.agent.sendTurn).not.toHaveBeenCalled()
  } finally {
    await rig.lease.release()
  }
}

describe('unregistered schedule delivery factory', () => {
  it('settles a promotion chain received before admission and frees the next delivery', async () => {
    const rig = await fixture()
    rig.agent.sendScheduledTurn.mockImplementation(() => {
      rig.agent.emit({
        type: 'userMessageTurnChanged',
        userMessageId: 'message',
        turnId: 'temporary',
      })
      rig.agent.emit({
        type: 'userMessageTurnChanged',
        userMessageId: 'temporary',
        turnId: 'final',
      })
      rig.agent.emit({ type: 'turnCompleted', turnId: 'final', terminal: 'completed' })
      return queuedSubmission()
    })
    try {
      expect(await rig.run()).toMatchObject({ outcome: 'ran' })
      expect(await rig.run()).toMatchObject({ outcome: 'ran' })
    } finally {
      await rig.lease.release()
    }
  })
  it('publishes admission once and only republishes when the message moves to another turn', async () => {
    const rig = await fixture()
    const submitted = vi.fn<NonNullable<ScheduleEditorDeliveryPorts['submitted']>>()
    rig.ports.submitted = submitted
    const running = rig.run()
    try {
      await vi.waitFor(() => {
        expect(submitted).toHaveBeenCalledOnce()
      })
      expect(submitted.mock.calls[0]?.[3]).toMatchObject({
        turnId: 'admitted',
        disposition: 'queued',
      })
      rig.agent.emit({ type: 'textDelta', itemId: 'reply', field: 'text', delta: 'text' })
      expect(submitted).toHaveBeenCalledOnce()
      rig.agent.emit({
        type: 'userMessageTurnChanged',
        userMessageId: 'message',
        turnId: 'promoted',
      })
      expect(submitted).toHaveBeenCalledTimes(2)
      expect(submitted.mock.calls[1]?.[3].turnId).toBe('promoted')
      rig.agent.emit({ type: 'turnCompleted', turnId: 'promoted', terminal: 'completed' })
      expect(await running).toMatchObject({ outcome: 'ran' })
      expect(submitted).toHaveBeenCalledTimes(2)
    } finally {
      await rig.lease.release()
    }
  })
  it('preserves prototype methods and the owning receiver of background ports', async () => {
    const rig = await fixture()
    class OwnedPorts implements ScheduleEditorDeliveryPorts {
      readonly workspaceRoot = rig.ports.workspaceRoot
      readonly platform = rig.ports.platform
      readonly dialect = rig.ports.dialect
      readonly io = rig.ports.io
      readonly signal = rig.ports.signal
      readonly row: ScheduleEditorDeliveryPorts['row'] = (...args) => {
        rig.ports.row(...args)
      }
      readonly deferQuestions: ScheduleEditorDeliveryPorts['deferQuestions'] = (...args) =>
        rig.ports.deferQuestions(...args)
      readonly findLive: ScheduleEditorDeliveryPorts['findLive'] = (...args) =>
        rig.ports.findLive(...args)
      calls = 0
      isActive() {
        return rig.ports.isActive()
      }
      host(...args: Parameters<ScheduleEditorDeliveryPorts['host']>) {
        this.calls += 1
        return rig.ports.host(...args)
      }
      options(...args: Parameters<ScheduleEditorDeliveryPorts['options']>) {
        this.calls += 1
        return rig.ports.options(...args)
      }
      publish(...args: Parameters<ScheduleEditorDeliveryPorts['publish']>) {
        this.calls += 1
        return rig.ports.publish(...args)
      }
      safety(...args: Parameters<ScheduleEditorDeliveryPorts['safety']>) {
        this.calls += 1
        return rig.ports.safety(...args)
      }
    }
    const ports = new OwnedPorts()
    const binding = createScheduleDeliveryBinding(ports, rig.authority)
    try {
      const lease = await binding.targets.fresh(
        fakeSchedule({
          delivery: 'newConversation',
          target: { kind: 'newConversation', backend: 'museCode' },
        }),
        0,
      )
      try {
        expect(ports.calls).toBe(3)
      } finally {
        await lease.release()
      }
      const live = await binding.targets.find(rig.schedule)
      if (live === undefined) throw new Error('missing live target')
      const result = binding.runs.run(live.session, rig.schedule, rig.context, async () => {
        await live.session.queue('scheduled prompt', rig.context)
      })
      try {
        await vi.waitFor(() => {
          expect(rig.agent.sendScheduledTurn).toHaveBeenCalledOnce()
        })
        const run = rig.agent.sendScheduledTurn.mock.calls[0]?.[1]
        if (run === undefined) throw new Error('missing unattended run')
        await run.decide(new FakeScheduleApprovalStream('museCode').request('shell'))
        expect(ports.calls).toBe(4)
      } finally {
        rig.agent.emit({ type: 'turnCompleted', turnId: 'admitted', terminal: 'completed' })
        await result
        await live.release()
      }
    } finally {
      await rig.lease.release()
    }
  })
  it('refuses a different workspace before scheduled admission', async () => {
    const rig = await fixture()
    rig.schedule.workspaceKey = workspaceKey(path.resolve('/another/workspace'))
    await expectRefused(rig)
  })
  it('refuses absent paid authority before Model API admission', async () => {
    await expectRefused(await fixture('modelApi'))
  })
  it('settles a promoted short turn whose terminal precedes its admission ack', async () => {
    const rig = await fixture()
    rig.agent.sendScheduledTurn.mockImplementation(() => {
      rig.agent.emit(
        { type: 'userMessageTurnChanged', userMessageId: 'message', turnId: 'promoted' },
        { type: 'turnCompleted', turnId: 'promoted', terminal: 'completed' },
      )
      return Promise.resolve({
        turnId: 'admitted',
        userMessageId: 'message',
        disposition: 'queued',
      })
    })
    try {
      expect(await rig.run()).toEqual({
        outcome: 'ran',
        refusedActions: [],
        cost: noScheduleCost(),
      })
      expect(rig.agent.sendTurn).not.toHaveBeenCalled()
    } finally {
      await rig.lease.release()
    }
  })

  it('waits for this message terminal rather than admission or another turn', async () => {
    const rig = await fixture()
    let isSettled = false
    const result = (async () => {
      const record = await rig.run()
      isSettled = true
      return record
    })()
    try {
      await waitForSubmission(rig.agent)
      rig.agent.emit({ type: 'turnCompleted', turnId: 'user-turn', terminal: 'completed' })
      await Promise.resolve()
      expect(isSettled).toBe(false)
      rig.agent.emit({ type: 'turnWithdrawn', turnId: 'admitted', reason: 'withdrawn' })
      expect(await result).toMatchObject({ outcome: 'skipped', cost: noScheduleCost() })
    } finally {
      await rig.lease.release()
    }
  })

  it('settles lifecycle abort without cancelling a borrowed user turn', async () => {
    const rig = await fixture()
    const result = rig.run()
    try {
      await waitForSubmission(rig.agent)
      rig.abort.abort()
      expect(await result).toMatchObject({ outcome: 'skipped', cost: noScheduleCost() })
      expect(rig.agent.withdrawQueued).toHaveBeenCalledOnce()
      expect(rig.agent.cancel).not.toHaveBeenCalled()
      // The user may own another queued turn. The binding cannot cancel it.
      expect(rig.agent.dispose).not.toHaveBeenCalled()
    } finally {
      await rig.lease.release()
    }
  })

  it('retires a borrowed session independently of the window without cancelling user work', async () => {
    const rig = await fixture()
    const panel = new AbortController()
    rig.ports.findLive = () => ({ agent: rig.agent, status: 'idle', signal: panel.signal })
    const lease = await rig.binding.targets.find(rig.schedule)
    if (lease === undefined) throw new Error('missing target')
    const running = rig.binding.runs.run(lease.session, rig.schedule, rig.context, async () => {
      await lease.session.queue('follow up', rig.context)
    })
    const retired = expect(running).resolves.toMatchObject({ outcome: 'skipped' })
    try {
      await waitForSubmission(rig.agent)
      panel.abort()
      await retired
      expect(rig.abort.signal.aborted).toBe(false)
      expect(rig.agent.cancel).not.toHaveBeenCalled()
      expect(rig.agent.dispose).not.toHaveBeenCalled()
    } finally {
      await lease.release()
      await rig.lease.release()
    }
  })

  it('keeps completed delivery after authority retires before an unreadable cost', async () => {
    const rig = await fixture()
    let isActive = true
    rig.ports.isActive = () => isActive
    rig.ports.paid = () =>
      Promise.resolve({
        policy: unusedPaidPolicy(rig.agent.modelId),
        cost: () => Promise.reject(new Error('ledger unavailable')),
      })
    const running = rig.run()
    try {
      await waitForSubmission(rig.agent)
      rig.agent.emit({ type: 'turnCompleted', turnId: 'admitted', terminal: 'completed' })
      isActive = false
      expect(await running).toMatchObject({ outcome: 'ran', cost: { certainty: 'unknown' } })
    } finally {
      await rig.lease.release()
    }
  })
  it('keeps a delivered turn with unknown cost and retained liability after cost read failure', async () => {
    const rig = await fixture()
    const cost = vi.fn(() => Promise.reject(new Error('ledger unavailable')))
    rig.ports.paid = () =>
      Promise.resolve({
        policy: unusedPaidPolicy(rig.agent.modelId),
        cost,
      })
    const result = rig.run()
    const settled = expect(result).resolves.toMatchObject({
      outcome: 'ran',
      cost: { certainty: 'unknown' },
    })
    try {
      await waitForSubmission(rig.agent)
      rig.agent.emit({ type: 'turnCompleted', turnId: 'admitted', terminal: 'completed' })
      await settled
      expect(cost).toHaveBeenCalledOnce()
    } finally {
      await rig.lease.release()
    }
  })

  it('names a confirmed queue withdrawal as not sent after abort', async () => {
    const rig = await fixture()
    const result = rig.run()
    try {
      await waitForSubmission(rig.agent)
      rig.abort.abort()
      // Only a CONFIRMED withdrawal is a known nothing-sent fire, and it
      // carries the not-sent sentence the core journals as known.
      expect(await result).toMatchObject({
        outcome: 'skipped',
        reason: UI_TEXT.turnUnqueued,
        cost: noScheduleCost(),
      })
      expect(rig.agent.withdrawQueued).toHaveBeenCalledOnce()
      expect(rig.agent.cancel).not.toHaveBeenCalled()
    } finally {
      await rig.lease.release()
    }
  })

  it('never records a started turn as skipped after abort', async () => {
    const rig = await fixture()
    rig.agent.sendScheduledTurn.mockImplementation(() =>
      Promise.resolve({ turnId: 'admitted', disposition: 'started' }),
    )
    const result = rig.run()
    try {
      await waitForSubmission(rig.agent)
      rig.abort.abort()
      // The turn had started: the binding cancels it and reports nothing, so
      // the core keeps the outcome unknown instead of a false skipped.
      await expect(result).rejects.toThrow()
      expect(rig.agent.cancel).toHaveBeenCalledOnce()
      expect(rig.agent.withdrawQueued).not.toHaveBeenCalled()
    } finally {
      await rig.lease.release()
    }
  })

  it('calls the authoritative ledger with its owning receiver', async () => {
    const rig = await fixture()
    class Ledger {
      readonly policy = unusedPaidPolicy(rig.agent.modelId)
      reads = 0
      cost() {
        this.reads += 1
        return Promise.resolve(noScheduleCost())
      }
    }
    const accounting = new Ledger()
    rig.ports.paid = () => Promise.resolve(accounting)
    const result = rig.run()
    try {
      await waitForSubmission(rig.agent)
      rig.agent.emit({ type: 'turnCompleted', turnId: 'admitted', terminal: 'completed' })
      expect(await result).toMatchObject({ outcome: 'ran', cost: noScheduleCost() })
      expect(accounting.reads).toBe(1)
    } finally {
      await rig.lease.release()
    }
  })
})
