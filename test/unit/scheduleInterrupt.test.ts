import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { MODEL_API_MODEL_TEXT } from '../../src/shared/constants'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { ScheduleV2 } from '../../src/shared/scheduleV2'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import {
  ScheduleDelivery,
  type ScheduleDeliveryRuns,
  type ScheduleRunSettlement,
  type ScheduleTargetLease,
} from '../../src/core/schedules/delivery'
import {
  ScheduleAgentSession,
  type ScheduleContextSubmitter,
} from '../../src/host/schedules/backgroundTarget'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, settle } from './helpers/fakeMsp'
import { RACE_APPROVAL_ID, raceRequested, raceUpdated } from './helpers/stageRaceCapture'

const uncharged: ScheduleRunSettlement = {
  outcome: 'ran',
  refusedActions: [],
  cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
}

function deliveryFor(
  schedule: ScheduleV2,
  lease: ScheduleTargetLease,
  runs: ScheduleDeliveryRuns,
): ScheduleDelivery {
  return new ScheduleDelivery({
    now: () => schedule.createdAtMs,
    monotonicNow: () => 1,
    holds: () => true,
    targets: {
      find: () => Promise.resolve(lease),
      open: () => Promise.resolve(lease),
      fresh: () => Promise.resolve(lease),
    },
    runs,
    prompt: () => 'Scheduled follow-up',
  })
}

describe('scheduled interrupt through the real Muse Code Stop path', () => {
  it('rejects a partly-decided captured approval, cancels, then sends the scheduled prompt', async () => {
    const handle = fakeMspHost()
    const { server } = handle
    const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel())
    server.handle('session/start', () => ({
      session: { sessionId: 'session-1', modelId: 'muse-spark-1.3', status: 'idle' },
      viewCursor: '',
    }))
    server.handle('turn/start', (params) => ({
      commandId: params['commandId'],
      turnId: 'scheduled-turn',
      status: 'accepted',
      disposition: 'started',
      startedNewTurn: true,
    }))
    let isTerminal = false
    server.handle('approval/decide', (params) => ({
      status: 'accepted',
      commandId: params['commandId'],
      approvalId: params['approvalId'],
      terminal: isTerminal,
    }))
    const agent = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
    })
    const captured = raceRequested(agent.sessionId)
    const activeTurnId = captured['turnId']
    if (typeof activeTurnId !== 'string') throw new Error('Captured turn id missing')
    const contexts: ScheduleContextSubmitter = {
      submit: vi.fn<ScheduleContextSubmitter['submit']>(
        async (_session, _context, dispatch) => await dispatch(),
      ),
    }
    const session = new ScheduleAgentSession(agent, 'museCode', contexts, activeTurnId)
    const release = vi.fn(() => Promise.resolve())
    server.handle('turn/cancel', (params) => {
      server.notify('turn/completed', {
        sessionId: agent.sessionId,
        turnId: activeTurnId,
        terminal: 'cancelled',
      })
      return { status: 'accepted', commandId: params['commandId'] }
    })
    const schedule = fakeSchedule({
      delivery: 'interrupt',
      target: { kind: 'conversation', backend: 'museCode', sessionId: agent.sessionId },
    })
    const runs: ScheduleDeliveryRuns = {
      run: async (_session, _schedule, _context, dispatch) => {
        await dispatch()
        return uncharged
      },
    }
    const lease = { session, release }
    const delivery = deliveryFor(schedule, lease, runs)
    try {
      server.notify('approval/requested', captured)
      await settle()
      await agent.decideApproval({
        approvalId: RACE_APPROVAL_ID,
        choiceId: 'allow_once',
        requirementId: { approvalId: RACE_APPROVAL_ID, sourceIndex: 0 },
      })
      server.notify('approval/updated', raceUpdated(agent.sessionId, 1))
      await settle()
      isTerminal = true
      const pending = delivery.deliver(schedule, fakeRunContext(schedule), schedule.createdAtMs)
      void pending.catch(() => undefined)
      await vi.waitFor(() => {
        expect(server.requestsFor('turn/start')).toHaveLength(1)
      })
      await pending
      const methods = server.requests.map((request) => request.method)
      const decisions = server.requestsFor('approval/decide')
      expect(decisions.map((request) => request.params?.['choiceId'])).toEqual([
        'allow_once',
        'abort',
      ])
      expect(methods.lastIndexOf('approval/decide')).toBeLessThan(methods.indexOf('turn/cancel'))
      expect(methods.indexOf('turn/cancel')).toBeLessThan(methods.indexOf('turn/start'))
      expect(server.requestsFor('turn/interrupt')).toEqual([])
      expect(server.requestsFor('turn/start')[0]?.params?.['input']).toEqual([
        { type: 'text', text: 'Scheduled follow-up' },
      ])
      expect(release).toHaveBeenCalledOnce()
    } finally {
      session.dispose()
      await host.close()
    }
  })
})

async function modelApiRig() {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log,
    }),
    isPaidFeatureOn: (feature) => feature === 'subagents',
    allowsPaidUse: () => Promise.resolve(true),
  })
  const agent = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(agent instanceof ModelApiSession)) throw new Error('Expected Model API session')
  const contexts = {
    submit: vi.fn<ScheduleContextSubmitter['submit']>(
      async (_session, _context, dispatch) => await dispatch(),
    ),
  }
  const session = new ScheduleAgentSession(agent, 'modelApi', contexts)
  const events: AgentEvent[] = []
  agent.onEvent((event) => {
    events.push(event)
  })
  const schedule = fakeSchedule({
    target: { kind: 'conversation', backend: 'modelApi', sessionId: agent.sessionId },
  })
  const terminal = Promise.withResolvers<ScheduleRunSettlement>()
  const lease = { session, release: vi.fn(() => Promise.resolve()) }
  const runs: ScheduleDeliveryRuns = {
    run: async (_session, _schedule, _context, dispatch) => {
      try {
        await dispatch()
      } catch {
        return { ...uncharged, outcome: 'failed', reason: 'Dispatch failed' }
      }
      return await terminal.promise
    },
  }
  const delivery = deliveryFor(schedule, lease, runs)
  const settleRun = (outcome: ScheduleRunSettlement['outcome'] = 'ran') => {
    terminal.resolve({ ...uncharged, outcome })
  }
  const context = fakeRunContext(schedule)
  const fire = () => delivery.deliver(schedule, context, schedule.createdAtMs)
  const admission = () =>
    vi.waitFor(() => {
      expect(contexts.submit).toHaveBeenCalledOnce()
    })
  const waitIdle = () =>
    vi.waitFor(() => {
      expect(agent.status).toBe('idle')
    })
  const sendUser = (text = 'User') => agent.sendTurn([{ type: 'text', text }])
  return {
    api,
    host,
    agent,
    session,
    events,
    contexts,
    schedule,
    delivery,
    settleRun,
    fire,
    admission,
    waitIdle,
    sendUser,
    startFire: async () => {
      const pending = fire()
      await admission()
      return { pending, runId: context.runId }
    },
    beginCompaction: async () => {
      await sendUser()
      await waitIdle()
      const compacting = agent.compact()
      await vi.waitFor(() => {
        expect(api.responseBodies()).toHaveLength(2)
      })
      return { compacting }
    },
    holdAdmission: (shouldWaitAfterDispatch = false) => {
      const gate = Promise.withResolvers<undefined>()
      const original = contexts.submit.getMockImplementation()
      contexts.submit.mockImplementation(async (...args) => {
        if (!shouldWaitAfterDispatch) await gate.promise
        if (original === undefined) throw new Error('Missing submitter')
        const submitted = await original(...args)
        if (shouldWaitAfterDispatch) await gate.promise
        return submitted
      })
      return gate
    },
    close: async (...gates: readonly { resolve(value: undefined): void }[]) => {
      for (const gate of gates) gate.resolve(undefined)
      settleRun()
      session.dispose()
      await host.close()
    },
  }
}

describe('schedule delivery against the real Model API queue and lifecycle', () => {
  it('admits when-idle behind already queued user turns without losing the handoff', async () => {
    const rig = await modelApiRig()
    const first = Promise.withResolvers<undefined>()
    const second = Promise.withResolvers<undefined>()
    rig.api.script(
      { text: 'First', hold: first.promise },
      { text: 'Second', hold: second.promise },
      { text: 'Scheduled' },
    )
    try {
      await rig.sendUser('User first')
      await rig.sendUser('User second')
      const pending = rig.fire()
      // Resolve the target lease while the first response is still held.
      // The original wait-then-send path must reach the actual handoff race.
      await Promise.resolve()
      first.resolve(undefined)
      await vi.waitFor(() => {
        expect(rig.api.responseBodies()).toHaveLength(2)
      })
      second.resolve(undefined)
      await rig.waitIdle()
      rig.settleRun()
      expect(await pending).toMatchObject({ outcome: 'ran' })
      const bodies = rig.api.responseBodies()
      expect(bodies).toHaveLength(3)
      expect(JSON.stringify(bodies[2]?.['input'])).toContain('Scheduled follow-up')
    } finally {
      await rig.close(first, second)
    }
  })

  it('Skip survives asynchronous admission and removes the when-idle queue entry', async () => {
    const rig = await modelApiRig()
    const first = Promise.withResolvers<undefined>()
    const admitted = rig.holdAdmission()
    rig.api.script({ text: 'User', hold: first.promise }, { text: 'Unexpected scheduled reply' })
    try {
      await rig.sendUser('User first')
      const { pending, runId } = await rig.startFire()
      expect(rig.delivery.skip(runId)).toBe(true)
      admitted.resolve(undefined)
      first.resolve(undefined)
      await rig.waitIdle()
      rig.settleRun()
      expect(await pending).toMatchObject({ outcome: 'missed', cost: { usd: 0 } })
      expect(rig.api.responseBodies()).toHaveLength(1)
    } finally {
      await rig.close(admitted, first)
    }
  })

  it.each(['queued', 'acknowledgementPending'] as const)(
    'Skip removes the exact entry when %s',
    async (state) => {
      const rig = await modelApiRig()
      const user = Promise.withResolvers<undefined>()
      const acknowledgement =
        state === 'acknowledgementPending'
          ? rig.holdAdmission(true)
          : Promise.withResolvers<undefined>()
      const withdraw = vi.spyOn(rig.agent, 'withdrawQueued')
      rig.api.script({ text: 'User', hold: user.promise }, { text: 'Unexpected scheduled reply' })
      try {
        await rig.sendUser('User first')
        const { pending, runId } = await rig.startFire()
        expect(rig.delivery.skip(runId)).toBe(true)
        expect(rig.delivery.skip(runId)).toBe(true)
        acknowledgement.resolve(undefined)
        await vi.waitFor(() => {
          expect(withdraw).toHaveBeenCalledOnce()
        })
        expect(rig.agent.status).toBe('running')
        user.resolve(undefined)
        await rig.waitIdle()
        rig.settleRun('skipped')
        expect(await pending).toMatchObject({ outcome: 'skipped' })
        expect(rig.api.responseBodies()).toHaveLength(1)
      } finally {
        await rig.close(acknowledgement, user)
      }
    },
  )

  it('queues after a user turn that starts during asynchronous admission', async () => {
    const rig = await modelApiRig()
    const admitted = rig.holdAdmission()
    const user = Promise.withResolvers<undefined>()
    rig.api.script({ text: 'User', hold: user.promise }, { text: 'Scheduled' })
    try {
      const pending = rig.fire()
      await rig.admission()
      await rig.sendUser('User arrives during admission')
      admitted.resolve(undefined)
      await vi.waitFor(() => {
        expect(rig.api.responseBodies()).toHaveLength(1)
      })
      user.resolve(undefined)
      await rig.waitIdle()
      rig.settleRun()
      expect(await pending).toMatchObject({ outcome: 'ran' })
      expect(rig.api.responseBodies()).toHaveLength(2)
    } finally {
      await rig.close(admitted, user)
    }
  })

  it('when-idle queues behind compaction and Skip leaves the summary running', async () => {
    const rig = await modelApiRig()
    const summary = Promise.withResolvers<undefined>()
    const withdraw = vi.spyOn(rig.agent, 'withdrawQueued')
    const cancel = vi.spyOn(rig.agent, 'cancel')
    rig.api.script(
      { text: 'User' },
      { text: 'Summary', hold: summary.promise },
      { text: 'Unexpected scheduled reply' },
    )
    try {
      const { compacting } = await rig.beginCompaction()
      const { pending, runId } = await rig.startFire()
      expect(rig.api.responseBodies()).toHaveLength(2)
      expect(rig.delivery.skip(runId)).toBe(true)
      await vi.waitFor(() => {
        expect(withdraw).toHaveBeenCalledOnce()
      })
      expect(cancel).not.toHaveBeenCalled()
      expect(rig.agent.status).toBe('running')
      summary.resolve(undefined)
      expect(await compacting).toMatchObject({ status: 'accepted' })
      rig.settleRun('skipped')
      expect(await pending).toMatchObject({ outcome: 'skipped' })
      expect(rig.api.responseBodies()).toHaveLength(2)
    } finally {
      await rig.close(summary)
    }
  })

  it('steers only the parent and child completion never wakes its idle waiter', async () => {
    const rig = await modelApiRig()
    const child = Promise.withResolvers<undefined>()
    const parent = Promise.withResolvers<undefined>()
    rig.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"worker","objective":"Map files"}',
            callId: 'spawn',
          },
        ],
      },
      {
        text: 'Reply',
        // Parent and child requests race. Hold by the real request's objective,
        // never by whichever request happens to consume the next script slot.
        get hold() {
          return JSON.stringify(rig.api.responseBodies().at(-1)?.['input']).includes(
            MODEL_API_MODEL_TEXT.subagentObjective,
          )
            ? child.promise
            : parent.promise
        },
      },
    )
    const steer = vi.spyOn(rig.agent, 'steer')
    try {
      const submitted = await rig.sendUser('Delegate')
      await vi.waitFor(() => {
        expect(rig.api.responseBodies()).toHaveLength(3)
      })
      await rig.session.steer('Scheduled steer', fakeRunContext(rig.schedule))
      expect(steer).toHaveBeenCalledWith(submitted.turnId, [
        { type: 'text', text: 'Scheduled steer' },
      ])
      let isIdle = false
      const waiting = (async () => {
        const isResultIdle = await rig.session.waitUntilIdle(new AbortController().signal)
        isIdle = isResultIdle
        return isResultIdle
      })()
      child.resolve(undefined)
      await vi.waitFor(() => {
        expect(
          rig.events.some(
            (event) => event.type === 'turnCompleted' && event.turnId !== submitted.turnId,
          ),
        ).toBe(true)
      })
      expect(rig.session.isRunning()).toBe(true)
      expect(isIdle).toBe(false)
      parent.resolve(undefined)
      expect(await waiting).toBe(true)
    } finally {
      await rig.close(child, parent)
    }
  })

  it('Interrupt uses real Stop during compaction and waits for real idle', async () => {
    const rig = await modelApiRig()
    const summary = Promise.withResolvers<undefined>()
    rig.api.script(
      { text: 'First' },
      { text: 'Summary', hold: summary.promise },
      { text: 'Scheduled' },
    )
    const cancel = vi.spyOn(rig.agent, 'cancel')
    try {
      const { compacting } = await rig.beginCompaction()
      expect(rig.session.isRunning()).toBe(true)
      const schedule = { ...rig.schedule, delivery: 'interrupt' as const }
      const pending = rig.delivery.deliver(schedule, fakeRunContext(schedule), schedule.createdAtMs)
      await vi.waitFor(() => {
        expect(cancel).toHaveBeenCalledOnce()
      })
      expect(await compacting).toMatchObject({ status: 'cancelled' })
      await rig.waitIdle()
      rig.settleRun()
      expect(await pending).toMatchObject({ outcome: 'ran' })
      expect(rig.api.responseBodies()).toHaveLength(3)
    } finally {
      await rig.close(summary)
    }
  })
})
