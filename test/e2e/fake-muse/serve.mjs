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
//
// The credential file under XDG_CONFIG_HOME (never the developer's own) is
// checked at startup as 1.4.0-R4302.1 was captured checking it on Windows
// and Linux (docs/certification/sign-in-detection.md): a schema version
// other than 1 (1 or 2 on macOS) exits 3 before `initialize` with "unsupported
// auth schema version …", and off macOS a version-1 `meta` whose storage is
// the Keychain exits 3 with "keychain item for meta is unreadable". The
// real CLI starts with each of these while META_API_KEY is set; the fake
// does not model that key.
//
// Account methods (PLAN.md D26, shapes captured on 1.3.0 and 1.4.0,
// 2026-09-27), for a client that asked for `experimentalApi` only:
// `account/read` answers from that file as captured: `accountLogin` for a
// `meta` holding `access_token` (a browser sign-in), `apiKey` for one holding
// `api_key` alone (`muse auth set`), otherwise signed out; `account/logout`
// rewrites the file as the empty one the CLI leaves.
//
// The device sign-in replays the frames captured live on 1.4.0-R4302.1
// (test/fixtures/msp/account-login-*.json, 2026-09-27), read from the folder
// MUSE_FAKE_CAPTURES names. `account/loginStart` answers as captured; with
// MUSE_FAKE_LOGIN_ENDING=<capture> that capture's notifications up to its
// ending follow after MUSE_FAKE_LOGIN_ENDING_MS, in the captured order (for
// `granted`: the file written as the browser sign-in left it, then
// `account/changed`, the ending, and `account/changed` again).
// `account/loginCancel` sends the captured `cancelled` ending, then answers
// `{cancelled: true}`, in the captured order; with no flow pending it
// answers as captured after an ending. MUSE_FAKE_ACCOUNT_READ=silentAfterStart
// leaves every `account/read` after `account/loginStart` unanswered (a
// wedged CLI); MUSE_FAKE_LOGIN_EXIT_MS exits that long after
// `account/loginStart` (a host that dies mid-flow).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { argv, env, exit, platform, stderr, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import { clearTimeout, setImmediate, setTimeout } from 'node:timers'

const METHOD_NOT_FOUND = -32_601
const COMMAND_REJECTED = -32_000
// What `muse logout` and `account/logout` leave behind (44 bytes).
const LOGOUT_SHELL = '{\n  "schema_version": 1,\n  "providers": {}\n}'
// The account's display label: an e-mail address the extension never logs.
const ACCOUNT_LABEL = 'person@example.com'
// The provider the CLI keeps its own sign-in under; others share the file.
const MUSE_PROVIDER = 'meta'
// The credential file's versions: 1 holds the credential, 2 is macOS's pointer.
const INLINE_SCHEMA = 1
const POINTER_SCHEMA = 2
const KEYCHAIN_STORAGE = 'keychain'
// What 1.4.0-R4302.1 wrote to stderr for a version-1 Keychain lane off macOS.
const KEYCHAIN_UNREADABLE = 'keychain item for meta is unreadable (internal error -2147483648)'
// The lane `account/read` named for the Muse entry's key, as captured: a
// browser sign-in (`access_token`, with `api_key` beside it) is
// `accountLogin`; `muse auth set` (`api_key` alone) is `apiKey`.
const CAPTURED_LANES = [
  ['access_token', 'accountLogin'],
  ['api_key', 'apiKey'],
]
// A browser sign-in as the granted capture left the file (schema 1, `meta`
// with these keys; placeholders for every secret or personal value).
const DEVICE_LOGIN_FILE = JSON.stringify({
  schema_version: 1,
  providers: {
    meta: {
      access_token: '<placeholder>',
      obtained_via: 'device_code',
      mechanism: 'oauth',
      api_key: '<placeholder>',
      api_base_url: '<placeholder>',
      user_full_name: '<placeholder>',
      user_email: '<placeholder>',
      user_avatar_url: '<placeholder>',
    },
  },
})
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

refuseUnsupportedCredentialFile()

const serveArgs = argv.slice(2).join(' ')
const fingerprint = env['MUSE_FAKE_FINGERPRINT'] ?? 'sha256:fake'
/** sessionId → { record, items, approvalMode } */
const sessions = new Map()
const state = {
  clientName: 'unknown',
  /** The client asked for the experimental methods (account/*). */
  isExperimental: false,
  usage: undefined,
  nextId: 0,
  /** The turn in flight, if any: { sessionId, turnId, onCancel } */
  running: undefined,
  /** The approval in flight, if any: { resolve } */
  pendingApproval: undefined,
  /** Long tool calls by item (M46): { sessionId, call, isBackground, onBackground } */
  tasks: new Map(),
  /** The device sign-in in flight, if any: { timer } */
  login: undefined,
  /** `account/loginStart` was asked at least once. */
  isLoginStarted: false,
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

/** An account method without `experimentalApi`, as 1.4.0 refuses it. */
function requireExperimental(method) {
  if (!state.isExperimental) {
    throw Object.assign(new Error(`${method} requires experimentalApi capability`), {
      code: METHOD_NOT_FOUND,
      kind: 'experimentalRequired',
    })
  }
}

function credentialFile() {
  const configHome = env['XDG_CONFIG_HOME']
  return configHome === undefined ? undefined : path.join(configHome, 'muse', 'auth.json')
}

/** The credential file's JSON; an empty object when there is none or it is not JSON. */
function credentialJson() {
  const file = credentialFile()
  if (file === undefined || !existsSync(file)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {}
  } catch {
    return {}
  }
}

/** The Muse provider's entry (other providers, a connector's, share the file); `{}` when absent. */
function museEntry() {
  const providers = credentialJson().providers ?? {}
  const entry = Object.hasOwn(providers, MUSE_PROVIDER) ? providers[MUSE_PROVIDER] : {}
  return typeof entry === 'object' && entry !== null ? entry : {}
}

/** Exits 3 before `initialize` on a file 1.4.0-R4302.1 was captured refusing. */
function refuseUnsupportedCredentialFile() {
  const version = credentialJson().schema_version
  if (version === undefined) {
    return
  }
  const isMacOs = platform === 'darwin'
  const supported = isMacOs ? [INLINE_SCHEMA, POINTER_SCHEMA] : [INLINE_SCHEMA]
  if (!supported.includes(version)) {
    stderr.write(
      `compose serve model client: unsupported auth schema version ${String(version)} at ${credentialFile()}\n`,
    )
    exit(CRASH_EXIT_CODE)
  }
  if (isMacOs || museEntry().storage !== KEYCHAIN_STORAGE) {
    return
  }
  stderr.write(`compose serve model client: ${KEYCHAIN_UNREADABLE}\n`)
  exit(CRASH_EXIT_CODE)
}

function accountState() {
  const entry = museEntry()
  const lane = CAPTURED_LANES.find(([key]) => Object.hasOwn(entry, key))?.[1]
  return lane === undefined
    ? { state: 'loggedOut', credentialRequired: true }
    : { state: lane, label: ACCOUNT_LABEL, credentialRequired: true }
}

/** A live capture's frames, in the order they crossed the wire. */
function captureFrames(name) {
  const folder = env['MUSE_FAKE_CAPTURES']
  if (folder === undefined) {
    throw new Error('MUSE_FAKE_CAPTURES is not set')
  }
  return JSON.parse(readFileSync(path.join(folder, `account-login-${name}.json`), 'utf8')).frames
}

/** What the captured host answered the first time it was asked `method`. */
function capturedAnswer(name, method) {
  const frames = captureFrames(name)
  const asked = frames.find((entry) => entry.dir === 'out' && entry.frame.method === method)
  return frames.find((entry) => entry.dir === 'in' && entry.frame.id === asked?.frame.id)?.frame
    .result
}

/** The captured `account/loginCompleted` frame, as it arrived. */
function capturedEnding(name) {
  return captureFrames(name).find(
    (entry) => entry.dir === 'in' && entry.frame.method === 'account/loginCompleted',
  )?.frame
}

/** The notifications a capture received before it sent `account/loginCancel`. */
function capturedFlowNotifications(name) {
  const frames = captureFrames(name)
  const cancelAt = frames.findIndex(
    (entry) => entry.dir === 'out' && entry.frame.method === 'account/loginCancel',
  )
  return frames
    .slice(0, cancelAt === -1 ? frames.length : cancelAt)
    .filter((entry) => entry.dir === 'in' && entry.frame.method !== undefined)
    .map((entry) => entry.frame)
}

/** A capture's flow as it ended: the file a sign-in left, then its notifications. */
function endLogin(name) {
  state.login = undefined
  const file = credentialFile()
  if (name === 'granted' && file !== undefined) {
    writeFileSync(file, DEVICE_LOGIN_FILE)
  }
  for (const frame of capturedFlowNotifications(name)) {
    send(frame)
  }
}

function startLogin() {
  state.isLoginStarted = true
  const ending = env['MUSE_FAKE_LOGIN_ENDING']
  const exitAfter = env['MUSE_FAKE_LOGIN_EXIT_MS']
  if (exitAfter !== undefined) {
    setTimeout(() => {
      exit(DIE_EXIT_CODE)
    }, Number(exitAfter))
  }
  const timer =
    ending === undefined
      ? undefined
      : setTimeout(
          () => {
            endLogin(ending)
          },
          Number(env['MUSE_FAKE_LOGIN_ENDING_MS'] ?? '0'),
        )
  state.login = { timer }
  return capturedAnswer('cancelled', 'account/loginStart')
}

function cancelLogin() {
  if (state.login === undefined) {
    // As captured after the code expired: nothing left to cancel.
    return capturedAnswer('expired', 'account/loginCancel')
  }
  clearTimeout(state.login.timer)
  state.login = undefined
  // As captured: the ending, then the answer.
  send(capturedEnding('cancelled'))
  return capturedAnswer('cancelled', 'account/loginCancel')
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
    state.isExperimental = params.capabilities?.experimentalApi === true
    return {
      serverInfo: { name: 'muse', version: `0.0.0-fake ${serveArgs}` },
      museHome: `/fake/home/${state.clientName}`,
      experimentalApi: state.isExperimental,
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
  'account/read': () => {
    requireExperimental('account/read')
    return accountState()
  },
  'account/logout': () => {
    requireExperimental('account/logout')
    const file = credentialFile()
    if (file !== undefined && existsSync(file)) {
      writeFileSync(file, LOGOUT_SHELL)
    }
    const after = accountState()
    notify('account/changed', after)
    return after
  },
  'account/loginStart': (params) => {
    requireExperimental('account/loginStart')
    if (params.type !== 'deviceCode') {
      throw new Error('this fake runs the device-code flow only')
    }
    return startLogin()
  },
  'account/loginCancel': () => {
    requireExperimental('account/loginCancel')
    return cancelLogin()
  },
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
const isAccountReadSilentAfterStart = env['MUSE_FAKE_ACCOUNT_READ'] === 'silentAfterStart'

function handle(frame) {
  if (isSilent || frame.id === undefined) {
    // `initialized` and any other client notification need no answer; a
    // silent host answers nothing at all.
    return
  }
  if (isAccountReadSilentAfterStart && state.isLoginStarted && frame.method === 'account/read') {
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
    // Only a refusal built here names its own JSON-RPC code and kind.
    const isOwn = error instanceof Error && 'kind' in error && typeof error.code === 'number'
    const code = isOwn ? error.code : COMMAND_REJECTED
    const kind = isOwn ? error.kind : 'commandRejected'
    send({
      id: frame.id,
      error: {
        code,
        message,
        data: { kind, ...(reason !== undefined && { reason }) },
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
