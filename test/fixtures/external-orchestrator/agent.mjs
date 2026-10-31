// A real ACP agent process for the external-orchestrator suites (D250):
// the pinned SDK's own agent builder over real stdio, with a scripted turn
// instead of a model. It is the outside world the host speaks to — every
// byte it sends is a real ACP frame the SDK validates, and everything it
// observes (session/new params, config sets, authenticate, the permission
// answer, session/cancel) is recorded as JSON lines to FIXTURE_RECORD for
// the suite to assert. Behaviour is chosen by FIXTURE_MODE:
//   default      one streaming turn: thought, message, tool call, plan, usage
//   permission   asks session/request_permission, then reports the answer
//   slow         waits for session/cancel before ending its turn
//   auth-terminal session/new refuses with auth_required (terminal method)
//   auth-agent   the first prompt refuses until authenticate() runs
// FIXTURE_HTTP=1 advertises HTTP MCP transport; anything else does not.

import { appendFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import { Readable } from 'node:stream'
import { agent as acpAgent, ndJsonStream, RequestError } from '@agentclientprotocol/sdk/unstable'

const recordPath = process.env.FIXTURE_RECORD
const mode = process.env.FIXTURE_MODE ?? 'default'
const isHttp = process.env.FIXTURE_HTTP === '1'

function record(kind, data) {
  if (recordPath !== undefined) appendFileSync(recordPath, `${JSON.stringify({ kind, ...data })}\n`)
}

const MODELS = ['m1', 'm2']
const state = { model: 'm1', mode: 'default', isAuthenticated: false, cancel: undefined }

function configOptions() {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: state.model,
      options: MODELS.map((value) => ({ value, name: value.toUpperCase() })),
    },
    {
      id: 'effort',
      name: 'Effort',
      category: 'effort',
      type: 'select',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    },
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: state.mode,
      options: [
        { value: 'default', name: 'Default' },
        { value: 'plan', name: 'Plan' },
      ],
    },
  ]
}

function modes() {
  return {
    currentModeId: state.mode,
    availableModes: [
      { id: 'default', name: 'Default' },
      { id: 'plan', name: 'Plan' },
    ],
  }
}

function chunk(client, sessionId, sessionUpdate, text, messageId) {
  return client.notify('session/update', {
    sessionId,
    update: { sessionUpdate, content: { type: 'text', text }, messageId },
  })
}

const app = acpAgent({ name: 'fixture-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      mcpCapabilities: { http: isHttp, sse: false },
      promptCapabilities: { embeddedContext: true, image: true },
    },
    agentInfo: { name: 'fixture-agent', version: '1' },
    authMethods:
      mode === 'auth-terminal'
        ? [{ id: 'terminal-sign-in', name: 'Sign in', type: 'terminal' }]
        : mode === 'auth-agent'
          ? [{ id: 'agent-sign-in', name: 'Sign in' }]
          : [],
  }))
  .onRequest('authenticate', (context) => {
    record('authenticate', { methodId: context.params.methodId })
    state.isAuthenticated = true
    return {}
  })
  .onRequest('session/new', (context) => {
    record('session/new', {
      cwd: context.params.cwd,
      mcpServers: context.params.mcpServers,
    })
    if (mode === 'auth-terminal') throw RequestError.authRequired()
    return { sessionId: 'fixture-session', modes: modes(), configOptions: configOptions() }
  })
  .onRequest('session/load', async (context) => {
    record('session/load', { sessionId: context.params.sessionId })
    await chunk(context.client, context.params.sessionId, 'user_message_chunk', 'earlier ask', 'u1')
    await chunk(
      context.client,
      context.params.sessionId,
      'agent_message_chunk',
      'earlier answer',
      'a1',
    )
    return { modes: modes(), configOptions: configOptions() }
  })
  .onRequest('session/set_config_option', (context) => {
    const { configId, value } = context.params
    record('session/set_config_option', { configId, value })
    if (configId === 'model') state.model = String(value)
    else if (configId === 'mode') state.mode = String(value)
    return { configOptions: configOptions() }
  })
  .onNotification('session/cancel', () => {
    record('session/cancel', {})
    state.cancel?.()
  })
  .onRequest('session/prompt', async (context) => {
    const { sessionId, prompt } = context.params
    record('session/prompt', { blocks: prompt })
    if (mode === 'auth-agent' && !state.isAuthenticated) throw RequestError.authRequired()
    if (mode === 'slow') {
      const waiting = Promise.withResolvers()
      state.cancel = waiting.resolve
      await waiting.promise
      return { stopReason: 'cancelled' }
    }
    if (mode === 'permission') {
      const answer = await context.client.request('session/request_permission', {
        sessionId,
        toolCall: {
          toolCallId: 'tc-1',
          title: 'Write file',
          kind: 'edit',
          status: 'pending',
          locations: [{ path: 'out.txt' }],
          rawInput: { path: 'out.txt' },
        },
        options: [
          { optionId: 'allow-1', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-1', name: 'Reject once', kind: 'reject_once' },
        ],
      })
      record('permission-answer', { outcome: answer.outcome })
      await chunk(context.client, sessionId, 'agent_message_chunk', 'permission settled', 'm9')
      return { stopReason: 'end_turn' }
    }
    await chunk(context.client, sessionId, 'agent_thought_chunk', 'thinking ', 't1')
    await chunk(context.client, sessionId, 'agent_message_chunk', 'Hello ', 'm1')
    await chunk(context.client, sessionId, 'agent_message_chunk', 'world', 'm1')
    await context.client.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'Read file',
        kind: 'read',
        status: 'in_progress',
        rawInput: { path: 'a.txt' },
      },
    })
    await context.client.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
      },
    })
    await context.client.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'step one', status: 'completed', priority: 'high' },
          { content: 'step two', status: 'in_progress', priority: 'medium' },
        ],
      },
    })
    await context.client.notify('session/update', {
      sessionId,
      update: { sessionUpdate: 'usage_update', used: 500, size: 1000 },
    })
    return { stopReason: 'end_turn' }
  })

const connection = app.connect(
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
await connection.closed
