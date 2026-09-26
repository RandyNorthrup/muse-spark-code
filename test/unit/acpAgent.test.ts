import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { type AcpAgentDeps, type BackendReadiness, createAcpAgent } from '../../src/acp/agent'
import type { AgentEvent, ApprovalChoice, ItemSnapshot } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost, type FakeAgentSession } from './helpers/fakeAgent'

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
  readonly updates: acp.SessionUpdate[]
  readonly permissions: acp.RequestPermissionRequest[]
  readonly elicitations: acp.CreateElicitationRequest[]
  readonly log: { readonly warn: ReturnType<typeof vi.fn> }
  run<T>(op: (client: acp.ClientContext) => Promise<T>): Promise<T>
}

interface HarnessOptions {
  readonly readiness?: BackendReadiness
  readonly answer?: PermissionAnswer
  readonly elicitation?: acp.CreateElicitationResponse
  readonly canBypass?: boolean
  readonly allowsContributorModels?: boolean
}

function harness(options: HarnessOptions = {}): Harness {
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const permissions: acp.RequestPermissionRequest[] = []
  const elicitations: acp.CreateElicitationRequest[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: AcpAgentDeps = {
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve(options.readiness ?? { state: 'ready' }),
      hostFor: () => Promise.resolve(host),
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
      return options.elicitation ?? { action: 'cancel' }
    })
  return {
    host,
    updates,
    permissions,
    elicitations,
    log,
    run: (op) => client.connectWith(agent, op),
  }
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

/** Starts a session and a prompt, and waits until the backend has the turn. */
async function running(h: Harness, client: acp.ClientContext) {
  const { sessionId } = await start(client)
  const session = h.host.sessions.at(-1)!
  const response = prompt(client, sessionId)
  await until(() => session.sendTurn.mock.calls.length > 0)
  return { sessionId, session, response }
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
    expect(
      await harness().run((client) => client.request('authenticate', { methodId: 'x' })),
    ).toEqual({})
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
    await h.run(async (client) => {
      const { sessionId } = await start(client, { elicitation: { form: {} } })
      await turn(h, client, sessionId, async (session) => {
        session.emit({
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
        })
        await until(() => session.answerQuestions.mock.calls.length === 1)
      })
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
