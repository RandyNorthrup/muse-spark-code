import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost } from './helpers/fakeMsp'
import { unattendedRun } from './helpers/schedules/unattended'

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

describe('native scheduled queue authority', () => {
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
      await vi.waitFor(() => {
        expect(f.events).toContainEqual({
          type: 'userMessageTurnChanged',
          userMessageId: queued.userMessageId,
          turnId: 'turn-2',
        })
      })
      expect(f.session.getScheduledRun('turn-2')).toBe(run)
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
