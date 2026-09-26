#!/usr/bin/env node
// A fake Muse Code CLI for the process-level e2e tests (test/e2e): `muse
// serve` as the extension sees it, a JSON-RPC 2.0 NDJSON host over stdio
// speaking the Muse Session Protocol subset the extension uses (PLAN.md D11,
// shapes verified against Muse Code 1.3.0). It is deliberately small and
// scriptable through the prompt text, so a test can drive every path the
// panel has: a plain reply, a gated tool call (approval or refusal by mode),
// a cancelled turn, a host that dies mid-turn, and a malformed frame.
//
// Prompt scripts (the first text part of `turn/start`):
//   tool: <command>   a `powershell` tool call, gated by the approval mode
//   slow              a turn that waits for `turn/cancel`
//   die               exit 1 after `turn/started` (host-death drill)
//   malformed         an `item/delta` without its itemId, then a reply
//   subagents         two native subagents (running, then done) with child
//                     sessions readable through `session/read`
//   background: <cmd> a `powershell` call the host backgrounds (item/updated)
//   long: <cmd>       a `powershell` call that runs until `task/background`
//                     moves it (M46); `task/stop` then ends it
//   anything else     "echo: <text>" streamed in two deltas
//
// Environment: MUSE_FAKE_FINGERPRINT (the SDK's pinned schema fingerprint,
// so the handshake raises no warning), MUSE_FAKE_START=crash (exit 3 before
// the handshake, the spawn-failure drill) or =silent (read the handshake and
// never answer it, the wedged-CLI drill of PLAN.md D25). Node built-ins
// only: the file is copied beside the executable the resolver spawns.

import { argv, env, exit, stderr, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import { setImmediate } from 'node:timers'

const METHOD_NOT_FOUND = -32_601
const COMMAND_REJECTED = -32_000
const CRASH_EXIT_CODE = 3
const DIE_EXIT_CODE = 1
const ECHO_PREFIX = 'echo: '
const TOOL_PREFIX = 'tool:'
const BACKGROUND_PREFIX = 'background:'
const LONG_PREFIX = 'long:'
const SUBAGENTS = [
  { role: 'explorer', objective: 'Map the workspace layout' },
  { role: 'reviewer', objective: 'Review the change for dead code' },
]
const TOOL_NAME = 'powershell'
const MODEL_ID = 'muse-spark-1.3'
const CONTEXT_WINDOW = 1_007_997
const PROMPTING_MODES = new Set(['promptUnmatched', 'onRequest'])
const CHOICES = [
  { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once', acceptsFeedback: true },
]

if (env['MUSE_FAKE_START'] === 'crash') {
  stderr.write('fake muse: refusing to start\n')
  exit(CRASH_EXIT_CODE)
}

const serveArgs = argv.slice(2).join(' ')
const fingerprint = env['MUSE_FAKE_FINGERPRINT'] ?? 'sha256:fake'
/** sessionId → { record, items, approvalMode } */
const sessions = new Map()
const state = {
  clientName: 'unknown',
  usage: undefined,
  nextId: 0,
  /** The turn in flight, if any: { sessionId, turnId, onCancel } */
  running: undefined,
  /** The approval in flight, if any: { resolve } */
  pendingApproval: undefined,
  /** Long tool calls by item (M46): { sessionId, call, isBackground, onBackground } */
  tasks: new Map(),
}

function id(prefix) {
  state.nextId += 1
  return `${prefix}-${String(state.nextId)}`
}

function send(frame) {
  stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`)
}

function notify(method, params) {
  send({ method, params })
}

function now() {
  return new Date().toISOString()
}

function record(session) {
  return { ...session.record, updatedAt: now(), lastActivityAt: now() }
}

function item(session, fields) {
  const entry = { itemId: id('item'), status: 'completed', ...fields }
  session.items.push(entry)
  return entry
}

function emitItem(sessionId, entry) {
  notify('item/started', { sessionId, item: { ...entry, status: 'inProgress' } })
  notify('item/completed', { sessionId, item: entry })
}

function streamReply(session, turnId, text) {
  const entry = item(session, { kind: 'agentMessage', turnId, text })
  notify('item/started', {
    sessionId: session.record.sessionId,
    item: { ...entry, status: 'inProgress', text: '' },
  })
  const half = Math.ceil(text.length / 2)
  for (const delta of [text.slice(0, half), text.slice(half)]) {
    notify('item/delta', { sessionId: session.record.sessionId, itemId: entry.itemId, delta })
  }
  notify('item/completed', { sessionId: session.record.sessionId, item: entry })
}

function completeTurn(session, turnId, terminal, extra = {}) {
  const sessionId = session.record.sessionId
  session.record.turnCount += 1
  session.record.status = 'idle'
  session.record.activeTurnId = null
  // The live 1.3.0 shape: the completion's raw counters, its counted-once
  // totals, and the session's running totals (captured 2026-09-21).
  const turns = session.record.turnCount
  notify('session/tokenUsage', {
    sessionId,
    modelId: session.record.modelId,
    usage: { inputTokens: 120, outputTokens: 24, cachedTokens: 0, reasoningTokens: 0 },
    promptTokens: 120,
    totalTokens: 144,
    cumulative: { promptTokens: 120 * turns, outputTokens: 24 * turns, totalTokens: 144 * turns },
  })
  notify('session/contextUsage', {
    sessionId,
    usedTokens: 144,
    windowTokens: CONTEXT_WINDOW,
    pressure: 'none',
  })
  notify('turn/completed', { sessionId, turnId, terminal, durationMs: 12, ...extra })
  notify('session/statusChanged', { sessionId, status: 'idle' })
  notify('session/listChanged', { session: record(session) })
  state.usage = {
    observedAtMs: Date.now(),
    tier: '1',
    window: { usedPercent: 3, resetsAtMs: Date.now() + 3_600_000, windowDurationMins: 300 },
    weekly: { usedPercent: 1, resetsAtMs: Date.now() + 86_400_000 },
  }
  notify('usage/changed', state.usage)
  state.running = undefined
}

function awaitDecision() {
  return new Promise((resolve) => {
    state.pendingApproval = { resolve }
  })
}

async function runTool(session, turnId, command) {
  const sessionId = session.record.sessionId
  const call = {
    itemId: id('item'),
    kind: 'toolCall',
    status: 'inProgress',
    turnId,
    tool: TOOL_NAME,
    args: JSON.stringify({ command }),
  }
  notify('item/started', { sessionId, item: call })
  let decision = 'approved'
  if (session.approvalMode === 'denyUnmatched') {
    decision = 'denied'
  } else if (PROMPTING_MODES.has(session.approvalMode)) {
    const approvalId = id('approval')
    const requirement = { approvalId, sourceIndex: 0 }
    notify('approval/requested', {
      sessionId,
      approvalId,
      turnId,
      itemId: call.itemId,
      toolName: TOOL_NAME,
      rawArgs: call.args,
      currentRequirementId: requirement,
      subject: {
        kind: 'shell',
        command,
        stages: [
          { requirementId: requirement, position: 1, totalStages: 1, argv: command.split(' ') },
        ],
      },
      availableChoices: CHOICES,
      judgeEscalated: false,
      protectedWrite: false,
    })
    const chosen = await awaitDecision()
    decision = chosen === 'allow_once' ? 'approved' : 'abort'
    notify('approval/resolved', {
      sessionId,
      approvalId,
      itemId: call.itemId,
      decision,
      resolvedBy: 'user',
    })
  }
  const done =
    decision === 'approved'
      ? { ...call, status: 'completed', visibleOutput: `ran ${command}\n` }
      : {
          ...call,
          status: 'failed',
          failureReason: decision === 'denied' ? 'denied by policy' : 'rejected by the user',
        }
  session.items.push(done)
  notify('item/completed', { sessionId, item: done })
  streamReply(session, turnId, decision === 'approved' ? `ran: ${command}` : `skipped: ${command}`)
}

/** A child session the Agent map can read: the objective asked, the result given. */
function childSession(parent, spec, result) {
  const sessionId = id('child')
  const record = {
    sessionId,
    status: 'idle',
    activeTurnId: null,
    createdAt: now(),
    updatedAt: now(),
    lastActivityAt: now(),
    workspaceRoot: null,
    modelId: parent.record.modelId,
    turnCount: 1,
    forkedFrom: null,
    title: spec.objective,
  }
  const items = [
    {
      itemId: id('item'),
      kind: 'userMessage',
      status: 'completed',
      turnId: 'child-turn',
      text: spec.objective,
    },
    {
      itemId: id('item'),
      kind: 'agentMessage',
      status: 'completed',
      turnId: 'child-turn',
      text: result,
    },
  ]
  sessions.set(sessionId, { record, items, approvalMode: parent.approvalMode })
  return sessionId
}

function runSubagents(session, turnId) {
  const sessionId = session.record.sessionId
  const spawned = SUBAGENTS.map((spec, index) => {
    const result = `${spec.role} finished: ${spec.objective.toLowerCase()}`
    const entry = {
      itemId: id('item'),
      kind: 'subagent',
      status: 'inProgress',
      turnId,
      role: spec.role,
      objective: spec.objective,
      subagentId: id('subagent'),
      childSessionId: childSession(session, spec, result),
      depth: 1,
      controlStatus: 'running',
    }
    notify('item/started', { sessionId, item: entry })
    return { entry, result, index }
  })
  for (const { entry, result, index } of spawned) {
    const usage = {
      inputTokens: 1000 * (index + 1),
      outputTokens: 200,
      cachedTokens: 0,
      reasoningTokens: 0,
    }
    notify('item/updated', { sessionId, item: { ...entry, usage } })
    const done = {
      ...entry,
      status: 'completed',
      controlStatus: 'closed',
      durationMs: 1500 * (index + 1),
      usage,
      result: { summary: result, artifactRefs: [], evidenceRefs: [] },
    }
    session.items.push(done)
    session.subagents.set(done.subagentId, done)
    notify('item/completed', { sessionId, item: done })
  }
  streamReply(session, turnId, `delegated: ${String(spawned.length)} agents`)
}

function runBackground(session, turnId, command) {
  const sessionId = session.record.sessionId
  const call = {
    itemId: id('item'),
    kind: 'toolCall',
    status: 'inProgress',
    turnId,
    tool: TOOL_NAME,
    args: JSON.stringify({ command }),
  }
  notify('item/started', { sessionId, item: call })
  notify('item/updated', {
    sessionId,
    item: { ...call, background: true, backgroundInitiator: 'user' },
  })
  const done = {
    ...call,
    background: true,
    backgroundInitiator: 'user',
    status: 'completed',
    visibleOutput: `ran ${command} in the background\n`,
  }
  session.items.push(done)
  notify('item/completed', { sessionId, item: done })
  streamReply(session, turnId, `backgrounded: ${command}`)
}

/**
 * A tool call that runs until `task/background` moves it (M46): the turn
 * then goes on and ends, and the call runs on until `task/stop`.
 */
async function runLong(session, turnId, command) {
  const sessionId = session.record.sessionId
  const call = {
    itemId: id('task'),
    kind: 'toolCall',
    status: 'inProgress',
    turnId,
    tool: TOOL_NAME,
    args: JSON.stringify({ command }),
  }
  notify('item/started', { sessionId, item: call })
  await new Promise((resolve) => {
    state.tasks.set(call.itemId, { sessionId, call, isBackground: false, onBackground: resolve })
  })
  streamReply(session, turnId, `moved: ${command}`)
}

/** A refusal as Muse Code 1.3.0 words it for a task that is not there (M46). */
function rejected(reason) {
  return Object.assign(new Error(`rejected: ${reason}`), { reason })
}

/** A background task stopped: cancelled, as the capture of 2026-09-25 shows. */
function stopTask(taskId) {
  const task = state.tasks.get(taskId)
  if (task?.isBackground !== true) {
    throw rejected('invalid_target')
  }
  state.tasks.delete(taskId)
  const done = {
    ...task.call,
    status: 'cancelled',
    failureReason: 'cancelled by runtime client',
    background: true,
    backgroundInitiator: 'user',
  }
  sessions.get(task.sessionId)?.items.push(done)
  notify('item/completed', { sessionId: task.sessionId, item: done })
}

async function runTurn(session, turnId, text) {
  const sessionId = session.record.sessionId
  notify('turn/started', { sessionId, turnId })
  notify('session/statusChanged', { sessionId, status: 'running' })
  emitItem(sessionId, item(session, { kind: 'userMessage', turnId, text }))
  if (text === 'die') {
    stderr.write('fake muse: dying on purpose\n')
    exit(DIE_EXIT_CODE)
  } else if (text === 'slow') {
    await new Promise((resolve) => {
      state.running.onCancel = resolve
    })
    completeTurn(session, turnId, 'cancelled', { reason: 'cancelled by the user' })
    return
  }
  if (text === 'malformed') {
    notify('item/delta', { sessionId, delta: 'no item id here' })
  }
  if (text.startsWith(TOOL_PREFIX)) {
    await runTool(session, turnId, text.slice(TOOL_PREFIX.length).trim())
  } else if (text.startsWith(BACKGROUND_PREFIX)) {
    runBackground(session, turnId, text.slice(BACKGROUND_PREFIX.length).trim())
  } else if (text.startsWith(LONG_PREFIX)) {
    await runLong(session, turnId, text.slice(LONG_PREFIX.length).trim())
  } else if (text === 'subagents') {
    runSubagents(session, turnId)
  } else {
    streamReply(session, turnId, `${ECHO_PREFIX}${text}`)
  }
  completeTurn(session, turnId, 'completed')
}

function subagentOf(params) {
  const agent = sessionFor(params).subagents.get(params.subagentId)
  if (agent === undefined) {
    throw new Error(`unknown subagent ${String(params.subagentId)}`)
  }
  return agent
}

function subagentControl(params, controlStatus, status) {
  const session = sessionFor(params)
  const agent = subagentOf(params)
  const updated = { ...agent, controlStatus, ...(status !== undefined && { status }) }
  session.subagents.set(agent.subagentId, updated)
  notify('item/updated', { sessionId: session.record.sessionId, item: updated })
  return { commandId: params.commandId, status: 'accepted', subagentId: params.subagentId }
}

function subagentNote(params, summary) {
  const session = sessionFor(params)
  const agent = subagentOf(params)
  const updated = {
    ...agent,
    controlStatus: 'resultReady',
    result: { ...agent.result, summary, text: summary },
  }
  session.subagents.set(agent.subagentId, updated)
  notify('item/updated', { sessionId: session.record.sessionId, item: updated })
  return { commandId: params.commandId, status: 'accepted', subagentId: params.subagentId }
}

function sessionFor(params) {
  const session = sessions.get(params.sessionId)
  if (session === undefined) {
    throw new Error(`unknown session ${String(params.sessionId)}`)
  }
  return session
}

function envelope(session) {
  return {
    session: record(session),
    history: { mode: 'inline', items: session.items, snapshot: null },
    pendingRequests: [],
    viewCursor: `v:${session.record.sessionId}:${String(session.items.length)}`,
  }
}

const handlers = {
  initialize: (params) => {
    state.clientName = String(params.clientInfo?.name ?? 'unknown')
    return {
      serverInfo: { name: 'muse', version: `0.0.0-fake ${serveArgs}` },
      museHome: `/fake/home/${state.clientName}`,
      experimentalApi: false,
      grantedCapabilities: [...(params.capabilities?.requestedCapabilities ?? [])],
      platformFamily: 'fake',
      platformOs: 'fake',
      schema: { fingerprint },
      userAgent: 'muse-fake',
    }
  },
  'session/start': (params) => {
    const sessionId = id('session')
    const session = {
      record: {
        sessionId,
        status: 'idle',
        activeTurnId: null,
        createdAt: now(),
        updatedAt: now(),
        lastActivityAt: now(),
        workspaceRoot: params.workspaceRoot,
        modelId: params.modelId ?? MODEL_ID,
        turnCount: 0,
        forkedFrom: null,
      },
      items: [],
      subagents: new Map(),
      approvalMode: params.approvalMode,
    }
    sessions.set(sessionId, session)
    notify('session/listChanged', { session: record(session) })
    return { commandId: params.commandId, session: record(session), viewCursor: `v:${sessionId}:0` }
  },
  'turn/start': (params) => {
    if (state.running !== undefined) {
      throw new Error('a turn is already running')
    }
    const session = sessionFor(params)
    const turnId = id('turn')
    const text = params.input.find((part) => part.type === 'text')?.text ?? ''
    session.record.status = 'running'
    session.record.activeTurnId = turnId
    session.record.firstUserPrompt ??= text
    session.record.title ??= text
    state.running = { sessionId: session.record.sessionId, turnId, onCancel: undefined }
    setImmediate(() => {
      void runTurn(session, turnId, text)
    })
    return {
      commandId: params.commandId,
      turnId,
      status: 'accepted',
      disposition: 'started',
      startedNewTurn: true,
    }
  },
  'turn/cancel': (params) => {
    state.running?.onCancel?.()
    return { commandId: params.commandId, status: 'accepted' }
  },
  'turn/interrupt': (params) => handlers['turn/cancel'](params),
  'approval/decide': (params) => {
    if (state.pendingApproval === undefined) {
      throw new Error('no approval is pending')
    }
    const { resolve } = state.pendingApproval
    state.pendingApproval = undefined
    resolve(params.choiceId)
    return { commandId: params.commandId, status: 'accepted' }
  },
  'session/setApprovalMode': (params) => {
    sessionFor(params).approvalMode = params.mode
    notify('session/approvalModeChanged', { sessionId: params.sessionId, mode: params.mode })
    return {
      commandId: params.commandId,
      status: 'accepted',
      applyOutcome: 'completed',
      effectiveMode: { mode: params.mode, source: 'approvalReconfigure' },
    }
  },
  'session/setModel': (params) => {
    sessionFor(params).record.modelId = params.model.modelId
    notify('session/modelChanged', { sessionId: params.sessionId, modelId: params.model.modelId })
    return { commandId: params.commandId, status: 'accepted' }
  },
  'session/setReasoningEffort': (params) => ({ commandId: params.commandId, status: 'accepted' }),
  'session/compact': (params) => ({
    commandId: params.commandId,
    status: 'noop',
    reason: 'no_compactable_history',
  }),
  'session/rename': (params) => {
    sessionFor(params).record.name = params.name
    notify('session/nameChanged', { sessionId: params.sessionId, name: params.name })
    return { commandId: params.commandId, status: 'accepted', name: params.name }
  },
  'session/list': (params) => ({
    sessions: sessions
      .values()
      .filter((session) => session.record.workspaceRoot === params.workspaceRoot)
      .map((session) => record(session))
      .toArray(),
    nextCursor: null,
  }),
  'session/resume': (params) => ({ commandId: params.commandId, ...envelope(sessionFor(params)) }),
  'session/read': (params) => envelope(sessionFor(params)),
  // --- Owner commands on a subagent (M18): each answers accepted and updates the item ---
  'subagent/interrupt': (params) => subagentControl(params, 'interrupted'),
  'subagent/stop': (params) => subagentControl(params, 'closed', 'completed'),
  'subagent/resume': (params) => subagentControl(params, 'running', 'inProgress'),
  'subagent/close': (params) => subagentControl(params, 'closed', 'completed'),
  'subagent/sendMessage': (params) => subagentNote(params, `note: ${params.body}`),
  'subagent/followupTask': (params) => subagentNote(params, `followup: ${params.body}`),
  'subagent/readResult': (params) => ({
    commandId: params.commandId,
    status: 'accepted',
    subagentId: params.subagentId,
    result: subagentOf(params).result,
  }),
  'session/fork': (params) => {
    throw new Error(`fork is not supported by the fake (${String(params.sessionId)})`)
  },
  // --- M46: the TUI's `!`, background work (shapes captured 2026-09-25) ---
  'session/userShell': (params) => {
    const session = sessionFor(params)
    const sessionId = session.record.sessionId
    const started = {
      itemId: id('shell'),
      kind: 'userShell',
      turnId: null,
      status: 'inProgress',
      commandId: params.commandId,
      commandText: params.commandText,
    }
    const done = {
      ...started,
      status: 'completed',
      visibleOutput: `ran ${String(params.commandText)}\r\n`,
      exitCode: 0,
      durationMs: 5,
    }
    session.items.push(done)
    notify('item/started', { sessionId, item: started })
    setImmediate(() => {
      notify('item/completed', { sessionId, item: done })
    })
    return { commandId: params.commandId, status: 'accepted' }
  },
  'task/background': (params) => {
    const task = state.tasks.get(params.taskId)
    if (task === undefined || task.isBackground) {
      throw rejected('invalid_target')
    }
    task.isBackground = true
    // The update goes out before the answer, as it did live.
    notify('item/updated', {
      sessionId: task.sessionId,
      item: { ...task.call, background: true, backgroundInitiator: 'user' },
    })
    task.onBackground()
    return { commandId: params.commandId, status: 'accepted', taskId: params.taskId }
  },
  'task/stop': (params) => {
    stopTask(params.taskId)
    return { commandId: params.commandId, status: 'accepted', taskId: params.taskId }
  },
  'task/stopAll': (params) => {
    for (const [taskId, task] of state.tasks) {
      if (task.isBackground) {
        stopTask(taskId)
      }
    }
    return { commandId: params.commandId, status: 'accepted' }
  },
  'model/list': (params) => ({
    providerId: 'meta',
    models: [
      {
        modelId: MODEL_ID,
        displayLabel: 'Muse Spark 1.3',
        contextLimit: CONTEXT_WINDOW,
        isDefault: true,
        isActive: params.sessionId !== undefined,
      },
    ],
  }),
  'skill/list': () => ({ skills: [] }),
  'usage/read': () => (state.usage === undefined ? {} : { usage: state.usage }),
  'item/readOutput': (params) => {
    const content = `output of ${String(params.itemId)}`
    return {
      content,
      encoding: 'utf8',
      mediaType: 'text/plain',
      offsetBytes: 0,
      byteLen: content.length,
      eof: true,
    }
  },
}

const isSilent = env['MUSE_FAKE_START'] === 'silent'

function handle(frame) {
  if (isSilent || frame.id === undefined) {
    // `initialized` and any other client notification need no answer; a
    // silent host answers nothing at all.
    return
  }
  const handler = handlers[frame.method]
  if (handler === undefined) {
    send({
      id: frame.id,
      error: {
        code: METHOD_NOT_FOUND,
        message: `no handler for ${String(frame.method)}`,
        data: { kind: 'unknown' },
      },
    })
    return
  }
  try {
    send({ id: frame.id, result: handler(frame.params ?? {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = error instanceof Error && 'reason' in error ? error.reason : undefined
    send({
      id: frame.id,
      error: {
        code: COMMAND_REJECTED,
        message,
        data: { kind: 'commandRejected', ...(reason !== undefined && { reason }) },
      },
    })
  }
}

const lines = createInterface({ input: stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  if (line.trim() === '') {
    return
  }
  handle(JSON.parse(line))
})
lines.on('close', () => {
  exit(0)
})
