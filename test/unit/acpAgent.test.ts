import * as acp from '@agentclientprotocol/sdk'
import { MspError } from '@muse-code/sdk'
import { describe, expect, it, vi } from 'vitest'
import { type AcpAgentDeps, type BackendReadiness, createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import type { AgentHost, AgentSession, ModelSummary } from '../../src/core/agent/agentBackend'
import type {
  AgentEvent,
  ApprovalChoice,
  ItemSnapshot,
  Question,
} from '../../src/shared/agentEvents'
import { type AcpPaidFeature, UI_TEXT } from '../../src/shared/constants'
import type { PaidUseRequest } from '../../src/shared/paid'
import { approvalModeFor } from '../../src/shared/permissionModes'
import { FAKE_MODELS, FakeAgentHost, type FakeAgentSession } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { acpMspHost, acpResumeEnvelope, answerMsp } from './helpers/acpMsp'

// M63 (PLAN.md D62): the agent driven by the ACP SDK's own client, in
// process, against a scripted backend.

const CWD = process.platform === 'win32' ? String.raw`C:\work\app` : '/work/app'
const POLL_MS = 5
const WAIT_MS = 2000

const CHOICES: ApprovalChoice[] = [
  { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  {
    choiceId: 'allow_session',
    label: 'Allow for the session',
    decision: 'approvedPolicyAmendment',
    scope: 'session',
  },
  { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
]

type PermissionAnswer = (
  request: acp.RequestPermissionRequest,
) => acp.RequestPermissionResponse | Promise<acp.RequestPermissionResponse>

interface Harness {
  readonly host: FakeAgentHost
  /** What each readiness question asked: a recheck (authenticate) or not. */
  readonly rechecks: boolean[]
  readonly paid: AcpPaidUse
  readonly grants: ReturnType<typeof memoryPaidGrants>
  readonly updates: acp.SessionUpdate[]
  readonly permissions: acp.RequestPermissionRequest[]
  readonly elicitations: acp.CreateElicitationRequest[]
  readonly log: { readonly info: ReturnType<typeof vi.fn>; readonly warn: ReturnType<typeof vi.fn> }
  run<T>(op: (client: acp.ClientContext) => Promise<T>): Promise<T>
}

interface HarnessOptions {
  readonly backendHost?: AgentHost
  readonly readiness?: BackendReadiness
  readonly answer?: PermissionAnswer
  /** The client's form answer, or a function answering when the test lets it. */
  readonly elicitation?:
    acp.CreateElicitationResponse | (() => Promise<acp.CreateElicitationResponse>)
  /** The client's form request fails instead of answering. */
  readonly isElicitationBroken?: boolean
  readonly canBypass?: boolean
  readonly allowsContributorModels?: boolean
  readonly kind?: 'museCode' | 'modelApi'
  readonly paid?: readonly AcpPaidFeature[]
  /** `--trust-workspace`: "Allow always" is offered and kept (M58). */
  readonly isTrusted?: boolean
}

function harness(options: HarnessOptions = {}): Harness {
  const host = new FakeAgentHost()
  const kind = options.kind ?? 'museCode'
  host.info = { ...host.info, kind }
  const updates: acp.SessionUpdate[] = []
  const permissions: acp.RequestPermissionRequest[] = []
  const elicitations: acp.CreateElicitationRequest[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const grants = memoryPaidGrants()
  const rechecks: boolean[] = []
  const paid = new AcpPaidUse({
    flagged: options.paid ?? [],
    canRemember: () => options.isTrusted === true,
    grants,
    log,
  })
  const deps: AcpAgentDeps = {
    backend: {
      kind,
      readiness: (isRecheck) => {
        rechecks.push(isRecheck)
        return Promise.resolve(options.readiness ?? { state: 'ready' })
      },
      hostFor: () => Promise.resolve(options.backendHost ?? host),
    },
    version: '0.0.0-test',
    options: {
      canBypass: options.canBypass ?? false,
      allowsContributorModels: options.allowsContributorModels ?? false,
      initialMode: 'manual',
    },
    signIn: {
      id: 'muse-code-login',
      name: 'Sign in',
      description: 'Sign in to Muse Code',
      args: ['login'],
      command: 'muse-spark-code-acp login',
    },
    defaultCwd: CWD,
    paid,
    log,
  }
  const agent = createAcpAgent(deps)
  const client = acp
    .client({ name: 'test-client' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('session/request_permission', async (context) => {
      permissions.push(context.params)
      return await (options.answer ?? (() => ({ outcome: { outcome: 'cancelled' } })))(
        context.params,
      )
    })
    .onRequest('elicitation/create', (context) => {
      elicitations.push(context.params)
      if (options.isElicitationBroken === true) {
        throw new Error('the form could not be shown')
      }
      return typeof options.elicitation === 'function'
        ? options.elicitation()
        : (options.elicitation ?? { action: 'cancel' })
    })
  return {
    host,
    rechecks,
    paid,
    grants,
    updates,
    permissions,
    elicitations,
    log,
    run: (op) => client.connectWith(agent, op),
  }
}

/** Lets the agent act on what it just received, before a test checks it did nothing. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, WAIT_MS / 10))
}

/** Observe overlapping requests immediately, so an expected rejection is never unhandled. */
async function didRequestSucceed(
  request: Promise<unknown>,
  finished?: { isDone: boolean },
): Promise<boolean> {
  try {
    await request
    return true
  } catch {
    return false
  } finally {
    if (finished !== undefined) {
      finished.isDone = true
    }
  }
}

/** The same held form, answered only after a lifecycle boundary. */
function delayedForm() {
  const form = Promise.withResolvers<acp.CreateElicitationResponse>()
  return { form, h: harness({ elicitation: () => form.promise }) }
}

/** A trusted paid search question whose late answer must never become a grant. */
function delayedPaidSearch() {
  const answer = Promise.withResolvers<acp.RequestPermissionResponse>()
  return {
    answer,
    h: harness({
      kind: 'modelApi',
      paid: ['webSearch'],
      isTrusted: true,
      answer: () => answer.promise,
    }),
  }
}

function colourQuestion(): Extract<AgentEvent, { type: 'questionRequested' }> {
  return {
    type: 'questionRequested',
    userInputId: 'input-1',
    itemId: 'q1',
    questions: [
      {
        id: 'color',
        header: 'Colour',
        question: 'Which colour?',
        selection: { mode: 'single' },
        options: [{ label: 'Blue' }, { label: 'Red' }],
      },
    ],
  }
}

function loadStoredSession(client: acp.ClientContext) {
  return client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
}

/** Owns one real MSP fixture and client, closing the transport even after a failed assertion. */
async function withMspSession(
  op: (client: acp.ClientContext, wire: ReturnType<typeof acpMspHost>) => Promise<void>,
): Promise<void> {
  const wire = acpMspHost()
  const h = harness({ backendHost: wire.host })
  try {
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      await loadStoredSession(client)
      await op(client, wire)
    })
  } finally {
    await wire.host.close()
  }
}

/** Starts a prompt whose turn/start reply is explicitly released by the test. */
async function pendingMspPrompt(client: acp.ClientContext, wire: ReturnType<typeof acpMspHost>) {
  wire.server.silence('turn/start')
  const response = prompt(client, 'old-1')
  await until(() => wire.server.requestsFor('turn/start').length === 1)
  return { response }
}

/** Hands a held session back retained on the next resume, as both hosts do (Grok on 78a74430). */
function retainOnResume(h: Harness, shared: FakeAgentSession): void {
  const resume = h.host.resumeSession.getMockImplementation()!
  h.host.resumeSession.mockImplementation(async (...args) => ({
    ...(await resume(...args)),
    session: shared,
  }))
}

async function until(isMet: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!isMet()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time')
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

async function start(
  client: acp.ClientContext,
  capabilities: acp.ClientCapabilities = {},
): Promise<acp.NewSessionResponse> {
  await client.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: capabilities,
  })
  return await client.request('session/new', { cwd: CWD, mcpServers: [] })
}

async function startFormSession(h: Harness, client: acp.ClientContext) {
  const { sessionId } = await start(client, { elicitation: { form: {} } })
  return { sessionId, session: h.host.sessions[0]! }
}

function prompt(client: acp.ClientContext, sessionId: string, text = 'hello') {
  return client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}

function message(itemId: string, text: string, status = 'inProgress'): ItemSnapshot {
  return { itemId, kind: 'agentMessage', status, turnId: 'turn-1', text }
}

function approval(overrides: Partial<Extract<AgentEvent, { type: 'approvalRequested' }>> = {}) {
  return {
    type: 'approvalRequested' as const,
    approvalId: 'approval-1',
    itemId: 'tool-1',
    toolName: 'powershell',
    rawArgs: JSON.stringify({ command: 'npm test' }),
    requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    subject: { kind: 'command', command: 'npm test' },
    availableChoices: CHOICES,
    isJudgeEscalated: false,
    isProtectedWrite: false,
    ...overrides,
  }
}

/** Asks one question in a session whose client has forms, until it is answered or declined. */
async function askInForm(h: Harness, question: Question): Promise<void> {
  await h.run(async (client) => {
    const { sessionId } = await start(client, { elicitation: { form: {} } })
    await turn(h, client, sessionId, async (session) => {
      session.emit({
        type: 'questionRequested',
        userInputId: 'input-1',
        itemId: 'q1',
        questions: [question],
      })
      await until(
        () =>
          session.answerQuestions.mock.calls.length + session.cancelQuestions.mock.calls.length ===
          1,
      )
    })
  })
}

/** Loads `old-1` on a fresh connection; its backend session. */
async function loadOld(h: Harness, client: acp.ClientContext): Promise<FakeAgentSession> {
  await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
  await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
  return h.host.sessions.at(-1)!
}

/** The next session resumed, as `change` leaves it before the agent has it. */
function onNextResume(h: Harness, change: (session: AgentSession) => void): void {
  const resume = h.host.resumeSession.getMockImplementation()!
  h.host.resumeSession.mockImplementationOnce(async (...args) => {
    const loaded = await resume(...args)
    change(loaded.session)
    return loaded
  })
}

/** A load whose resumed session `spoil` breaks first: it fails, and that session is let go. */
async function failedLoad(
  h: Harness,
  spoil: (session: AgentSession) => void,
  after: (client: acp.ClientContext) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  onNextResume(h, spoil)
  await h.run(async (client) => {
    await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
    await expect(
      client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] }),
    ).rejects.toThrow()
    await after(client)
  })
  expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
}

/** Starts a session and a prompt, and waits until the backend has the turn. */
async function running(h: Harness, client: acp.ClientContext) {
  const { sessionId } = await start(client)
  const session = h.host.sessions.at(-1)!
  const response = prompt(client, sessionId)
  await until(() => session.sendTurn.mock.calls.length > 0)
  return { sessionId, session, response }
}

/** Completes the currently scripted turn after any requested cancellation reached the backend. */
async function finishRunningPrompt(
  client: acp.ClientContext,
  active: Awaited<ReturnType<typeof running>>,
  terminal: string,
): Promise<void> {
  if (terminal === 'cancelled') {
    await client.notify('session/cancel', { sessionId: active.sessionId })
    await until(() => active.session.cancel.mock.calls.length === 1)
  }
  active.session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal })
  await active.response
}

/** One turn in which the backend asks `approval()`, waits for the decision, then plays `after`. */
async function approvalTurn(
  h: Harness,
  after: (session: FakeAgentSession) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await h.run(async (client) => {
    const { sessionId } = await start(client)
    await turn(h, client, sessionId, async (session) => {
      session.emit(approval())
      await until(() => session.decideApproval.mock.calls.length === 1)
      await after(session)
    })
  })
}

/** Runs one prompt: waits for the turn, plays `events`, completes it with `terminal`. */
async function turn(
  h: Harness,
  client: acp.ClientContext,
  sessionId: string,
  events: (session: FakeAgentSession) => Promise<void> | void,
  terminal = 'completed',
) {
  const session = h.host.sessions.at(-1)
  if (session === undefined) {
    throw new Error('no session')
  }
  const calls = session.sendTurn.mock.calls.length
  const response = prompt(client, sessionId)
  await until(() => session.sendTurn.mock.calls.length > calls)
  await events(session)
  session.emit({ type: 'turnCompleted', turnId: `turn-${String(calls + 1)}`, terminal })
  return await response
}

describe('the ACP agent (M63)', () => {
  it('initializes with its capabilities, and a terminal sign-in only for a client that runs one', async () => {
    const h = harness()
    const [plain, terminal] = await h.run(async (client) => [
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION }),
      await client.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { auth: { terminal: true } },
      }),
    ])
    expect(plain.agentCapabilities).toMatchObject({
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      sessionCapabilities: { list: {}, resume: {}, close: {} },
    })
    expect(plain.agentInfo).toMatchObject({ name: 'muse-spark-code-acp', version: '0.0.0-test' })
    expect(plain.authMethods).toEqual([
      {
        id: 'muse-code-login',
        name: 'Sign in',
        description: 'Run “muse-spark-code-acp login” in a terminal, then try again.',
      },
    ])
    expect(terminal.authMethods).toEqual([
      {
        type: 'terminal',
        id: 'muse-code-login',
        name: 'Sign in',
        description: 'Sign in to Muse Code',
        args: ['login'],
      },
    ])
  })

  it('passes the editor’s MCP servers to Muse Code, logging their names only', async () => {
    const h = harness()
    const servers: acp.McpServer[] = [
      {
        name: 'notes',
        command: 'notes-mcp',
        args: ['--stdio'],
        env: [{ name: 'NOTES_DIR', value: '/n' }],
      },
      {
        type: 'http',
        name: 'jupyter',
        url: 'http://127.0.0.1:8888/mcp',
        headers: [{ name: 'Authorization', value: 'token secret' }],
      },
      { type: 'sse', name: 'legacy', url: 'http://127.0.0.1:1/sse', headers: [] },
    ]
    await h.run(async (client) => {
      const init = await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      expect(init.agentCapabilities?.mcpCapabilities).toEqual({ http: true, sse: false })
      await client.request('session/new', { cwd: CWD, mcpServers: servers })
      await client.request('session/resume', { sessionId: 'old-1', cwd: CWD, mcpServers: servers })
    })
    const forwarded = {
      notes: { command: 'notes-mcp', args: ['--stdio'], env: { NOTES_DIR: '/n' } },
      jupyter: { url: 'http://127.0.0.1:8888/mcp', headers: { Authorization: 'token secret' } },
    }
    expect(h.host.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServers: forwarded }),
    )
    expect(h.host.resumeSession).toHaveBeenCalledWith('old-1', expect.any(String), forwarded)
    const logged = JSON.stringify([h.log.info.mock.calls, h.log.warn.mock.calls])
    expect(logged).toContain('legacy')
    expect(logged).not.toContain('token secret')
    expect(logged).not.toContain('/n')
  })

  it('passes no MCP servers without the grant, or on the Model API backend', async () => {
    const servers: acp.McpServer[] = [{ name: 'notes', command: 'notes-mcp', args: [], env: [] }]
    const ungranted = harness()
    ungranted.host.info = { ...ungranted.host.info, grantedCapabilities: [] }
    const modelApi = harness({ kind: 'modelApi' })
    for (const h of [ungranted, modelApi]) {
      const capabilities = await h.run(async (client) => {
        const init = await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        await client.request('session/new', { cwd: CWD, mcpServers: servers })
        return init.agentCapabilities?.mcpCapabilities
      })
      expect(h.host.startSession).toHaveBeenCalledWith(
        expect.not.objectContaining({ mcpServers: expect.anything() }),
      )
      expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining('not passed on (notes)'))
      expect(capabilities?.http).toBe(h === ungranted)
    }
  })

  it('answers auth_required until the backend is signed in, and an error when it cannot run', async () => {
    const signedOut = harness({ readiness: { state: 'signedOut', message: 'sign in first' } })
    await expect(signedOut.run((client) => start(client))).rejects.toMatchObject({
      code: -32_000,
    })
    await expect(
      signedOut.run((client) => client.request('authenticate', { methodId: 'x' })),
    ).rejects.toMatchObject({ code: -32_000 })
    const missing = harness({ readiness: { state: 'unavailable', message: 'no CLI' } })
    await expect(missing.run((client) => start(client))).rejects.toMatchObject({ code: -32_603 })
    const ready = harness()
    expect(await ready.run((client) => client.request('authenticate', { methodId: 'x' }))).toEqual(
      {},
    )
    await ready.run((client) => start(client))
    // Only authenticate, after a sign-in in the terminal, asks afresh (PR #49).
    expect(ready.rechecks).toEqual([true, false])
  })

  it('starts a session on the default model with the modes and the config options', async () => {
    const h = harness()
    const created = await h.run((client) => start(client))
    const session = h.host.sessions[0]
    expect(h.host.startSession).toHaveBeenCalledWith({
      workspaceRoot: CWD,
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
    })
    expect(session?.setReasoningEffort).toHaveBeenCalledWith('high')
    expect(created.modes?.currentModeId).toBe('manual')
    expect(created.modes?.availableModes.map((mode) => mode.id)).toEqual([
      'manual',
      'acceptEdits',
      'plan',
      'auto',
    ])
    const [model, effort] = created.configOptions ?? []
    expect(model).toMatchObject({ id: 'model', type: 'select', currentValue: 'muse-spark-1.3' })
    expect(model && 'options' in model ? model.options : []).toEqual([
      { value: 'muse-spark-1.3', name: 'Muse Spark 1.3' },
    ])
    expect(effort).toMatchObject({ id: 'effort', category: 'thought_level', currentValue: 'high' })
  })

  it('lists contributor models and Bypass permissions only when the flags allow them', async () => {
    const h = harness({ canBypass: true, allowsContributorModels: true })
    const created = await h.run((client) => start(client))
    expect(created.modes?.availableModes.map((mode) => mode.id)).toContain('bypassPermissions')
    const [model] = created.configOptions ?? []
    expect(model && 'options' in model ? model.options.length : 0).toBe(2)
  })

  it('refuses a relative folder', async () => {
    const h = harness()
    await expect(
      h.run(async (client) => {
        await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        return await client.request('session/new', { cwd: 'relative/path', mcpServers: [] })
      }),
    ).rejects.toMatchObject({ code: -32_602 })
  })

  it('streams a turn and answers end_turn only after every update went out', async () => {
    const h = harness()
    const response = await h.run(async (client) => {
      const { sessionId } = await start(client)
      return await turn(h, client, sessionId, (session) => {
        session.emit(
          { type: 'turnStarted', turnId: 'turn-1' },
          { type: 'itemStarted', item: message('m1', '') },
          { type: 'textDelta', itemId: 'm1', field: 'text', delta: 'Hel' },
          { type: 'textDelta', itemId: 'm1', field: 'text', delta: 'lo' },
          { type: 'itemCompleted', item: message('m1', 'Hello!', 'completed') },
          { type: 'todoChanged', items: [{ text: 'Write tests', status: 'in_progress' }] },
        )
      })
    })
    expect(response).toEqual({ stopReason: 'end_turn' })
    expect(h.updates).toEqual([
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '!' } },
      {
        sessionUpdate: 'plan',
        entries: [{ content: 'Write tests', priority: 'medium', status: 'in_progress' }],
      },
    ])
  })

  it('announces skills as commands and runs /selector as the skill', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]
      if (session !== undefined) {
        session.skills = [
          { selector: 'review', displayName: 'Review', description: '', argumentHint: '<path>' },
        ]
      }
      const response = client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/review src/app.ts' }],
      })
      await until(() => (session?.sendTurn.mock.calls.length ?? 0) > 0)
      session?.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await response
    })
    expect(h.updates[0]).toEqual({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'review', description: 'Review', input: { hint: '<path>' } }],
    })
    expect(h.host.sessions[0]?.sendTurn).toHaveBeenCalledWith(
      [{ type: 'skill', selector: 'review', arguments: 'src/app.ts' }],
      '/review src/app.ts',
    )
  })

  it('answers cancelled when the client cancels, and passes the cancel to the backend', async () => {
    const h = harness()
    const response = await h.run(async (client) => {
      const { sessionId } = await start(client)
      return await turn(
        h,
        client,
        sessionId,
        async (session) => {
          await client.notify('session/cancel', { sessionId })
          await until(() => session.cancel.mock.calls.length === 1)
        },
        'completed',
      )
    })
    expect(response).toEqual({ stopReason: 'cancelled' })
  })

  it('passes a cancel sent while the turn is starting to the backend once the turn exists', async () => {
    const h = harness()
    const response = await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]!
      const gate = new AbortController()
      session.sendTurn.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            gate.signal.addEventListener(
              'abort',
              () => {
                resolve({ turnId: 'turn-1', disposition: 'started' })
              },
              { once: true },
            )
          }),
      )
      const answer = prompt(client, sessionId)
      await until(() => session.sendTurn.mock.calls.length === 1)
      await client.notify('session/cancel', { sessionId })
      await new Promise((resolve) => setTimeout(resolve, 20))
      // A stop sent before the turn exists would find nothing to stop.
      expect(session.cancel).not.toHaveBeenCalled()
      gate.abort()
      await until(() => session.cancel.mock.calls.length === 1)
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'cancelled' })
      return await answer
    })
    expect(response).toEqual({ stopReason: 'cancelled' })
  })

  it('ignores a cancel for a session it does not hold', async () => {
    const h = harness()
    // The SDK reports a notification handler's exception only here.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await h.run(async (client) => {
        const { sessionId } = await start(client)
        await client.notify('session/cancel', { sessionId: 'not-a-session' })
        await client.request('session/close', { sessionId })
        await client.notify('session/cancel', { sessionId })
        // A request after them is answered in order, so both were handled.
        await start(client)
      })
      expect(reported).not.toHaveBeenCalled()
    } finally {
      reported.mockRestore()
    }
    expect(h.host.sessions[0]?.cancel).not.toHaveBeenCalled()
  })

  it('turns a failed turn into an error with its reason', async () => {
    const h = harness()
    await expect(
      h.run(async (client) => {
        const { session, response } = await running(h, client)
        session.emit({
          type: 'turnCompleted',
          turnId: 'turn-1',
          terminal: 'failed',
          reason: 'model overloaded',
        })
        return await response
      }),
    ).rejects.toThrow(/model overloaded/)
  })

  it('refuses a second prompt while one runs, and a prompt with content it cannot take', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]
      const first = prompt(client, sessionId)
      await until(() => (session?.sendTurn.mock.calls.length ?? 0) > 0)
      await expect(prompt(client, sessionId)).rejects.toThrow(UI_TEXT.acpPromptBusy)
      session?.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await first
      await expect(
        client.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'image', data: 'bm90IGFuIGltYWdl', mimeType: 'image/png' }],
        }),
      ).rejects.toThrow(UI_TEXT.attachmentUnsupported)
    })
  })

  it('settles a turn that finished before its id came back', async () => {
    const h = harness()
    const response = await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]
      session?.sendTurn.mockImplementationOnce(() => {
        session.emit({ type: 'turnCompleted', turnId: 'turn-early', terminal: 'completed' })
        return Promise.resolve({ turnId: 'turn-early', disposition: 'started' })
      })
      return await prompt(client, sessionId)
    })
    expect(response).toEqual({ stopReason: 'end_turn' })
  })

  it('decides an approval with the option the client picked', async () => {
    const h = harness({
      answer: () => ({ outcome: { outcome: 'selected', optionId: 'allow_session' } }),
    })
    await approvalTurn(h)
    expect(h.permissions[0]).toMatchObject({
      toolCall: { toolCallId: 'tool-1', title: 'PowerShell: npm test', kind: 'execute' },
      options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'allow_session', kind: 'allow_always' },
        { optionId: 'abort', kind: 'reject_once' },
      ],
    })
    expect(h.host.sessions[0]?.decideApproval).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      choiceId: 'allow_session',
      requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    })
  })

  it('denies an approval the client cancelled, answered with an unknown option, or failed to answer', async () => {
    const answers: PermissionAnswer[] = [
      () => ({ outcome: { outcome: 'cancelled' } }),
      () => ({ outcome: { outcome: 'selected', optionId: 'invented' } }),
      () => Promise.reject(new Error('client crashed')),
    ]
    for (const answer of answers) {
      const h = harness({ answer })
      await approvalTurn(h)
      expect(h.host.sessions[0]?.decideApproval).toHaveBeenCalledWith(
        expect.objectContaining({ choiceId: 'abort' }),
      )
    }
  })

  it('asks again for each stage of a staged command', async () => {
    const h = harness({
      answer: () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }),
    })
    await approvalTurn(h, async (session) => {
      session.emit({
        type: 'approvalUpdated',
        approvalId: 'approval-1',
        requirementId: { approvalId: 'approval-1', sourceIndex: 1 },
        subject: { kind: 'command', command: 'npm run build' },
        availableChoices: CHOICES,
      })
      await until(() => session.decideApproval.mock.calls.length === 2)
      session.emit({
        type: 'approvalResolved',
        approvalId: 'approval-1',
        itemId: 'tool-1',
        decision: 'approved',
        resolvedBy: 'user',
      })
    })
    expect(h.permissions.map((request) => request.toolCall.title)).toEqual([
      'PowerShell: npm test',
      'PowerShell: npm run build',
    ])
  })

  it('stops the turn when an approval offers no way to deny', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await turn(h, client, sessionId, async (session) => {
        session.emit(approval({ availableChoices: [CHOICES[0]!] }))
        await until(() => session.cancel.mock.calls.length === 1)
      })
    })
    expect(h.host.sessions[0]?.decideApproval).not.toHaveBeenCalled()
  })

  it('answers a plain file write itself in Edit automatically, as the panel does', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await client.request('session/set_mode', { sessionId, modeId: 'acceptEdits' })
      await turn(h, client, sessionId, async (session) => {
        session.emit(
          approval({
            toolName: 'write_file',
            subject: { kind: 'fileAccess', access: 'write', path: 'src/app.ts' },
          }),
        )
        await until(() => session.decideApproval.mock.calls.length === 1)
      })
    })
    expect(h.permissions).toEqual([])
    expect(h.host.sessions[0]?.setApprovalMode).toHaveBeenCalledWith('promptUnmatched')
    expect(h.host.sessions[0]?.decideApproval).toHaveBeenCalledWith(
      expect.objectContaining({ choiceId: 'allow_once' }),
    )
  })

  it('asks the question as a form where the client has forms', async () => {
    const h = harness({
      elicitation: { action: 'accept', content: { color: 'Blue' } },
    })
    await askInForm(h, {
      id: 'color',
      header: 'Colour',
      question: 'Which colour?',
      selection: { mode: 'single' },
      options: [{ label: 'Blue' }, { label: 'Red' }],
    })
    expect(h.elicitations[0]).toMatchObject({
      mode: 'form',
      message: UI_TEXT.acpQuestionFormMessage,
    })
    expect(h.host.sessions[0]?.answerQuestions).toHaveBeenCalledWith('input-1', [
      { questionId: 'color', selectedLabel: 'Blue' },
    ])
  })

  it('declines a question the form was cancelled on, and shows it as text where there are no forms', async () => {
    const withForms = harness({ elicitation: { action: 'decline' } })
    const withoutForms = harness()
    // A form request that fails is declined too, so the turn goes on.
    const brokenForms = harness({ isElicitationBroken: true })
    const question: AgentEvent = {
      type: 'questionRequested',
      userInputId: 'input-1',
      itemId: 'q1',
      questions: [
        {
          id: 'q',
          header: 'Go?',
          question: 'Proceed?',
          selection: { mode: 'single' },
          options: [{ label: 'Yes' }],
        },
      ],
    }
    for (const [h, capabilities] of [
      [withForms, { elicitation: { form: {} } }],
      [withoutForms, {}],
      [brokenForms, { elicitation: { form: {} } }],
    ] as const) {
      await h.run(async (client) => {
        const { sessionId } = await start(client, capabilities)
        await turn(h, client, sessionId, async (session) => {
          session.emit(question)
          await until(() => session.cancelQuestions.mock.calls.length === 1)
        })
      })
    }
    expect(withoutForms.updates).toContainEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `${UI_TEXT.acpQuestionAsked}\nProceed?\n- Yes` },
    })
  })

  it('declines a form whose answer is not one of the options it offered', async () => {
    const h = harness({
      elicitation: { action: 'accept', content: { parts: ['A', 'Z'] } },
    })
    await askInForm(h, {
      id: 'parts',
      header: 'Parts',
      question: 'Which parts?',
      selection: { mode: 'multiple' },
      options: [{ label: 'A' }, { label: 'B' }],
    })
    expect(h.host.sessions[0]?.answerQuestions).not.toHaveBeenCalled()
    expect(h.log.info).toHaveBeenCalledWith(
      expect.stringContaining('question input-1 declined: the form came back without an answer'),
    )
  })

  it('logs a backend failure by its MSP kind and code, never the CLI’s message', async () => {
    const personal = 'no such session under /home/someone for someone@example.com'
    const refused = new MspError({
      code: -32_000,
      message: personal,
      data: { kind: 'commandRejected' },
    })
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await turn(h, client, sessionId, async (session) => {
        session.decideApproval.mockRejectedValueOnce(refused)
        session.cancelQuestions.mockRejectedValue(refused)
        session.emit(approval())
        session.emit({
          type: 'questionRequested',
          userInputId: 'input-1',
          itemId: 'q1',
          questions: [],
        })
        await until(() => session.cancelQuestions.mock.calls.length === 2)
      })
    })
    const logged = JSON.stringify([h.log.info.mock.calls, h.log.warn.mock.calls])
    expect(logged).toContain('approval approval-1: commandRejected (MSP error -32000)')
    expect(logged).toContain('question input-1 not declined: commandRejected (MSP error -32000)')
    expect(logged).not.toContain('/home/someone')
    expect(logged).not.toContain('someone@example.com')
  })

  it('is busy while the skills are first announced, and a cancel then ends the prompt without a turn', async () => {
    const h = harness()
    const stop = await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]!
      // The skills answer only once the gate opens.
      const gate = new AbortController()
      session.listSkills.mockImplementation(
        () =>
          new Promise((resolve) => {
            gate.signal.addEventListener(
              'abort',
              () => {
                resolve([])
              },
              { once: true },
            )
          }),
      )
      const first = prompt(client, sessionId)
      await until(() => session.listSkills.mock.calls.length === 1)
      await expect(prompt(client, sessionId, 'again')).rejects.toMatchObject({
        message: expect.stringContaining(UI_TEXT.acpPromptBusy),
      })
      await client.notify('session/cancel', { sessionId })
      await until(() =>
        h.log.info.mock.calls.some(([line]) => String(line).includes('cancelled before its turn')),
      )
      gate.abort()
      return await first
    })
    expect(stop).toEqual({ stopReason: 'cancelled' })
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })

  it('switches the model and the effort, and refuses what the session does not offer', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]
      const switched = await client.request('session/set_config_option', {
        sessionId,
        configId: 'effort',
        value: 'low',
      })
      expect(session?.setReasoningEffort).toHaveBeenLastCalledWith('low')
      expect(switched.configOptions[1]).toMatchObject({ currentValue: 'low' })
      await client.request('session/set_config_option', {
        sessionId,
        configId: 'model',
        value: 'muse-spark-1.3',
      })
      expect(session?.setModel).toHaveBeenCalledWith('muse-spark-1.3')
      for (const [configId, value] of [
        ['model', 'muse-spark-1.3-contributor'],
        ['effort', 'turbo'],
        ['colour', 'blue'],
      ] as const) {
        await expect(
          client.request('session/set_config_option', { sessionId, configId, value }),
        ).rejects.toMatchObject({ code: -32_602 })
      }
      await expect(
        client.request('session/set_config_option', {
          sessionId,
          configId: 'model',
          type: 'boolean',
          value: true,
        }),
      ).rejects.toMatchObject({ code: -32_602 })
      await expect(
        client.request('session/set_mode', { sessionId, modeId: 'bypassPermissions' }),
      ).rejects.toMatchObject({ code: -32_602 })
    })
  })

  it('follows the backend when it changes the model or the effort itself', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await turn(h, client, sessionId, (session) => {
        session.emit(
          { type: 'effortChanged', effort: 'medium' },
          { type: 'effortChanged', effort: 'none' },
          { type: 'modelChanged', modelId: 'muse-spark-1.3' },
        )
      })
    })
    const configUpdates = h.updates.filter(
      (update) => update.sessionUpdate === 'config_option_update',
    )
    expect(configUpdates).toHaveLength(2)
  })

  it('loads a session with its history replayed and its plan, and resumes one without', async () => {
    const h = harness()
    h.host.history = {
      items: [
        { itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'Fix the bug' },
        { itemId: 'a1', kind: 'agentMessage', status: 'completed', text: 'Done.' },
      ],
      todos: [{ text: 'Fix the bug', status: 'completed' }],
    }
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      const loaded = await client.request('session/load', {
        sessionId: 'old-1',
        cwd: CWD,
        mcpServers: [],
      })
      expect(loaded.modes?.currentModeId).toBe('manual')
      await client.request('session/resume', { sessionId: 'old-2', cwd: CWD })
      await client.request('session/resume', { sessionId: 'old-2', cwd: CWD })
    })
    // The mode the editor is told is set on the backend, whatever the session last ran in.
    for (const session of h.host.sessions) {
      expect(session.setApprovalMode).toHaveBeenCalledWith(approvalModeFor('manual', true))
    }
    // Resumed again, the session held before is let go.
    expect(h.host.sessions[1]?.dispose).toHaveBeenCalledTimes(1)
    expect(h.host.sessions[2]?.dispose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Fix the bug' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } },
      {
        sessionUpdate: 'plan',
        entries: [{ content: 'Fix the bug', priority: 'medium', status: 'completed' }],
      },
    ])
    expect(h.host.resumeSession).toHaveBeenCalledTimes(3)
  })

  it('fails a load whose mode the backend refuses, and lets that session go', async () => {
    const h = harness()
    await failedLoad(
      h,
      (session) => {
        vi.mocked(session.setApprovalMode).mockRejectedValue(new Error('refused'))
      },
      async (client) => {
        await expect(prompt(client, 'old-1')).rejects.toThrow()
      },
    )
    expect(h.updates).toEqual([])
  })

  it('runs a loaded session on the model the backend reports, never the one its handle holds (Codex on 4eb0156c)', async () => {
    const h = harness()
    // Muse Code's resumed handle holds the model the agent asked for; the
    // CLI keeps the contributor model the session last ran on.
    h.host.listModels.mockImplementation((sessionId) =>
      Promise.resolve(
        sessionId === undefined
          ? h.host.models
          : h.host.models.map((model) => ({
              ...model,
              isActive: model.modelId === 'muse-spark-1.3-contributor',
            })),
      ),
    )
    const loaded = await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      return await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
    })
    const session = h.host.sessions[0]!
    expect(session.modelId).toBe('muse-spark-1.3')
    expect(h.host.listModels).toHaveBeenCalledWith('old-1')
    expect(loaded.modes?.currentModeId).toBe('manual')
    expect(session.setApprovalMode).toHaveBeenCalledWith('promptUnmatched')
    expect(session.setModel).toHaveBeenCalledWith('muse-spark-1.3')
    expect(loaded.configOptions?.find((option) => option.id === 'model')?.currentValue).toBe(
      'muse-spark-1.3',
    )
    expect(session.setReasoningEffort).toHaveBeenCalledTimes(1)
  })

  it('keeps a listed model the backend reports active, and sets the default where it reports none', async () => {
    const other: ModelSummary = {
      modelId: 'muse-spark-1.2',
      displayLabel: 'Muse Spark 1.2',
      contextLimit: 1_000_000,
      isDefault: false,
      isActive: false,
    }
    const h = harness()
    h.host.models = [...FAKE_MODELS.map((model) => ({ ...model, isActive: false })), other]
    h.host.listModels.mockImplementation((sessionId) =>
      Promise.resolve(
        h.host.models.map((model) => ({
          ...model,
          isActive: sessionId === 'old-1' && model.modelId === other.modelId,
        })),
      ),
    )
    const [kept, unreported] = await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      return [
        await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] }),
        await client.request('session/resume', { sessionId: 'old-2', cwd: CWD }),
      ]
    })
    expect(h.host.sessions[0]?.setModel).not.toHaveBeenCalled()
    expect(kept.configOptions?.find((option) => option.id === 'model')?.currentValue).toBe(
      'muse-spark-1.2',
    )
    expect(h.host.sessions[1]?.setModel).toHaveBeenCalledWith('muse-spark-1.3')
    expect(unreported.configOptions?.find((option) => option.id === 'model')?.currentValue).toBe(
      'muse-spark-1.3',
    )
  })

  it('lets a new session go when its effort is refused, and holds nothing (Codex on 4eb0156c)', async () => {
    const h = harness()
    const startNew = h.host.startSession.getMockImplementation()!
    h.host.startSession.mockImplementationOnce(async (options) => {
      const started = await startNew(options)
      vi.mocked(started.setReasoningEffort).mockRejectedValue(new Error('refused'))
      return started
    })
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      await expect(client.request('session/new', { cwd: CWD, mcpServers: [] })).rejects.toThrow()
      await expect(prompt(client, 'session-1')).rejects.toThrow()
    })
    expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
  })

  it('lets the held session go before a reload runs on it, and holds nothing if the reload fails (Grok on 78a74430)', async () => {
    const h = harness()
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      retainOnResume(h, h.host.sessions[0]!)
      h.host.listModels.mockImplementation((sessionId) =>
        sessionId === undefined
          ? Promise.resolve(h.host.models)
          : Promise.reject(new Error('no model list')),
      )
      await expect(
        client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] }),
      ).rejects.toThrow()
      // Nothing is held for it, so nothing is shown that does not run.
      await expect(
        client.request('session/set_mode', { sessionId: 'old-1', modeId: 'plan' }),
      ).rejects.toThrow()
      h.host.listModels.mockImplementation(() => Promise.resolve(h.host.models))
      await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      await client.request('session/set_mode', { sessionId: 'old-1', modeId: 'plan' })
    })
    const shared = h.host.sessions[0]!
    // The first hold went with the reload, the failed reload's with it.
    expect(shared.dispose).toHaveBeenCalledTimes(2)
    expect(shared.setApprovalMode).toHaveBeenLastCalledWith(approvalModeFor('plan', true))
  })

  it('follows a session loaded again once, not once for each load (Grok on 78a74430)', async () => {
    const h = harness()
    const configUpdates = () =>
      h.updates.filter((update) => update.sessionUpdate === 'config_option_update')
    await h.run(async (client) => {
      const shared = await loadOld(h, client)
      retainOnResume(h, shared)
      // Muse Code tells of the effort it was set to.
      shared.setReasoningEffort.mockImplementation(() => {
        shared.emit({ type: 'effortChanged', effort: 'medium' })
        return Promise.resolve()
      })
      await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      await until(() => configUpdates().length > 0)
      await settled()
    })
    expect(configUpdates()).toHaveLength(1)
  })

  it('ends a closed session’s prompt cancelled, stops its turn, and its late approval decides nothing (Grok on 78a74430, 5e2b85c3)', async () => {
    const answer = Promise.withResolvers<acp.RequestPermissionResponse>()
    const h = harness({ answer: () => answer.promise })
    const stop = await h.run(async (client) => {
      const { sessionId, session, response } = await running(h, client)
      session.emit(approval())
      await until(() => h.permissions.length === 1)
      await client.request('session/close', { sessionId })
      answer.resolve({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
      await settled()
      return await response
    })
    expect(stop).toEqual({ stopReason: 'cancelled' })
    expect(h.host.sessions[0]?.decideApproval).not.toHaveBeenCalled()
    // The editor was told it stopped, so it stops on the backend too.
    expect(h.host.sessions[0]?.cancel).toHaveBeenCalledTimes(1)
    expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['has started', true],
    // Past its deadline a start fails, yet may still start (Grok on ca263c53).
    ['failed to start', false],
  ])(
    'closed while its turn is being started, it stops the turn once the start is answered: %s (Grok on 5e2b85c3)',
    async (_name, isStarted) => {
      const h = harness()
      const starting = Promise.withResolvers<{ turnId: string; disposition: 'started' }>()
      const stop = await h.run(async (client) => {
        const { sessionId } = await start(client)
        const session = h.host.sessions[0]!
        session.sendTurn.mockImplementation(() => starting.promise)
        const response = prompt(client, sessionId)
        await until(() => session.sendTurn.mock.calls.length === 1)
        const closed = client.request('session/close', { sessionId })
        await settled()
        // Nothing is stopped before there is a turn to stop.
        expect(session.cancel).not.toHaveBeenCalled()
        if (isStarted) {
          starting.resolve({ turnId: 'turn-1', disposition: 'started' })
        } else {
          starting.reject(new Error('not started'))
        }
        await closed
        return await response
      })
      expect(stop).toEqual({ stopReason: 'cancelled' })
      expect(h.host.sessions[0]?.cancel).toHaveBeenCalledTimes(1)
      expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
    },
  )

  it('follows a session loaded again only once its running turn is stopped (Grok on ca263c53)', async () => {
    const h = harness()
    const starting = Promise.withResolvers<{ turnId: string; disposition: 'started' }>()
    await h.run(async (client) => {
      const shared = await loadOld(h, client)
      shared.sendTurn.mockImplementation(() => starting.promise)
      const response = prompt(client, 'old-1')
      await until(() => shared.sendTurn.mock.calls.length === 1)
      // An approval open on that turn, which Muse Code hands a new listener.
      shared.openPrompts = [approval()]
      const subscribe = vi.spyOn(shared, 'onEvent')
      retainOnResume(h, shared)
      const reload = client.request('session/load', {
        sessionId: 'old-1',
        cwd: CWD,
        mcpServers: [],
      })
      await settled()
      // The reload waits for the turn to be stopped before it follows.
      expect(subscribe).not.toHaveBeenCalled()
      expect(h.permissions).toEqual([])
      starting.resolve({ turnId: 'turn-1', disposition: 'started' })
      await reload
      await response
      expect(shared.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        subscribe.mock.invocationCallOrder[0]!,
      )
    })
  })

  it('lets a load being set up go when its backend stops, and the load fails (Grok on ca263c53)', async () => {
    const h = harness()
    const mode = Promise.withResolvers<undefined>()
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      onNextResume(h, (session) => {
        vi.mocked(session.setApprovalMode).mockImplementationOnce(() => mode.promise)
      })
      const loading = client.request('session/resume', { sessionId: 'old-1', cwd: CWD })
      await until(() => h.host.sessions[0]?.setApprovalMode.mock.calls.length === 1)
      h.host.exit('the backend stopped')
      mode.resolve(undefined)
      await expect(loading).rejects.toThrow()
      await expect(prompt(client, 'old-1')).rejects.toThrow()
    })
    expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
  })

  it('stops the turn of a session loaded again while it runs (Grok on 5e2b85c3)', async () => {
    const h = harness()
    const stop = await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      const shared = h.host.sessions[0]!
      const response = prompt(client, 'old-1')
      await until(() => shared.sendTurn.mock.calls.length === 1)
      retainOnResume(h, shared)
      await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      return await response
    })
    expect(stop).toEqual({ stopReason: 'cancelled' })
    expect(h.host.sessions[0]?.cancel).toHaveBeenCalledTimes(1)
  })

  it('lets a load still being set up go for a newer load of the same session (Grok on 5e2b85c3)', async () => {
    const h = harness()
    const firstMode = Promise.withResolvers<undefined>()
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      // The first load's session: its mode is set only when the test lets it.
      onNextResume(h, (session) => {
        vi.mocked(session.setApprovalMode).mockImplementationOnce(() => firstMode.promise)
      })
      const first = client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      await until(() => h.host.sessions.length === 1)
      const shared = h.host.sessions[0]!
      await until(() => shared.setApprovalMode.mock.calls.length === 1)
      retainOnResume(h, shared)
      const second = client.request('session/load', {
        sessionId: 'old-1',
        cwd: CWD,
        mcpServers: [],
      })
      await until(() => shared.setApprovalMode.mock.calls.length === 2)
      firstMode.resolve(undefined)
      await expect(first).rejects.toThrow()
      await second
      // Only the newer load follows the session and asks the editor.
      shared.emit(approval())
      await until(() => h.permissions.length === 1)
      await settled()
    })
    expect(h.permissions).toHaveLength(1)
    // The superseded load's hold on the shared session went, the newer one's stays.
    expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
    // The superseded load changed nothing once let go: the effort is the newer load's.
    expect(h.host.sessions[0]?.setReasoningEffort).toHaveBeenCalledTimes(1)
  })

  it.each([
    // Its first step, and its last (after which nothing more checks).
    ['mode', 'setApprovalMode'],
    ['effort', 'setReasoningEffort'],
  ] as const)(
    'lets a resume go when the editor closes that session while its %s is being set',
    async (_name, step) => {
      const h = harness()
      const held = Promise.withResolvers<undefined>()
      await h.run(async (client) => {
        await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        onNextResume(h, (session) => {
          vi.mocked(session[step]).mockImplementationOnce(() => held.promise)
        })
        // Resumed: no replay follows, so the last step is the effort.
        const loading = client.request('session/resume', { sessionId: 'old-1', cwd: CWD })
        await until(() => h.host.sessions[0]?.[step].mock.calls.length === 1)
        await client.request('session/close', { sessionId: 'old-1' })
        held.resolve(undefined)
        await expect(loading).rejects.toThrow()
        await expect(prompt(client, 'old-1')).rejects.toThrow()
        // Closing what is not held is refused.
        await expect(client.request('session/close', { sessionId: 'old-1' })).rejects.toThrow()
      })
      expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
      // Nothing more was set once it was let go.
      expect(h.host.sessions[0]?.setReasoningEffort).toHaveBeenCalledTimes(
        step === 'setApprovalMode' ? 0 : 1,
      )
    },
  )

  it('ends a prompt cancelled when its session is closed while the skills are announced', async () => {
    const h = harness()
    const skills = Promise.withResolvers<readonly never[]>()
    const stop = await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]!
      session.listSkills.mockImplementation(() => skills.promise)
      const first = prompt(client, sessionId)
      await until(() => session.listSkills.mock.calls.length === 1)
      await client.request('session/close', { sessionId })
      skills.resolve([])
      return await first
    })
    expect(stop).toEqual({ stopReason: 'cancelled' })
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })

  it.each([
    [
      'answered',
      (form: PromiseWithResolvers<acp.CreateElicitationResponse>) => {
        form.resolve({ action: 'accept', content: { color: 'Blue' } })
      },
    ],
    [
      'failed',
      (form: PromiseWithResolvers<acp.CreateElicitationResponse>) => {
        form.reject(new Error('the form went away'))
      },
    ],
  ])(
    'neither answers nor declines a question whose form is %s after its session closed',
    async (_name, settle) => {
      const { form, h } = delayedForm()
      await h.run(async (client) => {
        const { sessionId, session } = await startFormSession(h, client)
        session.emit(colourQuestion())
        await until(() => h.elicitations.length === 1)
        await client.request('session/close', { sessionId })
        settle(form)
        await settled()
      })
      expect(h.host.sessions[0]?.answerQuestions).not.toHaveBeenCalled()
      expect(h.host.sessions[0]?.cancelQuestions).not.toHaveBeenCalled()
    },
  )

  it('lets a session go whose events cannot be followed', async () => {
    await failedLoad(harness(), (session) => {
      vi.spyOn(session, 'onEvent').mockImplementation(() => {
        throw new Error('no events')
      })
    })
  })

  it('logs a backend failure by its kind, never its message (Codex on a209130)', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]!
      session.listSkills.mockRejectedValue(
        new Error(String.raw`cannot read C:\Users\person\secret.json for person@example.com`),
      )
      await turn(h, client, sessionId, () => undefined)
    })
    const logged = JSON.stringify(h.log.warn.mock.calls)
    expect(logged).toContain('skills unavailable: Error')
    expect(logged).not.toContain('person')
  })

  it('lists the folder’s sessions, the agent’s own folder when none is named', async () => {
    const h = harness()
    h.host.page = {
      sessions: [
        {
          sessionId: 's1',
          name: 'Refactor',
          createdAt: '2026-09-25T00:00:00Z',
          updatedAt: '2026-09-26T00:00:00Z',
          status: 'idle',
          turnCount: 3,
        },
      ],
      nextCursor: 'next',
    }
    const listed = await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      return await client.request('session/list', { cursor: 'c1' })
    })
    expect(h.host.listSessions).toHaveBeenCalledWith({
      workspaceRoot: CWD,
      limit: 50,
      cursor: 'c1',
    })
    expect(listed).toEqual({
      sessions: [
        { sessionId: 's1', cwd: CWD, title: 'Refactor', updatedAt: '2026-09-26T00:00:00Z' },
      ],
      nextCursor: 'next',
    })
  })

  it('closes a session, and refuses a session it does not hold', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await client.request('session/close', { sessionId })
      expect(h.host.sessions[0]?.dispose).toHaveBeenCalled()
      await expect(prompt(client, sessionId)).rejects.toMatchObject({ code: -32_002 })
    })
  })

  it('fails the running prompt when the backend stops', async () => {
    const h = harness()
    await expect(
      h.run(async (client) => {
        const { response } = await running(h, client)
        h.host.exit('killed by signal 9')
        return await response
      }),
    ).rejects.toThrow(/killed by signal 9/)
    expect(h.log.warn).toHaveBeenCalledWith('The museCode backend stopped: killed by signal 9')
  })
})

/** Answers a permission prompt with the option of that id. */
function choose(optionId: string): PermissionAnswer {
  return () => ({ outcome: { outcome: 'selected', optionId } })
}

const WEB_SEARCH = { feature: 'webSearch' } as const
const IMAGE = {
  feature: 'imageGeneration',
  kind: 'generate',
  path: 'logo.png',
  sources: [],
  prompt: 'a logo',
} as const
const SUBAGENT_TASK = {
  feature: 'subagents',
  task: { role: 'explorer', objective: 'Map files', modelId: 'muse-spark-1.3', attemptLimit: 4 },
} as const

/** A session, then the backend's question before each use in it, in turn (M58). */
async function answersInOneSession(
  h: Harness,
  requests: readonly PaidUseRequest[],
): Promise<boolean[]> {
  return await h.run(async (client) => {
    const { sessionId } = await start(client)
    const answers: boolean[] = []
    for (const request of requests) {
      answers.push(await h.paid.allows(CWD, sessionId, request, false))
    }
    return answers
  })
}

describe('paid features in the agent (M63c, M58)', () => {
  it.each(['cancelled', 'completed'])(
    'never remembers a paid answer arriving after the prompt %s',
    async (terminal) => {
      const { answer, h } = delayedPaidSearch()
      await h.run(async (client) => {
        const active = await running(h, client)
        const { sessionId } = active
        const paid = h.paid.allows(CWD, sessionId, WEB_SEARCH, false)
        await until(() => h.permissions.length === 1)
        await finishRunningPrompt(client, active, terminal)
        answer.resolve({ outcome: { outcome: 'selected', optionId: 'paid-allow-always' } })
        expect(await paid).toBe(false)
        expect(h.paid.isRemembered(CWD, 'webSearch')).toBe(false)
        expect(h.grants.byFolder.size).toBe(0)
        // A fresh use still asks and can be allowed; only the stale answer was refused.
        expect(await h.paid.allows(CWD, sessionId, WEB_SEARCH, false)).toBe(true)
        expect(h.permissions).toHaveLength(2)
      })
    },
  )

  it('denies a paid answer while its prompt is cancelled before its turn starts', async () => {
    const { answer, h } = delayedPaidSearch()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]!
      let isAllowed = true
      session.listSkills.mockImplementation(async () => {
        isAllowed = await h.paid.allows(CWD, sessionId, WEB_SEARCH, false)
        return []
      })
      const response = prompt(client, sessionId)
      await until(() => h.permissions.length === 1)
      await client.notify('session/cancel', { sessionId })
      await until(() =>
        h.log.info.mock.calls.some(
          ([message]) =>
            typeof message === 'string' && message.includes('cancelled before its turn started'),
        ),
      )
      answer.resolve({ outcome: { outcome: 'selected', optionId: 'paid-allow-always' } })
      expect(await response).toEqual({ stopReason: 'cancelled' })
      expect(isAllowed).toBe(false)
      expect(h.grants.byFolder.size).toBe(0)
      expect(session.sendTurn).not.toHaveBeenCalled()
    })
  })

  it('denies a paid use answered after its session closed (Grok on 78a74430)', async () => {
    const answer = Promise.withResolvers<acp.RequestPermissionResponse>()
    const h = harness({ kind: 'modelApi', paid: ['webSearch'], answer: () => answer.promise })
    const isAllowed = await h.run(async (client) => {
      const { sessionId } = await start(client)
      const asked = h.paid.allows(CWD, sessionId, WEB_SEARCH, false)
      await until(() => h.permissions.length === 1)
      await client.request('session/close', { sessionId })
      answer.resolve({ outcome: { outcome: 'selected', optionId: 'paid-allow-once' } })
      return await asked
    })
    expect(isAllowed).toBe(false)
    // Nothing more reaches the editor for a session it closed (Grok on ca263c53).
    expect(h.updates.filter((update) => update.sessionUpdate === 'tool_call_update')).toEqual([])
  })

  it('denies without asking a feature it has no flag for, and subagents always', async () => {
    const h = harness({ kind: 'modelApi', paid: ['webSearch'], answer: choose('paid-allow-once') })
    expect(await answersInOneSession(h, [IMAGE, SUBAGENT_TASK])).toEqual([false, false])
    expect(h.permissions).toEqual([])
  })

  it('asks before each use in its session, naming the price; Allow once allows that use only', async () => {
    const h = harness({ kind: 'modelApi', paid: ['webSearch'], answer: choose('paid-allow-once') })
    expect(await answersInOneSession(h, [WEB_SEARCH, WEB_SEARCH])).toEqual([true, true])
    expect(h.permissions).toHaveLength(2)
    const [asked] = h.permissions
    const id = asked?.toolCall.toolCallId
    expect(id).toMatch(/^paid-use-[\da-f-]{36}$/)
    expect(asked?.toolCall.title).toBe('Let Muse search the web for this prompt?')
    expect(JSON.stringify(asked?.toolCall.content)).toContain('$2.50 per 1,000 searches')
    // Not trusted: "Allow always" is neither offered nor kept.
    expect(asked?.options).toEqual([
      { optionId: 'paid-allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'paid-deny', name: 'Deny', kind: 'reject_once' },
    ])
    // Each question its own row, however the session came to be held.
    expect(h.permissions[1]?.toolCall.toolCallId).not.toBe(id)
    const row = h.updates.find(
      (update) => update.sessionUpdate === 'tool_call' && update.toolCallId === id,
    )
    expect(JSON.stringify(row)).toContain('$2.50 per 1,000 searches')
    expect(h.updates).toContainEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      status: 'completed',
    })
    expect(h.grants.byFolder.size).toBe(0)
  })

  it('stops asking in a trusted folder allowed always, and keeps that for the folder', async () => {
    const h = harness({
      kind: 'modelApi',
      paid: ['webSearch', 'imageGeneration'],
      isTrusted: true,
      answer: choose('paid-allow-always'),
    })
    const answers = await answersInOneSession(h, [WEB_SEARCH, WEB_SEARCH, IMAGE])
    expect(answers).toEqual([true, true, true])
    // The second search asked nothing; the image is a feature of its own.
    expect(h.permissions.map((request) => request.toolCall.title)).toEqual([
      'Let Muse search the web for this prompt?',
      'Muse wants to create the image logo.png',
    ])
    expect(h.permissions[0]?.options.map((option) => option.kind)).toEqual([
      'allow_once',
      'allow_always',
      'reject_once',
    ])
    expect(h.grants.byFolder.get(CWD)).toEqual(new Set(['webSearch', 'imageGeneration']))
    expect(h.paid.isRemembered(CWD, 'webSearch')).toBe(true)
  })

  it.each([
    ['Deny', choose('paid-deny')],
    ['a cancel', (() => ({ outcome: { outcome: 'cancelled' } })) satisfies PermissionAnswer],
    ['an option it was not offered', choose('paid-allow-always')],
    ['an unknown option', choose('turn-on')],
  ])('denies on %s, and keeps nothing', async (_name, answer: PermissionAnswer) => {
    const h = harness({ kind: 'modelApi', paid: ['imageGeneration'], answer })
    expect(await answersInOneSession(h, [IMAGE])).toEqual([false])
    expect(h.permissions).toHaveLength(1)
    expect(h.updates).toContainEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: h.permissions[0]?.toolCall.toolCallId,
      status: 'failed',
    })
    expect(h.grants.byFolder.size).toBe(0)
  })

  it('denies when the client cannot answer, or the session is not one the agent holds', async () => {
    const h = harness({
      kind: 'modelApi',
      paid: ['webSearch'],
      answer: () => {
        throw new Error('no permission prompts here')
      },
    })
    expect(await answersInOneSession(h, [WEB_SEARCH])).toEqual([false])
    expect(await h.paid.allows(CWD, 'not-a-session', WEB_SEARCH, false)).toBe(false)
    expect(h.permissions).toHaveLength(1)
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('the paid-use question failed, denying'),
    )
    expect(h.log.warn).toHaveBeenCalledWith(
      'Paid use of webSearch: no editor session not-a-session to ask in, so it is denied',
    )
  })

  it('names the price on a paid row', async () => {
    const h = harness({ kind: 'modelApi' })
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await turn(h, client, sessionId, (session) => {
        session.emit({
          type: 'itemStarted',
          item: {
            itemId: 'search-1',
            kind: 'toolCall',
            status: 'inProgress',
            turnId: 'turn-1',
            tool: 'web_search',
            args: JSON.stringify({ query: 'acp' }),
            paid: 'webSearch',
          },
        })
      })
    })
    const row = h.updates.find(
      (update) => update.sessionUpdate === 'tool_call' && update.toolCallId === 'search-1',
    )
    expect(row).toMatchObject({
      title: expect.stringContaining('(Billed to your Model API key: $2.50 per 1,000 searches)'),
    })
  })
})

describe('ACP session ownership across asynchronous releases', () => {
  it.each(['cancelled', 'completed'])(
    'ignores an ordinary approval answer after its prompt %s and a replacement starts',
    async (terminal) => {
      const answer = Promise.withResolvers<acp.RequestPermissionResponse>()
      const h = harness({ answer: () => answer.promise })
      await h.run(async (client) => {
        const active = await running(h, client)
        const { sessionId, session } = active
        session.emit(approval())
        await until(() => h.permissions.length === 1)
        await finishRunningPrompt(client, active, terminal)
        const fresh = prompt(client, sessionId)
        await until(() => session.sendTurn.mock.calls.length === 2)
        answer.resolve({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
        await settled()
        expect(session.decideApproval).not.toHaveBeenCalled()
        session.emit({ type: 'turnCompleted', turnId: 'turn-2', terminal: 'completed' })
        expect(await fresh).toEqual({ stopReason: 'end_turn' })
      })
    },
  )

  it('ignores an answer for an approval stage that advanced while the editor was asked', async () => {
    const oldAnswer = Promise.withResolvers<acp.RequestPermissionResponse>()
    const nextAnswer = Promise.withResolvers<acp.RequestPermissionResponse>()
    let answers = 0
    const h = harness({ answer: () => (++answers === 1 ? oldAnswer.promise : nextAnswer.promise) })
    await h.run(async (client) => {
      const { session, response } = await running(h, client)
      session.emit(approval())
      await until(() => h.permissions.length === 1)
      session.emit({
        type: 'approvalUpdated',
        approvalId: 'approval-1',
        requirementId: { approvalId: 'approval-1', sourceIndex: 1 },
        subject: { kind: 'command', command: 'npm run build' },
        availableChoices: CHOICES,
      })
      await until(() => h.permissions.length === 2)
      oldAnswer.resolve({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
      nextAnswer.resolve({ outcome: { outcome: 'selected', optionId: 'abort' } })
      await until(() => session.decideApproval.mock.calls.length > 0)
      await settled()
      expect(session.decideApproval).toHaveBeenCalledTimes(1)
      expect(session.decideApproval).toHaveBeenCalledWith({
        approvalId: 'approval-1',
        choiceId: 'abort',
        requirementId: { approvalId: 'approval-1', sourceIndex: 1 },
      })
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await response
    })
  })

  it.each(['accept', 'decline', 'failure'])(
    'neither answers nor declines a question after its prompt finished: %s',
    async (action) => {
      const { form, h } = delayedForm()
      await h.run(async (client) => {
        const { sessionId, session } = await startFormSession(h, client)
        const response = prompt(client, sessionId)
        await until(() => session.sendTurn.mock.calls.length === 1)
        session.emit(colourQuestion())
        await until(() => h.elicitations.length === 1)
        session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
        await response
        if (action === 'failure') {
          form.reject(new Error('form failed'))
        } else {
          form.resolve(
            action === 'accept' ? { action, content: { color: 'Blue' } } : { action: 'decline' },
          )
        }
        await settled()
        expect(session.answerQuestions).not.toHaveBeenCalled()
        expect(session.cancelQuestions).not.toHaveBeenCalled()
      })
    },
  )

  it.each(['turn/start', 'turn/cancel'])(
    'keeps the newest reload waiting while the old %s is unanswered',
    async (heldMethod) => {
      await withMspSession(async (client, wire) => {
        const { response: oldPrompt } = await pendingMspPrompt(client, wire)
        if (heldMethod === 'turn/cancel') {
          answerMsp(wire.server, 'turn/start', 0, { turnId: 'turn-1', status: 'accepted' })
          wire.server.silence('turn/cancel')
        }
        const older = didRequestSucceed(loadStoredSession(client))
        await until(() => wire.server.requestsFor('session/resume').length === 2)
        if (heldMethod === 'turn/cancel') {
          await until(() => wire.server.requestsFor('turn/cancel').length === 1)
        }
        const newestStatus = { isDone: false }
        const newest = didRequestSucceed(
          client.request('session/resume', { sessionId: 'old-1', cwd: CWD }),
          newestStatus,
        )
        await until(() => wire.server.requestsFor('session/resume').length === 3)
        await settled()
        const attachedBeforeRelease = wire.server.requestsFor('session/setApprovalMode').length
        const wasCompletedBeforeRelease = newestStatus.isDone
        answerMsp(
          wire.server,
          heldMethod,
          0,
          heldMethod === 'turn/start' ? { turnId: 'turn-1', status: 'accepted' } : {},
        )
        const hasOlderSucceeded = await older
        const hasNewestSucceeded = await newest
        expect(await oldPrompt).toEqual({ stopReason: 'cancelled' })
        expect(wasCompletedBeforeRelease).toBe(false)
        expect(attachedBeforeRelease).toBe(1)
        expect(hasOlderSucceeded).toBe(false)
        expect(hasNewestSucceeded).toBe(true)
        expect(wire.server.requestsFor('turn/cancel')).toHaveLength(1)
        const fresh = prompt(client, 'old-1')
        await until(() => wire.server.requestsFor('turn/start').length === 2)
        answerMsp(wire.server, 'turn/start', 1, { turnId: 'turn-2', status: 'accepted' })
        wire.server.notify('turn/completed', {
          sessionId: 'old-1',
          turnId: 'turn-2',
          terminal: 'completed',
        })
        expect(await fresh).toEqual({ stopReason: 'end_turn' })
      })
    },
  )

  it('waits for a closing session to stop before a newer reload attaches', async () => {
    await withMspSession(async (client, wire) => {
      const { response: oldPrompt } = await pendingMspPrompt(client, wire)
      const closed = client.request('session/close', { sessionId: 'old-1' })
      await settled()
      const loadedStatus = { isDone: false }
      const loaded = didRequestSucceed(
        client.request('session/resume', { sessionId: 'old-1', cwd: CWD }),
        loadedStatus,
      )
      await until(() => wire.server.requestsFor('session/resume').length === 2)
      await settled()
      const wasAttachedBeforeRelease = loadedStatus.isDone
      answerMsp(wire.server, 'turn/start', 0, { turnId: 'turn-1', status: 'accepted' })
      await closed
      expect(await loaded).toBe(true)
      expect(await oldPrompt).toEqual({ stopReason: 'cancelled' })
      expect(wasAttachedBeforeRelease).toBe(false)
      expect(wire.server.requestsFor('turn/cancel')).toHaveLength(1)
    })
  })

  it('closes a reload still waiting for the old release, and leaves no session held', async () => {
    await withMspSession(async (client, wire) => {
      const { response: oldPrompt } = await pendingMspPrompt(client, wire)
      const loading = didRequestSucceed(loadStoredSession(client))
      await until(() => wire.server.requestsFor('session/resume').length === 2)
      await settled()
      const closed = didRequestSucceed(client.request('session/close', { sessionId: 'old-1' }))
      await settled()
      answerMsp(wire.server, 'turn/start', 0, { turnId: 'turn-1', status: 'accepted' })
      expect(await closed).toBe(true)
      expect(await loading).toBe(false)
      expect(await oldPrompt).toEqual({ stopReason: 'cancelled' })
      await expect(prompt(client, 'old-1')).rejects.toThrow()
    })
  })

  it('refuses an older resume whose backend answer arrives after a newer load', async () => {
    const h = harness()
    const firstResume = Promise.withResolvers<Awaited<ReturnType<AgentHost['resumeSession']>>>()
    const resume = h.host.resumeSession.getMockImplementation()!
    let older: Awaited<ReturnType<AgentHost['resumeSession']>> | undefined
    h.host.resumeSession.mockImplementationOnce(async (...args) => {
      older = await resume(...args)
      return await firstResume.promise
    })
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      const pending = didRequestSucceed(
        client.request('session/resume', { sessionId: 'old-1', cwd: CWD }),
      )
      await until(() => older !== undefined)
      await client.request('session/load', { sessionId: 'old-1', cwd: CWD, mcpServers: [] })
      firstResume.resolve(older!)
      expect(await pending).toBe(false)
      await client.request('session/set_mode', { sessionId: 'old-1', modeId: 'plan' })
    })
    expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(h.host.sessions[1]?.dispose).not.toHaveBeenCalled()
    expect(h.host.sessions[1]?.setApprovalMode).toHaveBeenLastCalledWith('denyUnmatched')
  })

  it('releases only a stale resume’s retained hold and leaves the newer real session usable', async () => {
    await withMspSession(async (client, wire) => {
      wire.server.silence('session/resume')
      const older = didRequestSucceed(loadStoredSession(client))
      await until(() => wire.server.requestsFor('session/resume').length === 2)
      const newer = didRequestSucceed(loadStoredSession(client))
      await until(() => wire.server.requestsFor('session/resume').length === 3)
      answerMsp(wire.server, 'session/resume', 2, acpResumeEnvelope())
      expect(await newer).toBe(true)
      answerMsp(wire.server, 'session/resume', 1, acpResumeEnvelope())
      expect(await older).toBe(false)
      expect(wire.host.sessionCount).toBe(1)
      expect(wire.server.requestsFor('task/stopAll')).toEqual([])
      wire.server.silence('turn/start')
      const fresh = prompt(client, 'old-1')
      await until(() => wire.server.requestsFor('turn/start').length === 1)
      answerMsp(wire.server, 'turn/start', 0, { turnId: 'fresh', status: 'accepted' })
      wire.server.notify('turn/completed', {
        sessionId: 'old-1',
        turnId: 'fresh',
        terminal: 'completed',
      })
      expect(await fresh).toEqual({ stopReason: 'end_turn' })
    })
  })

  it('fails a prompt without an unhandled rejection when the real backend exits during turn/start', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await withMspSession(async (client, wire) => {
        wire.server.silence('turn/start')
        const response = didRequestSucceed(prompt(client, 'old-1'))
        await until(() => wire.server.requestsFor('turn/start').length === 1)
        wire.exit(1)
        // The process exit and the pipe ending can arrive on separate ticks.
        await settled()
        wire.server.close()
        expect(await response).toBe(false)
        await settled()
        expect(unhandled).not.toHaveBeenCalled()
        await expect(prompt(client, 'old-1')).rejects.toThrow()
      })
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('fails a preparing prompt when the backend exits and sends no turn afterward', async () => {
    const h = harness()
    const skills = Promise.withResolvers<readonly never[]>()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const session = h.host.sessions[0]!
      session.listSkills.mockImplementation(() => skills.promise)
      session.sendTurn.mockRejectedValue(new Error('backend stopped'))
      const response = didRequestSucceed(prompt(client, sessionId))
      await until(() => session.listSkills.mock.calls.length === 1)
      h.host.exit('backend stopped')
      skills.resolve([])
      expect(await response).toBe(false)
      expect(session.sendTurn).not.toHaveBeenCalled()
      expect(session.dispose).toHaveBeenCalledTimes(1)
    })
  })

  it.each(['close', 'backend exit'])(
    'refuses a load whose backend response arrives after %s',
    async (ending) => {
      const h = harness()
      const resumed = Promise.withResolvers<Awaited<ReturnType<AgentHost['resumeSession']>>>()
      const resume = h.host.resumeSession.getMockImplementation()!
      let held: Awaited<ReturnType<AgentHost['resumeSession']>> | undefined
      h.host.resumeSession.mockImplementationOnce(async (...args) => {
        held = await resume(...args)
        return await resumed.promise
      })
      await h.run(async (client) => {
        await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        const loading = didRequestSucceed(
          client.request('session/resume', { sessionId: 'old-1', cwd: CWD }),
        )
        await until(() => held !== undefined)
        if (ending === 'close') {
          await client.request('session/close', { sessionId: 'old-1' })
        } else {
          h.host.exit('backend stopped')
        }
        resumed.resolve(held!)
        expect(await loading).toBe(false)
        await expect(prompt(client, 'old-1')).rejects.toThrow()
      })
      expect(h.host.sessions[0]?.dispose).toHaveBeenCalledTimes(1)
    },
  )

  it('forgets a failed resume before a later close', async () => {
    const h = harness()
    h.host.resumeSession.mockRejectedValueOnce(new Error('no session'))
    await h.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      await expect(
        client.request('session/resume', { sessionId: 'old-1', cwd: CWD }),
      ).rejects.toThrow()
      await expect(client.request('session/close', { sessionId: 'old-1' })).rejects.toThrow()
    })
  })
})
