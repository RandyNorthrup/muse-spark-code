import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import type { ScheduleTargetLease } from '../../src/core/schedules/delivery'
import {
  ScheduleAgentSession,
  ScheduleBackgroundTargets,
  type ScheduleBackgroundTargetDeps,
  type ScheduleContextSubmitter,
} from '../../src/host/schedules/backgroundTarget'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'

function setup(backend: 'modelApi' | 'museCode') {
  const host = new FakeAgentHost()
  host.info = { ...host.info, kind: backend, canEditSessions: backend === 'modelApi' }
  const schedule = fakeSchedule({
    target: { kind: 'conversation', backend, sessionId: 'closed-session' },
  })
  const contexts: ScheduleContextSubmitter = {
    submit: vi.fn<ScheduleContextSubmitter['submit']>(
      async (_session, _context, dispatch) => await dispatch(),
    ),
  }
  const unpublish = vi.fn()
  const publish = vi.fn<ScheduleBackgroundTargetDeps['publish']>(() => unpublish)
  const findLive = vi.fn<ScheduleBackgroundTargetDeps['findLive']>(() => Promise.resolve(undefined))
  const deps: ScheduleBackgroundTargetDeps = {
    host: vi.fn(() => Promise.resolve(host)),
    options: vi.fn(() =>
      Promise.resolve({
        workspaceRoot: '/test/workspace',
        modelId: 'chosen-model',
        approvalMode: 'allowAll',
      }),
    ),
    findLive,
    contexts,
    publish,
  }
  return {
    host,
    schedule,
    contexts,
    publish,
    unpublish,
    findLive,
    deps,
    targets: new ScheduleBackgroundTargets(deps),
  }
}

async function assertReplacementReused(
  rig: ReturnType<typeof setup>,
  replacement: ScheduleTargetLease,
): Promise<void> {
  const next = await rig.targets.open(rig.schedule)
  expect(next.session).toBe(replacement.session)
  expect(rig.host.resumeSession).toHaveBeenCalledTimes(2)
  await next.release()
  await replacement.release()
}

describe.each(['museCode', 'modelApi'] as const)('%s background schedule target', (backend) => {
  it('resumes the named target, publishes its history and preserves panel selection', async () => {
    const rig = setup(backend)
    const panel = { sessionId: 'user-conversation' }
    const lease = await rig.targets.open(rig.schedule)
    expect(rig.host.resumeSession).toHaveBeenCalledWith('closed-session', 'chosen-model', undefined)
    expect(lease.session.sessionId).toBe('closed-session')
    expect(rig.publish).toHaveBeenCalledWith(
      rig.host.sessions[0],
      expect.objectContaining({
        workspaceKey: rig.schedule.workspaceKey,
        backend,
        history: expect.objectContaining({ mode: 'inline' }),
        notice: fill(UI_TEXT.scheduleV2.messages.backgroundNotice, { name: rig.schedule.name }),
      }),
    )
    expect(panel.sessionId).toBe('user-conversation')
    expect(rig.host.sessions[0]?.dispose).not.toHaveBeenCalled()
    await lease.release()
    expect(rig.host.sessions[0]?.dispose).toHaveBeenCalledOnce()
    expect(rig.unpublish).toHaveBeenCalledOnce()
  })

  it('shares one background resume until every concurrent lease has settled', async () => {
    const rig = setup(backend)
    const [first, second] = await Promise.all([
      rig.targets.open(rig.schedule),
      rig.targets.open(rig.schedule),
    ])
    expect(first.session).toBe(second.session)
    expect(rig.host.resumeSession).toHaveBeenCalledOnce()
    const found = await rig.targets.find(rig.schedule)
    expect(found?.session).toBe(first.session)
    await first.release()
    await first.release()
    await second.release()
    expect(rig.host.sessions[0]?.dispose).not.toHaveBeenCalled()
    await found?.release()
    expect(rig.host.sessions[0]?.dispose).toHaveBeenCalledOnce()
    expect(await rig.targets.find(rig.schedule)).toBeUndefined()
  })

  it('never leases a retired lookup or evicts its replacement', async () => {
    const rig = setup(backend)
    const first = await rig.targets.open(rig.schedule)
    const pending = rig.targets.find(rig.schedule)
    // findLive resolves, then the pooled entry is read before its await resumes.
    await Promise.resolve()
    await first.release()
    const replacement = await rig.targets.open(rig.schedule)
    const found = await pending
    expect(found?.session.isOpen()).not.toBe(false)
    await found?.release()
    await assertReplacementReused(rig, replacement)
  })

  it('keeps a replacement pooled after the retired host lease releases', async () => {
    const rig = setup(backend)
    const retired = await rig.targets.open(rig.schedule)
    rig.host.exit('Stopped')
    const replacement = await rig.targets.open(rig.schedule)
    await retired.release()
    await assertReplacementReused(rig, replacement)
  })

  it('borrows a live session without resuming or disposing it', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('live-session', 'chosen-model')
    const session = new ScheduleAgentSession(agent, backend, rig.contexts)
    const release = vi.fn(() => Promise.resolve())
    const live: ScheduleTargetLease = { session, release }
    rig.findLive.mockResolvedValue(live)
    expect(await rig.targets.find(rig.schedule)).toBe(live)
    expect(rig.host.resumeSession).not.toHaveBeenCalled()
    expect(agent.dispose).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates a fresh named session for every fire with the schedule’s selected mode', async () => {
    const rig = setup(backend)
    const atMs = rig.schedule.createdAtMs
    const first = await rig.targets.fresh(rig.schedule, atMs)
    const second = await rig.targets.fresh(rig.schedule, atMs + 1)
    expect(first.session.sessionId).not.toBe(second.session.sessionId)
    expect(rig.host.startSession).toHaveBeenCalledTimes(2)
    expect(rig.host.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ approvalMode: 'promptUnmatched' }),
    )
    const title = fill(UI_TEXT.scheduleV2.messages.conversationTitle, {
      name: rig.schedule.name,
      date: formatDateTime(atMs),
    })
    expect(rig.publish.mock.calls[0]?.[1].title).toBe(title)
    expect(rig.host.sessions[0]?.rename).toHaveBeenCalledTimes(backend === 'modelApi' ? 1 : 0)
    await first.release()
    await second.release()
  })

  it('evicts a failed resume and allows a later retry', async () => {
    const rig = setup(backend)
    rig.host.resumeSession.mockRejectedValueOnce(new Error('No backend'))
    await expect(rig.targets.open(rig.schedule)).rejects.toThrow('No backend')
    const lease = await rig.targets.open(rig.schedule)
    expect(rig.host.resumeSession).toHaveBeenCalledTimes(2)
    await lease.release()
  })

  it('refuses a host from a different backend before loading a session', async () => {
    const rig = setup(backend)
    rig.host.info = { ...rig.host.info, kind: backend === 'modelApi' ? 'museCode' : 'modelApi' }
    await expect(rig.targets.open(rig.schedule)).rejects.toThrow(
      UI_TEXT.scheduleV2.messages.targetUnavailable,
    )
    expect(rig.host.resumeSession).not.toHaveBeenCalled()
  })

  it('cleans up a session when publishing its background transcript fails', async () => {
    const rig = setup(backend)
    rig.publish.mockImplementationOnce(() => {
      throw new Error('History unavailable')
    })
    await expect(rig.targets.open(rig.schedule)).rejects.toThrow('History unavailable')
    expect(rig.host.sessions[0]?.dispose).toHaveBeenCalledOnce()
    const lease = await rig.targets.open(rig.schedule)
    await lease.release()
  })

  it('resumes active state and wakes idle waiters when its host exits', async () => {
    const rig = setup(backend)
    const original = rig.host.resumeSession.getMockImplementation()
    rig.host.resumeSession.mockImplementation(async (...args) => {
      if (original === undefined) throw new Error('Missing fixture')
      return { ...(await original(...args)), activeTurnId: 'active-turn' }
    })
    const lease = await rig.targets.open(rig.schedule)
    expect(lease.session.isRunning()).toBe(true)
    const pending = lease.session.waitUntilIdle(new AbortController().signal)
    rig.host.exit('Host stopped')
    expect(lease.session.isOpen()).toBe(false)
    expect(await pending).toBe(false)
    await lease.release()
  })
})

describe.each(['museCode', 'modelApi'] as const)('%s schedule session adapter', (backend) => {
  it('binds context around send, steer and queue; withdraws the exact backend reference', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const withdrawQueued = vi.fn<NonNullable<AgentSession['withdrawQueued']>>(() =>
      Promise.resolve({ status: 'withdrawn', images: [] }),
    )
    const session = new ScheduleAgentSession(
      Object.assign(agent, { withdrawQueued }),
      backend,
      rig.contexts,
    )
    const context = fakeRunContext(rig.schedule)
    await session.send('Scheduled prompt', context)
    expect(session.isRunning()).toBe(true)
    await session.steer('Steering prompt', context)
    expect(agent.steer).toHaveBeenCalledWith('turn-1', [{ type: 'text', text: 'Steering prompt' }])
    agent.sendTurn.mockResolvedValueOnce({
      turnId: 'queued-turn',
      disposition: 'queued',
      userMessageId: 'message-1',
    })
    const id = await session.queue('Queued prompt', context)
    expect(await session.withdraw(id)).toBe(true)
    expect(withdrawQueued).toHaveBeenCalledWith({
      turnId: 'queued-turn',
      disposition: 'queued',
      userMessageId: 'message-1',
    })
    expect(await session.withdraw(id)).toBe(false)
    expect(rig.contexts.submit).toHaveBeenCalledTimes(3)
    session.dispose()
  })

  it('refuses a new turn while busy and treats an idle steer as a definite refusal', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const session = new ScheduleAgentSession(agent, backend, rig.contexts)
    const context = fakeRunContext(rig.schedule)
    await expect(session.steer('Prompt', context)).rejects.toMatchObject({
      name: 'SteerRefusedError',
    })
    await session.send('Prompt', context)
    await expect(session.send('Second prompt', context)).rejects.toThrow(UI_TEXT.scheduleBusy)
    expect(agent.sendTurn).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('does not resurrect a turn that completed before its admission acknowledgement', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const session = new ScheduleAgentSession(agent, backend, rig.contexts)
    agent.sendTurn.mockImplementationOnce(() => {
      agent.emit(
        { type: 'turnStarted', turnId: 'fast-turn' },
        { type: 'turnCompleted', turnId: 'fast-turn', terminal: 'completed' },
      )
      return Promise.resolve({ turnId: 'fast-turn', disposition: 'started' })
    })
    await session.send('Prompt', fakeRunContext(rig.schedule))
    expect(session.isRunning()).toBe(false)
    expect(await session.waitUntilIdle(new AbortController().signal)).toBe(true)
    session.dispose()
  })

  it('ignores completion of an unrelated queued turn and cleans aborted idle listeners', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const session = new ScheduleAgentSession(agent, backend, rig.contexts, 'running-turn')
    const abort = new AbortController()
    const pending = session.waitUntilIdle(abort.signal)
    agent.emit({ type: 'turnCompleted', turnId: 'other-turn', terminal: 'completed' })
    expect(session.isRunning()).toBe(true)
    abort.abort()
    expect(await pending).toBe(false)
    agent.emit({ type: 'turnCompleted', turnId: 'running-turn', terminal: 'completed' })
    expect(await session.waitUntilIdle(new AbortController().signal)).toBe(true)
    session.dispose()
  })

  it('does not withdraw an unsupported or already delivered message', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const withdrawQueued = vi.fn<NonNullable<AgentSession['withdrawQueued']>>(() =>
      Promise.resolve({ status: 'tooLate' }),
    )
    const context = fakeRunContext(rig.schedule)
    agent.sendTurn.mockResolvedValue({ turnId: 'queued-turn', disposition: 'queued' })
    const unsupported = new ScheduleAgentSession(agent, backend, rig.contexts)
    const unsupportedId = await unsupported.queue('Prompt', context)
    expect(await unsupported.withdraw(unsupportedId)).toBe(false)
    const session = new ScheduleAgentSession(
      Object.assign(agent, { withdrawQueued }),
      backend,
      rig.contexts,
    )
    const id = await session.queue('Prompt', context)
    expect(await session.withdraw(id)).toBe(false)
    session.dispose()
    unsupported.dispose()
  })

  it('reparents a queued message by its user id and discards completed handles', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    agent.sendTurn.mockResolvedValue({
      turnId: 'old-turn',
      disposition: 'steered',
      userMessageId: 'message-1',
    })
    const withdrawQueued = vi.fn<NonNullable<AgentSession['withdrawQueued']>>(() =>
      Promise.resolve({ status: 'tooLate' }),
    )
    const session = new ScheduleAgentSession(
      Object.assign(agent, { withdrawQueued }),
      backend,
      rig.contexts,
    )
    const id = await session.queue('Prompt', fakeRunContext(rig.schedule))
    agent.emit({ type: 'userMessageTurnChanged', userMessageId: 'message-1', turnId: 'new-turn' })
    expect(await session.withdraw(id)).toBe(false)
    expect(withdrawQueued).toHaveBeenCalledWith({
      turnId: 'new-turn',
      userMessageId: 'message-1',
      disposition: 'steered',
    })
    agent.emit({ type: 'turnCompleted', turnId: 'new-turn', terminal: 'completed' })
    expect(await session.withdraw(id)).toBe(false)
    expect(withdrawQueued).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('keeps every non-idle status busy until real idle', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const session = new ScheduleAgentSession(agent, backend, rig.contexts)
    for (const status of ['running', 'compacting', 'waitingForApproval']) {
      agent.emit({ type: 'sessionStatus', status })
      expect(session.isRunning()).toBe(true)
    }
    let isIdle = false
    const waiting = (async () => {
      const isResultIdle = await session.waitUntilIdle(new AbortController().signal)
      isIdle = isResultIdle
      return isResultIdle
    })()
    agent.emit({ type: 'turnCompleted', turnId: 'unrelated', terminal: 'completed' })
    await Promise.resolve()
    expect(isIdle).toBe(false)
    agent.emit({ type: 'sessionStatus', status: 'idle' })
    expect(await waiting).toBe(true)
    session.dispose()
  })

  it('observes idle status and refuses sends after disposal', async () => {
    const rig = setup(backend)
    const agent = new FakeAgentSession('session-1', 'chosen-model')
    const session = new ScheduleAgentSession(agent, backend, rig.contexts, 'running-turn')
    const waiting = session.waitUntilIdle(new AbortController().signal)
    agent.emit({ type: 'sessionStatus', status: 'idle' })
    expect(session.isRunning()).toBe(false)
    expect(await waiting).toBe(true)
    session.dispose()
    await expect(session.send('Prompt', fakeRunContext(rig.schedule))).rejects.toThrow(
      UI_TEXT.scheduleV2.messages.targetClosed,
    )
    expect(agent.sendTurn).not.toHaveBeenCalled()
  })
})
