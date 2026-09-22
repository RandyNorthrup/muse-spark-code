import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, settle } from './helpers/fakeMsp'

function setup() {
  const handle = fakeMspHost()
  const log = new FakeLogOutputChannel()
  handle.server.handle('session/start', (params) => ({
    session: {
      sessionId: `session-for-${String(params['modelId'])}`,
      modelId: params['modelId'],
      status: 'idle',
    },
    viewCursor: '',
  }))
  handle.server.handle('turn/start', (params) => ({
    commandId: params['commandId'],
    turnId: 'turn-1',
    status: 'accepted',
    disposition: 'started',
    startedNewTurn: true,
  }))
  handle.server.handle('turn/cancel', () => ({ status: 'accepted' }))
  handle.server.handle('turn/interrupt', () => ({ status: 'accepted' }))
  handle.server.handle('model/list', () => ({
    providerId: 'meta',
    profileId: null,
    source: 'providerCatalog',
    models: [
      {
        modelId: 'muse-spark-1.3',
        displayLabel: 'muse-spark-1.3',
        contextLimit: 1_007_997,
        isDefault: false,
        isActive: true,
      },
      {
        modelId: 'muse-spark-1.3-contributor',
        displayLabel: 'muse-spark-1.3-contributor',
        contextLimit: null,
        isDefault: true,
        isActive: true,
      },
    ],
  }))
  const host = new MuseCodeHost(handle.host, log)
  return { ...handle, log, host }
}

const startOptions = {
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'denyUnmatched',
}

describe('MuseCodeHost', () => {
  it('reads the server identity from the handshake result', () => {
    const { host } = setup()
    expect(host.info).toEqual({
      serverName: 'muse',
      serverVersion: '1.3.0-test',
      museHome: '/home/test/.local/share/muse',
    })
  })

  it('starts a session with an explicit model, approval mode and workspace', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    expect(session.sessionId).toBe('session-for-muse-spark-1.3')
    expect(session.modelId).toBe('muse-spark-1.3')
    const [request] = server.requestsFor('session/start')
    expect(request?.params).toMatchObject(startOptions)
    expect(typeof request?.params?.['commandId']).toBe('string')
    expect(host.sessionCount).toBe(1)
  })

  it('sends a text turn and routes that session’s events to its listener in order', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    const events: AgentEvent[] = []
    session.onEvent((event) => {
      events.push(event)
    })
    const turnId = await session.sendTurn('hi')
    expect(turnId).toBe('turn-1')
    expect(server.requestsFor('turn/start')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      input: [{ type: 'text', text: 'hi' }],
    })
    server.notify('turn/started', { sessionId: session.sessionId, turnId, viewCursor: 'v' })
    server.notify('item/delta', {
      sessionId: session.sessionId,
      itemId: 'i',
      delta: 'yo',
      viewCursor: 'v',
    })
    server.notify('turn/completed', { sessionId: session.sessionId, turnId, terminal: 'completed' })
    await settle()
    expect(events.map((event) => event.type)).toEqual(['turnStarted', 'textDelta', 'turnCompleted'])
  })

  it('warns about events for sessions it does not know and ignores unmapped methods', async () => {
    const { host, server, log } = setup()
    await host.startSession(startOptions)
    server.notify('turn/started', { sessionId: 'ghost', turnId: 't', viewCursor: 'v' })
    server.notify('view/gap', { sessionId: 'ghost' })
    await settle()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('unknown session ghost')
  })

  it('cancels and interrupts through the wire', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    await session.cancel()
    await session.interrupt()
    expect(server.requestsFor('turn/cancel')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
    })
    expect(server.requestsFor('turn/interrupt')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
    })
  })

  it('lists models with their context limits', async () => {
    const { host } = setup()
    await expect(host.listModels()).resolves.toEqual([
      {
        modelId: 'muse-spark-1.3',
        displayLabel: 'muse-spark-1.3',
        contextLimit: 1_007_997,
        isDefault: false,
      },
      {
        modelId: 'muse-spark-1.3-contributor',
        displayLabel: 'muse-spark-1.3-contributor',
        contextLimit: undefined,
        isDefault: true,
      },
    ])
  })

  it('refuses server requests it cannot serve', async () => {
    const { server, log } = setup()
    server.serverRequest('userInput/request', { userInputId: 'u1', questions: [] })
    await settle()
    expect(server.clientResponses[0]).toMatchObject({ id: 1, error: expect.anything() })
    expect(log.warn).toHaveBeenCalledOnce()
  })

  it('reports the host exit to listeners', async () => {
    const { host, exit, log } = setup()
    const listener = vi.fn()
    host.onExit(listener)
    exit(1, null)
    await settle()
    expect(listener).toHaveBeenCalledWith('code 1, signal null')
    expect(log.warn).toHaveBeenCalledWith('muse serve exited (code 1, signal null)')
  })

  it('disposes sessions and closes the process on close', async () => {
    const { host, closeCalls } = setup()
    const session = await host.startSession(startOptions)
    const listener = vi.fn()
    session.onEvent(listener)
    await host.close()
    expect(host.sessionCount).toBe(0)
    expect(closeCalls()).toBe(1)
    session.emit({ type: 'sessionStatus', status: 'idle' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops routing to a session after it is disposed', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    const listener = vi.fn()
    session.onEvent(listener)
    session.dispose()
    session.dispose()
    server.notify('turn/started', { sessionId: session.sessionId, turnId: 't', viewCursor: 'v' })
    await settle()
    expect(listener).not.toHaveBeenCalled()
    expect(host.sessionCount).toBe(0)
  })
})
