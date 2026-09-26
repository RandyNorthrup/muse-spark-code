import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  MODEL_API_MAX_RETRIES,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_TEXT,
  type PaidFeature,
  UI_TEXT,
} from '../../src/shared/constants'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import {
  ModelApiHost,
  type ModelApiHostDeps,
  type ModelApiSession,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClient,
  type ScriptedReply,
  TINY_PNG_BASE64,
} from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { parseStoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'

function setup(
  options: {
    platform?: NodeJS.Platform
    files?: Record<string, string>
    personalSkillsRoot?: string
    isTrusted?: boolean
    store?: ReturnType<typeof memorySessionStore>
    describeEnvironment?: ModelApiHostDeps['describeEnvironment']
    /** The paid features that are on (M33–M35); none unless a test says so. */
    paid?: readonly PaidFeature[]
  } = {},
) {
  const paidUses: { readonly feature: PaidFeature; readonly units: number }[] = []
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(options.files ?? {}, ROOT)
  let ids = 0
  let clock = 1_000_000
  const client = fakeModelApiClient(api, log)
  const host = new ModelApiHost({
    client,
    workspaceRoot: ROOT,
    platform: options.platform ?? 'linux',
    io,
    // The context loaders read the same files the tools do.
    contextIo: memoryContextIo(io.files),
    newId: () => {
      ids += 1
      return `id${String(ids)}`
    },
    now: () => {
      clock += 1000
      return clock
    },
    log,
    personalSkillsRoot: options.personalSkillsRoot,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    store: options.store,
    describeEnvironment: options.describeEnvironment ?? (() => Promise.resolve({ git: undefined })),
    isPaidFeatureOn: (feature) => options.paid?.includes(feature) === true,
    notePaidUse: (feature, units) => {
      paidUses.push({ feature, units })
    },
  })
  return { api, host, log, io, files: io.files, shellCalls: io.shellCalls, paidUses }
}

async function startSession(
  t: ReturnType<typeof setup>,
  approvalMode = 'promptUnmatched',
): Promise<{ session: ModelApiSession; events: AgentEvent[]; turnDone: () => Promise<void> }> {
  const session = (await t.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode,
  })) as ModelApiSession
  const events: AgentEvent[] = []
  let done = Promise.withResolvers<undefined>()
  session.onEvent((event) => {
    events.push(event)
    if (event.type !== 'turnCompleted') {
      return
    }
    done.resolve(undefined)
    done = Promise.withResolvers<undefined>()
  })
  return { session, events, turnDone: () => done.promise }
}

/** Waits for the n-th approval request (0-based) and returns it. */
async function approvalRequest(
  events: readonly AgentEvent[],
  index: number,
): Promise<Extract<AgentEvent, { type: 'approvalRequested' }>> {
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === 'approvalRequested').length).toBeGreaterThan(
      index,
    )
  })
  const request = events.filter((event) => event.type === 'approvalRequested')[index]
  if (request?.type !== 'approvalRequested') {
    throw new Error('expected an approval request')
  }
  return request
}

/** One plain turn: "first", answered "first reply". */
async function answerFirst(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
): Promise<void> {
  t.api.script({ text: 'first reply' })
  await session.sendTurn([{ type: 'text', text: 'first' }])
  await turnDone()
}

/** One turn that reads a.txt and answers, with the fake API scripted for it. */
async function readAlphaTurn(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
): Promise<void> {
  t.api.script(
    { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'call_read' }] },
    { text: 'It says alpha.' },
  )
  await session.sendTurn([{ type: 'text', text: 'what is in a.txt?' }])
  await turnDone()
}

const kinds = (events: readonly AgentEvent[]) =>
  events.map((event) =>
    event.type === 'itemStarted' || event.type === 'itemCompleted'
      ? `${event.type}:${event.item.kind}:${event.item.status}`
      : event.type,
  )

/** An `ask_user` call with one single-choice question, shared by the M7 and M16 cases. */
const ASK_USER_CALL = {
  name: 'ask_user',
  arguments: JSON.stringify({
    questions: [
      {
        id: 'q',
        header: 'Colour',
        question: 'Which?',
        selection: { mode: 'single' },
        options: [{ label: 'Red' }],
      },
    ],
  }),
}

/** The prompt the tool raised, once it arrives. */
async function awaitQuestion(events: readonly AgentEvent[]) {
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'questionRequested')).toBe(true)
  })
  const question = events.find((event) => event.type === 'questionRequested')
  if (question?.type !== 'questionRequested') {
    throw new Error('expected a question')
  }
  return question
}

describe('ModelApiHost: catalogue and sessions', () => {
  it('lists the chat models with the window, default and active flags', async () => {
    const t = setup()
    const { session } = await startSession(t)
    await session.setModel('muse-spark-1.2')
    const models = await t.host.listModels(session.sessionId)
    expect(models).toEqual([
      {
        modelId: 'muse-spark-1.3',
        displayLabel: 'muse-spark-1.3',
        contextLimit: 1_048_576,
        isDefault: true,
        isActive: false,
      },
      {
        modelId: 'muse-spark-1.3-contributor',
        displayLabel: 'muse-spark-1.3-contributor',
        contextLimit: 1_048_576,
        isDefault: false,
        isActive: false,
      },
      {
        modelId: 'muse-spark-1.2',
        displayLabel: 'muse-spark-1.2',
        contextLimit: 1_048_576,
        isDefault: false,
        isActive: true,
      },
    ])
    expect(t.host.info).toEqual({
      kind: 'modelApi',
      serverName: 'meta-model-api',
      serverVersion: 'v1',
      grantedCapabilities: [],
      canEditSessions: true,
    })
    expect(t.host.onExit(() => undefined)).toBeTypeOf('function')
    await expect(
      t.host.startSession({ workspaceRoot: ROOT, modelId: 'm', approvalMode: 'yolo' }),
    ).rejects.toThrow('unknown approval mode')
  })

  it('lists, resumes and forks the sessions it holds, announcing changes', async () => {
    const t = setup()
    const changes: string[] = []
    t.host.onSessionListEvent((event) => {
      changes.push(
        event.type === 'changed' ? `${event.record.sessionId}:${event.record.status}` : 'closed',
      )
    })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    t.api.script({ text: 'second reply' })
    await session.sendTurn([{ type: 'text', text: 'second' }])
    await turnDone()
    const page = await t.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(page.sessions).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        title: 'first',
        firstUserPrompt: 'first',
        status: 'idle',
        turnCount: 2,
        forkedFrom: null,
        workspaceRoot: ROOT,
      }),
    ])
    expect(page.nextCursor).toBeUndefined()
    const elsewhere = await t.host.listSessions({ workspaceRoot: '/other', limit: 10 })
    expect(elsewhere.sessions).toEqual([])
    expect(changes[0]).toBe(`${session.sessionId}:idle`)
    expect(changes).toContain(`${session.sessionId}:running`)

    const resumed = await t.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(resumed.session).toBe(session)
    expect(resumed.history.mode).toBe('inline')
    expect(resumed.history.items.map((item) => `${item.kind}:${item.text ?? ''}`)).toEqual([
      'userMessage:first',
      'agentMessage:first reply',
      'userMessage:second',
      'agentMessage:second reply',
    ])
    await expect(t.host.resumeSession('ghost', 'm')).rejects.toThrow('not held by this window')

    const firstTurn = resumed.history.items[0]?.turnId
    const fork = await t.host.forkSession(session.sessionId, 'muse-spark-1.2', firstTurn)
    expect(fork.record.forkedFrom).toEqual({ sessionId: session.sessionId })
    expect(fork.record.turnCount).toBe(1)
    expect(fork.history.items.map((item) => item.text)).toEqual(['first', 'first reply'])
    expect(fork.session.modelId).toBe('muse-spark-1.2')
    expect(t.host.sessionCount).toBe(2)
    await expect(t.host.forkSession(session.sessionId, 'm', 'no-such-turn')).rejects.toThrow(
      'invalid fork boundary',
    )
    expect(t.host.sessionCount).toBe(2)
    const whole = await t.host.forkSession(session.sessionId, 'm')
    expect(whole.history.items).toHaveLength(4)
    await t.host.close()
    expect(t.host.sessionCount).toBe(0)
  })
})

describe('ModelApiHost: usage (M8)', () => {
  it('has no subscription window to report and never fires usage changes', async () => {
    const t = setup()
    await expect(t.host.readUsage()).resolves.toBeUndefined()
    const stop = t.host.onUsageChanged(() => {
      throw new Error('a key has no usage stream')
    })
    expect(typeof stop).toBe('function')
    stop()
  })
})

describe('ModelApiSession: turns', () => {
  it('streams a reply with reasoning into the transcript and replays it with usage', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      reasoning: 'thinking hard',
      text: 'Hello there',
      usage: { input: 100, output: 20, cached: 30 },
    })
    const submission = await session.sendTurn([{ type: 'text', text: 'hi' }], 'hi (shown)')
    expect(submission).toEqual({ turnId: 'id2', disposition: 'started' })
    await turnDone()
    expect(kinds(events)).toEqual([
      'turnStarted',
      'sessionStatus',
      'itemStarted:reasoning:inProgress',
      'textDelta',
      'textDelta',
      'textDelta',
      'itemCompleted:reasoning:completed',
      'itemStarted:agentMessage:inProgress',
      'textDelta',
      'textDelta',
      'textDelta',
      'itemCompleted:agentMessage:completed',
      'tokenUsage',
      'contextUsage',
      'turnCompleted',
      'sessionStatus',
    ])
    const deltas = events.filter((event) => event.type === 'textDelta')
    expect(deltas.map((event) => event.field)).toEqual([
      'summary.0',
      'summary.0',
      'summary.0',
      'text',
      'text',
      'text',
    ])
    expect(events.find((event) => event.type === 'tokenUsage')).toEqual({
      type: 'tokenUsage',
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 30,
      reasoningTokens: 1,
      modelId: 'muse-spark-1.3',
    })
    expect(events.find((event) => event.type === 'contextUsage')).toEqual({
      type: 'contextUsage',
      usedTokens: 120,
      windowTokens: 1_048_576,
      pressure: 'low',
    })
    expect(events.at(-2)).toMatchObject({
      type: 'turnCompleted',
      terminal: 'completed',
      durationMs: expect.any(Number),
    })
    const [body] = t.api.responseBodies()
    expect(body).toMatchObject({
      model: 'muse-spark-1.3',
      reasoning: { effort: 'high', summary: 'auto' },
      store: false,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: session.sessionId,
      tool_choice: 'auto',
    })
    expect((body?.['input'] as unknown[])[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hi' }],
    })
    expect(String(body?.['instructions'])).toContain(ROOT)
    // The next turn replays the reasoning (with its encrypted content) and the reply.
    t.api.script({ text: 'again' })
    await session.sendTurn([{ type: 'text', text: 'more' }])
    await turnDone()
    const second = t.api.responseBodies()[1]?.['input'] as Record<string, unknown>[]
    expect(
      second.map(
        (item) => `${String(item['type'])}${'role' in item ? `:${String(item['role'])}` : ''}`,
      ),
    ).toEqual(['message:user', 'reasoning', 'message:assistant', 'message:user'])
    expect(second[1]).toMatchObject({ encrypted_content: expect.stringContaining('enc:') })
    // The transcript history shows the display text, not the model-visible one.
    expect(session.history().items[0]).toMatchObject({ kind: 'userMessage', text: 'hi (shown)' })
  })

  it('runs read-class tools without asking and feeds the results back', async () => {
    const t = setup({ files: { 'a.txt': 'alpha\n' } })
    const { session, events, turnDone } = await startSession(t)
    await readAlphaTurn(t, session, turnDone)
    expect(kinds(events)).toContain('itemStarted:toolCall:inProgress')
    const tool = events.find(
      (event) => event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(tool).toMatchObject({
      item: {
        tool: 'read_file',
        status: 'completed',
        visibleOutput: 'Read text file `a.txt`.\n1|alpha',
      },
    })
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    const second = t.api.responseBodies()[1]?.['input'] as Record<string, unknown>[]
    expect(second.at(-1)).toEqual({
      type: 'function_call_output',
      call_id: 'call_read',
      output: 'Read text file `a.txt`.\n1|alpha',
    })
    expect(second.at(-2)).toMatchObject({ type: 'function_call', call_id: 'call_read' })
  })

  it('asks before an edit in Manual mode, honours the choice, and stores the patch', async () => {
    const t = setup({ files: { 'a.txt': 'alpha\n' } })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'edit_file',
            arguments: '{"path":"a.txt","find":"alpha","replace":"beta"}',
            callId: 'c1',
          },
          { name: 'write_file', arguments: '{"path":"b.txt","content":"x"}', callId: 'c2' },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'edit' }])
    const request = await approvalRequest(events, 0)
    expect(request).toMatchObject({
      toolName: 'edit_file',
      subject: { kind: 'fileWrite', path: 'a.txt', toolName: 'edit_file' },
      requirementId: { approvalId: expect.any(String), sourceIndex: 0 },
      isJudgeEscalated: false,
      isProtectedWrite: false,
    })
    await expect(
      session.decideApproval({
        approvalId: 'nope',
        choiceId: 'allow_once',
        requirementId: request.requirementId,
      }),
    ).rejects.toThrow('not pending')
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    const second = await approvalRequest(events, 1)
    await session.decideApproval({
      approvalId: second.approvalId,
      choiceId: 'abort',
      requirementId: second.requirementId,
      feedback: 'not that file',
    })
    await turnDone()
    expect(t.files.get(`${ROOT}/a.txt`)).toBe('beta\n')
    expect(t.files.has(`${ROOT}/b.txt`)).toBe(false)
    const resolved = events.filter((event) => event.type === 'approvalResolved')
    expect(resolved).toEqual([
      expect.objectContaining({ decision: 'approved', resolvedBy: 'user' }),
      expect.objectContaining({ decision: 'abort', resolvedBy: 'user' }),
    ])
    const tools = events.filter(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(tools[0]?.item).toMatchObject({
      status: 'completed',
      patchSummary: { files: 1, added: 1, removed: 1 },
      patchRef: { id: expect.stringMatching(/^tool_patch-/), byteLen: expect.any(Number) },
    })
    expect(tools[1]?.item).toMatchObject({
      status: 'rejected',
      failureReason: 'write_file rejected by the user',
    })
    const outputs = (t.api.responseBodies()[1]?.['input'] as Record<string, unknown>[]).filter(
      (item) => item['type'] === 'function_call_output',
    )
    expect(outputs[1]?.['output']).toBe(
      'Error: write_file rejected by the user\nUser: not that file',
    )
    // The stored patch pages back like `item/readOutput`.
    const ref = tools[0]?.item.patchRef
    if (ref === undefined) {
      throw new Error('expected a patch ref')
    }
    const page = await session.readOutput({
      itemId: tools[0]?.item.itemId ?? '',
      outputRef: ref.id,
      offsetBytes: 0,
      lengthBytes: 8,
    })
    expect(page).toMatchObject({ offsetBytes: 0, byteLen: 8, eof: false, encoding: 'utf8' })
    const rest = await session.readOutput({
      itemId: '',
      outputRef: ref.id,
      offsetBytes: 8,
      lengthBytes: 100_000,
    })
    expect(rest.eof).toBe(true)
    expect(`${page.content}${rest.content}`).toContain('"path":"a.txt"')
    await expect(
      session.readOutput({ itemId: '', outputRef: 'ghost', offsetBytes: 0, lengthBytes: 1 }),
    ).rejects.toThrow('unknown output')
  })

  it('remembers "always allow in this session" per command line and refuses in Plan mode', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"ls","description":"list"}' }] },
      { calls: [{ name: 'bash', arguments: '{"command":"ls","description":"again"}' }] },
      { calls: [{ name: 'bash', arguments: '{"command":"pwd","description":"where"}' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'run' }])
    const request = await approvalRequest(events, 0)
    expect(request.subject).toEqual({ kind: 'shell', command: 'ls' })
    expect(request.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'allow_session',
      'abort',
    ])
    expect(request.availableChoices[1]?.label).toBe('Always allow in this session: ls')
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_session',
      requirementId: request.requirementId,
    })
    // The same command runs without a card; a different one asks (D24).
    const next = await approvalRequest(events, 1)
    expect(next.subject).toEqual({ kind: 'shell', command: 'pwd' })
    await session.decideApproval({
      approvalId: next.approvalId,
      choiceId: 'allow_once',
      requirementId: next.requirementId,
    })
    await turnDone()
    expect(events.filter((event) => event.type === 'approvalRequested')).toHaveLength(2)
    expect(t.shellCalls.map((call) => call.command)).toEqual(['ls', 'ls', 'pwd'])

    await session.setApprovalMode('denyUnmatched')
    await expect(session.setApprovalMode('whatever')).rejects.toThrow('unknown approval mode')
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"rm -rf x","description":"d"}' }] },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'again' }])
    await turnDone()
    expect(t.shellCalls).toHaveLength(3)
    const refused = events.findLast(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(refused?.item).toMatchObject({
      status: 'rejected',
      failureReason: 'bash refused by the permission mode',
    })
  })

  it('asks for a protected write even in Auto, and refuses a choice it never offered (D24)', async () => {
    const t = setup({ files: { 'a.txt': 'alpha\n' } })
    const { session, events, turnDone } = await startSession(t, 'onRequest')
    t.api.script(
      {
        calls: [
          { name: 'write_file', arguments: '{"path":"notes.txt","content":"x"}', callId: 'c1' },
          {
            name: 'write_file',
            arguments: '{"path":".git/hooks/pre-commit","content":"evil"}',
            callId: 'c2',
          },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'write' }])
    const request = await approvalRequest(events, 0)
    expect(request).toMatchObject({
      subject: { kind: 'fileWrite', path: '.git/hooks/pre-commit' },
      isProtectedWrite: true,
    })
    // The ordinary write ran without a card in Auto.
    expect(t.files.get(`${ROOT}/notes.txt`)).toBe('x')
    await expect(
      session.decideApproval({
        approvalId: request.approvalId,
        choiceId: 'allow_local_prefix',
        requirementId: request.requirementId,
      }),
    ).rejects.toThrow('unknown choice allow_local_prefix')
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'abort',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.files.has(`${ROOT}/.git/hooks/pre-commit`)).toBe(false)
  })

  it('refuses an edit outside the workspace before any card', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'write_file', arguments: '{"path":"../x","content":"y"}' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'write' }])
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    const row = events.findLast(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(row?.item).toMatchObject({
      status: 'failed',
      failureReason: 'path ../x is outside the workspace',
    })
  })

  it('serves ask_user questions and todo_write, and reports unknown tools', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          { name: 'todo_write', arguments: '{"items":[{"text":"do it","status":"inProgress"}]}' },
          ASK_USER_CALL,
          { name: 'ask_user', arguments: '{"questions":"bad"}' },
          { name: 'todo_write', arguments: '{"items":"bad"}' },
          { name: 'teleport', arguments: '{}' },
        ],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    const question = await awaitQuestion(events)
    expect(events.find((event) => event.type === 'todoChanged')).toEqual({
      type: 'todoChanged',
      items: [{ text: 'do it', status: 'inProgress' }],
    })
    await expect(session.answerQuestions('ghost', [])).rejects.toThrow('not pending')
    await session.answerQuestions(question.userInputId, [{ questionId: 'q', selectedLabel: 'Red' }])
    await turnDone()
    expect(events.find((event) => event.type === 'questionSettled')).toEqual({
      type: 'questionSettled',
      userInputId: question.userInputId,
      outcome: 'answered',
      answers: [{ questionId: 'q', selectedLabel: 'Red' }],
    })
    const tools = events.filter(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(tools.map((event) => event.item.status)).toEqual([
      'completed',
      'completed',
      'failed',
      'failed',
      'failed',
    ])
    expect(tools[4]?.item.failureReason).toBe('unknown tool teleport')
    expect(session.history().todos).toEqual([{ text: 'do it', status: 'inProgress' }])
  })

  it('steers a running turn, queues a second one, and cancels', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"ls","description":"d"}' }] },
      { text: 'after steer' },
    )
    const first = await session.sendTurn([{ type: 'text', text: 'one' }])
    await approvalRequest(events, 0)
    await expect(session.steer('wrong', [{ type: 'text', text: 'x' }])).rejects.toThrow(
      'not running',
    )
    await expect(session.steer(first.turnId, [{ type: 'text', text: 'also this' }])).resolves.toBe(
      first.turnId,
    )
    const queued = await session.sendTurn([{ type: 'text', text: 'two' }])
    expect(queued.disposition).toBe('queued')
    const request = await approvalRequest(events, 0)
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    const secondBody = t.api.responseBodies()[1]?.['input'] as Record<string, unknown>[]
    const steered = secondBody.find(
      (item) => item['role'] === 'user' && JSON.stringify(item).includes('also this'),
    )
    expect(steered).toMatchObject({
      content: [
        { type: 'input_text', text: '[The user added while you were working]' },
        { type: 'input_text', text: 'also this' },
      ],
    })
    // The queued turn ran afterwards.
    await turnDone()
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(2)
    expect(
      events.filter((event) => event.type === 'turnCompleted').map((event) => event.terminal),
    ).toEqual(['completed', 'completed'])

    t.api.script({ calls: [{ name: 'bash', arguments: '{"command":"sleep","description":"d"}' }] })
    await session.sendTurn([{ type: 'text', text: 'three' }])
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'approvalRequested')).toHaveLength(2)
    })
    await session.cancel()
    await turnDone()
    expect(events.at(-2)).toMatchObject({ type: 'turnCompleted', terminal: 'cancelled' })
  })

  it('reports API failures as failed turns, marking a refused key as authRequired', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      httpError: {
        status: 401,
        body: {
          error: { message: 'bad key', type: 'authentication_error', code: 'invalid_api_key' },
        },
      },
    })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    expect(events.at(-2)).toMatchObject({
      type: 'turnCompleted',
      terminal: 'failed',
      errorKind: 'authRequired',
      reason: 'bad key',
    })
    t.api.script({
      text: 'partial',
      streamError: { code: 'server_shutting_down', message: 'draining' },
    })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    expect(events.at(-2)).toMatchObject({
      type: 'turnCompleted',
      terminal: 'failed',
      errorKind: 'modelApi',
      reason: 'draining',
    })
    t.api.script({ text: 'nope', failed: { code: 'x', message: 'the model failed' } })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    expect(events.at(-2)).toMatchObject({
      type: 'turnCompleted',
      terminal: 'failed',
      reason: 'the model failed',
    })
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('failed: bad key'))
  })

  it('compacts by summarising, then replays only the summary', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    await expect(session.compact()).resolves.toEqual({
      status: 'noop',
      reason: 'no_compactable_history',
    })
    await answerFirst(t, session, turnDone)
    t.api.script({ text: 'THE SUMMARY' })
    t.api.inputTokens = 77
    await expect(session.compact()).resolves.toEqual({ status: 'accepted', reason: undefined })
    const compactionBody = t.api.responseBodies().at(-1)
    expect(compactionBody?.['tools']).toEqual([])
    expect(JSON.stringify(compactionBody?.['input'])).toContain('Summarise this conversation')
    // The compaction runs like a turn (D26): running, the summary, idle.
    expect(events.slice(-3)).toEqual([
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ kind: 'compaction', fallbackText: 'Context compacted' }),
      }),
      { type: 'contextUsage', usedTokens: 77, windowTokens: 1_048_576, pressure: 'low' },
      { type: 'sessionStatus', status: 'idle' },
    ])
    t.api.script({ text: 'later' })
    await session.sendTurn([{ type: 'text', text: 'next' }])
    await turnDone()
    const replayed = t.api.responseBodies().at(-1)?.['input'] as Record<string, unknown>[]
    expect(replayed).toHaveLength(2)
    expect(JSON.stringify(replayed[0])).toContain('THE SUMMARY')
    expect(JSON.stringify(replayed[0])).not.toContain('first reply')
  })

  it('exposes the rest of the session surface: effort, rename, skills, images, dispose', async () => {
    const t = setup({ platform: 'win32' })
    const { session, events, turnDone } = await startSession(t)
    await session.setReasoningEffort('none')
    await expect(session.setReasoningEffort('')).rejects.toThrow('must not be empty')
    await expect(session.listSkills()).resolves.toEqual([])
    await expect(session.rename('My chat')).resolves.toBe('My chat')
    expect(events.at(-1)).toEqual({ type: 'sessionNamed', name: 'My chat' })
    expect(session.record()).toMatchObject({ name: 'My chat' })
    t.api.script({ text: 'nice picture' })
    await session.sendTurn([
      { type: 'image', base64Data: 'AAAA', mediaType: 'image/png', width: 2, height: 3 },
      { type: 'skill', selector: 'fix', arguments: 'it' },
    ])
    await turnDone()
    const body = t.api.responseBodies()[0]
    expect(body?.['reasoning']).toEqual({ effort: 'minimal', summary: 'auto' })
    expect((body?.['tools'] as { name: string }[]).map((tool) => tool.name)).toContain('powershell')
    expect((body?.['input'] as Record<string, unknown>[])[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
        { type: 'input_text', text: '/fix it' },
      ],
    })
    expect(session.history().items[0]).toMatchObject({
      kind: 'userMessage',
      text: '/fix it',
      attachments: [{ type: 'image', mediaType: 'image/png', width: 2, height: 3 }],
    })
    session.dispose()
    session.dispose()
    expect(t.host.sessionCount).toBe(0)
  })
})

const skillFile = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

describe('ModelApiSession: workspace context (M10)', () => {
  it('sends the rules, the catalogue and the memory index, serves read_skill, and loads deeper rules on touch', async () => {
    const t = setup({
      files: {
        'AGENTS.md': 'End every reply with PINEAPPLE.\n',
        'src/AGENTS.md': 'Use tabs in src.\n',
        'src/a.ts': 'export {}\n',
        '.agents/skills/shout/SKILL.md': skillFile(
          'shout',
          'Repeat in caps',
          '# Shout\n\nUPPER CASE.',
        ),
        '.agents/memory/MEMORY.md': '- [Build](build.md) | npm run build\n',
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'read_skill', arguments: '{"id":"shout"}', callId: 'call_skill' }] },
      { calls: [{ name: 'read_file', arguments: '{"path":"src/a.ts"}', callId: 'call_read' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await turnDone()
    const bodies = t.api.responseBodies()
    const first = bodies[0]?.['instructions'] as string
    expect(first).toContain('# Workspace rules')
    expect(first).toContain('## Rules from AGENTS.md\n\nEnd every reply with PINEAPPLE.')
    expect(first).not.toContain('src/AGENTS.md')
    expect(first).toContain('- shout: Repeat in caps')
    expect(first).toContain('- [Build](build.md) | npm run build')
    expect((bodies[0]?.['tools'] as { name: string }[]).map((tool) => tool.name)).toContain(
      'read_skill',
    )
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    const skillRow = events.find(
      (event) =>
        event.type === 'itemCompleted' &&
        event.item.kind === 'toolCall' &&
        event.item.tool === 'read_skill',
    )
    expect(skillRow).toMatchObject({
      item: { status: 'completed', visibleOutput: 'Loaded skill shout (project)' },
    })
    const second = bodies[1]?.['input'] as Record<string, unknown>[]
    expect(second.at(-1)).toEqual({
      type: 'function_call_output',
      call_id: 'call_skill',
      output: 'Skill shout: Repeat in caps\n\n# Shout\n\nUPPER CASE.',
    })
    expect(bodies[1]?.['instructions']).not.toContain('src/AGENTS.md')
    const third = bodies[2]?.['instructions'] as string
    expect(third.indexOf('## Rules from src/AGENTS.md\n\nUse tabs in src.')).toBeGreaterThan(
      third.indexOf('## Rules from AGENTS.md'),
    )
    await expect(session.listSkills()).resolves.toEqual([
      {
        selector: 'shout',
        displayName: 'shout',
        description: 'Repeat in caps',
        argumentHint: undefined,
      },
    ])
  })

  it('expands a skill invocation with its body and arguments, and refuses bad read_skill calls', async () => {
    const t = setup({
      files: {
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Repeat in caps', 'UPPER CASE.'),
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          { name: 'read_skill', arguments: '{"id":"nope"}', callId: 'c1' },
          { name: 'read_skill', arguments: 'not json', callId: 'c2' },
        ],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'skill', selector: 'shout', arguments: 'good morning' }])
    await turnDone()
    const input = t.api.responseBodies()[0]?.['input'] as Record<string, unknown>[]
    expect(input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'The user invoked the skill "shout". Arguments: good morning\n\nUPPER CASE.',
        },
      ],
    })
    expect(session.history().items[0]).toMatchObject({
      kind: 'userMessage',
      text: '/shout good morning',
    })
    const failures = events.flatMap((event) =>
      event.type === 'itemCompleted' && event.item.kind === 'toolCall'
        ? [event.item.failureReason]
        : [],
    )
    expect(failures).toEqual(['unknown skill nope', 'invalid arguments: id is required'])
  })

  it('offers no shell, refuses one, and loads no context in Restricted Mode', async () => {
    const t = setup({
      isTrusted: false,
      files: {
        'AGENTS.md': 'rules\n',
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'd', 'b'),
      },
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [{ name: 'bash', arguments: '{"command":"ls","description":"list"}', callId: 'c1' }],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'run' }])
    await turnDone()
    const body = t.api.responseBodies()[0]
    expect((body?.['tools'] as { name: string }[]).map((tool) => tool.name)).not.toContain('bash')
    expect(body?.['instructions']).toContain('There is no shell tool')
    expect(body?.['instructions']).not.toContain('# Workspace rules')
    expect(t.shellCalls).toEqual([])
    const row = events.find(
      (event) => event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(row).toMatchObject({
      item: {
        status: 'rejected',
        failureReason:
          'shell commands are disabled while the workspace is in Restricted Mode; trust the workspace to enable them',
      },
    })
    await expect(session.listSkills()).resolves.toEqual([])
  })

  it('re-reads the skills on request and announces a changed catalogue', async () => {
    const t = setup({ files: { '.agents/skills/shout/SKILL.md': skillFile('shout', 'd', 'b') } })
    const { session, events } = await startSession(t)
    await session.listSkills()
    await t.host.refreshSkills()
    expect(events.filter((event) => event.type === 'skillsChanged')).toHaveLength(0)
    t.files.set('/ws/.agents/skills/whisper/SKILL.md', skillFile('whisper', 'q', 'b'))
    await t.host.refreshSkills()
    expect(events.filter((event) => event.type === 'skillsChanged')).toHaveLength(1)
    await expect(session.listSkills()).resolves.toHaveLength(2)
  })
})

describe('ModelApiSession: environment (M12)', () => {
  it('describes the environment once per session and puts the date and git facts in the prompt', async () => {
    let calls = 0
    const t = setup({
      describeEnvironment: () => {
        calls += 1
        return Promise.resolve({
          git: { branch: 'main', changedFiles: 2, recentCommits: ['abc first'] },
        })
      },
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'one' })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    t.api.script({ text: 'two' })
    await session.sendTurn([{ type: 'text', text: 'again' }])
    await turnDone()
    expect(calls).toBe(1)
    const bodies = t.api.responseBodies()
    const first = bodies[0]?.['instructions'] as string
    expect(first).toContain("- Today's date: 1970-01-01")
    expect(first).toContain(
      '- Git branch: main\n- Working tree at session start: 2 changed entries',
    )
    expect(first).toContain('- Recent commits:\n  - abc first')
    expect(first).toContain('# How to work')
    expect(bodies.at(-1)?.['instructions']).toContain('- Git branch: main')
  })

  it('keeps the turn going when the describer fails', async () => {
    const t = setup({ describeEnvironment: () => Promise.reject(new Error('no git')) })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    expect(t.api.responseBodies()[0]?.['instructions']).toContain(
      '- Git: not a repository, or git could not answer.',
    )
    expect(t.log.warn).toHaveBeenCalledWith('The environment could not be described: no git')
  })
})

describe('ModelApiHost: sessions between windows (M11)', () => {
  it('saves after every change and lists, resumes and forks stored sessions in a new host', async () => {
    const store = memorySessionStore()
    const first = setup({ store, files: { 'a.txt': 'alpha\n' } })
    const { session, turnDone } = await startSession(first)
    await readAlphaTurn(first, session, turnDone)
    await session.rename('Alpha chat')
    await session.setReasoningEffort('low')
    await first.host.close()
    const saved = store.saved.get(session.sessionId)
    expect(saved).toMatchObject({
      version: 1,
      workspaceRoot: ROOT,
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
      effort: 'low',
      name: 'Alpha chat',
      firstPrompt: 'what is in a.txt?',
      turnIds: [expect.any(String)],
    })
    expect(saved?.replay.map((entry) => entry.item.type)).toEqual([
      'message',
      'function_call',
      'function_call_output',
      'message',
    ])
    expect(saved?.transcript.map((entry) => entry.item.kind)).toEqual([
      'userMessage',
      'toolCall',
      'agentMessage',
    ])

    const second = setup({ store })
    await second.host.load()
    const page = await second.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(page.sessions).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        name: 'Alpha chat',
        title: 'what is in a.txt?',
        status: 'idle',
        turnCount: 1,
        forkedFrom: null,
      }),
    ])
    const resumed = await second.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(resumed.history.name).toBe('Alpha chat')
    expect(
      resumed.history.items.map((item) => `${item.kind}:${item.text ?? item.tool ?? ''}`),
    ).toEqual([
      'userMessage:what is in a.txt?',
      'toolCall:read_file',
      'agentMessage:It says alpha.',
    ])
    expect(second.host.sessionCount).toBe(1)
    expect(await second.host.resumeSession(session.sessionId, 'm')).toMatchObject({
      session: resumed.session,
    })
    // A further turn replays the stored conversation before the new message.
    const events: AgentEvent[] = []
    const done = Promise.withResolvers<undefined>()
    resumed.session.onEvent((event) => {
      events.push(event)
      if (event.type === 'turnCompleted') {
        done.resolve(undefined)
      }
    })
    second.api.script({ text: 'still alpha' })
    await resumed.session.sendTurn([{ type: 'text', text: 'and now?' }])
    await done.promise
    const input = second.api.responseBodies()[0]?.['input'] as { type: string }[]
    expect(input.map((item) => item.type)).toEqual([
      'message',
      'function_call',
      'function_call_output',
      'message',
      'message',
    ])
    expect(store.saved.get(session.sessionId)?.turnIds).toHaveLength(2)

    const fork = await second.host.forkSession(session.sessionId, 'muse-spark-1.2')
    expect(fork.record.forkedFrom).toEqual({ sessionId: session.sessionId })
    expect(fork.history.items).toHaveLength(5)
    await second.host.flush()
    expect(store.saved.has(fork.record.sessionId)).toBe(true)

    // Disposing a session keeps it in the list (the store still has it).
    resumed.session.dispose()
    const after = await second.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(after.sessions.map((record) => record.sessionId)).toContain(session.sessionId)
    await expect(second.host.resumeSession('ghost', 'm')).rejects.toThrow('not held by this window')
    await expect(second.host.forkSession('ghost', 'm')).rejects.toThrow('not held by this window')
  })

  it('ignores other workspaces, survives a failing save, and works without a store', async () => {
    const store = memorySessionStore()
    store.saved.set('elsewhere', {
      ...store.saved.get('elsewhere'),
      version: 1,
      sessionId: 'elsewhere',
      workspaceRoot: '/other',
      modelId: 'm',
      approvalMode: 'allowAll',
      effort: 'high',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      turnIds: [],
      todos: [],
      replay: [],
      transcript: [],
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
    })
    store.failNextSave = true
    const t = setup({ store })
    await t.host.load()
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'hi' })
    await session.sendTurn([{ type: 'text', text: 'hello' }])
    await turnDone()
    await t.host.close()
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('was not saved: disk full'))
    expect(store.saved.has(session.sessionId)).toBe(true)
    const page = await t.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(page.sessions.map((record) => record.sessionId)).toEqual([session.sessionId])

    const bare = setup()
    await bare.host.load()
    const { session: plain } = await startSession(bare)
    await plain.rename('x')
    await bare.host.close()
    expect(bare.host.sessionCount).toBe(0)
  })
})

describe('ModelApiSession question cancel (M16)', () => {
  it('settles a cancelled prompt with no answers and tells the model the user declined', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [ASK_USER_CALL],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    const question = await awaitQuestion(events)
    await session.cancelQuestions(question.userInputId)
    await turnDone()
    expect(events.find((event) => event.type === 'questionSettled')).toEqual({
      type: 'questionSettled',
      userInputId: question.userInputId,
      outcome: 'cancelled',
      answers: [],
    })
    const tool = events.findLast(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(tool?.item.visibleOutput).toContain('declined to answer')
  })
})

describe('ModelApiSession subagents (M18)', () => {
  it('refuses owner controls and notes: this backend runs no subagents', async () => {
    const t = setup()
    const { session } = await startSession(t)
    // Through the backend interface, as the controller calls it.
    const asSession: AgentSession = session
    await expect(asSession.controlSubagent('sub-1', 'stop')).rejects.toThrow('runs no subagents')
    await expect(asSession.messageSubagent('sub-1', 'hi', false)).rejects.toThrow(
      'runs no subagents',
    )
  })
})

/** The `function_call_output` the replay holds for one call id, from a request body. */
function outputFor(body: Record<string, unknown> | undefined, callId: string): unknown {
  const input = (body?.['input'] ?? []) as readonly Record<string, unknown>[]
  return input.find((item) => item['type'] === 'function_call_output' && item['call_id'] === callId)
}

describe('ModelApiSession: protocol semantics (D26)', () => {
  it('answers a tool call that threw, so the conversation stays valid', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.io.writeFile = () => Promise.reject(new Error('disk full'))
    t.api.script(
      {
        calls: [
          { name: 'write_file', arguments: '{"path":"new.txt","content":"x"}', callId: 'call_w' },
        ],
      },
      { text: 'could not write' },
    )
    await session.sendTurn([{ type: 'text', text: 'write it' }])
    await turnDone()
    expect(outputFor(t.api.responseBodies()[1], 'call_w')).toMatchObject({
      output: expect.stringContaining('disk full'),
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ tool: 'write_file', status: 'failed' }),
      }),
    )
    expect(events.at(-2)).toMatchObject({ type: 'turnCompleted', terminal: 'completed' })
  })

  it('records a cancelled output for a call Stop cut off at its card', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      calls: [{ name: 'bash', arguments: '{"command":"ls","description":"d"}', callId: 'call_s' }],
    })
    await session.sendTurn([{ type: 'text', text: 'list' }])
    await approvalRequest(events, 0)
    await session.cancel()
    await turnDone()
    t.api.script({ text: 'fine' })
    await session.sendTurn([{ type: 'text', text: 'something else' }])
    await turnDone()
    expect(outputFor(t.api.responseBodies().at(-1), 'call_s')).toEqual({
      type: 'function_call_output',
      call_id: 'call_s',
      output: `Error: ${MODEL_TEXT.toolCancelledByStop}`,
    })
  })

  it('gives a message typed during the final answer its own round', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'first answer' }, { text: 'about the addition' })
    let turnId = ''
    let hasSteered = false
    session.onEvent((event) => {
      if (hasSteered || event.type !== 'textDelta') {
        return
      }
      hasSteered = true
      void session.steer(turnId, [{ type: 'text', text: 'and this' }])
    })
    const submission = await session.sendTurn([{ type: 'text', text: 'go' }])
    turnId = submission.turnId
    await turnDone()
    const bodies = t.api.responseBodies()
    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(bodies[1]?.['input'])).toContain('and this')
    expect(events.filter((event) => event.type === 'turnCompleted')).toHaveLength(1)
  })

  it('queues a message sent during a compaction and runs it after', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    t.api.script({ text: 'THE SUMMARY' }, { text: 'after the summary' })
    const compacting = session.compact()
    await expect(session.sendTurn([{ type: 'text', text: 'meanwhile' }])).resolves.toMatchObject({
      disposition: 'queued',
    })
    await expect(compacting).resolves.toEqual({ status: 'accepted', reason: undefined })
    await turnDone()
    expect(JSON.stringify(t.api.responseBodies().at(-1)?.['input'])).toContain('THE SUMMARY')
    expect(events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
  })

  it('stops a compaction and ends the messages queued behind it with a reason', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    const compacting = session.compact()
    const queued = await session.sendTurn([{ type: 'text', text: 'meanwhile' }])
    await session.cancel()
    await expect(compacting).resolves.toEqual({
      status: 'cancelled',
      reason: UI_TEXT.compactionStopped,
    })
    expect(events).toContainEqual({
      type: 'turnWithdrawn',
      turnId: queued.turnId,
      reason: UI_TEXT.queuedTurnDropped,
    })
    // Nothing was summarised: the conversation replays as it was.
    t.api.script({ text: 'still here' })
    await session.sendTurn([{ type: 'text', text: 'next' }])
    await turnDone()
    expect(JSON.stringify(t.api.responseBodies().at(-1)?.['input'])).toContain('first reply')
  })

  it('keeps a compaction whose new size cannot be counted, and logs why', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    t.api.script({ text: 'THE SUMMARY' })
    t.api.inputTokens = NaN
    await expect(session.compact()).resolves.toEqual({ status: 'accepted', reason: undefined })
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('The compacted context could not be counted'),
    )
  })

  it('pages a stored output on character boundaries', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [{ name: 'write_file', arguments: '{"path":"é.txt","content":"über café"}' }],
      },
      { text: 'written' },
    )
    await session.sendTurn([{ type: 'text', text: 'write' }])
    await turnDone()
    const row = events.find(
      (event) => event.type === 'itemCompleted' && event.item.patchRef !== undefined,
    )
    if (row?.type !== 'itemCompleted' || row.item.patchRef === undefined) {
      throw new Error('expected a patch row')
    }
    const request = { itemId: row.item.itemId, outputRef: row.item.patchRef.id }
    const whole = await session.readOutput({ ...request, offsetBytes: 0, lengthBytes: 1_000_000 })
    let joined = ''
    let offsetBytes = 0
    for (;;) {
      const page = await session.readOutput({ ...request, offsetBytes, lengthBytes: 1 })
      expect(page.content).not.toContain('�')
      joined += page.content
      if (page.eof) {
        break
      }
      offsetBytes = page.offsetBytes + page.byteLen
    }
    expect(joined).toBe(whole.content)
    // An offset inside a character is served from that character's start.
    const bytes = Buffer.from(whole.content, 'utf8')
    const inside = bytes.indexOf(Buffer.from('é', 'utf8')) + 1
    const served = await session.readOutput({ ...request, offsetBytes: inside, lengthBytes: 8 })
    expect(served.offsetBytes).toBe(inside - 1)
    expect(served.content.startsWith('é')).toBe(true)
  })

  it('reports the running turn to a surface that loads the session mid-turn', async () => {
    const t = setup()
    const { session, events } = await startSession(t)
    t.api.script({ calls: [{ name: 'bash', arguments: '{"command":"ls","description":"d"}' }] })
    const { turnId } = await session.sendTurn([{ type: 'text', text: 'list' }])
    await approvalRequest(events, 0)
    const loaded = await t.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(loaded.activeTurnId).toBe(turnId)
    await session.cancel()
  })

  it('reads a stored session from the store only when it is opened', async () => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'hello there' })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    session.dispose()
    const load = vi.spyOn(store, 'load')
    const listed = await t.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(listed.sessions.map((record) => record.sessionId)).toEqual([session.sessionId])
    expect(load).not.toHaveBeenCalled()
    const history = await t.host.readSession(session.sessionId)
    expect(history.items.map((item) => item.kind)).toContain('agentMessage')
    const loaded = await t.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(load).toHaveBeenCalledTimes(2)
    expect(loaded.history.items.length).toBe(history.items.length)
    await expect(t.host.readSession('never-stored')).rejects.toThrow('not held by this window')
  })
})

/** The search rows a turn completed, in order (M33). */
function completedSearchRows(events: readonly AgentEvent[]) {
  return events.flatMap((event) =>
    event.type === 'itemCompleted' && event.item.tool === 'web_search' ? [event.item] : [],
  )
}

/** The first request of a plain turn with these paid features on (M33). */
async function firstRequest(paid: readonly PaidFeature[]) {
  const t = setup({ paid })
  const { session, turnDone } = await startSession(t)
  await answerFirst(t, session, turnDone)
  const [body] = t.api.responseBodies()
  return {
    tools: body?.['tools'] as readonly Record<string, unknown>[],
    include: body?.['include'],
  }
}

describe('ModelApiSession: web search, paid and loud (M33)', () => {
  it('keeps the search tool and its results out of every request while it is off', async () => {
    const { tools, include } = await firstRequest([])
    expect(tools.some((tool) => tool['type'] === 'web_search')).toBe(false)
    expect(include).toEqual(['reasoning.encrypted_content'])
  })

  it('sends exactly one search tool, and asks for the results, while it is on', async () => {
    const { tools, include } = await firstRequest(['webSearch'])
    expect(tools.filter((tool) => tool['type'] === 'web_search')).toEqual([{ type: 'web_search' }])
    expect(include).toEqual(['reasoning.encrypted_content', 'web_search_call.results'])
  })

  it('shows a search as a paid row with its query and results, counts it, cites, and replays it without results', async () => {
    const t = setup({ paid: ['webSearch'] })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      searches: [
        {
          queries: ['vite 7 release'],
          results: [
            {
              title: 'Vite 7 is out',
              url: 'https://vite.dev/blog/announcing-vite7',
              snippet: 'Vite 7.0 is released.',
            },
          ],
        },
      ],
      text: 'Vite 7 shipped in June.',
      citations: [{ url: 'https://vite.dev/blog/announcing-vite7', title: 'Vite 7 is out' }],
    })
    await session.sendTurn([{ type: 'text', text: 'when did vite 7 ship?' }])
    await turnDone()
    expect(events).toContainEqual({
      type: 'itemStarted',
      item: expect.objectContaining({
        kind: 'toolCall',
        tool: 'web_search',
        status: 'inProgress',
        paid: 'webSearch',
      }),
    })
    expect(completedSearchRows(events)).toEqual([
      expect.objectContaining({
        status: 'completed',
        args: JSON.stringify({ query: 'vite 7 release' }),
        // Muse Code's own `web_search` result shape, so both backends render alike (M43).
        visibleOutput: JSON.stringify({
          // The snippet too (the review of PR #29).
          results: [
            {
              url: 'https://vite.dev/blog/announcing-vite7',
              title: 'Vite 7 is out',
              snippet: 'Vite 7.0 is released.',
            },
          ],
        }),
        paid: 'webSearch',
      }),
    ])
    expect(t.paidUses).toEqual([{ feature: 'webSearch', units: 1 }])
    expect(events).toContainEqual({
      type: 'itemCompleted',
      item: expect.objectContaining({
        kind: 'agentMessage',
        citations: [{ url: 'https://vite.dev/blog/announcing-vite7', title: 'Vite 7 is out' }],
      }),
    })
    // The next request replays the search, without the results asked for the row.
    t.api.script({ text: 'more' })
    await session.sendTurn([{ type: 'text', text: 'and 8?' }])
    await turnDone()
    const input = t.api.responseBodies().at(-1)?.['input'] as readonly Record<string, unknown>[]
    const replayed = input.find((item) => item['type'] === 'web_search_call')
    expect(replayed).toEqual({
      type: 'web_search_call',
      id: expect.any(String),
      status: 'completed',
      action: { type: 'search', queries: ['vite 7 release'] },
    })
    // The row and the sources come back with the conversation.
    const history = session.history()
    expect(history.items).toContainEqual(expect.objectContaining({ paid: 'webSearch' }))
  })

  it('counts each query, not a failed search, completes one only the response carried, and settles late citations', async () => {
    const t = setup({ paid: ['webSearch'] })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      searches: [
        { queries: ['one', 'two'] },
        { status: 'failed' },
        { queries: ['late'], isDoneOmitted: true },
        { isBareDone: true },
        { action: { type: 'open_page', url: 'https://example.com/page' } },
      ],
      text: 'Answer.',
      citations: [{ url: 'https://example.com/a', title: 'A' }],
      areCitationsLate: true,
    })
    await session.sendTurn([{ type: 'text', text: 'search' }])
    await turnDone()
    const rows = completedSearchRows(events)
    expect(rows.map((row) => row.status)).toEqual([
      'completed',
      'failed',
      'completed',
      'completed',
      'completed',
    ])
    expect(rows[1]).toEqual(expect.objectContaining({ failureReason: 'The search failed' }))
    expect(rows[2]?.args).toBe('{}')
    expect(rows[3]?.args).toBe(JSON.stringify({ url: 'https://example.com/page' }))
    // In stream order; the search only the response carried is counted last.
    expect(t.paidUses.map((use) => use.units)).toEqual([2, 1, 1, 1])
    const message = events.find(
      (event) => event.type === 'itemCompleted' && event.item.kind === 'agentMessage',
    )
    expect(message?.type === 'itemCompleted' && message.item.citations).toBeFalsy()
    expect(events).toContainEqual({
      type: 'itemUpdated',
      item: expect.objectContaining({
        kind: 'agentMessage',
        citations: [{ url: 'https://example.com/a', title: 'A' }],
      }),
    })
    // The transcript holds the reply once, with its sources.
    const replies = session.history().items.filter((item) => item.kind === 'agentMessage')
    expect(replies).toEqual([
      expect.objectContaining({ citations: [{ url: 'https://example.com/a', title: 'A' }] }),
    ])
  })

  it('compacts without the search tool or its results', async () => {
    const t = setup({ paid: ['webSearch'] })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    t.api.script({ text: 'THE SUMMARY' })
    await session.compact()
    const body = t.api.responseBodies().at(-1)
    expect(body?.['tools']).toEqual([])
    expect(body?.['include']).toEqual(['reasoning.encrypted_content'])
  })

  it('stores and reads back a conversation with a search in it', async () => {
    const store = memorySessionStore()
    const t = setup({ paid: ['webSearch'], store })
    const { session, turnDone } = await startSession(t)
    t.api.script({ searches: [{ queries: ['q'] }], text: 'found' })
    await session.sendTurn([{ type: 'text', text: 'look it up' }])
    await turnDone()
    await t.host.flush()
    const stored = parseStoredSession(structuredClone(session.snapshot()))
    expect(stored.ok).toBe(true)
    session.dispose()
    const history = await t.host.readSession(session.sessionId)
    expect(history.items).toContainEqual(
      expect.objectContaining({ tool: 'web_search', paid: 'webSearch' }),
    )
  })
})

/** A `generate_image` call as the model makes it (M34). */
function imageCall(args: Record<string, unknown>, callId = 'call_img') {
  return { name: 'generate_image', arguments: JSON.stringify(args), callId }
}

/** The tool output the model received for `callId`, from the last request's input. */
function toolOutput(t: ReturnType<typeof setup>, callId: string): string | undefined {
  const input = t.api.responseBodies().at(-1)?.['input'] as readonly Record<string, unknown>[]
  const output = input.find(
    (item) => item['type'] === 'function_call_output' && item['call_id'] === callId,
  )
  return output?.['output'] as string | undefined
}

describe('ModelApiSession: image generation, paid and asked every time (M34)', () => {
  it('offers no image tool while it is off, and refuses one called anyway without a card', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script({ calls: [imageCall({ prompt: 'a cat', path: 'cat.png' })] }, { text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'draw a cat' }])
    await turnDone()
    const tools = t.api.responseBodies()[0]?.['tools'] as readonly Record<string, unknown>[]
    expect(tools.some((tool) => tool['name'] === 'generate_image')).toBe(false)
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(t.api.imageBodies()).toEqual([])
    expect(toolOutput(t, 'call_img')).toContain('image generation is off')
    expect(t.paidUses).toEqual([])
  })

  it('asks before the image, naming it paid, then writes the PNG and counts it', async () => {
    const t = setup({ paid: ['imageGeneration'] })
    const { session, events, turnDone } = await startSession(t)
    t.api.images.push({ revisedPrompt: 'a calm tabby cat' })
    t.api.script(
      { calls: [imageCall({ prompt: 'a cat', path: 'art/cat.png', aspect: 'landscape' })] },
      { text: 'Done.' },
    )
    await session.sendTurn([{ type: 'text', text: 'draw a cat' }])
    const request = await approvalRequest(events, 0)
    const tools = t.api.responseBodies()[0]?.['tools'] as readonly Record<string, unknown>[]
    expect(tools.filter((tool) => tool['name'] === 'generate_image')).toEqual([
      expect.objectContaining({
        parameters: expect.objectContaining({ required: ['prompt', 'path'] }),
      }),
    ])
    expect(request.subject).toEqual({
      kind: 'paidTool',
      toolName: 'generate_image',
      paidFeature: 'imageGeneration',
      path: 'art/cat.png',
    })
    // This once or not at all: never "always allow".
    expect(request.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
    expect(t.api.imageBodies()).toEqual([])
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.api.imageBodies()).toEqual([
      {
        model: 'muse-image-1.0',
        prompt: 'a cat',
        n: 1,
        size: '1536x1024',
        response_format: 'b64_json',
        output_format: 'png',
      },
    ])
    const written = t.io.binaries.get(`${ROOT}/art/cat.png`)
    expect([...(written?.subarray(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(t.paidUses).toEqual([{ feature: 'imageGeneration', units: 1 }])
    expect(events).toContainEqual({
      type: 'itemCompleted',
      item: expect.objectContaining({
        tool: 'generate_image',
        status: 'completed',
        paid: 'imageGeneration',
        visibleOutput: 'Created art/cat.png (landscape, 1 KiB)',
      }),
    })
    expect(toolOutput(t, 'call_img')).toContain('revised the prompt to: a calm tabby cat')
  })

  it('asks in Bypass and in Auto too, asks again for the next image, and Plan refuses it', async () => {
    for (const mode of ['allowAll', 'onRequest']) {
      const t = setup({ paid: ['imageGeneration'] })
      const { session, events, turnDone } = await startSession(t, mode)
      t.api.script(
        {
          calls: [
            imageCall({ prompt: 'one', path: 'one.png' }, 'c1'),
            imageCall({ prompt: 'two', path: 'two.png' }, 'c2'),
          ],
        },
        { text: 'ok' },
      )
      await session.sendTurn([{ type: 'text', text: 'two images' }])
      for (const index of [0, 1]) {
        const request = await approvalRequest(events, index)
        await session.decideApproval({
          approvalId: request.approvalId,
          choiceId: 'allow_once',
          requirementId: request.requirementId,
        })
      }
      await turnDone()
      expect(t.api.imageBodies()).toHaveLength(2)
      expect(t.paidUses).toHaveLength(2)
    }
    const plan = setup({ paid: ['imageGeneration'] })
    const { session, events, turnDone } = await startSession(plan, 'denyUnmatched')
    plan.api.script({ calls: [imageCall({ prompt: 'a', path: 'a.png' })] }, { text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'draw' }])
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(plan.api.imageBodies()).toEqual([])
    expect(toolOutput(plan, 'call_img')).toContain('refused by the permission mode')
  })

  it('refuses before the card what could not be saved, so nothing is asked or billed', async () => {
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ prompt: 'a', path: 'cat.jpg' }, 'must end in .png'],
      [{ prompt: 'a', path: 'taken.png' }, 'already exists'],
      [{ prompt: 'a', path: 'art' }, 'must end in .png'],
      [{ prompt: 'a', path: '../outside.png' }, 'outside'],
      [{ prompt: 'x'.repeat(4001), path: 'long.png' }, 'invalid arguments'],
      [{ prompt: '', path: 'empty.png' }, 'invalid arguments'],
    ]
    for (const [args, reason] of cases) {
      const t = setup({ paid: ['imageGeneration'], files: { 'taken.png': 'x', 'art/a.txt': 'x' } })
      const { session, events, turnDone } = await startSession(t, 'allowAll')
      t.api.script({ calls: [imageCall(args)] }, { text: 'ok' })
      await session.sendTurn([{ type: 'text', text: 'draw' }])
      await turnDone()
      expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
      expect(t.api.imageBodies()).toEqual([])
      expect(toolOutput(t, 'call_img')?.toLowerCase()).toContain(reason)
    }
  })

  it('calls nothing when the card is rejected, and counts a billed image that was not a PNG', async () => {
    const t = setup({ paid: ['imageGeneration'] })
    const { session, events, turnDone } = await startSession(t)
    t.api.images.push({ b64: Buffer.from('GIF89a…').toString('base64') })
    t.api.script(
      {
        calls: [
          imageCall({ prompt: 'no', path: 'no.png' }, 'c1'),
          imageCall({ prompt: 'odd', path: 'odd.png' }, 'c2'),
        ],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'draw' }])
    const first = await approvalRequest(events, 0)
    await session.decideApproval({
      approvalId: first.approvalId,
      choiceId: 'abort',
      requirementId: first.requirementId,
    })
    const second = await approvalRequest(events, 1)
    expect(t.api.imageBodies()).toEqual([])
    await session.decideApproval({
      approvalId: second.approvalId,
      choiceId: 'allow_once',
      requirementId: second.requirementId,
    })
    await turnDone()
    expect(t.api.imageBodies()).toHaveLength(1)
    expect(t.io.binaries.size).toBe(0)
    expect(t.paidUses).toEqual([{ feature: 'imageGeneration', units: 1 }])
    expect(toolOutput(t, 'c2')).toContain('not a PNG')
  })

  it('counts nothing and writes nothing when the service returns no image', async () => {
    const t = setup({ paid: ['imageGeneration'] })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.images.push({ isEmpty: true })
    t.api.script({ calls: [imageCall({ prompt: 'x', path: 'none.png' })] }, { text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'draw' }])
    const request = await approvalRequest(events, 0)
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.api.imageBodies()).toHaveLength(1)
    expect(t.paidUses).toEqual([])
    expect(t.io.binaries.size).toBe(0)
    expect(toolOutput(t, 'call_img')).toContain('returned no image')
  })

  it('reports an API refusal as a failed row, uncounted, and flags a protected path', async () => {
    const t = setup({ paid: ['imageGeneration'] })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.images.push({ httpError: { status: 400, message: 'prompt rejected by moderation' } })
    t.api.script({ calls: [imageCall({ prompt: 'x', path: '.vscode/icon.png' })] }, { text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'draw' }])
    const request = await approvalRequest(events, 0)
    expect(request.isProtectedWrite).toBe(true)
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.paidUses).toEqual([])
    expect(events).toContainEqual({
      type: 'itemCompleted',
      item: expect.objectContaining({
        tool: 'generate_image',
        status: 'failed',
        failureReason: 'prompt rejected by moderation',
      }),
    })
  })
})

/** One image call in Bypass, its card approved once `beforeApproval` has run. */
async function approvedImage(
  t: ReturnType<typeof setup>,
  path: string,
  beforeApproval: () => void = () => undefined,
) {
  const { session, events, turnDone } = await startSession(t, 'allowAll')
  t.api.script({ calls: [imageCall({ prompt: 'x', path })] }, { text: 'ok' })
  await session.sendTurn([{ type: 'text', text: 'draw' }])
  const request = await approvalRequest(events, 0)
  beforeApproval()
  await session.decideApproval({
    approvalId: request.approvalId,
    choiceId: 'allow_once',
    requirementId: request.requirementId,
  })
  await turnDone()
  return toolOutput(t, 'call_img')
}

describe('ModelApiSession: image generation, the review of PR #27 (M34)', () => {
  it('buys nothing when the feature is turned off while the card is open', async () => {
    const paid: PaidFeature[] = ['imageGeneration']
    const t = setup({ paid })
    const output = await approvedImage(t, 'off.png', () => {
      paid.length = 0
    })
    expect(t.api.imageBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    expect(output).toContain('image generation is off')
  })

  it('buys nothing when the path is taken while the card is open', async () => {
    const t = setup({ paid: ['imageGeneration'] })
    const output = await approvedImage(t, 'late.png', () => {
      t.files.set(`${ROOT}/late.png`, 'someone else')
    })
    expect(t.api.imageBodies()).toEqual([])
    expect(output).toContain('already exists')
    expect(t.files.get(`${ROOT}/late.png`)).toBe('someone else')
  })

  it('never retries a lost connection or a server error, which may have been billed', async () => {
    for (const image of [
      { networkError: 'socket hang up' },
      { httpError: { status: 500, message: 'boom' } },
    ]) {
      const t = setup({ paid: ['imageGeneration'] })
      t.api.images.push(image, {})
      await approvedImage(t, 'once.png')
      expect(t.api.imageBodies()).toHaveLength(1)
      // The reserved file goes when no image came.
      expect(t.io.binaries.has(`${ROOT}/once.png`)).toBe(false)
      expect(t.paidUses).toEqual([])
    }
  })

  it('retries a rate limit, which Meta refused before any work', async () => {
    const t = setup({ paid: ['imageGeneration'] })
    t.api.images.push({ httpError: { status: 429, message: 'slow down' } }, {})
    await approvedImage(t, 'later.png')
    expect(t.api.imageBodies()).toHaveLength(2)
    expect(t.paidUses).toEqual([{ feature: 'imageGeneration', units: 1 }])
    expect(t.io.binaries.get(`${ROOT}/later.png`)?.length).toBeGreaterThan(0)
  })
})

/** The `input` of the last request sent. */
function lastInput(t: ReturnType<typeof setup>): readonly Record<string, unknown>[] {
  return t.api.responseBodies().at(-1)?.['input'] as readonly Record<string, unknown>[]
}

/** Two plain turns, the first answered by `first`; the second request's input. */
async function twoTurns(first: ScriptedReply): Promise<readonly Record<string, unknown>[]> {
  const t = setup()
  const { session, turnDone } = await startSession(t)
  t.api.script(first, { text: 'later' })
  await session.sendTurn([{ type: 'text', text: 'one' }])
  await turnDone()
  await session.sendTurn([{ type: 'text', text: 'two' }])
  await turnDone()
  return lastInput(t)
}

describe('ModelApiSession: replay as Meta validates it (protocols/responses)', () => {
  it('replays text written before a tool call as commentary, and a final answer without a phase', async () => {
    const t = setup({ files: { 'a.txt': 'alpha' } })
    const { session, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        text: 'Let me read the file first.',
        phase: 'commentary',
        calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'c1' }],
      },
      { text: 'It says alpha.' },
      { text: 'later' },
    )
    await session.sendTurn([{ type: 'text', text: 'what is in a.txt?' }])
    await turnDone()
    await session.sendTurn([{ type: 'text', text: 'thanks' }])
    await turnDone()
    const messages = lastInput(t).filter(
      (item) => item['type'] === 'message' && item['role'] === 'assistant',
    )
    expect(messages).toEqual([
      expect.objectContaining({ phase: 'commentary' }),
      expect.not.objectContaining({ phase: expect.anything() }),
    ])
  })

  it('replays reasoning with its summary, an empty one when Meta sent none', async () => {
    const input = await twoTurns({ reasoning: 'hmm', isSummaryMissing: true, text: 'done' })
    const reasoning = input.find((item) => item['type'] === 'reasoning')
    expect(reasoning).toEqual(expect.objectContaining({ summary: [] }))
  })

  it('puts a minimal assistant message after a reply that was reasoning alone', async () => {
    const input = await twoTurns({ reasoning: 'thinking only' })
    const reasoningAt = input.findIndex((item) => item['type'] === 'reasoning')
    expect(input[reasoningAt + 1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '(no reply text)' }],
    })
    expect(input[reasoningAt + 2]).toEqual(expect.objectContaining({ role: 'user' }))
  })

  it('sends the whole request again when the stream ends with a retryable error, keeping the retried reply', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { text: 'Half a rep', streamError: { code: 'server_shutting_down', message: 'draining' } },
      { text: 'The whole reply.' },
      { text: 'later' },
    )
    await session.sendTurn([{ type: 'text', text: 'one' }])
    await turnDone()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turnRetry',
        attempt: 1,
        reason: 'server_shutting_down: draining',
      }),
    )
    expect(events.at(-2)).toEqual(
      expect.objectContaining({ type: 'turnCompleted', terminal: 'completed' }),
    )
    await session.sendTurn([{ type: 'text', text: 'two' }])
    await turnDone()
    const replies = lastInput(t).filter((item) => item['role'] === 'assistant')
    expect(JSON.stringify(replies)).toContain('The whole reply.')
    expect(JSON.stringify(replies)).not.toContain('Half a rep')
  })

  it('fails the turn on a stream error the guide does not call retryable', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'x', streamError: { code: 'invalid_prompt', message: 'no' } })
    await session.sendTurn([{ type: 'text', text: 'one' }])
    await turnDone()
    expect(events.some((event) => event.type === 'turnRetry')).toBe(false)
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'turnCompleted', terminal: 'failed' }),
    )
    // What the failed stream showed stays in the history (the review of PR #28).
    expect(session.history().items).toContainEqual(
      expect.objectContaining({ kind: 'agentMessage', text: 'x' }),
    )
  })

  it('retries a 502 like the other server errors', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    t.api.script({ httpError: { status: 502 } }, { text: 'fine' })
    await session.sendTurn([{ type: 'text', text: 'one' }])
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(2)
  })

  it('spends one retry budget on HTTP retries and whole-stream retries together (the review of PR #28)', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    const busy: ScriptedReply = { httpError: { status: 502 } }
    const httpRetries = Array.from({ length: MODEL_API_MAX_RETRIES - 1 }, () => busy)
    t.api.script(
      ...httpRetries,
      { text: 'Half', streamError: { code: 'service_overloaded', message: 'busy' } },
      ...Array.from({ length: MODEL_API_MAX_RETRIES + 1 }, () => busy),
    )
    await session.sendTurn([{ type: 'text', text: 'one' }])
    await turnDone()
    // The HTTP retries and the stream retry use the budget up; the next 502 ends the turn.
    expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_RETRIES + 1)
    const attempts = events.flatMap((event) => (event.type === 'turnRetry' ? [event.attempt] : []))
    expect(attempts).toEqual(Array.from({ length: MODEL_API_MAX_RETRIES }, (_, index) => index + 1))
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'turnCompleted', terminal: 'failed' }),
    )
  })

  it('keeps what the last cut-short stream showed when the retries run out (the review of PR #28)', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    t.api.script(
      ...Array.from({ length: MODEL_API_MAX_RETRIES + 1 }, (_, index): ScriptedReply => ({
        text: `Part ${String(index)}`,
        streamError: { code: 'server_shutting_down', message: 'draining' },
      })),
    )
    await session.sendTurn([{ type: 'text', text: 'one' }])
    await turnDone()
    const replies = session
      .history()
      .items.filter((item) => item.kind === 'agentMessage')
      .map((item) => item.text)
    expect(replies.at(-1)).toBe(`Part ${String(MODEL_API_MAX_RETRIES)}`)
  })
})

// --- M44: image edits, the same gate and price ---

/** An `edit_image` call as the model makes it (M44). */
function editCall(args: Record<string, unknown>, callId = 'call_edit') {
  return { name: 'edit_image', arguments: JSON.stringify(args), callId }
}

/** A session with `sources` as workspace images and paid image generation on. */
function editSetup(sources: Readonly<Record<string, Uint8Array>> = {}) {
  const t = setup({ paid: ['imageGeneration'], files: { 'notes.txt': 'x', 'taken.png': 'x' } })
  for (const [name, bytes] of Object.entries(sources)) {
    t.io.binaries.set(`${ROOT}/${name}`, bytes)
  }
  return t
}

const SOURCE_PNG = Buffer.from(TINY_PNG_BASE64, 'base64')

describe('ModelApiSession: image edits, paid and asked every time (M44)', () => {
  it('offers edit_image beside generate_image only while image generation is on', async () => {
    for (const paid of [[], ['imageGeneration']] as const) {
      const t = setup({ paid: [...paid] })
      const { session, turnDone } = await startSession(t, 'allowAll')
      await session.sendTurn([{ type: 'text', text: 'hi' }])
      await turnDone()
      const tools = t.api.responseBodies()[0]?.['tools'] as readonly Record<string, unknown>[]
      const names = tools.map((tool) => tool['name'])
      expect(names.includes('edit_image')).toBe(paid.length > 0)
    }
  })

  it('asks with the sources named, then sends them inline and writes the new PNG', async () => {
    const t = editSetup({ 'art/fox.png': SOURCE_PNG, 'art/hat.webp': SOURCE_PNG })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    const args = {
      prompt: 'put the hat on the fox',
      images: ['art/fox.png', 'art/hat.webp'],
      path: 'art/fox-hat.png',
    }
    t.api.script({ calls: [editCall(args)] }, { text: 'Done.' })
    await session.sendTurn([{ type: 'text', text: 'give the fox a hat' }])
    const request = await approvalRequest(events, 0)
    expect(request.subject).toEqual({
      kind: 'paidTool',
      toolName: 'edit_image',
      paidFeature: 'imageGeneration',
      path: 'art/fox-hat.png',
    })
    expect(JSON.parse(request.rawArgs)).toEqual(args)
    expect(t.api.editBodies()).toEqual([])
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.api.editBodies()).toEqual([
      {
        model: 'muse-image-1.0',
        prompt: 'put the hat on the fox',
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
        output_format: 'png',
        images: [
          { image_url: `data:image/png;base64,${TINY_PNG_BASE64}` },
          { image_url: `data:image/webp;base64,${TINY_PNG_BASE64}` },
        ],
      },
    ])
    expect(t.api.imageBodies()).toEqual([])
    expect(t.io.binaries.get(`${ROOT}/art/fox-hat.png`)?.subarray(0, 4)).toEqual(
      SOURCE_PNG.subarray(0, 4),
    )
    // The sources are left as they were.
    expect(t.io.binaries.get(`${ROOT}/art/fox.png`)).toEqual(SOURCE_PNG)
    expect(t.paidUses).toEqual([{ feature: 'imageGeneration', units: 1 }])
    expect(toolOutput(t, 'call_edit')).toContain(
      'Created art/fox-hat.png from art/fox.png, art/hat.webp',
    )
  })

  it('refuses before the card a source it could not send or a result it could not save', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ prompt: 'a', images: ['missing.png'], path: 'out.png' }, 'does not exist'],
      [{ prompt: 'a', images: ['../outside.png'], path: 'out.png' }, 'outside'],
      [{ prompt: 'a', images: ['notes.txt'], path: 'out.png' }, 'not a png, jpeg or webp'],
      [{ prompt: 'a', images: ['anim.gif'], path: 'out.png' }, 'not a png, jpeg or webp'],
      [{ prompt: 'a', images: ['big.png'], path: 'out.png' }, 'over'],
      [{ prompt: 'a', images: [], path: 'out.png' }, 'invalid arguments'],
      [
        { prompt: 'a', images: ['a.png', 'a.png', 'a.png', 'a.png', 'a.png'], path: 'out.png' },
        'invalid arguments',
      ],
      [{ prompt: 'a', images: ['a.png'], path: 'taken.png' }, 'already exists'],
      [{ prompt: 'a', images: ['a.png'], path: 'out.jpg' }, 'must end in .png'],
    ]
    for (const [args, reason] of cases) {
      const t = editSetup({ 'a.png': SOURCE_PNG, 'anim.gif': SOURCE_PNG, 'big.png': big })
      const { session, events, turnDone } = await startSession(t, 'allowAll')
      t.api.script({ calls: [editCall(args)] }, { text: 'ok' })
      await session.sendTurn([{ type: 'text', text: 'edit' }])
      await turnDone()
      expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
      expect(t.api.editBodies()).toEqual([])
      expect(toolOutput(t, 'call_edit')?.toLowerCase()).toContain(reason)
    }
  })

  it('is refused in Plan, and with image generation off, without a card', async () => {
    const plan = editSetup({ 'a.png': SOURCE_PNG })
    const planned = await startSession(plan, 'denyUnmatched')
    plan.api.script(
      { calls: [editCall({ prompt: 'a', images: ['a.png'], path: 'b.png' })] },
      { text: 'ok' },
    )
    await planned.session.sendTurn([{ type: 'text', text: 'edit' }])
    await planned.turnDone()
    expect(toolOutput(plan, 'call_edit')).toContain('refused by the permission mode')
    const off = setup()
    const { session, events, turnDone } = await startSession(off, 'allowAll')
    off.api.script(
      { calls: [editCall({ prompt: 'a', images: ['a.png'], path: 'b.png' })] },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'edit' }])
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(toolOutput(off, 'call_edit')).toContain('image generation is off')
    expect(off.api.editBodies()).toEqual([])
  })
})

/** The goals a session reported, in order (M45). */
function goalEvents(events: readonly AgentEvent[]) {
  return events.flatMap((event) => (event.type === 'goalChanged' ? [event.goal] : []))
}

/** The instructions of the n-th request to the fake API. */
function instructionsOf(t: ReturnType<typeof setup>, index: number) {
  return String(t.api.responseBodies()[index]?.['instructions'])
}

/** Establish an active budgeted goal with one completed model turn. */
async function beginBudgetGoal(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
): Promise<void> {
  t.api.script(
    {
      calls: [
        {
          name: 'create_goal',
          arguments: '{"objective":"Ship it","token_budget":100}',
          callId: 'goal',
        },
      ],
    },
    { text: 'Working' },
  )
  await session.sendTurn([{ type: 'text', text: 'go' }])
  await turnDone()
}

/** Records whether any persisted replay had a call without its output. */
function storeTrackingPendingCalls() {
  const store = memorySessionStore()
  const savedWithoutOutput: boolean[] = []
  const save = store.save.bind(store)
  store.save = (snapshot) => {
    const outputs = new Set(
      snapshot.replay.flatMap((entry) =>
        entry.item.type === 'function_call_output' ? [entry.item.call_id] : [],
      ),
    )
    savedWithoutOutput.push(
      snapshot.replay.some(
        (entry) => entry.item.type === 'function_call' && !outputs.has(entry.item.call_id),
      ),
    )
    return save(snapshot)
  }
  return { store, savedWithoutOutput }
}

const GOAL_WAKE_MESSAGE = {
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text: MODEL_TEXT.goalWake }],
}

describe('ModelApiHost: the session goal (M45, PLAN.md D38)', () => {
  it("runs Muse Code's goal tools with its result shape and pins the goal into the next request", async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'create_goal', arguments: '{"objective":"Ship it"}', callId: 'c1' }] },
      {
        calls: [
          {
            name: 'report_progress',
            arguments: '{"current_work":"Tests","next_work":"Docs","percent_complete":50}',
            callId: 'c2',
          },
        ],
      },
      { text: 'Halfway.' },
    )
    await session.sendTurn([{ type: 'text', text: 'set a goal and work on it' }])
    await turnDone()
    expect(goalEvents(events)).toEqual([
      { objective: 'Ship it', status: 'active', percentComplete: 0 },
      {
        objective: 'Ship it',
        status: 'active',
        percentComplete: 50,
        currentWork: 'Tests',
        nextWork: 'Docs',
      },
    ])
    const row = events.find(
      (event) => event.type === 'itemCompleted' && event.item.tool === 'create_goal',
    )
    expect(row?.type === 'itemCompleted' && JSON.parse(row.item.visibleOutput ?? '')).toMatchObject(
      { goal: { session_id: session.sessionId, objective: 'Ship it', status: 'active' } },
    )
    expect(t.api.responseBodies()[0]?.['tools']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'create_goal' }),
        expect.objectContaining({ name: 'get_goal' }),
        expect.objectContaining({ name: 'update_goal' }),
        expect.objectContaining({ name: 'report_progress' }),
      ]),
    )
    expect(instructionsOf(t, 0)).not.toContain('# Session goal')
    expect(instructionsOf(t, 1)).toContain('- Objective: Ship it')
    expect(instructionsOf(t, 2)).toContain('- Current work: Tests')
    expect(session.history().goal).toMatchObject({ objective: 'Ship it', percentComplete: 50 })
  })

  it('wakes a turn when the user sets a goal while idle, with no card for its cue', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [{ name: 'update_goal', arguments: '{"status":"complete"}', callId: 'c1' }],
      },
      { text: 'hello' },
    )
    const outcome = await session.controlGoal({ verb: 'set', objective: 'Say hello' })
    await turnDone()
    expect(outcome.turnId).toBeDefined()
    expect(events).toContainEqual({ type: 'turnStarted', turnId: outcome.turnId })
    expect(t.api.responseBodies()[0]?.['input']).toContainEqual(GOAL_WAKE_MESSAGE)
    expect(instructionsOf(t, 0)).toContain('- Objective: Say hello')
    expect(session.history().items.some((item) => item.kind === 'userMessage')).toBe(false)
    expect(session.record().title).toBe('Say hello')
    expect(goalEvents(events).at(-1)).toEqual({
      objective: 'Say hello',
      status: 'complete',
      percentComplete: 100,
    })
  })

  it('follows MSP: a busy set joins the turn, pause and clear never wake, refusals as captured', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ calls: [ASK_USER_CALL] }, { text: 'done' })
    const running = await session.sendTurn([{ type: 'text', text: 'ask me' }])
    const question = await awaitQuestion(events)
    await expect(session.controlGoal({ verb: 'set', objective: 'Ship it' })).resolves.toEqual({
      turnId: running.turnId,
    })
    await session.answerQuestions(question.userInputId, [{ questionId: 'q', selectedLabel: 'Red' }])
    await turnDone()
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(1)
    await expect(session.controlGoal({ verb: 'pause' })).resolves.toEqual({ turnId: undefined })
    await expect(session.controlGoal({ verb: 'pause' })).rejects.toMatchObject({
      name: 'GoalRefusedError',
      refusal: 'wrongState',
    })
    // An edit of a paused goal keeps it paused, and wakes nothing (live 2026-09-25).
    await expect(session.controlGoal({ verb: 'edit', objective: 'Ship it now' })).resolves.toEqual({
      turnId: undefined,
    })
    await expect(session.controlGoal({ verb: 'edit', objective: '  ' })).rejects.toThrow(
      MODEL_TEXT.goalEmptyObjective,
    )
    await session.controlGoal({ verb: 'clear' })
    await expect(session.controlGoal({ verb: 'clear' })).rejects.toMatchObject({
      refusal: 'noGoal',
    })
    expect(goalEvents(events).slice(-3)).toEqual([
      { objective: 'Ship it', status: 'paused', percentComplete: 0 },
      { objective: 'Ship it now', status: 'paused', percentComplete: 0 },
      null,
    ])
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(1)
  })

  it('gives a busy goal command a new round after a final streaming reply', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'Before the goal', hold: held.promise }, { text: 'Working on it' })
    const running = await session.sendTurn([{ type: 'text', text: 'First request' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(1)
    })
    await expect(session.controlGoal({ verb: 'set', objective: 'Ship it' })).resolves.toEqual({
      turnId: running.turnId,
    })
    held.resolve(undefined)
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(instructionsOf(t, 0)).not.toContain('# Session goal')
    expect(instructionsOf(t, 1)).toContain('- Objective: Ship it')
    expect(t.api.responseBodies()[1]?.['input']).toContainEqual(GOAL_WAKE_MESSAGE)
    expect(session.history().items.filter((item) => item.kind === 'userMessage')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(1)
  })

  it('starts a fresh goal turn when a busy command arrives in the last tool round', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    const tool = { name: 'get_goal', arguments: '{}' }
    t.api.script(
      ...Array.from({ length: MODEL_API_MAX_TOOL_ROUNDS - 1 }, () => ({ calls: [tool] })),
      { calls: [tool], hold: held.promise },
      { text: 'Working on the goal' },
    )
    await session.sendTurn([{ type: 'text', text: 'many tool rounds' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS)
    })
    await session.controlGoal({ verb: 'set', objective: 'New goal' })
    held.resolve(undefined)
    await turnDone()
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS + 1)
    })
    expect(instructionsOf(t, MODEL_API_MAX_TOOL_ROUNDS)).toContain('- Objective: New goal')
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(2)
  })

  const staleGoalCases: readonly {
    readonly command: Parameters<ModelApiSession['controlGoal']>[0]
    readonly call: { readonly name: string; readonly arguments: string; readonly callId: string }
  }[] = [
    {
      command: { verb: 'set', objective: 'Replacement' },
      call: { name: 'update_goal', arguments: '{"status":"complete"}', callId: 'old' },
    },
    {
      command: { verb: 'edit', objective: 'Replacement' },
      call: {
        name: 'report_progress',
        arguments: '{"current_work":"Old work","next_work":"Done","percent_complete":100}',
        callId: 'old',
      },
    },
  ]
  it.each(staleGoalCases)(
    'rejects stale goal calls after a busy $command.verb',
    async ({ command, call }) => {
      const t = setup()
      const { session, events, turnDone } = await startSession(t)
      const held = Promise.withResolvers<undefined>()
      t.api.script({ calls: [call], hold: held.promise }, { text: 'Working on replacement' })
      await session.controlGoal({ verb: 'set', objective: 'Original' })
      await vi.waitFor(() => {
        expect(t.api.responseBodies()).toHaveLength(1)
      })
      await session.controlGoal(command)
      held.resolve(undefined)
      await turnDone()
      expect(session.history().goal).toMatchObject({
        objective: 'Replacement',
        status: 'active',
        percentComplete: 0,
      })
      expect(t.api.responseBodies()).toHaveLength(2)
      expect(instructionsOf(t, 1)).toContain('- Objective: Replacement')
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'itemCompleted',
          item: expect.objectContaining({ tool: call.name, status: 'failed' }),
        }),
      )
    },
  )

  it('pauses an active goal when Stop ends its turn, as Esc does in Muse Code', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ calls: [ASK_USER_CALL] })
    await session.controlGoal({ verb: 'set', objective: 'Ship it' })
    await awaitQuestion(events)
    await session.cancel()
    await turnDone()
    expect(goalEvents(events).at(-1)).toEqual({
      objective: 'Ship it',
      status: 'paused',
      percentComplete: 0,
    })
  })

  it('counts what the goal used against its budget and stops it when spent', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":100}',
            callId: 'c1',
          },
        ],
        usage: { input: 50, output: 5 },
      },
      { text: 'working', usage: { input: 90, output: 20 } },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await turnDone()
    expect(goalEvents(events).at(-1)).toMatchObject({ status: 'budget_limited' })
    expect(session.snapshot().goal).toMatchObject({ token_budget: 100, tokens_used: 110 })
  })

  it('does not run returned tools or buy another round after the goal budget runs out', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":100}',
            callId: 'goal',
          },
        ],
      },
      {
        calls: [
          { name: 'write_file', arguments: '{"path":"first.txt","content":"x"}', callId: 'first' },
          {
            name: 'write_file',
            arguments: '{"path":"second.txt","content":"x"}',
            callId: 'second',
          },
        ],
        usage: { input: 90, output: 10 },
      },
      { text: 'Next user turn' },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await turnDone()
    expect(goalEvents(events).at(-1)).toMatchObject({ status: 'budget_limited' })
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.files.has(`${ROOT}/first.txt`)).toBe(false)
    expect(t.files.has(`${ROOT}/second.txt`)).toBe(false)
    await session.sendTurn([{ type: 'text', text: 'A separate question' }])
    await turnDone()
    expect(outputFor(t.api.responseBodies()[2], 'first')).toMatchObject({
      output: `Error: ${MODEL_TEXT.goalBudgetReached}`,
    })
    expect(outputFor(t.api.responseBodies()[2], 'second')).toMatchObject({
      output: `Error: ${MODEL_TEXT.goalBudgetReached}`,
    })
  })

  it('withdraws a goal wake queued during compaction when the budget is spent', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    await beginBudgetGoal(t, session, turnDone)

    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'Summary', hold: held.promise, usage: { input: 90, output: 10 } })
    const compacting = session.compact()
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(3)
    })
    await session.controlGoal({ verb: 'pause' })
    const wake = await session.controlGoal({ verb: 'resume' })
    expect(wake.turnId).toBeDefined()
    held.resolve(undefined)
    await compacting

    expect(session.snapshot().goal).toMatchObject({ status: 'budget_limited' })
    expect(t.api.responseBodies()).toHaveLength(3)
    expect(events).toContainEqual({
      type: 'turnWithdrawn',
      turnId: wake.turnId,
      reason: UI_TEXT.goalWakeWithdrawn,
    })
    expect(
      events.some((event) => event.type === 'turnStarted' && event.turnId === wake.turnId),
    ).toBe(false)
  })

  it('charges a held response to its original goal even when the goal is paused', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    await beginBudgetGoal(t, session, turnDone)
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'Before pause', hold: held.promise, usage: { input: 90, output: 10 } })
    await session.sendTurn([{ type: 'text', text: 'continue' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(3)
    })
    await session.controlGoal({ verb: 'pause' })
    held.resolve(undefined)
    await turnDone()
    expect(session.snapshot().goal).toMatchObject({ status: 'budget_limited', tokens_used: 115 })
    expect(t.api.responseBodies()).toHaveLength(3)
  })

  it('does not charge an old request to a goal resumed while it streamed', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    await beginBudgetGoal(t, session, turnDone)
    await session.controlGoal({ verb: 'pause' })
    const old = Promise.withResolvers<undefined>()
    const wake = Promise.withResolvers<undefined>()
    t.api.script(
      { text: 'Old answer', hold: old.promise, usage: { input: 90, output: 10 } },
      { text: 'Goal answer', hold: wake.promise, usage: { input: 1, output: 1 } },
    )
    await session.sendTurn([{ type: 'text', text: 'unrelated request' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(3)
    })
    await session.controlGoal({ verb: 'resume' })
    old.resolve(undefined)
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(4)
    })
    expect(session.snapshot().goal).toMatchObject({ status: 'active', tokens_used: 15 })
    wake.resolve(undefined)
    await turnDone()
    expect(session.snapshot().goal).toMatchObject({ status: 'active', tokens_used: 17 })
  })

  it('pauses an active goal when Stop cancels a compaction', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'Goal work' })
    await session.controlGoal({ verb: 'set', objective: 'Ship it' })
    await turnDone()
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'Summary', hold: held.promise })
    const compacting = session.compact()
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(2)
    })
    await session.cancel()
    held.resolve(undefined)
    await expect(compacting).resolves.toMatchObject({ status: 'cancelled' })
    expect(session.snapshot().goal).toMatchObject({ status: 'paused' })
  })

  it('refuses an incomplete compaction and still charges its goal usage', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    await beginBudgetGoal(t, session, turnDone)
    t.api.script({
      text: 'PARTIAL SUMMARY',
      incomplete: { reason: 'max_output_tokens' },
      usage: { input: 90, output: 10 },
    })
    await expect(session.compact()).rejects.toThrow('response.incomplete')
    expect(session.snapshot().goal).toMatchObject({ status: 'budget_limited', tokens_used: 115 })
    expect(session.history().items.some((item) => item.kind === 'compaction')).toBe(false)
    t.api.script({ text: 'Next answer' })
    await session.sendTurn([{ type: 'text', text: 'next request' }])
    await turnDone()
    const replay = JSON.stringify(t.api.responseBodies().at(-1)?.['input'])
    expect(replay).toContain('go')
    expect(replay).not.toContain('PARTIAL SUMMARY')
  })

  it.each([false, true])('persists incomplete compaction usage (goal: %s)', async (withGoal) => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    if (withGoal) {
      await beginBudgetGoal(t, session, turnDone)
    } else {
      t.api.script({ text: 'Start' })
      await session.sendTurn([{ type: 'text', text: 'go' }])
      await turnDone()
    }
    const before = session.snapshot().usage
    t.api.script({
      text: 'PARTIAL SUMMARY',
      incomplete: { reason: 'max_output_tokens' },
      usage: { input: 90, output: 10 },
    })
    await expect(session.compact()).rejects.toThrow('response.incomplete')
    await t.host.close()
    expect(session.snapshot().usage.inputTokens).toBe(before.inputTokens + 90)
    expect(session.snapshot().usage.outputTokens).toBe(before.outputTokens + 10)
    expect(store.saved.get(session.sessionId)?.usage).toEqual(session.snapshot().usage)
  })

  it('never saves a pending function call without its output', async () => {
    const { store, savedWithoutOutput } = storeTrackingPendingCalls()
    const t = setup({ store })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          { name: 'todo_write', arguments: '{"items":[{"text":"First","status":"completed"}]}' },
          ASK_USER_CALL,
        ],
      },
      { text: 'Done' },
    )
    await session.sendTurn([{ type: 'text', text: 'ask me' }])
    const question = await awaitQuestion(events)
    await session.controlGoal({ verb: 'set', objective: 'Ship it' })
    await session.answerQuestions(question.userInputId, [{ questionId: 'q', selectedLabel: 'Red' }])
    await turnDone()
    await t.host.close()
    expect(savedWithoutOutput).not.toContain(true)
  })

  it('saves goal tool calls only after their outputs', async () => {
    const { store, savedWithoutOutput } = storeTrackingPendingCalls()
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'create_goal', arguments: '{"objective":"Ship it"}', callId: 'goal' }] },
      { text: 'Working' },
    )
    await session.sendTurn([{ type: 'text', text: 'set a goal' }])
    await turnDone()
    await t.host.close()
    expect(savedWithoutOutput).not.toContain(true)
  })

  it('keeps the goal with the stored session, and forks carry it', async () => {
    const store = memorySessionStore()
    const first = setup({ store })
    const { session, turnDone } = await startSession(first)
    first.api.script({ text: 'ok' })
    await session.controlGoal({ verb: 'set', objective: 'Ship it' })
    await turnDone()
    await session.controlGoal({ verb: 'pause' })
    await first.host.close()
    const saved = store.saved.get(session.sessionId)
    expect(saved?.goal).toMatchObject({ objective: 'Ship it', status: 'paused' })
    expect(parseStoredSession(structuredClone(saved))).toMatchObject({
      ok: true,
      session: { goal: { objective: 'Ship it', status: 'paused' } },
    })
    const second = setup({ store })
    await second.host.load()
    const expected = { objective: 'Ship it', status: 'paused', percentComplete: 0 }
    const read = await second.host.readSession(session.sessionId)
    expect(read.goal).toEqual(expected)
    const resumed = await second.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(resumed.history.goal).toEqual(expected)
    const fork = await second.host.forkSession(session.sessionId, 'muse-spark-1.3')
    expect(fork.history.goal).toEqual(expected)
  })
})
