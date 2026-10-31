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
//   die          the process ends when the first prompt arrives
//   mcp          opens the `team` MCP server it was given in session/new —
//                over HTTP, or by spawning the stdio command as a real agent
//                does — and reports its instructions, tools and roster
// FIXTURE_HTTP=1 advertises HTTP MCP transport; anything else does not.

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { Readable } from 'node:stream'
import { agent as acpAgent, ndJsonStream, RequestError } from '@agentclientprotocol/sdk/unstable'

const recordPath = process.env.FIXTURE_RECORD
const mode = process.env.FIXTURE_MODE ?? 'default'
const isHttp = process.env.FIXTURE_HTTP === '1'

function record(kind, data) {
  if (recordPath !== undefined) appendFileSync(recordPath, `${JSON.stringify({ kind, ...data })}\n`)
}

const JSON_RPC = '2.0'
const MCP_PROTOCOL = '2025-03-26'

// One MCP client over the server exactly as session/new described it.
function openMcp(server) {
  if (server.type === 'http') {
    const headers = Object.fromEntries(server.headers.map((row) => [row.name, row.value]))
    return {
      send: async (body) => {
        const response = await fetch(server.url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        })
        const text = await response.text()
        return text === '' ? undefined : JSON.parse(text)
      },
      close: () => undefined,
    }
  }
  const env = {
    ...process.env,
    ...Object.fromEntries(server.env.map((row) => [row.name, row.value])),
  }
  const child = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiters = new Map()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const parsed = JSON.parse(line)
    waiters.get(parsed.id)?.(parsed)
  })
  return {
    send: (body) =>
      new Promise((resolveSend) => {
        if (body.id === undefined) {
          child.stdin.write(`${JSON.stringify(body)}\n`, () => resolveSend(undefined))
          return
        }
        waiters.set(body.id, resolveSend)
        child.stdin.write(`${JSON.stringify(body)}\n`)
      }),
    close: () => child.kill(),
  }
}

async function readTeam(server) {
  const mcp = openMcp(server)
  try {
    const initialized = await mcp.send({
      jsonrpc: JSON_RPC,
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'fixture-agent' },
      },
    })
    await mcp.send({ jsonrpc: JSON_RPC, method: 'notifications/initialized' })
    const listed = await mcp.send({ jsonrpc: JSON_RPC, id: 2, method: 'tools/list' })
    const roster = await mcp.send({
      jsonrpc: JSON_RPC,
      id: 3,
      method: 'tools/call',
      params: { name: 'roster', arguments: {} },
    })
    return {
      transport: server.type === 'http' ? 'http' : 'stdio',
      instructions: initialized.result.instructions,
      tools: listed.result.tools.map((tool) => tool.name),
      roster: roster.result.content[0].text,
    }
  } finally {
    mcp.close()
  }
}

const MODELS = ['m1', 'm2']
const state = {
  model: 'm1',
  mode: 'default',
  isAuthenticated: false,
  cancel: undefined,
  mcpServers: [],
}

function authMethods() {
  if (mode === 'auth-terminal')
    return [{ id: 'terminal-sign-in', name: 'Sign in', type: 'terminal' }]
  return mode === 'auth-agent' ? [{ id: 'agent-sign-in', name: 'Sign in' }] : []
}

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
    authMethods: authMethods(),
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
    state.mcpServers = context.params.mcpServers
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
    if (mode === 'die') {
      record('die', {})
      process.exit(3)
    }
    if (mode === 'slow') {
      const waiting = Promise.withResolvers()
      state.cancel = waiting.resolve
      await waiting.promise
      return { stopReason: 'cancelled' }
    }
    if (mode === 'mcp') {
      const team = state.mcpServers.find((server) => server.name === 'team')
      const seen = team === undefined ? { missing: true } : await readTeam(team)
      record('team-read', seen)
      await chunk(context.client, sessionId, 'agent_message_chunk', JSON.stringify(seen), 'mcp1')
      return { stopReason: 'end_turn' }
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
