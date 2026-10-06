import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { ScheduleDelivery, type ScheduleDeliveryRuns } from '../../src/core/schedules/delivery'
import {
  ScheduleAgentSession,
  type ScheduleContextSubmitter,
} from '../../src/host/schedules/backgroundTarget'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, settle } from './helpers/fakeMsp'
import { RACE_APPROVAL_ID, raceRequested, raceUpdated } from './helpers/stageRaceCapture'

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
        return {
          outcome: 'ran',
          refusedActions: [],
          cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
        }
      },
    }
    const lease = { session, release }
    const delivery = new ScheduleDelivery({
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
