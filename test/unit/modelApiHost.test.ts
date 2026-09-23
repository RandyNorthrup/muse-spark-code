import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  ModelApiHost,
  type ModelApiHostDeps,
  type ModelApiSession,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { memorySessionStore } from './helpers/fakeSessionStore'
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
  } = {},
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(options.files ?? {}, ROOT)
  let ids = 0
  let clock = 1_000_000
  const client = new ModelApiClient({
    fetch: api.fetch,
    baseUrl: 'https://api.example.test/v1',
    apiKey: () => Promise.resolve('LLM|1|secret'),
    sleep: () => Promise.resolve(),
    random: () => 0,
    log,
  })
  const host = new ModelApiHost({
    client,
    workspaceRoot: ROOT,
    platform: options.platform ?? 'linux',
    io,
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
  })
  return { api, host, log, files: io.files, shellCalls: io.shellCalls }
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
    t.api.script({ text: 'first reply' })
    await session.sendTurn([{ type: 'text', text: 'first' }])
    await turnDone()
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

  it('remembers "always allow in this session" and refuses in Plan mode', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"ls","description":"list"}' }] },
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
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_session',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(events.filter((event) => event.type === 'approvalRequested')).toHaveLength(1)
    expect(t.shellCalls.map((call) => call.command)).toEqual(['ls', 'pwd'])

    await session.setApprovalMode('denyUnmatched')
    await expect(session.setApprovalMode('whatever')).rejects.toThrow('unknown approval mode')
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"rm -rf x","description":"d"}' }] },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'again' }])
    await turnDone()
    expect(t.shellCalls).toHaveLength(2)
    const refused = events.findLast(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall',
    )
    expect(refused?.item).toMatchObject({
      status: 'rejected',
      failureReason: 'bash refused by the permission mode',
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
    t.api.script({ text: 'first reply' })
    await session.sendTurn([{ type: 'text', text: 'first' }])
    await turnDone()
    t.api.script({ text: 'THE SUMMARY' })
    t.api.inputTokens = 77
    await expect(session.compact()).resolves.toEqual({ status: 'accepted', reason: undefined })
    const compactionBody = t.api.responseBodies().at(-1)
    expect(compactionBody?.['tools']).toEqual([])
    expect(JSON.stringify(compactionBody?.['input'])).toContain('Summarise this conversation')
    expect(events.at(-2)).toMatchObject({
      type: 'itemCompleted',
      item: { kind: 'compaction', fallbackText: 'Context compacted' },
    })
    expect(events.at(-1)).toEqual({
      type: 'contextUsage',
      usedTokens: 77,
      windowTokens: 1_048_576,
      pressure: 'low',
    })
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
