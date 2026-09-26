import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { GoalRefusedError, SessionNotLoadedError } from '../../src/core/agent/agentBackend'
import {
  type CommandTimeouts,
  describeExit,
  MuseCodeHost,
} from '../../src/core/backends/musecode/MuseCodeHost'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MSP_FRAME_LIMIT_BYTES, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeInitializeResult,
  fakeMspHost,
  goalRefusal,
  refusalOf,
  settle,
} from './helpers/fakeMsp'
import {
  INVALID_TARGET,
  QUESTION_CLARIFIED,
  SHELL_CALL_STARTED,
  taskAck,
} from './helpers/m46Capture'

const ack = (params: Record<string, unknown>) => ({
  status: 'accepted',
  commandId: params['commandId'],
})

function setup(
  options: {
    timeouts?: CommandTimeouts
    /** What the handshake granted (M46: `userShell`); nothing by default. */
    grantedCapabilities?: readonly string[]
  } = {},
) {
  const handle = fakeMspHost({
    ...fakeInitializeResult,
    grantedCapabilities: [...(options.grantedCapabilities ?? [])],
  })
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
  const host = new MuseCodeHost(handle.host, log, options.timeouts)
  return { ...handle, log, host }
}

const startOptions = {
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'denyUnmatched',
}

/** A started session and every event it delivers, in order. */
async function listeningSession(host: MuseCodeHost) {
  const session = await host.startSession(startOptions)
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  return { session, events }
}

describe('MuseCodeHost', () => {
  it('reads the server identity from the handshake result', () => {
    const { host } = setup()
    expect(host.info).toEqual({
      kind: 'museCode',
      serverName: 'muse',
      serverVersion: '1.3.0-test',
      museHome: '/home/test/.local/share/muse',
      grantedCapabilities: [],
      canEditSessions: true,
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
    const { session, events } = await listeningSession(host)
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

  it('warns about events for sessions it does not know', async () => {
    const { host, server, log } = setup()
    await host.startSession(startOptions)
    server.notify('turn/started', { sessionId: 'ghost', turnId: 't', viewCursor: 'v' })
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

  // M39: a refusal that admitted nothing is retried, and the log says so.
  it('logs a retried refusal and traces how long each command took', async () => {
    const { host, server, log } = setup()
    const session = await host.startSession(startOptions)
    const refuse = refusalOf('overloaded', -32_001)
    let calls = 0
    server.handle('session/setModel', (params) => {
      calls += 1
      return calls === 1 ? refuse() : ack(params)
    })
    await session.setModel('muse-spark-1.2')
    expect(calls).toBe(2)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^session\/setModel refused \(refused: overloaded\); attempt 2 in \d+ ms$/,
      ),
    )
    expect(log.trace).toHaveBeenCalledWith(
      expect.stringMatching(/^session\/setModel answered in \d+ ms$/),
    )
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

  it('refuses a mirrored prompt it cannot read, so the host presents it again (D26)', async () => {
    const { server, log } = setup()
    server.serverRequest('userInput/request', { userInputId: 'u1', questions: [] })
    server.serverRequest('approval/request', { approvalId: 'a1' })
    await settle()
    expect(server.clientResponses).toHaveLength(2)
    for (const response of server.clientResponses) {
      expect(response).toMatchObject({ error: expect.anything() })
    }
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('userInput/requested had an'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('approval/requested had an'))
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
    server.handle('userInput/cancel', (params) => ({
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
    await session.cancelQuestions('q1')
    expect(server.requestsFor('userInput/cancel')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      userInputId: 'q1',
    })
    server.handle('subagent/interrupt', (params) => ({
      ...ack(params),
      subagentId: params['subagentId'],
    }))
    server.handle('subagent/sendMessage', (params) => ({
      ...ack(params),
      subagentId: params['subagentId'],
    }))
    await session.controlSubagent('sub-1', 'interrupt')
    await session.messageSubagent('sub-1', 'keep going', false)
    expect(server.requestsFor('subagent/interrupt')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      subagentId: 'sub-1',
    })
    expect(server.requestsFor('subagent/sendMessage')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      subagentId: 'sub-1',
      body: 'keep going',
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

  it('reports a crash to listeners, with what the exit code means (D25)', async () => {
    const { host, exit, log } = setup()
    const listener = vi.fn()
    host.onExit(listener)
    exit(3, null)
    await settle()
    expect(listener).toHaveBeenCalledWith({
      description:
        'Muse Code refused its configuration; check its settings.json and museSpark.environmentVariables (exit code 3)',
      isExpected: false,
      isPersistent: true,
    })
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('muse serve exited (Muse Code refused'),
    )
  })

  it('reports its own close as expected, not as a crash (D25)', async () => {
    const { host, exit } = setup()
    const listener = vi.fn()
    host.onExit(listener)
    await host.close()
    exit(0, null)
    await settle()
    expect(listener).toHaveBeenCalledWith({
      description: 'Muse Code stopped (exit code 0)',
      isExpected: true,
      isPersistent: false,
    })
  })

  it('keeps listening after a notification handler throws (D25)', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    let calls = 0
    session.onEvent(() => {
      calls += 1
      if (calls === 1) {
        throw new Error('listener bug')
      }
    })
    const { sessionId } = session
    server.notify('session/statusChanged', { sessionId, status: 'running' })
    server.notify('session/statusChanged', { sessionId, status: 'idle' })
    await settle()
    expect(calls).toBe(2)
  })

  it('fails a command that never answers instead of waiting for ever (D25)', async () => {
    const { host, server } = setup({ timeouts: { normalMs: 50, longMs: 100 } })
    server.silence('model/list')
    await expect(host.listModels()).rejects.toThrow(
      'Muse Code did not answer model/list within 0 s',
    )
  })

  it('turns sessionNotLoaded into SessionNotLoadedError (D25)', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    server.handle('turn/start', () => {
      throw Object.assign(new Error('not loaded'), { kind: 'sessionNotLoaded' })
    })
    const failure = session.sendTurn([{ type: 'text', text: 'hi' }])
    await expect(failure).rejects.toBeInstanceOf(SessionNotLoadedError)
    await expect(failure).rejects.toMatchObject({ sessionId: session.sessionId })
  })

  it('shares one handle between two surfaces on the same session (D25)', async () => {
    const { host } = setup()
    const first = await host.startSession(startOptions)
    const second = await host.startSession(startOptions)
    expect(second).toBe(first)
    const listener = vi.fn()
    second.onEvent(listener)
    first.dispose()
    // The other surface still hears its session.
    expect(host.sessionCount).toBe(1)
    first.emit({ type: 'sessionStatus', status: 'idle' })
    expect(listener).toHaveBeenCalledOnce()
    second.dispose()
    expect(host.sessionCount).toBe(0)
  })

  it('describes every documented exit code and a signal', () => {
    expect(describeExit({ code: null, signal: 'SIGKILL' }, false)).toEqual({
      description: 'Muse Code was stopped by SIGKILL',
      isExpected: false,
      isPersistent: false,
    })
    expect(describeExit({ code: 4, signal: null }, false)).toMatchObject({ isPersistent: false })
    expect(describeExit({ code: 5, signal: null }, false)).toMatchObject({ isPersistent: true })
    expect(describeExit({ code: 2, signal: null }, false)).toMatchObject({ isPersistent: true })
    expect(describeExit({ code: 77, signal: null }, true)).toEqual({
      description: 'Muse Code exited with code 77',
      isExpected: true,
      isPersistent: false,
    })
  })

  it('closes a host whose connection ended while the process lived (D25)', async () => {
    const { server, closeCalls } = setup()
    server.close()
    await settle()
    expect(closeCalls()).toBe(1)
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

describe('MuseCodeHost: stored sessions (M6)', () => {
  const stored = {
    sessionId: 'old',
    path: '/logs/old.jsonl',
    status: 'notLoaded',
    activeTurnId: null,
    createdAt: '2026-09-22T10:00:00Z',
    updatedAt: '2026-09-22T11:00:00Z',
    workspaceRoot: '/ws',
    providerId: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    turnCount: 1,
    forkedFrom: null,
    title: 'Old prompt',
  }
  const items = [
    { itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'Old prompt' },
  ]
  const envelope = (session: Record<string, unknown>) => ({
    session,
    history: { mode: 'inline', items, snapshot: null },
    pendingRequests: [],
    viewCursor: 'v:old:3',
  })

  it('pages session/list for a workspace', async () => {
    const { host, server } = setup()
    server.handle('session/list', (params) => ({
      sessions: [
        { ...stored, sessionId: typeof params['cursor'] === 'string' ? params['cursor'] : 'first' },
      ],
      nextCursor: params['cursor'] === undefined ? 'next' : null,
    }))
    const first = await host.listSessions({ workspaceRoot: '/ws', limit: 50 })
    expect(first.sessions[0]?.sessionId).toBe('first')
    expect(first.nextCursor).toBe('next')
    const second = await host.listSessions({ workspaceRoot: '/ws', limit: 50, cursor: 'next' })
    expect(second.sessions[0]?.sessionId).toBe('next')
    expect(second.nextCursor).toBeUndefined()
    expect(server.requestsFor('session/list')[1]?.params).toMatchObject({
      workspaceRoot: '/ws',
      limit: 50,
      cursor: 'next',
    })
    expect(server.requestsFor('session/list')[0]?.params).not.toHaveProperty('cursor')
  })

  it('resumes asking for a snapshot, tracks the session and routes its events', async () => {
    const { host, server } = setup()
    server.handle('session/resume', (params) =>
      envelope({ ...stored, sessionId: params['sessionId'], status: 'idle' }),
    )
    const loaded = await host.resumeSession('old', 'muse-spark-1.3', {
      ide: { url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer x' } },
    })
    expect(server.requestsFor('session/resume')[0]?.params).toMatchObject({
      sessionId: 'old',
      history: 'snapshot',
      config: { mcpServers: { ide: { transport: 'streamableHttp', mode: 'optional' } } },
    })
    expect(loaded.session.sessionId).toBe('old')
    expect(loaded.session.modelId).toBe('muse-spark-1.3')
    expect(loaded.record.status).toBe('idle')
    expect(loaded.history).toEqual({
      mode: 'inline',
      items,
      name: undefined,
      todos: [],
    })
    expect(host.sessionCount).toBe(1)
    const events: AgentEvent[] = []
    loaded.session.onEvent((event) => {
      events.push(event)
    })
    server.notify('session/nameChanged', { sessionId: 'old', name: 'N' })
    await settle()
    expect(events).toEqual([{ type: 'sessionNamed', name: 'N' }])
    // Resuming again hands back the same handle.
    const again = await host.resumeSession('old', 'muse-spark-1.3')
    expect(again.session).toBe(loaded.session)
    expect(server.requestsFor('session/resume')[1]?.params).not.toHaveProperty('config')
  })

  it('reads a session without loading it, forks with an optional cut point, renames', async () => {
    const { host, server } = setup()
    server.handle('session/read', () => envelope(stored))
    server.handle('session/fork', (params) =>
      envelope({ ...stored, sessionId: 'fork', forkedFrom: { sessionId: params['sessionId'] } }),
    )
    server.handle('session/rename', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
      name: 'Canonical',
    }))
    const read = await host.readSession('old')
    expect(read.items).toEqual(items)
    expect(server.requestsFor('session/read')[0]?.params).toMatchObject({
      sessionId: 'old',
      excludeItems: false,
    })
    expect(host.sessionCount).toBe(0)
    const fork = await host.forkSession('old', 'muse-spark-1.3', 't1')
    expect(server.requestsFor('session/fork')[0]?.params).toMatchObject({
      sessionId: 'old',
      cutPoint: { lastTurnId: 't1' },
    })
    expect(fork.session.sessionId).toBe('fork')
    expect(fork.record.forkedFrom).toEqual({ sessionId: 'old' })
    await host.forkSession('old', 'muse-spark-1.3')
    expect(server.requestsFor('session/fork')[1]?.params).not.toHaveProperty('cutPoint')
    await expect(fork.session.rename('canonical')).resolves.toBe('Canonical')
    expect(server.requestsFor('session/rename')[0]?.params).toMatchObject({
      sessionId: 'fork',
      name: 'canonical',
    })
    server.handle('session/rename', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    await expect(fork.session.rename('later')).resolves.toBeUndefined()
  })

  it('delivers list-stream events to their listeners without a session, warning on bad shapes', async () => {
    const { host, server, log } = setup()
    const events: unknown[] = []
    const stop = host.onSessionListEvent((event) => {
      events.push(event)
    })
    server.notify('session/listChanged', { session: stored })
    server.notify('session/closed', { sessionId: 'old', reason: 'hostShutdown', viewCursor: 'v' })
    server.notify('session/listChanged', { session: { sessionId: 'broken' } })
    await settle()
    expect(events).toEqual([
      { type: 'changed', record: expect.objectContaining({ sessionId: 'old' }) },
      { type: 'closed', sessionId: 'old', reason: 'hostShutdown' },
    ])
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('session/listChanged')
    stop()
    server.notify('session/closed', { sessionId: 'old', reason: 'idle', viewCursor: 'v' })
    await settle()
    expect(events).toHaveLength(2)
  })
})

describe('MuseCodeHost: subscription usage (M8)', () => {
  const usage = {
    observedAtMs: 1_800_000_000_000,
    tier: 'muse-pro',
    window: { usedPercent: 12, resetsAtMs: 1_800_000_900_000, windowDurationMins: 300 },
    weekly: { usedPercent: 3, resetsAtMs: 1_800_400_000_000 },
  }

  it('reads usage/read, absent before the first observation', async () => {
    const { host, server } = setup()
    server.handle('usage/read', () => ({}))
    await expect(host.readUsage()).resolves.toBeUndefined()
    server.handle('usage/read', () => ({ usage }))
    await expect(host.readUsage()).resolves.toEqual(usage)
    expect(server.requestsFor('usage/read')).toHaveLength(2)
  })

  it('delivers usage/changed to its listeners without a session, warning on bad shapes', async () => {
    const { host, server, log } = setup()
    const seen: unknown[] = []
    const stop = host.onUsageChanged((next) => {
      seen.push(next)
    })
    server.notify('usage/changed', usage)
    server.notify('usage/changed', { tier: 'broken' })
    await settle()
    expect(seen).toEqual([usage])
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('usage/changed')
    stop()
    server.notify('usage/changed', usage)
    await settle()
    expect(seen).toHaveLength(1)
  })
})

/** The params of an approval as `approval/requested` and `approval/request` carry them. */
function approvalParams(sessionId: string, sourceIndex = 1): Record<string, unknown> {
  return {
    sessionId,
    approvalId: 'a1',
    itemId: 'call-1',
    toolName: 'shell',
    rawArgs: '{"command":"ls"}',
    currentRequirementId: { approvalId: 'a1', sourceIndex },
    subject: { kind: 'command', command: 'ls' },
    availableChoices: [
      { choiceId: 'allow_once', decision: 'approved', label: 'Allow', scope: 'once' },
    ],
    judgeEscalated: false,
    protectedWrite: false,
    turnId: 'turn-1',
    toolCallId: 'tc-1',
    taskId: 'task-1',
    sourceRange: {},
    viewCursor: 'v1',
  }
}

function questionParams(sessionId: string): Record<string, unknown> {
  return {
    sessionId,
    userInputId: 'u1',
    itemId: 'call-2',
    questions: [
      {
        id: 'colour',
        header: 'Colour',
        question: 'Which colour?',
        options: [{ label: 'Red' }],
        selection: { mode: 'single' },
      },
    ],
    toolCallId: 'tc-2',
    toolName: 'request_user_input',
    turnId: 'turn-1',
    viewCursor: 'v2',
  }
}

function envelope(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    session: {
      sessionId,
      createdAt: '2026-09-23T00:00:00Z',
      updatedAt: '2026-09-23T00:00:00Z',
      status: 'running',
      turnCount: 1,
      activeTurnId: 'turn-9',
    },
    history: { mode: 'inline', items: [] },
    viewCursor: 'v0',
    pendingRequests: [],
    ...extra,
  }
}

describe('MuseCodeHost: prompts, receipts and resume (D26)', () => {
  it('answers a mirrored prompt with the receipt and shows it once with its notification', async () => {
    const { host, server } = setup()
    const { session, events } = await listeningSession(host)
    server.notify('approval/requested', approvalParams(session.sessionId))
    const approvalRequest = server.serverRequest(
      'approval/request',
      approvalParams(session.sessionId),
    )
    const questionRequest = server.serverRequest(
      'userInput/request',
      questionParams(session.sessionId),
    )
    server.notify('userInput/requested', questionParams(session.sessionId))
    await settle()
    expect(events.map((event) => event.type)).toEqual(['approvalRequested', 'questionRequested'])
    expect(server.clientResponses).toEqual([
      { jsonrpc: '2.0', id: approvalRequest, result: {} },
      { jsonrpc: '2.0', id: questionRequest, result: {} },
    ])
  })

  it('shows the prompts a resume re-issues in the same read as its answer', async () => {
    const { host, server } = setup()
    server.handle('session/resume', (params) => envelope(String(params['sessionId'])))
    server.followWith('session/resume', (params) => [
      server.serverRequestFrame('approval/request', approvalParams(String(params['sessionId']))),
      {
        jsonrpc: '2.0',
        method: 'item/delta',
        params: { sessionId: params['sessionId'], itemId: 'i1', delta: 'still ', viewCursor: 'v' },
      },
    ])
    const loaded = await host.resumeSession('s-old', 'muse-spark-1.3')
    await settle()
    const events: AgentEvent[] = []
    loaded.session.onEvent((event) => {
      events.push(event)
    })
    expect(events.map((event) => event.type)).toEqual(['approvalRequested', 'textDelta'])
    expect(loaded.activeTurnId).toBe('turn-9')
    expect(server.clientResponses).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }])
  })

  it('pulls the pending prompts a resume names and shows each once', async () => {
    const { host, server } = setup()
    server.handle('session/resume', (params) =>
      envelope(String(params['sessionId']), {
        pendingRequests: [
          { kind: 'approval', approvalId: 'a1', viewCursor: 'v1' },
          { kind: 'userInput', userInputId: 'u1', viewCursor: 'v2' },
        ],
      }),
    )
    server.handle('approval/listPending', (params) => ({
      approvals: [approvalParams(String(params['sessionId']))],
      userInputs: [questionParams(String(params['sessionId']))],
    }))
    const loaded = await host.resumeSession('s-old', 'muse-spark-1.3')
    server.serverRequest('approval/request', approvalParams('s-old'))
    await settle()
    const events: AgentEvent[] = []
    loaded.session.onEvent((event) => {
      events.push(event)
    })
    expect(server.requestsFor('approval/listPending')[0]?.params).toMatchObject({
      sessionId: 's-old',
    })
    expect(events.map((event) => event.type)).toEqual(['approvalRequested', 'questionRequested'])
  })

  it('does not pull pending prompts when the resume names none, and survives a failed pull', async () => {
    const { host, server, log } = setup()
    server.handle('session/resume', (params) => envelope(String(params['sessionId'])))
    await host.resumeSession('s-old', 'muse-spark-1.3')
    expect(server.requestsFor('approval/listPending')).toHaveLength(0)
    server.handle('session/resume', (params) =>
      envelope(String(params['sessionId']), {
        pendingRequests: [{ kind: 'approval', approvalId: 'a1', viewCursor: 'v1' }],
      }),
    )
    await expect(host.resumeSession('s-two', 'muse-spark-1.3')).resolves.toBeDefined()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('approval/listPending'))
  })

  it('refuses a server request it cannot present: an unknown method or session', async () => {
    const { server, log } = setup()
    const unknownMethod = server.serverRequest('session/somethingNew', {})
    const ghost = server.serverRequest('approval/request', approvalParams('ghost'))
    await settle()
    expect(server.clientResponses).toEqual([
      expect.objectContaining({
        id: unknownMethod,
        error: expect.objectContaining({ code: -32_601 }),
      }),
      expect.objectContaining({ id: ghost, error: expect.anything() }),
    ])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('session/somethingNew'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('unknown session ghost'))
  })

  it('refreshes the card for a re-issued next stage and ignores the stages after a terminal decide', async () => {
    const { host, server } = setup()
    server.handle('approval/decide', (params) => ({
      ...ack(params),
      approvalId: params['approvalId'],
      terminal: true,
    }))
    const { session, events } = await listeningSession(host)
    server.notify('approval/requested', approvalParams(session.sessionId, 1))
    server.serverRequest('approval/request', approvalParams(session.sessionId, 2))
    await settle()
    expect(events.map((event) => event.type)).toEqual(['approvalRequested', 'approvalUpdated'])
    await session.decideApproval({
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 2 },
    })
    const { turnId: _turn, taskId: _task, ...update } = approvalParams(session.sessionId, 3)
    server.notify('approval/updated', { ...update, change: { kind: 'stageResolved' } })
    server.notify('approval/resolved', {
      sessionId: session.sessionId,
      approvalId: 'a1',
      itemId: 'call-1',
      decision: 'approved',
      resolvedBy: 'user',
    })
    await settle()
    expect(events.map((event) => event.type)).toEqual([
      'approvalRequested',
      'approvalUpdated',
      'approvalResolved',
    ])
  })

  it('drops an update for an approval the host says is already terminal', async () => {
    const { host, server } = setup()
    const { session, events } = await listeningSession(host)
    server.notify('approval/requested', approvalParams(session.sessionId, 1))
    server.notify('approval/updated', {
      ...approvalParams(session.sessionId, 2),
      change: { kind: 'alreadyTerminal' },
    })
    server.notify('approval/updated', {
      ...approvalParams(session.sessionId, 3),
      change: { kind: 'stageResolved' },
    })
    await settle()
    expect(events.map((event) => event.type)).toEqual(['approvalRequested'])
  })

  it('shows a second surface the prompts still open', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    session.onEvent(() => undefined)
    server.notify('approval/requested', approvalParams(session.sessionId, 1))
    server.notify('approval/updated', {
      ...approvalParams(session.sessionId, 2),
      change: { kind: 'stageResolved' },
    })
    server.notify('userInput/requested', questionParams(session.sessionId))
    server.notify('userInput/settled', {
      sessionId: session.sessionId,
      userInputId: 'u1',
      outcome: 'answered',
      answers: [],
    })
    await settle()
    const late: AgentEvent[] = []
    session.onEvent((event) => {
      late.push(event)
    })
    expect(late).toEqual([
      expect.objectContaining({
        type: 'approvalRequested',
        approvalId: 'a1',
        requirementId: { approvalId: 'a1', sourceIndex: 2 },
      }),
    ])
  })

  it('reports a decision or answer that arrived late as PromptSettledError', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    const decision = {
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
    }
    const cases: readonly (readonly [string, string])[] = [
      ['approvalAlreadyResolved', 'alreadySettled'],
      ['approvalRequirementStale', 'movedOn'],
      ['approvalNotFound', 'gone'],
    ]
    for (const [kind, reason] of cases) {
      server.handle('approval/decide', refusalOf(kind))
      await expect(session.decideApproval(decision)).rejects.toMatchObject({
        name: 'PromptSettledError',
        reason,
      })
    }
    server.handle('userInput/answer', refusalOf('userInputAlreadySettled'))
    await expect(session.answerQuestions('u1', [])).rejects.toMatchObject({
      reason: 'alreadySettled',
    })
    server.handle('userInput/cancel', refusalOf('userInputNotFound'))
    await expect(session.cancelQuestions('u1')).rejects.toMatchObject({ reason: 'gone' })
    server.handle('approval/decide', refusalOf('commandRejected'))
    await expect(session.decideApproval(decision)).rejects.not.toMatchObject({
      name: 'PromptSettledError',
    })
  })

  it('maps withdrawn turns, delivery gaps and an unserved model route', async () => {
    const { host, server } = setup()
    const { session, events } = await listeningSession(host)
    server.notify('turn/unqueued', { sessionId: session.sessionId, turnId: 't2', commandId: 'c' })
    server.notify('view/gap', { sessionId: session.sessionId, after: 'v1', next: 'v5' })
    server.notify('session/modelRouteUnserved', {
      sessionId: session.sessionId,
      modelId: 'muse-spark-1.3',
      installedProviderId: 'p',
      commandId: 'c',
    })
    server.notify('turn/retracted', { sessionId: session.sessionId, turnId: 't3', commandId: 'c' })
    await settle()
    expect(events).toEqual([
      { type: 'turnWithdrawn', turnId: 't2', reason: UI_TEXT.turnUnqueued },
      { type: 'viewGap' },
      {
        type: 'backendNotice',
        level: 'warning',
        text: `${UI_TEXT.modelRouteUnserved} (muse-spark-1.3)`,
      },
      { type: 'backendNotice', level: 'info', text: UI_TEXT.turnRetracted },
    ])
  })

  it('logs an unshown or malformed notification once per method', async () => {
    const { host, server, log } = setup()
    const session = await host.startSession(startOptions)
    server.notify('goal/changed', { sessionId: session.sessionId })
    server.notify('goal/changed', { sessionId: session.sessionId })
    server.notify('turn/started', { sessionId: session.sessionId })
    server.notify('turn/started', { sessionId: session.sessionId })
    await settle()
    expect(
      log.info.mock.calls.filter(([line]) => String(line).includes('goal/changed')),
    ).toHaveLength(1)
    expect(
      log.warn.mock.calls.filter(([line]) => String(line).includes('turn/started')),
    ).toHaveLength(1)
  })

  it('logs a protocol error by kind, never its frame', async () => {
    const { server, log } = setup()
    server.incoming.push('{"secret": not json}\n')
    await settle()
    expect(log.warn).toHaveBeenCalledWith('MSP protocol error: inbound frame is not valid JSON')
  })

  it('refuses a command too large for the frame cap before sending it', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    const huge = 'x'.repeat(MSP_FRAME_LIMIT_BYTES)
    await expect(session.sendTurn([{ type: 'text', text: huge }])).rejects.toThrow(
      UI_TEXT.commandTooLarge,
    )
    expect(server.requestsFor('turn/start')).toHaveLength(0)
  })

  it('clamps a session/list page to the host maximum', async () => {
    const { host, server } = setup()
    server.handle('session/list', () => ({ sessions: [], nextCursor: null }))
    await host.listSessions({ workspaceRoot: '/ws', limit: 500 })
    expect(server.requestsFor('session/list')[0]?.params).toMatchObject({ limit: 200 })
  })

  it('decodes a base64 page that is text and refuses one that is binary', async () => {
    const { host, server } = setup()
    const session = await host.startSession(startOptions)
    const serve = (bytes: Buffer) => () => ({
      content: bytes.toString('base64'),
      encoding: 'base64',
      mediaType: 'application/octet-stream',
      offsetBytes: 0,
      byteLen: bytes.length,
      eof: true,
    })
    const request = { itemId: 'c', outputRef: 'o', offsetBytes: 0, lengthBytes: 64 }
    server.handle('item/readOutput', serve(Buffer.from('héllo', 'utf8')))
    await expect(session.readOutput(request)).resolves.toMatchObject({
      content: 'héllo',
      encoding: 'utf8',
    })
    server.handle('item/readOutput', serve(Buffer.from([0xff, 0xfe, 0x00])))
    await expect(session.readOutput(request)).rejects.toThrow(UI_TEXT.outputIsBinary)
  })
})

/** A host whose handshake names this platform and version, with ephemeral sessions. */
function hostOn(platformOs: string, version: string) {
  const handle = fakeMspHost({
    ...fakeInitializeResult,
    platformOs,
    serverInfo: { name: 'muse', version },
    sessionDurability: 'ephemeral',
  })
  const log = new FakeLogOutputChannel()
  return { ...handle, log, host: new MuseCodeHost(handle.host, log) }
}

describe('MuseCodeHost: the handshake facts (D26)', () => {
  it('offers rename and fork except on Windows up to 1.3.0, and says so before forking', async () => {
    expect(hostOn('windows', '1.3.0-R3401.1').host.info.canEditSessions).toBe(false)
    expect(hostOn('windows', '1.4.0').host.info.canEditSessions).toBe(true)
    expect(hostOn('linux', '1.3.0').host.info.canEditSessions).toBe(true)
    const { host, server } = hostOn('windows', '1.3.0')
    await expect(host.forkSession('s1', 'muse-spark-1.3')).rejects.toThrow(
      UI_TEXT.sessionEditsUnsupported,
    )
    expect(server.requestsFor('session/fork')).toHaveLength(0)
  })

  it('logs the platform, the schema and non-durable sessions', () => {
    const { log } = hostOn('macos', '1.3.0')
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('MSP host on macos'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ephemeral sessions'))
  })
})

/**
 * The shared `goal/*` ack as `muse serve` answered it (live 2026-09-25): an
 * idle set or resume names the turn it woke, a pause never names one (M45).
 */
function goalAck(turnId?: string) {
  return (params: Record<string, unknown>) => ({
    commandId: params['commandId'],
    status: 'accepted',
    ...(turnId !== undefined && { turnId }),
  })
}

function resumedGoalSession(sessionId: string) {
  return {
    sessionId,
    status: 'idle',
    activeTurnId: null,
    createdAt: '2026-09-25T19:06:18Z',
    updatedAt: '2026-09-25T19:06:39Z',
    turnCount: 1,
  }
}

describe('MuseCodeHost: the session goal (M45)', () => {
  it('sends each verb as goal/<verb>, the objective only with set and edit', async () => {
    const { host, server } = setup()
    const { session } = await listeningSession(host)
    server.handle('goal/set', goalAck('turn-goal'))
    server.handle('goal/edit', goalAck())
    server.handle('goal/pause', goalAck())
    server.handle('goal/resume', goalAck('turn-goal-2'))
    server.handle('goal/clear', goalAck())
    await expect(session.controlGoal({ verb: 'set', objective: 'Ship it' })).resolves.toEqual({
      turnId: 'turn-goal',
    })
    await expect(session.controlGoal({ verb: 'edit', objective: 'Ship it now' })).resolves.toEqual({
      turnId: undefined,
    })
    await session.controlGoal({ verb: 'pause' })
    await expect(session.controlGoal({ verb: 'resume' })).resolves.toEqual({
      turnId: 'turn-goal-2',
    })
    await session.controlGoal({ verb: 'clear' })
    expect(server.requestsFor('goal/set')[0]?.params).toMatchObject({
      sessionId: session.sessionId,
      objective: 'Ship it',
    })
    expect(server.requestsFor('goal/edit')[0]?.params).toMatchObject({ objective: 'Ship it now' })
    // A bare verb with an objective is `invalidParams` on the wire (live).
    for (const verb of ['goal/pause', 'goal/resume', 'goal/clear']) {
      expect(server.requestsFor(verb)[0]?.params, verb).not.toHaveProperty('objective')
      expect(server.requestsFor(verb)[0]?.params, verb).toHaveProperty('commandId')
    }
  })

  it('turns the captured refusals into GoalRefusedError, anything else as it came', async () => {
    const { host, server } = setup()
    const { session } = await listeningSession(host)
    server.handle('goal/pause', goalRefusal('missing_goal'))
    server.handle('goal/resume', goalRefusal('invalid_goal_state'))
    server.handle('goal/clear', refusalOf('commandRejected', -32_030, 'session_busy'))
    server.handle('goal/set', refusalOf('invalidParams', -32_602))
    await expect(session.controlGoal({ verb: 'pause' })).rejects.toMatchObject({
      name: 'GoalRefusedError',
      refusal: 'noGoal',
    })
    await expect(session.controlGoal({ verb: 'resume' })).rejects.toBeInstanceOf(GoalRefusedError)
    await expect(session.controlGoal({ verb: 'resume' })).rejects.toMatchObject({
      refusal: 'wrongState',
    })
    // Another reason is not a goal refusal: it comes as MSP sent it.
    await expect(session.controlGoal({ verb: 'clear' })).rejects.toMatchObject({
      name: 'MspError',
      kind: 'commandRejected',
    })
    await expect(session.controlGoal({ verb: 'set', objective: 'x' })).rejects.toMatchObject({
      kind: 'invalidParams',
    })
  })

  it('resumes asking for a snapshot, whose goal and task list come with the history', async () => {
    const { host, server } = setup()
    server.handle('session/resume', (params) => ({
      session: resumedGoalSession(String(params['sessionId'])),
      history: {
        mode: 'snapshot',
        items: null,
        snapshot: {
          schemaVersion: 1,
          viewCursor: 'v:old:14',
          state: {
            items: [],
            goal: {
              objective: 'Reply with the single word hello',
              status: 'paused',
              percentComplete: 0,
            },
            todoList: { items: [{ text: 'Say hello', status: 'pending' }] },
            name: null,
          },
        },
      },
      pendingRequests: [],
      viewCursor: 'v:old:14',
    }))
    const loaded = await host.resumeSession('old', 'muse-spark-1.3')
    expect(server.requestsFor('session/resume')[0]?.params).toMatchObject({ history: 'snapshot' })
    expect(loaded.history.goal).toEqual({
      objective: 'Reply with the single word hello',
      status: 'paused',
      percentComplete: 0,
    })
    // Inline history carried no task list, so a resume lost it before M45.
    expect(loaded.history.todos).toEqual([{ text: 'Say hello', status: 'pending' }])
    expect(server.requestsFor('view/page')).toHaveLength(0)
  })

  it('recovers the goal when a resume downgrades from snapshot to inline', async () => {
    const { host, server } = setup()
    server.handle('session/resume', (params) => ({
      session: resumedGoalSession(String(params['sessionId'])),
      history: { mode: 'inline', items: [], snapshot: null },
      pendingRequests: [],
      viewCursor: 'v:old:14',
    }))
    server.handle('view/page', () => ({
      events: [
        {
          method: 'session/goalChanged',
          params: {
            sessionId: 'old',
            viewCursor: 'v:old:14',
            sourceRange: {
              stream: { kind: 'session', id: 'old' },
              first: { id: 'goal', sequence: 14 },
              last: { id: 'goal', sequence: 14 },
            },
            goal: { objective: 'Ship it', status: 'paused', percentComplete: 25 },
          },
        },
      ],
      nextCursor: null,
    }))
    const loaded = await host.resumeSession('old', 'muse-spark-1.3')
    expect(loaded.history.goal).toEqual({
      objective: 'Ship it',
      status: 'paused',
      percentComplete: 25,
    })
    expect(server.requestsFor('view/page')).toHaveLength(1)
  })

  it('routes session/goalChanged to the session as goalChanged', async () => {
    const { host, server } = setup()
    const { session, events } = await listeningSession(host)
    server.notify('session/goalChanged', {
      sessionId: session.sessionId,
      viewCursor: 'v:1',
      goal: { objective: 'Ship it', status: 'active', percentComplete: 0 },
    })
    server.notify('session/goalChanged', { sessionId: session.sessionId, goal: null })
    await settle()
    expect(events).toEqual([
      {
        type: 'goalChanged',
        goal: { objective: 'Ship it', status: 'active', percentComplete: 0 },
      },
      { type: 'goalChanged', goal: null },
    ])
  })
})

describe('MuseSession: background work, `!` commands, explanations (M46)', () => {
  it('runs a `!` command with session/userShell once the host granted it', async () => {
    const t = setup({ grantedCapabilities: ['userShell'] })
    t.server.handle('session/userShell', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    const session = await t.host.startSession(startOptions)
    await session.runUserShell("Write-Output 'hello-m46'")
    expect(t.server.requestsFor('session/userShell')[0]?.params).toMatchObject({
      sessionId: 'session-for-muse-spark-1.3',
      commandText: "Write-Output 'hello-m46'",
    })
  })

  it('refuses a `!` command the host did not grant, sending nothing', async () => {
    const t = setup()
    const session = await t.host.startSession(startOptions)
    await expect(session.runUserShell('ls')).rejects.toThrow(UI_TEXT.userShellNotGranted)
    expect(t.server.requestsFor('session/userShell')).toHaveLength(0)
  })

  it('moves a task to the background and stops one or all, by the row’s id', async () => {
    const t = setup()
    t.server.handle('task/background', taskAck)
    t.server.handle('task/stop', taskAck)
    t.server.handle('task/stopAll', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    const session = await t.host.startSession(startOptions)
    const taskId = SHELL_CALL_STARTED.item.itemId
    await session.moveToBackground(taskId)
    await session.stopTask(taskId)
    await session.stopAllTasks()
    expect(t.server.requestsFor('task/background')[0]?.params).toMatchObject({ taskId })
    expect(t.server.requestsFor('task/stop')[0]?.params).toMatchObject({ taskId })
    expect(t.server.requestsFor('task/stopAll')[0]?.params).toMatchObject({
      sessionId: 'session-for-muse-spark-1.3',
    })
  })

  it('says a task that is gone is not running any more (`invalid_target`)', async () => {
    const t = setup()
    const refused = refusalOf(INVALID_TARGET.kind, INVALID_TARGET.code, INVALID_TARGET.data)
    t.server.handle('task/background', refused)
    t.server.handle('task/stop', refused)
    const session = await t.host.startSession(startOptions)
    await expect(session.moveToBackground('gone')).rejects.toThrow(UI_TEXT.taskNotRunning)
    await expect(session.stopTask('gone')).rejects.toThrow(UI_TEXT.taskNotRunning)
    // Any other refusal is passed on as it came.
    t.server.handle('task/stop', refusalOf('invalidParams', -32_602))
    await expect(session.stopTask('not-a-uuid')).rejects.toThrow('refused: invalidParams')
  })

  it('explains instead of answering with userInput/clarify; a late one is settled', async () => {
    const t = setup()
    t.server.handle('userInput/clarify', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
      userInputId: params['userInputId'],
    }))
    const session = await t.host.startSession(startOptions)
    await session.clarifyQuestions(QUESTION_CLARIFIED.userInputId, 'I prefer green.')
    expect(t.server.requestsFor('userInput/clarify')[0]?.params).toMatchObject({
      userInputId: QUESTION_CLARIFIED.userInputId,
      clarification: { format: 'text', content: 'I prefer green.' },
    })
    t.server.handle('userInput/clarify', refusalOf('userInputAlreadySettled'))
    await expect(session.clarifyQuestions('q1', 'late')).rejects.toMatchObject({
      name: 'PromptSettledError',
      reason: 'alreadySettled',
    })
  })
})
