import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, settle } from './helpers/fakeMsp'

const ack = (params: Record<string, unknown>) => ({
  status: 'accepted',
  commandId: params['commandId'],
})

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
  handle.server.handle('turn/steer', (params) => ({
    commandId: params['commandId'],
    turnId: 'turn-1',
    status: 'accepted',
  }))
  handle.server.handle('turn/cancel', ack)
  handle.server.handle('turn/interrupt', ack)
  handle.server.handle('session/setModel', ack)
  handle.server.handle('session/setReasoningEffort', ack)
  handle.server.handle('session/setApprovalMode', (params) => ({
    ...ack(params),
    applyOutcome: 'completed',
    effectiveMode: { mode: params['mode'], source: 'approvalReconfigure' },
  }))
  handle.server.handle('session/compact', (params) => ({
    ...ack(params),
    status: 'noop',
    reason: 'no_compactable_history',
  }))
  handle.server.handle('model/list', (params) => ({
    providerId: 'meta',
    profileId: null,
    source: 'providerCatalog',
    models: [
      {
        modelId: 'muse-spark-1.3',
        displayLabel: 'muse-spark-1.3',
        contextLimit: 1_007_997,
        isDefault: false,
        isActive: params['sessionId'] !== undefined,
      },
      {
        modelId: 'muse-spark-1.3-contributor',
        displayLabel: 'muse-spark-1.3-contributor',
        contextLimit: null,
        isDefault: true,
      },
    ],
  }))
  handle.server.handle('skill/list', () => ({
    skills: [
      {
        selector: 'fix-bug',
        displayName: 'Fix bug',
        description: 'Fixes a bug',
        source: 'project',
      },
      {
        selector: 'acme:deploy',
        displayName: 'Deploy',
        description: 'Deploys',
        argumentHint: '<env>',
        source: 'plugin',
        pluginId: 'acme',
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
      grantedCapabilities: [],
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
    const submission = await session.sendTurn([{ type: 'text', text: 'hi' }])
    expect(submission).toEqual({ turnId: 'turn-1', disposition: 'started' })
    expect(server.requestsFor('turn/start')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      input: [{ type: 'text', text: 'hi' }],
    })
    const { turnId } = submission
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

  it('defaults the disposition when the host omits it and steers a running turn', async () => {
    const { host, server } = setup()
    server.handle('turn/start', (params) => ({
      commandId: params['commandId'],
      turnId: 'turn-2',
      status: 'accepted',
    }))
    const session = await host.startSession(startOptions)
    await expect(session.sendTurn([{ type: 'text', text: 'x' }])).resolves.toEqual({
      turnId: 'turn-2',
      disposition: 'started',
    })
    const parts = [
      { type: 'text' as const, text: 'more' },
      { type: 'image' as const, base64Data: 'AAAA', mediaType: 'image/png', width: 1, height: 1 },
    ]
    await expect(session.steer('turn-2', parts)).resolves.toBe('turn-1')
    expect(server.requestsFor('turn/steer')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      expectedTurnId: 'turn-2',
      input: parts,
    })
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

  it('sets the model, reasoning effort and approval mode as session commands', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    await session.setModel('muse-spark-1.2')
    await session.setReasoningEffort('xhigh')
    await session.setApprovalMode('allowAll')
    expect(server.requestsFor('session/setModel')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      model: { modelId: 'muse-spark-1.2' },
    })
    expect(server.requestsFor('session/setReasoningEffort')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      reasoningEffort: 'xhigh',
    })
    expect(server.requestsFor('session/setApprovalMode')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      mode: 'allowAll',
    })
    const sessionCommands = server.requests.filter((r) => r.method?.startsWith('session/set'))
    expect(sessionCommands).toHaveLength(3)
    for (const request of sessionCommands) {
      expect(typeof request.params?.['commandId']).toBe('string')
    }
  })

  it('compacts and reports a noop with its reason', async () => {
    const { host } = setup()
    const session = await host.startSession(startOptions)
    await expect(session.compact()).resolves.toEqual({
      status: 'noop',
      reason: 'no_compactable_history',
    })
  })

  it('lists the session’s skills', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    await expect(session.listSkills()).resolves.toEqual([
      {
        selector: 'fix-bug',
        displayName: 'Fix bug',
        description: 'Fixes a bug',
        argumentHint: undefined,
      },
      {
        selector: 'acme:deploy',
        displayName: 'Deploy',
        description: 'Deploys',
        argumentHint: '<env>',
      },
    ])
    expect(server.requestsFor('skill/list')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
    })
  })

  it('lists models with their context limits, flagging the active one for a session', async () => {
    const { host } = setup()
    await expect(host.listModels()).resolves.toEqual([
      {
        modelId: 'muse-spark-1.3',
        displayLabel: 'muse-spark-1.3',
        contextLimit: 1_007_997,
        isDefault: false,
        isActive: false,
      },
      {
        modelId: 'muse-spark-1.3-contributor',
        displayLabel: 'muse-spark-1.3-contributor',
        contextLimit: undefined,
        isDefault: true,
        isActive: false,
      },
    ])
    const [active] = await host.listModels('s1')
    expect(active?.isActive).toBe(true)
  })

  it('refuses server requests it cannot serve, quietly for the mirrored ones', async () => {
    const { server, log } = setup()
    server.serverRequest('userInput/request', { userInputId: 'u1', questions: [] })
    server.serverRequest('approval/request', { approvalId: 'a1' })
    server.serverRequest('session/somethingNew', {})
    await settle()
    expect(server.clientResponses).toHaveLength(3)
    for (const response of server.clientResponses) {
      expect(response).toMatchObject({ error: expect.anything() })
    }
    expect(log.info).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledOnce()
  })

  it('decides approvals, answers questions and reads output pages on the wire', async () => {
    const { host, server } = setup()
    server.handle('approval/decide', (params) => ({
      ...ack(params),
      approvalId: params['approvalId'],
      terminal: true,
    }))
    server.handle('userInput/answer', (params) => ({
      ...ack(params),
      userInputId: params['userInputId'],
    }))
    server.handle('item/readOutput', (params) => ({
      content: '{"files":[]}',
      encoding: 'utf8',
      mediaType: 'application/json',
      offsetBytes: params['offsetBytes'],
      byteLen: 12,
      eof: true,
    }))
    const session = await host.startSession(startOptions)
    await session.decideApproval({
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
      feedback: 'use the file tool',
    })
    expect(server.requestsFor('approval/decide')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
      feedback: 'use the file tool',
    })
    await session.decideApproval({
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
    })
    expect(server.requestsFor('approval/decide')[1]?.params).not.toHaveProperty('feedback')
    await session.answerQuestions('q1', [{ questionId: 'colour', selectedLabel: 'Red' }])
    expect(server.requestsFor('userInput/answer')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      userInputId: 'q1',
      answers: [{ questionId: 'colour', selectedLabel: 'Red' }],
    })
    const page = await session.readOutput({
      itemId: 'c1',
      outputRef: 'tool_patch-1',
      offsetBytes: 0,
      lengthBytes: 4096,
    })
    expect(server.requestsFor('item/readOutput')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      itemId: 'c1',
      outputRef: 'tool_patch-1',
      offsetBytes: 0,
      lengthBytes: 4096,
    })
    expect(page).toEqual({
      content: '{"files":[]}',
      encoding: 'utf8',
      mediaType: 'application/json',
      offsetBytes: 0,
      byteLen: 12,
      eof: true,
    })
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
