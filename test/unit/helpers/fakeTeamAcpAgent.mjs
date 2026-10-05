// A scriptable ACP agent for lane W's tests (M96): it speaks JSON-RPC over
// stdio like a real agent process, so the SDK adapter, the policy handlers
// and the runner are all real. Received requests are recorded on stderr as
// `RECORD {...}` lines; scenarios drive permission, fs, cancel and auth.
//
// Usage: node fakeTeamAcpAgent.mjs <scenario> [--cwd <dir>]
// Scenarios: report, permission-inside, permission-outside, fs, slow, auth,
// modes-legacy (no session/set_config_option).

import { RequestError } from '@agentclientprotocol/sdk'
import { createInterface } from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'

const scenario = process.argv[2]
const rest = process.argv.slice(3)
const cwdIndex = rest.indexOf('--cwd')
const cwd = cwdIndex === -1 ? '/work/copy' : rest[cwdIndex + 1]

function record(entry) {
  process.stderr.write(`RECORD ${JSON.stringify(entry)}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } })
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

const agentState = { nextId: 1, model: 'fake-default', mode: 'default' }
const pending = new Map()
const promptTimers = new Map()

function agentRequest(method, params) {
  const id = `agent-${agentState.nextId}`
  agentState.nextId += 1
  return new Promise((resolve) => {
    pending.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function chunk(sessionId, text) {
  notify('session/update', {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  })
}

function finishPrompt(id, sessionId, text) {
  chunk(sessionId, text)
  respond(id, { stopReason: 'end_turn' })
}

const MODES = {
  currentModeId: 'default',
  availableModes: [
    { id: 'default', name: 'Default' },
    { id: 'plan', name: 'Plan' },
  ],
}

function configOptions() {
  const model = {
    id: 'fake-model-selector',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: agentState.model,
    options: [
      { value: 'fake-default', name: 'Default' },
      { value: 'explicit-selected-model', name: 'Selected' },
    ],
  }
  const mode = {
    id: 'fake-mode-selector',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: agentState.mode,
    options: MODES.availableModes.map((entry) => ({ value: entry.id, name: entry.name })),
  }
  return scenario === 'model-missing' ? [mode] : [mode, model]
}

async function onPrompt(id, params) {
  const sessionId = params.sessionId
  if (scenario === 'slow') {
    const timer = setTimeout(() => {
      promptTimers.delete(sessionId)
      respond(id, { stopReason: 'end_turn' })
    }, 30_000)
    promptTimers.set(sessionId, { id, timer })
    return
  }
  if (scenario === 'permission-inside' || scenario === 'permission-outside') {
    const target = scenario === 'permission-inside' ? `${cwd}/docs/a.md` : '/etc/passwd'
    const answer = await agentRequest('session/request_permission', {
      sessionId,
      toolCall: {
        toolCallId: 'tc-1',
        title: 'Edit a file',
        kind: 'edit',
        locations: [{ path: target }],
        rawInput: {},
      },
      options: [
        { optionId: 'yes-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'yes-always', name: 'Allow always', kind: 'allow_always' },
        { optionId: 'no-once', name: 'Reject', kind: 'reject_once' },
      ],
    })
    record({ permissionAnswer: answer })
    finishPrompt(id, sessionId, 'done after the permission round')
    return
  }
  if (scenario === 'fs') {
    const read = await agentRequest('fs/read_text_file', { sessionId, path: `${cwd}/a.ts` })
    record({ fsRead: read })
    const write = await agentRequest('fs/write_text_file', {
      sessionId,
      path: '/etc/outside.txt',
      content: 'x',
    })
    record({
      fsWrite:
        write !== null && typeof write === 'object' && 'outcomeError' in write
          ? { fsError: write.outcomeError?.message ?? String(write.outcomeError) }
          : write,
    })
    finishPrompt(id, sessionId, 'done after the fs round')
    return
  }
  finishPrompt(
    id,
    sessionId,
    'All green.\n```muse-team-report\n{"status":"done","summary":"Fake work."}\n```',
  )
}

async function onRequest(message) {
  const { id, method, params } = message
  record({ method, params, ...(id !== undefined && { id }) })
  switch (method) {
    case 'initialize': {
      respond(id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
      break
    }
    case 'session/new': {
      if (scenario === 'auth') {
        send({ jsonrpc: '2.0', id, ...RequestError.authRequired().toResult() })
        break
      }
      respond(id, { sessionId: 'fake-s1', modes: MODES, configOptions: configOptions() })
      break
    }
    case 'session/set_config_option': {
      if (scenario === 'modes-legacy') {
        fail(id, -32_601, 'Method not found')
        break
      }
      if (params.configId === 'fake-mode-selector')
        agentState.mode = scenario === 'mode-ignored' ? 'plan' : params.value
      if (scenario !== 'model-ignored' && params.configId === 'fake-model-selector')
        agentState.model = params.value
      respond(id, { configOptions: configOptions() })
      break
    }
    case 'session/set_mode': {
      agentState.mode = params.modeId
      respond(id, {})
      break
    }
    case 'session/prompt': {
      await onPrompt(id, params)
      break
    }
    case 'session/cancel': {
      const held = promptTimers.get(params.sessionId)
      if (held !== undefined) {
        clearTimeout(held.timer)
        promptTimers.delete(params.sessionId)
        respond(held.id, { stopReason: 'cancelled' })
      }
      if (id !== undefined) respond(id, {})
      break
    }
    default: {
      fail(id, -32_601, 'Method not found')
    }
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  if (line.trim() === '') {
    return
  }
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === undefined) {
    const resolve = pending.get(message.id)
    if (resolve === undefined) {
      return
    }
    pending.delete(message.id)
    if (message.error === undefined) {
      resolve(message.result)
    } else {
      resolve({ outcomeError: message.error })
    }
    return
  }
  void onRequest(message)
})
