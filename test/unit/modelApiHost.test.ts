import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  CLARIFICATION_MAX_CHARS,
  HOOK_MAX_STOP_CONTINUATIONS,
  MODEL_API_MAX_RETRIES,
  MODEL_API_MAX_TOOL_ROUNDS,
  GOAL_OBJECTIVE_MAX_CHARS,
  MAX_MODEL_API_TEXT_ATTACHMENT_BYTES,
  MODEL_TEXT,
  SCHEDULE_LIFETIME_MS,
  type PaidFeature,
  type PromptCacheRetention,
  UI_TEXT,
} from '../../src/shared/constants'
import type { AgentSession, DocumentPart, TurnPart } from '../../src/core/agent/agentBackend'
import { AttachmentStore } from '../../src/core/attachments'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type { PaidUseRequest } from '../../src/shared/paid'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type ScriptedReply,
  TINY_PNG_BASE64,
} from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import {
  parseStoredSession,
  type StoredSession,
} from '../../src/core/backends/modelapi/sessionStore'
import { heldShellToolIo, type MemoryToolIo, memoryToolIo } from './helpers/fakeToolIo'
import { pdfFixture } from './helpers/pdfFixture'
import { createFileScheduleStore } from '../../src/host/backend/fileScheduleStore'
import type {
  ScheduledPrompt,
  ScheduleRunConfirmation,
  ScheduleStore,
} from '../../src/shared/schedule'
import { removeFolder } from './helpers/temporaryFolders'
import { parseHookConfig, type HookDefinition } from '../../src/core/backends/modelapi/hooks'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { type FakeMcpSource, fakeMcpSource } from './helpers/fakeMcpSource'
import type { McpCallOutcome } from '../../src/core/backends/modelapi/mcp/functions'
import { countLogged } from './helpers/logText'
import type { McpTool } from '../../src/core/mcp'
import type { WebFetcher, WebFetchResult } from '../../src/core/web/webFetch'
import { memoryStoreOver, PERSONAL } from './helpers/fakeMemoryIo'

const ROOT = '/ws'

/** A child turn carries its task marker; prompt-cache keys now name shared prefixes. */
function isChildRequest(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'input' in body &&
    body.input !== undefined &&
    JSON.stringify(body.input).includes(MODEL_TEXT.subagentObjective)
  )
}

function hooksFor(event: string, command: string): readonly HookDefinition[] {
  return parseHookConfig(
    JSON.stringify({
      hooks: {
        [event]: [{ hooks: [{ type: 'command', command }] }],
      },
    }),
    'project',
    'linux',
  ).hooks
}

function permitHook() {
  return hookReply(JSON.stringify({ decision: { behavior: 'allow' } }))
}

function denyHook() {
  return hookReply(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'policy denied' },
      },
    }),
  )
}

function hookReply(stdout = '{}') {
  return Promise.resolve({
    stdout,
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
    isCancelled: false,
  })
}

function recordHookPayloads(payloads: unknown[]): NonNullable<ToolIo['runHook']> {
  return (_command, payload) => {
    payloads.push(z.unknown().parse(JSON.parse(payload)))
    return hookReply()
  }
}

function recordRawHookPayloads(payloads: string[]): NonNullable<ToolIo['runHook']> {
  return (_command, payload) => {
    payloads.push(payload)
    return hookReply('')
  }
}

function postVetoHook(isBlocked: () => boolean): NonNullable<ToolIo['runHook']> {
  return () =>
    hookReply(isBlocked() ? JSON.stringify({ decision: 'block', reason: 'Post veto' }) : '{}')
}

function modelCallObserver(payloads: unknown[]): ReturnType<typeof setup> {
  return setup({
    hooks: [...hooksFor('PreLLMCall', 'observe'), ...hooksFor('PostLLMCall', 'observe')],
    runHook: recordHookPayloads(payloads),
  })
}

function scriptWriteCalls(
  t: ReturnType<typeof setup>,
  ...calls: readonly { readonly path: string; readonly content: string; readonly callId?: string }[]
): void {
  t.api.script(
    {
      calls: calls.map(({ path, content, callId }) => ({
        name: 'write_file',
        arguments: JSON.stringify({ path, content }),
        ...(callId !== undefined && { callId }),
      })),
    },
    { text: 'done' },
  )
}

async function completeWriteTurn(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
  path: string,
  content: string,
  callId?: string,
): Promise<void> {
  scriptWriteCalls(t, { path, content, ...(callId !== undefined && { callId }) })
  await session.sendTurn([{ type: 'text', text: 'write' }])
  await turnDone()
}

async function completeUnpromptedWrite(t: ReturnType<typeof setup>): Promise<AgentEvent[]> {
  const { session, events, turnDone } = await startSession(t)
  await completeWriteTurn(t, session, turnDone, 'notes.txt', 'x', 'c')
  expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
  return events
}

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
    /** The paid-use popup (M58); every use is allowed unless a test says otherwise. */
    allowsPaidUse?: ModelApiHostDeps['allowsPaidUse']
    /** The features allowed always in this workspace (M58). */
    remembered?: readonly PaidFeature[]
    apiKey?: () => Promise<string | undefined>
    /** The tools' files and shell, when a test needs its own (M46: a held shell). */
    io?: MemoryToolIo
    /** `museSpark.modelApiPromptCacheRetention` (M56); in memory unless a test says so. */
    retention?: PromptCacheRetention
    mediaBudgetMaxEncodedChars?: number
    scheduleStore?: ScheduleStore
    getAccountId?: () => Promise<string | undefined>
    newId?: () => string
    hooks?: readonly HookDefinition[]
    runHook?: NonNullable<ToolIo['runHook']>
    isHooksEnabled?: () => boolean
    hookNotificationDelayMs?: number
    /** The MCP servers and the IDE tools (M50). */
    mcpServers?: ModelApiHostDeps['mcpServers']
    ideTools?: ModelApiHostDeps['ideTools']
    /** False: the host has no memory store (M49). */
    hasMemory?: boolean
    /** Folders the memory fake reports as links to elsewhere (M49). */
    memoryLinks?: Record<string, string>
    /** The window's web fetch (M69); none unless a test gives one. */
    webFetch?: ModelApiHostDeps['webFetch']
  } = {},
) {
  const paidUses: { readonly feature: PaidFeature; readonly units: number }[] = []
  // What the paid-use popup was asked (M58), in order, and whether it had to ask.
  const paidRequests: { readonly request: PaidUseRequest; readonly requiresAsking: boolean }[] = []
  // The conversation each question was asked in, in the same order.
  const paidSessions: string[] = []
  const subagentUsage: {
    readonly modelId: string
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cachedTokens: number
  }[] = []
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = options.io ?? memoryToolIo(options.files ?? {}, ROOT)
  if (options.runHook !== undefined) {
    io.runHook = options.runHook
  }
  // Muse Code's memory over the same files the tools see (M49).
  const memory =
    options.hasMemory === false
      ? undefined
      : memoryStoreOver(io.files, {
          platform: options.platform ?? 'linux',
          ...(options.memoryLinks !== undefined && { links: options.memoryLinks }),
        }).store
  let ids = 0
  let clock = 1_000_000
  const client =
    options.apiKey === undefined
      ? fakeModelApiClient(api, log)
      : new ModelApiClient({
          fetch: api.fetch,
          baseUrl: 'https://api.example.test/v1',
          apiKey: options.apiKey,
          sleep: () => Promise.resolve(),
          now: () => 0,
          random: () => 0,
          log,
        })
  const host = new ModelApiHost({
    client,
    workspaceRoot: ROOT,
    platform: options.platform ?? 'linux',
    io,
    // The context loaders read the same files the tools do.
    contextIo: memoryContextIo(io.files),
    newId:
      options.newId ??
      (() => {
        ids += 1
        return `id${String(ids)}`
      }),
    now: () => {
      clock += 1000
      return clock
    },
    log,
    personalSkillsRoot: options.personalSkillsRoot,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    store: options.store,
    scheduleStore: options.scheduleStore,
    getAccountId: options.getAccountId ?? (() => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID)),
    describeEnvironment: options.describeEnvironment ?? (() => Promise.resolve({ git: undefined })),
    isPaidFeatureOn: (feature) => options.paid?.includes(feature) === true,
    notePaidUse: (feature, units) => {
      paidUses.push({ feature, units })
    },
    promptCacheRetention: () => options.retention ?? 'in_memory',
    ...(options.mediaBudgetMaxEncodedChars !== undefined && {
      mediaBudgetMaxEncodedChars: options.mediaBudgetMaxEncodedChars,
    }),
    mcpServers: options.mcpServers,
    ideTools: options.ideTools,
    allowsPaidUse: async (request, requiresAsking, sessionId) => {
      paidRequests.push({ request, requiresAsking })
      paidSessions.push(sessionId)
      return await (options.allowsPaidUse?.(request, requiresAsking, sessionId) ??
        Promise.resolve(true))
    },
    isPaidUseRemembered: (feature) => options.remembered?.includes(feature) === true,
    noteSubagentUsage: (modelId, usage) => {
      subagentUsage.push({ modelId, ...usage })
    },
    loadHooks: () => Promise.resolve(options.hooks ?? []),
    isHooksEnabled: options.isHooksEnabled,
    hookNotificationDelayMs: options.hookNotificationDelayMs,
    memory,
    webFetch: options.webFetch,
  })
  return {
    api,
    client,
    host,
    log,
    io,
    files: io.files,
    shellCalls: io.shellCalls,
    paidUses,
    paidRequests,
    paidSessions,
    advanceClock: (ms: number) => {
      clock += ms
    },
    subagentUsage,
  }
}

async function startSession(
  t: ReturnType<typeof setup>,
  approvalMode = 'promptUnmatched',
  isSideChat = false,
): Promise<{ session: ModelApiSession; events: AgentEvent[]; turnDone: () => Promise<void> }> {
  const session = (await t.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode,
    ...(isSideChat && { sideChat: true }),
  })) as ModelApiSession
  return { session, ...watchTurns(session) }
}

/** A session's events, and a wait for its next turn's end. */
function watchTurns(session: AgentSession): {
  events: AgentEvent[]
  turnDone: () => Promise<void>
} {
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
  return { events, turnDone: () => done.promise }
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

/**
 * A paid-use popup (M58) that allows every use at once until `hold` is
 * called; from then on each use waits until the test settles the answer
 * `hold` returned, as a user would while the popup is open.
 */
function paidPopup() {
  let held: PromiseWithResolvers<boolean> | undefined
  return {
    allowsPaidUse: (): Promise<boolean> => held?.promise ?? Promise.resolve(true),
    hold: (): PromiseWithResolvers<boolean> => {
      held = Promise.withResolvers<boolean>()
      return held
    },
  }
}

/** Waits until the paid-use popup has been asked `count` times in all. */
async function paidPopupAsked(t: ReturnType<typeof setup>, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(t.paidRequests).toHaveLength(count)
  })
}

/** Whether any approval card was shown: a paid call never gets one (M58). */
function hasApprovalCard(events: readonly AgentEvent[]): boolean {
  return events.some((event) => event.type === 'approvalRequested')
}

/** One plain turn: "first", answered "first reply". */
async function answerFirst(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
): Promise<string> {
  t.api.script({ text: 'first reply' })
  const submitted = await session.sendTurn([{ type: 'text', text: 'first' }])
  await turnDone()
  return submitted.turnId
}

async function openSideFork(t: ReturnType<typeof setup>, session: AgentSession) {
  const side = await t.host.forkSession(session.sessionId, session.modelId, undefined, {
    sideChat: true,
  })
  expect(side.record.sideChat).toBe(true)
  return side
}

async function answerWithPdf(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
  pageCount: number,
): Promise<string> {
  const bytes = pdfFixture(pageCount)
  const base64Data = Buffer.from(bytes).toString('base64')
  t.api.script({ text: 'I read it' })
  await session.sendTurn([
    { type: 'text', text: 'Read the report' },
    {
      type: 'file',
      name: 'report.pdf',
      mediaType: 'application/pdf',
      base64Data,
      sizeBytes: bytes.length,
      pageCount,
    },
  ])
  await turnDone()
  return base64Data
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

/** One more request after Stop, so a tool-read file cannot hide in later replay (M54). */
async function nextInputAfterStop(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
): Promise<string> {
  t.api.script({ text: 'fresh' })
  await session.sendTurn([{ type: 'text', text: 'Next request' }])
  await turnDone()
  const input = t.api.responseBodies().at(-1)?.['input']
  if (!Array.isArray(input)) {
    throw new TypeError('expected the next Model API request input')
  }
  return JSON.stringify(input)
}

/** Two different PDFs so replay proves which round's bytes were delivered. */
function twoToolPdfs(t: ReturnType<typeof setup>): {
  readonly firstData: string
  readonly laterData: string
} {
  const first = pdfFixture(1)
  const later = pdfFixture(2)
  t.io.binaries.set('/ws/docs/first.pdf', first)
  t.io.binaries.set('/ws/docs/later.pdf', later)
  return {
    firstData: `data:application/pdf;base64,${Buffer.from(first).toString('base64')}`,
    laterData: `data:application/pdf;base64,${Buffer.from(later).toString('base64')}`,
  }
}

/** One model round that asks to read two workspace PDFs in call order. */
function requestTwoToolPdfs(t: ReturnType<typeof setup>, answer: string): void {
  t.api.script(
    {
      calls: [
        { name: 'read_file', arguments: '{"path":"docs/first.pdf"}', callId: 'read_first' },
        { name: 'read_file', arguments: '{"path":"docs/second.pdf"}', callId: 'read_second' },
      ],
    },
    { text: answer },
  )
}

function mcpImages(...urls: readonly string[]): McpCallOutcome {
  return {
    output: 'picture result',
    visibleOutput: 'picture result',
    outputParts: urls.map((url) => ({ type: 'input_image', image_url: url, detail: 'auto' })),
  }
}

function pictureSource(...outcomes: readonly McpCallOutcome[]): FakeMcpSource {
  const mcp = fakeMcpSource([{ server: 'docs', tool: 'picture', isReadOnly: true }])
  mcp.outcomes = [...outcomes]
  return mcp
}

function twoImageBudgetFixture(isOneOutcome: boolean) {
  const firstUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
  const secondUrl = 'data:image/png;base64,AAAA'
  const outcomes = isOneOutcome
    ? [mcpImages(firstUrl, secondUrl)]
    : [mcpImages(firstUrl), mcpImages(secondUrl)]
  const t = setup({
    mcpServers: pictureSource(...outcomes),
    mediaBudgetMaxEncodedChars: firstUrl.length + secondUrl.length - 1,
  })
  return { t, firstUrl, secondUrl }
}

function pdfPictureFixture() {
  const pdf = pdfFixture(50)
  const pdfData = `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`
  const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
  const t = setup({ mcpServers: pictureSource(mcpImages(imageUrl)) })
  t.io.binaries.set('/ws/docs/report.pdf', pdf)
  return { t, pdfData, imageUrl }
}

function expectFailedTool(events: readonly AgentEvent[], tool: string): void {
  expect(
    events.find((event) => event.type === 'itemCompleted' && event.item.tool === tool),
  ).toMatchObject({ item: { status: 'failed' } })
}

async function expectNoPictureAfterStop(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
  imageUrl: string,
): Promise<void> {
  expect(JSON.stringify(session.snapshot().replay).includes(imageUrl)).toBe(false)
  const nextInput = await nextInputAfterStop(t, session, turnDone)
  expect(nextInput.includes(imageUrl)).toBe(false)
}

function modelInputAt(t: ReturnType<typeof setup>, index: number): string {
  return JSON.stringify(t.api.responseBodies()[index]?.['input'])
}

async function completeToolCalls(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
  calls: NonNullable<ScriptedReply['calls']>,
  prompt: string,
  followup?: ScriptedReply,
): Promise<void> {
  t.api.script({ calls }, ...(followup === undefined ? [] : [followup]))
  await session.sendTurn([{ type: 'text', text: prompt }])
  await turnDone()
}

function pdfTurnPart(pages: number): DocumentPart {
  const bytes = pdfFixture(pages)
  return {
    type: 'file',
    name: 'steered.pdf',
    mediaType: 'application/pdf',
    base64Data: Buffer.from(bytes).toString('base64'),
    sizeBytes: bytes.length,
    pageCount: pages,
  }
}

function namedTextPart(name: string, text: string): TurnPart {
  return {
    type: 'textFile',
    name,
    mediaType: 'text/plain',
    text,
    sizeBytes: Buffer.byteLength(text),
  }
}

function halfBudgetTextPart(name: string): TurnPart {
  return namedTextPart(name, 'x'.repeat(Math.ceil(MAX_MODEL_API_TEXT_ATTACHMENT_BYTES / 2)))
}

/** Earlier bytes stay, while a later undelivered file becomes path-only context. */
function expectOnlyFirstPdfDelivered(
  nextInput: string,
  firstData: string,
  laterData: string,
): void {
  expect(nextInput).toContain(firstData)
  expect(nextInput).not.toContain(laterData)
  expect(nextInput).toContain('docs/later.pdf')
  expect(nextInput).toContain('was not delivered because that tool round ended early')
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

  it('restores sent image bytes and forks only completed turns while another reply runs (M53)', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'first reply' })
    const first = await session.sendTurn([
      { type: 'text', text: 'look at this' },
      { type: 'image', mediaType: 'image/png', base64Data: TINY_PNG_BASE64, width: 1, height: 1 },
    ])
    await turnDone()
    const userCard = session
      .history()
      .items.find((item) => item.kind === 'userMessage' && item.turnId === first.turnId)
    expect(first.userMessageId).toBe(userCard?.itemId)
    expect(session.sentImages(first.turnId, userCard?.itemId ?? '')).toEqual([
      { mediaType: 'image/png', base64Data: TINY_PNG_BASE64 },
    ])
    const held = Promise.withResolvers<undefined>()
    t.api.script({ hold: held.promise, text: 'second reply' })
    const second = await session.sendTurn([{ type: 'text', text: 'still running' }])
    const fork = await t.host.forkSession(session.sessionId, 'muse-spark-1.3')
    held.resolve(undefined)
    await turnDone()
    expect(fork.record.turnCount).toBe(1)
    expect(fork.history.items.map((item) => item.text)).toEqual(['look at this', 'first reply'])
    expect(fork.history.items.some((item) => item.turnId === second.turnId)).toBe(false)
  })

  it('restores images from the selected steered user card, not another message in its turn (M53)', async () => {
    const store = memorySessionStore()
    const t = setup({
      store,
      hooks: hooksFor('SessionStart', 'introduce'),
      runHook: () =>
        hookReply(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: 'Session context before prompt',
            },
          }),
        ),
    })
    const { session, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    const steeredImage = Buffer.from('steered image').toString('base64')
    t.api.script({ text: 'first', hold: held.promise }, { text: 'after steering' })
    const submitted = await session.sendTurn([
      { type: 'text', text: 'first image' },
      { type: 'image', mediaType: 'image/png', base64Data: TINY_PNG_BASE64, width: 1, height: 1 },
    ])
    const steered = await session.steer(submitted.turnId, [
      { type: 'text', text: 'second image' },
      { type: 'image', mediaType: 'image/png', base64Data: steeredImage, width: 1, height: 1 },
    ])
    held.resolve(undefined)
    await turnDone()
    const userCards = session
      .history()
      .items.filter((item) => item.kind === 'userMessage' && item.turnId === submitted.turnId)
    expect(userCards).toHaveLength(2)
    expect(submitted.userMessageId).toBe(userCards[0]?.itemId)
    expect(steered.userMessageId).toBe(userCards[1]?.itemId)
    expect(
      session.snapshot().replay.find((entry) => entry.turnId === submitted.turnId)?.userMessageId,
    ).toBeUndefined()
    expect(session.sentImages(submitted.turnId, userCards[0]?.itemId ?? '')).toEqual([
      { mediaType: 'image/png', base64Data: TINY_PNG_BASE64 },
    ])
    expect(session.sentImages(submitted.turnId, userCards[1]?.itemId ?? '')).toEqual([
      { mediaType: 'image/png', base64Data: steeredImage },
    ])
    expect(session.sentImages(submitted.turnId, 'not-a-user-card')).toBeUndefined()
    await t.host.flush()
    const stored = store.saved.get(session.sessionId)
    expect(stored?.replay.some((entry) => entry.userMessageId === userCards[1]?.itemId)).toBe(true)
    session.dispose()
    const resumedHost = setup({ store })
    await resumedHost.host.load()
    const resumed = await resumedHost.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(resumed.session.sentImages?.(submitted.turnId, userCards[1]?.itemId ?? '')).toEqual([
      { mediaType: 'image/png', base64Data: steeredImage },
    ])

    if (stored === undefined) {
      throw new Error('expected saved session')
    }
    const legacyReplay = stored.replay.map(({ userMessageId: _userMessageId, ...entry }) => entry)
    store.saved.set(session.sessionId, { ...stored, replay: legacyReplay })
    const legacyHost = setup({ store })
    await legacyHost.host.load()
    const legacy = await legacyHost.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(
      legacy.session.sentImages?.(submitted.turnId, userCards[1]?.itemId ?? ''),
    ).toBeUndefined()
  })

  it('rejects a rewind whose cut predates the latest compaction summary (M53)', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const firstTurnId = await answerFirst(t, session, turnDone)
    t.api.script({ text: 'second reply' })
    await session.sendTurn([{ type: 'text', text: 'second' }])
    await turnDone()
    t.api.script({ text: 'summary' })
    await session.compact()
    await expect(
      t.host.forkSession(session.sessionId, 'muse-spark-1.3', firstTurnId),
    ).rejects.toThrow(UI_TEXT.rewindBeforeCompaction)
  })

  it('keeps the accepted compaction cut when a later hook-blocked turn has no replay (M53)', async () => {
    const store = memorySessionStore()
    let shouldBlock = false
    const t = setup({
      store,
      hooks: hooksFor('UserPromptSubmit', 'guard'),
      runHook: () =>
        hookReply(
          shouldBlock ? JSON.stringify({ decision: 'block', reason: 'blocked later' }) : '{}',
        ),
    })
    const { session, turnDone } = await startSession(t)
    const firstTurnId = await answerFirst(t, session, turnDone)
    t.api.script({ text: 'second reply' })
    const second = await session.sendTurn([{ type: 'text', text: 'second' }])
    await turnDone()
    t.api.script({ text: 'summary' })
    await expect(session.compact()).resolves.toMatchObject({ status: 'accepted' })
    shouldBlock = true
    const blocked = await session.sendTurn([{ type: 'text', text: 'blocked later' }])
    await turnDone()
    expect(session.snapshot().turnIds).toContain(blocked.turnId)
    expect(session.snapshot().replay.some((entry) => entry.turnId === blocked.turnId)).toBe(false)
    await expect(
      t.host.forkSession(session.sessionId, 'muse-spark-1.3', firstTurnId),
    ).rejects.toThrow(UI_TEXT.rewindBeforeCompaction)
    await expect(
      t.host.forkSession(session.sessionId, 'muse-spark-1.3', second.turnId),
    ).resolves.toMatchObject({ record: { forkedFrom: { sessionId: session.sessionId } } })

    await t.host.flush()
    session.dispose()
    const reopened = setup({ store })
    await reopened.host.load()
    await expect(
      reopened.host.forkSession(session.sessionId, 'muse-spark-1.3', second.turnId),
    ).resolves.toMatchObject({ record: { forkedFrom: { sessionId: session.sessionId } } })

    const stored = store.saved.get(session.sessionId)
    if (stored === undefined) {
      throw new Error('expected saved session')
    }
    expect(stored.compactedThroughTurnId).toBe(second.turnId)
    const { compactedThroughTurnId: _compactedThroughTurnId, ...legacy } = stored
    store.saved.set(session.sessionId, legacy)
    const oldHost = setup({ store })
    await oldHost.host.load()
    await expect(
      oldHost.host.forkSession(session.sessionId, 'muse-spark-1.3', second.turnId),
    ).resolves.toMatchObject({ record: { forkedFrom: { sessionId: session.sessionId } } })
  })

  it('stores a side fork in Plan before opening and suppresses its hooks across resume (M53)', async () => {
    const store = memorySessionStore()
    const runHook = vi.fn(() => hookReply())
    const t = setup({ store, hooks: hooksFor('SessionStart', 'record'), runHook })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await t.host.flush()
    runHook.mockClear()

    const side = await openSideFork(t, session)
    expect(store.saved.get(side.record.sessionId)).toMatchObject({
      sideChat: true,
      approvalMode: 'denyUnmatched',
    })
    expect(runHook).not.toHaveBeenCalled()

    side.session.dispose()
    const resumed = await t.host.resumeSession(side.record.sessionId, 'muse-spark-1.3')
    expect(resumed.record.sideChat).toBe(true)
    await expect(resumed.session.setApprovalMode('allowAll')).rejects.toThrow(
      UI_TEXT.sideChatPlanOnly,
    )
    expect(runHook).not.toHaveBeenCalled()

    const normal = await t.host.forkSession(session.sessionId, 'muse-spark-1.3')
    expect(normal.record.sideChat).not.toBe(true)
    expect(runHook).toHaveBeenCalled()

    await t.host.close()
    runHook.mockClear()
    const nextWindow = setup({ store, hooks: hooksFor('SessionStart', 'record'), runHook })
    await nextWindow.host.load()
    const restored = await nextWindow.host.resumeSession(side.record.sessionId, 'muse-spark-1.3')
    expect(restored.record.sideChat).toBe(true)
    await expect(restored.session.setApprovalMode('allowAll')).rejects.toThrow(
      UI_TEXT.sideChatPlanOnly,
    )
    expect(runHook).not.toHaveBeenCalled()
  })

  it('refuses to open a side fork when its durable save fails (M53)', async () => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await t.host.flush()
    store.failNextSave = true

    await expect(
      t.host.forkSession(session.sessionId, 'muse-spark-1.3', undefined, { sideChat: true }),
    ).rejects.toThrow('disk full')
    await t.host.flush()
    expect(t.host.sessionCount).toBe(1)
    expect(store.saved.size).toBe(1)
    expect(store.saved.has(session.sessionId)).toBe(true)
    const listed = await t.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(listed.sessions.map((record) => record.sessionId)).toEqual([session.sessionId])
  })

  it('waits for a side fork save before its only hold can be released and resumed (M53)', async () => {
    const store = memorySessionStore()
    const save = store.save.bind(store)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    store.save = async (snapshot) => {
      if (snapshot.sideChat === true) {
        entered.resolve(undefined)
        await release.promise
      }
      await save(snapshot)
    }
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await t.host.flush()

    let hasReturned = false
    const opening = t.host.forkSession(session.sessionId, 'muse-spark-1.3', undefined, {
      sideChat: true,
    })
    void opening.then(() => {
      hasReturned = true
    })
    try {
      await entered.promise
      expect(hasReturned).toBe(false)
    } finally {
      release.resolve(undefined)
    }
    const side = await opening
    side.session.dispose()
    const resumed = await t.host.resumeSession(side.record.sessionId, 'muse-spark-1.3')
    expect(resumed.record.sideChat).toBe(true)
    expect(resumed.history.sideChat).toBe(true)
  })

  it('refuses even a read-only-hinted external MCP call in a side session (M53)', async () => {
    const mcp = fakeMcpSource([{ server: 'docs', tool: 'lookup', isReadOnly: true }])
    const t = setup({ mcpServers: mcp })
    const { session, events, turnDone } = await startSession(t, 'denyUnmatched', true)
    t.api.script({ calls: [{ name: 'mcp__docs__lookup', arguments: '{}' }] }, { text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'read from docs' }])
    await turnDone()
    expect(mcp.calls).toEqual([])
    expect(events.filter((event) => event.type === 'approvalRequested')).toEqual([])
  })

  it('runs no SessionStart or SessionEnd command hook for a side session (M53)', async () => {
    const runHook = vi.fn(() => hookReply())
    const t = setup({
      hooks: [...hooksFor('SessionStart', 'start'), ...hooksFor('SessionEnd', 'end')],
      runHook,
    })
    await t.host.startSession({
      workspaceRoot: ROOT,
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
      sideChat: true,
    })
    await t.host.close()
    expect(runHook).not.toHaveBeenCalled()
  })

  it('runs no model-call command hook during a side turn (M53)', async () => {
    const runHook = vi.fn(() => hookReply())
    const t = setup({ hooks: hooksFor('PreLLMCall', 'before-model'), runHook })
    const { session, turnDone } = await startSession(t, 'denyUnmatched', true)
    t.api.script({ text: 'answer' })
    await session.sendTurn([{ type: 'text', text: 'question' }])
    await turnDone()
    expect(runHook).not.toHaveBeenCalled()
  })

  it('rejects a stored ordinary session before its resume hook when a side surface requires it (M53)', async () => {
    const store = memorySessionStore()
    const runHook = vi.fn(() => hookReply())
    const t = setup({ store, hooks: hooksFor('SessionStart', 'on-resume'), runHook })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await t.host.flush()
    session.dispose()
    runHook.mockClear()

    await expect(
      t.host.resumeSession(session.sessionId, 'muse-spark-1.3', undefined, {
        requireSideChat: true,
      }),
    ).rejects.toThrow(UI_TEXT.sideChatSessionOnly)
    expect(runHook).not.toHaveBeenCalled()
  })

  it('clears the inherited goal before a side fork is saved (M53)', async () => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    t.api.script({ text: 'working' })
    await session.controlGoal({ verb: 'set', objective: 'Ship it' })
    await turnDone()
    expect(session.history().goal?.status).toBe('active')

    const side = await t.host.forkSession(session.sessionId, 'muse-spark-1.3', undefined, {
      sideChat: true,
    })
    expect(side.history.goal).toBeNull()
    expect(store.saved.get(side.record.sessionId)?.goal).toBeUndefined()
    expect(session.history().goal?.status).toBe('active')
  })

  it('keeps copied child records closed and unable to resume paid work from a side fork (M53)', async () => {
    const store = memorySessionStore()
    const t = setupSubagents({ store })
    const { session } = await startApprovedSubagentSession(t)
    await completePaidChild(t, session, 'spawn_before_side_fork')
    const chargedBefore = t.paidUses.length

    const side = await t.host.forkSession(session.sessionId, 'muse-spark-1.3', undefined, {
      sideChat: true,
    })
    expect(side.history.items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
      'closed',
    )
    expect(store.saved.get(side.record.sessionId)?.children?.[0]?.session.approvalMode).toBe(
      'denyUnmatched',
    )
    await expect(side.session.controlSubagent('subagent-1', 'reopen')).rejects.toThrow()
    side.session.dispose()
    const reopened = await t.host.resumeSession(side.record.sessionId, 'muse-spark-1.3')
    await expect(reopened.session.controlSubagent('subagent-1', 'reopen')).rejects.toThrow()
    expect(t.paidUses).toHaveLength(chargedBefore)
  })

  it('keeps an earlier PDF in side-fork replay while preserving its Plan marker (M53/M54)', async () => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, turnDone } = await startSession(t)
    const base64Data = await answerWithPdf(t, session, turnDone, 2)

    const side = await openSideFork(t, session)
    expect(store.saved.get(side.record.sessionId)?.approvalMode).toBe('denyUnmatched')
    expect(side.history.items[0]).toMatchObject({
      kind: 'userMessage',
      attachments: [{ type: 'file', name: 'report.pdf', mediaType: 'application/pdf' }],
    })
    const { turnDone: sideTurnDone } = watchTurns(side.session)
    t.api.script({ text: 'The side answer' })
    await side.session.sendTurn([{ type: 'text', text: 'One more question' }])
    await sideTurnDone()
    const input = JSON.stringify(t.api.responseBodies().at(-1)?.['input'])
    expect(input).toContain(`data:application/pdf;base64,${base64Data}`)
    expect(input).toContain('One more question')
  })
})

const scheduleRoot = mkdtempSync(path.join(tmpdir(), 'muse-model-schedules-'))
afterAll(() => removeFolder(scheduleRoot))

function confirmedRun(job: ScheduledPrompt, session: AgentSession): ScheduleRunConfirmation {
  return { sessionId: session.sessionId, modelId: session.modelId, prompt: job.prompt }
}

async function dueSchedule(t: ReturnType<typeof setup>, session: ModelApiSession) {
  const schedules = session.schedules
  if (schedules === undefined) {
    throw new Error('expected local schedules')
  }
  const job = await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Review tests')
  t.advanceClock(65_000)
  return { schedules, job }
}

function scheduleWithHook(options: {
  readonly folder: string
  readonly now: () => number
  readonly event: 'PreLLMCall' | 'Stop'
  readonly runHook: NonNullable<ToolIo['runHook']>
  readonly apiKey?: () => Promise<string | undefined>
}) {
  const store = createFileScheduleStore({
    directory: path.join(scheduleRoot, options.folder),
    now: options.now,
    log: new FakeLogOutputChannel(),
  })
  const t = setup({
    store: memorySessionStore(),
    scheduleStore: store,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    paid: ['scheduledPrompts'],
    hooks: hooksFor(options.event, 'schedule-hook'),
    runHook: options.runHook,
    ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
  })
  return { t, store }
}

async function startAccountScopedSchedules(
  scheduleStore: ScheduleStore,
  getAccountId: () => Promise<string | undefined>,
) {
  const t = setup({ store: memorySessionStore(), scheduleStore, getAccountId })
  const started = await startSession(t)
  const schedules = started.session.schedules
  if (schedules === undefined) {
    throw new Error('expected local schedules')
  }
  return { t, ...started, schedules }
}

describe('Model API scheduled prompts (M52)', () => {
  it('refuses a seven-day cadence before storing a never-runnable job', async () => {
    const scheduleStore = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'seven-day-boundary'),
      now: () => 1_000_000,
      log: new FakeLogOutputChannel(),
    })
    const { t, session, schedules } = await startAccountScopedSchedules(scheduleStore, () =>
      Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    )
    await expect(
      schedules.create({ kind: 'interval', everyMs: SCHEDULE_LIFETIME_MS }, 'Review tests'),
    ).rejects.toThrow(UI_TEXT.scheduleNoFire)
    expect(await scheduleStore.list(session.sessionId)).toEqual([])
    expect(t.api.responseBodies()).toEqual([])
    await t.host.close()
  })

  it('creates locally without a paid request and keeps key identity out of the panel event', async () => {
    const t = setup({
      store: memorySessionStore(),
      scheduleStore: createFileScheduleStore({
        directory: path.join(scheduleRoot, 'identity'),
        now: () => 1_000_000,
        log: new FakeLogOutputChannel(),
      }),
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    })
    const { session, events } = await startSession(t)
    const schedules = session.schedules
    if (schedules === undefined) {
      throw new Error('expected local schedules')
    }
    const created = await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Review tests')
    expect(created.prompt).toBe('Review tests')
    expect(t.api.responseBodies()).toEqual([])
    const event = events.findLast((entry) => entry.type === 'schedulesChanged')
    if (event?.type !== 'schedulesChanged') {
      throw new Error('expected schedule event')
    }
    expect(event.jobs[0]).toMatchObject({ id: created.id, prompt: 'Review tests' })
    expect(JSON.stringify(event)).not.toContain(FAKE_MODEL_API_ACCOUNT_ID)
    expect(JSON.stringify(event)).not.toContain(ROOT)
    await t.host.close()
  })

  it('refuses schedule creation during an unanswered tool call without saving invalid replay', async () => {
    const { store: sessionStore, savedWithoutOutput } = storeTrackingPendingCalls()
    const scheduleStore = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'pending-tool-create'),
      now: () => 1_000_000,
      log: new FakeLogOutputChannel(),
    })
    const t = setup({
      store: sessionStore,
      scheduleStore,
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ calls: [ASK_USER_CALL] }, { text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'ask me' }])
    const question = await awaitQuestion(events)
    const schedules = session.schedules
    if (schedules === undefined) {
      throw new Error('expected local schedules')
    }
    let createError: unknown
    try {
      await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Review tests')
    } catch (error: unknown) {
      createError = error
    }
    const jobsBeforeTurnEnds = await scheduleStore.list(session.sessionId)
    const invalidSavesBeforeTurnEnds = [...savedWithoutOutput]
    await session.answerQuestions(question.userInputId, [{ questionId: 'q', selectedLabel: 'Red' }])
    await turnDone()
    await t.host.close()
    expect(createError).toEqual(expect.objectContaining({ message: UI_TEXT.scheduleBusy }))
    expect(jobsBeforeTurnEnds).toEqual([])
    expect(invalidSavesBeforeTurnEnds).not.toContain(true)
    expect(savedWithoutOutput).not.toContain(true)
    const restored = setup({ store: sessionStore, scheduleStore })
    await restored.host.load()
    const resumed = await restored.host.resumeSession(session.sessionId, session.modelId)
    expect(resumed.history.items.some((item) => item.status === 'pending')).toBe(false)
    await restored.host.close()
  })

  it('refuses a due run while its paid gate is off, then admits one explicit run and marks it paid', async () => {
    let now = 1_000_000
    const paid: PaidFeature[] = []
    const sessionStore = memorySessionStore()
    const store = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'paid'),
      now: () => now,
      log: new FakeLogOutputChannel(),
    })
    const t = setup({
      store: sessionStore,
      scheduleStore: store,
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      paid,
    })
    // `allowAll` is Bypass permissions; paid admission still refuses.
    const { session, turnDone } = await startSession(t, 'allowAll')
    const { schedules, job } = await dueSchedule(t, session)
    now = job.nextFireAtMs + 1
    await expect(
      schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session)),
    ).rejects.toThrow(UI_TEXT.schedulePaidOff)
    expect(t.api.responseBodies()).toHaveLength(0)
    const beforeRun = await store.list(session.sessionId)
    expect(beforeRun[0]?.fireCount).toBe(0)
    paid.push('scheduledPrompts')
    t.api.script({ text: 'Tests look good' })
    const completed = turnDone()
    await schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session))
    await completed
    expect(t.api.responseBodies()).toHaveLength(1)
    const requestJson = JSON.stringify(t.api.responseBodies())
    expect(requestJson).not.toContain(FAKE_MODEL_API_ACCOUNT_ID)
    expect(requestJson).not.toContain('confirmedRequest')
    expect(t.paidUses).toContainEqual({ feature: 'scheduledPrompts', units: 1 })
    expect(session.history().items).toContainEqual(
      expect.objectContaining({ tool: 'scheduled_prompt', paid: 'scheduledPrompts' }),
    )
    const afterRun = await store.list(session.sessionId)
    expect(afterRun[0]?.fireCount).toBe(1)
    await t.host.flush()
    const savedJson = JSON.stringify(sessionStore.saved.get(session.sessionId))
    expect(sessionStore.saved.get(session.sessionId)?.accountId).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    expect(savedJson).not.toContain('confirmedRequest')
    const logJson = JSON.stringify([
      ...t.log.trace.mock.calls,
      ...t.log.debug.mock.calls,
      ...t.log.info.mock.calls,
      ...t.log.warn.mock.calls,
      ...t.log.error.mock.calls,
    ])
    expect(logJson).not.toContain(FAKE_MODEL_API_ACCOUNT_ID)
    expect(logJson).not.toContain('confirmedRequest')
    expect(t.io.shellCalls).toEqual([])
    await expect(
      schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session)),
    ).rejects.toThrow(UI_TEXT.scheduleNotDue)
    expect(t.api.responseBodies()).toHaveLength(1)
    await t.host.close()
  })

  it('keeps an earlier PDF in the confirmed paid run within the replay media budget', async () => {
    let now = 1_000_000
    const t = setup({
      store: memorySessionStore(),
      scheduleStore: createFileScheduleStore({
        directory: path.join(scheduleRoot, 'pdf-replay'),
        now: () => now,
        log: new FakeLogOutputChannel(),
      }),
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      paid: ['scheduledPrompts'],
    })
    const { session, turnDone } = await startSession(t)
    const base64Data = await answerWithPdf(t, session, turnDone, 50)

    const { schedules, job } = await dueSchedule(t, session)
    now = job.nextFireAtMs + 1
    t.api.script({ text: 'Scheduled review complete' })
    const completed = turnDone()
    await schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session))
    await completed

    const scheduledInput = JSON.stringify(t.api.responseBodies()[1]?.['input'])
    expect(scheduledInput).toContain(`data:application/pdf;base64,${base64Data}`)
    expect(scheduledInput).toContain(job.prompt)
    expect(t.paidUses).toEqual([{ feature: 'scheduledPrompts', units: 1 }])
    await t.host.close()
  })

  it('records a due receipt but spends nothing when PreLLMCall vetoes the run', async () => {
    let now = 1_000_000
    const { t, store } = scheduleWithHook({
      folder: 'pre-llm-veto',
      now: () => now,
      event: 'PreLLMCall',
      runHook: () => hookReply(JSON.stringify({ decision: 'block', reason: 'veto' })),
    })
    const { session, turnDone } = await startSession(t)
    const { schedules, job } = await dueSchedule(t, session)
    now = job.nextFireAtMs + 1
    t.api.script({ text: 'must not run' })
    const completed = turnDone()
    await schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session))
    await completed
    expect(t.api.responseBodies()).toHaveLength(0)
    expect(t.paidUses).toEqual([])
    expect(session.history().items.some((item) => item.tool === 'scheduled_prompt')).toBe(false)
    const storedAfterVeto = await store.list(session.sessionId)
    expect(storedAfterVeto[0]?.fireCount).toBe(1)
    await expect(
      schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session)),
    ).rejects.toThrow(UI_TEXT.scheduleNotDue)
    await t.host.close()
  })

  it('refuses a Stop-hook continuation after the confirmed key changes', async () => {
    let now = 1_000_000
    let key = 'LLM|1|secret'
    const { t, store } = scheduleWithHook({
      folder: 'stop-hook-key-change',
      now: () => now,
      apiKey: () => Promise.resolve(key),
      event: 'Stop',
      runHook: () => {
        key = 'LLM|1|changed'
        return hookReply(JSON.stringify({ decision: 'block', reason: 'continue' }))
      },
    })
    const { session, turnDone } = await startSession(t)
    const { schedules, job } = await dueSchedule(t, session)
    now = job.nextFireAtMs + 1
    t.api.script({ text: 'first' }, { text: 'must not run' })
    const completed = turnDone()
    await schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session))
    await completed
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(t.paidUses).toEqual([{ feature: 'scheduledPrompts', units: 1 }])
    expect(session.history().items.filter((item) => item.tool === 'scheduled_prompt')).toHaveLength(
      1,
    )
    const storedAfterContinuation = await store.list(session.sessionId)
    expect(storedAfterContinuation[0]?.fireCount).toBe(1)
    await t.host.close()
  })

  it('refuses a model switch while the confirmed occurrence waits for its receipt', async () => {
    let now = 1_000_000
    const disk = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'delayed-admission-model'),
      now: () => now,
      log: new FakeLogOutputChannel(),
    })
    const claimStarted = Promise.withResolvers<undefined>()
    const releaseClaim = Promise.withResolvers<undefined>()
    const delayed: ScheduleStore = {
      ...disk,
      claim: async (job, occurrenceMs) => {
        claimStarted.resolve(undefined)
        await releaseClaim.promise
        return await disk.claim(job, occurrenceMs)
      },
    }
    const t = setup({
      store: memorySessionStore(),
      scheduleStore: delayed,
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      paid: ['scheduledPrompts'],
    })
    try {
      const { session } = await startSession(t)
      const { schedules, job } = await dueSchedule(t, session)
      now = job.nextFireAtMs + 1
      const run = schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session))
      await claimStarted.promise
      await session.setModel('muse-spark-1.2')
      releaseClaim.resolve(undefined)
      await expect(run).rejects.toThrow(UI_TEXT.scheduleConfirmationExpired)
      expect(t.api.responseBodies()).toEqual([])
    } finally {
      releaseClaim.resolve(undefined)
      await t.host.close()
    }
  })

  it('refuses a changed key at the last request boundary after admission', async () => {
    let now = 1_000_000
    let key = 'LLM|1|secret'
    const keyReadStarted = Promise.withResolvers<undefined>()
    const releaseKeyRead = Promise.withResolvers<undefined>()
    const t = setup({
      store: memorySessionStore(),
      scheduleStore: createFileScheduleStore({
        directory: path.join(scheduleRoot, 'key-before-http'),
        now: () => now,
        log: new FakeLogOutputChannel(),
      }),
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      paid: ['scheduledPrompts'],
      apiKey: async () => {
        keyReadStarted.resolve(undefined)
        await releaseKeyRead.promise
        return key
      },
    })
    try {
      const { session, turnDone } = await startSession(t)
      const { schedules, job } = await dueSchedule(t, session)
      now = job.nextFireAtMs + 1
      const completed = turnDone()
      await schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session))
      await keyReadStarted.promise
      key = 'LLM|1|changed'
      releaseKeyRead.resolve(undefined)
      await completed
      expect(t.api.responseBodies()).toEqual([])
      expect(t.paidUses).toEqual([])
      expect(session.history().items.some((item) => item.tool === 'scheduled_prompt')).toBe(false)
    } finally {
      releaseKeyRead.resolve(undefined)
      await t.host.close()
    }
  })

  it('shows jobs only while the creating Model API key identity is current', async () => {
    let account: string | undefined = FAKE_MODEL_API_ACCOUNT_ID
    let shouldFailRead = false
    const disk = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'key-change'),
      now: () => 1_000_000,
      log: new FakeLogOutputChannel(),
    })
    const scheduleStore: ScheduleStore = {
      ...disk,
      list: async (sessionId) => {
        if (shouldFailRead) {
          throw new Error('schedule store unavailable')
        }
        return await disk.list(sessionId)
      },
    }
    const { t, events, schedules } = await startAccountScopedSchedules(scheduleStore, () =>
      Promise.resolve(account),
    )
    try {
      await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Review tests')
      account = 'account-b'
      expect(await schedules.list()).toEqual([])
      account = undefined
      shouldFailRead = true
      expect(await schedules.list()).toEqual([])
      expect(events.findLast((event) => event.type === 'schedulesChanged')).toMatchObject({
        jobs: [],
      })
      await expect(
        schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Without a key'),
      ).rejects.toThrow(UI_TEXT.scheduleAccountMissing)
      shouldFailRead = false
      account = FAKE_MODEL_API_ACCOUNT_ID
      expect(await schedules.list()).toHaveLength(1)
    } finally {
      await t.host.close()
    }
  })

  it('does not publish an old account’s jobs after a delayed schedule read', async () => {
    let account = FAKE_MODEL_API_ACCOUNT_ID
    let isNextListDelayed = false
    const listed = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const disk = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'account-read-race'),
      now: () => 1_000_000,
      log: new FakeLogOutputChannel(),
    })
    const scheduleStore: ScheduleStore = {
      ...disk,
      list: async (sessionId) => {
        const jobs = await disk.list(sessionId)
        if (isNextListDelayed) {
          isNextListDelayed = false
          listed.resolve(undefined)
          await release.promise
        }
        return jobs
      },
    }
    const { t, events, schedules } = await startAccountScopedSchedules(scheduleStore, () =>
      Promise.resolve(account),
    )
    await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Private account prompt')
    isNextListDelayed = true
    const pending = schedules.list()
    await listed.promise
    account = 'another-account'
    release.resolve(undefined)
    expect(await pending).toEqual([])
    expect(events.findLast((event) => event.type === 'schedulesChanged')).toMatchObject({
      jobs: [],
    })
    await t.host.close()
  })

  it('burns a claimed occurrence without spending when the account is removed after confirmation', async () => {
    let now = 1_000_000
    let account: string | undefined = FAKE_MODEL_API_ACCOUNT_ID
    const disk = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'account-removed-after-claim'),
      now: () => now,
      log: new FakeLogOutputChannel(),
    })
    const scheduleStore: ScheduleStore = {
      ...disk,
      claim: async (job, occurrenceMs) => {
        const isClaimed = await disk.claim(job, occurrenceMs)
        account = undefined
        return isClaimed
      },
    }
    const t = setup({
      store: memorySessionStore(),
      scheduleStore,
      getAccountId: () => Promise.resolve(account),
      paid: ['scheduledPrompts'],
    })
    const { session } = await startSession(t)
    const { schedules, job } = await dueSchedule(t, session)
    now = job.nextFireAtMs + 1
    t.api.script({ text: 'must not run' })
    await expect(
      schedules.run(job.id, job.nextFireAtMs, confirmedRun(job, session)),
    ).rejects.toThrow(UI_TEXT.scheduleAccountMissing)
    expect(t.api.responseBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    expect(session.history().items.some((item) => item.tool === 'scheduled_prompt')).toBe(false)
    const claimed = await disk.list(session.sessionId)
    expect(claimed[0]?.fireCount).toBe(1)
    await t.host.close()
  })

  it('hides a same-session job stored for another workspace', async () => {
    const scheduleStore = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'workspace-scope'),
      now: () => 1_000_000,
      log: new FakeLogOutputChannel(),
    })
    const t = setup({
      store: memorySessionStore(),
      scheduleStore,
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    })
    const { session } = await startSession(t)
    const schedules = session.schedules
    if (schedules === undefined) {
      throw new Error('expected local schedules')
    }
    const own = await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Own workspace')
    await scheduleStore.create({
      ...own,
      id: 'foreign-workspace',
      workspaceRoot: '/elsewhere',
      prompt: 'Foreign workspace',
    })
    const visible = await schedules.list()
    expect(visible.map((job) => job.id)).toEqual([own.id])
    await t.host.close()
  })

  it('refuses schedule creation from a side session before touching storage or paid use (M53)', async () => {
    const scheduleStore = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'side-create'),
      now: () => 1_000_000,
      log: new FakeLogOutputChannel(),
    })
    const create = vi.spyOn(scheduleStore, 'create')
    const t = setup({
      store: memorySessionStore(),
      scheduleStore,
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      paid: ['scheduledPrompts'],
    })
    const { session } = await startSession(t, 'allowAll', true)
    expect(session.approvalMode).toBe('denyUnmatched')
    const schedules = session.schedules
    if (schedules === undefined) {
      throw new Error('expected local schedules')
    }
    await expect(
      schedules.create({ kind: 'interval', everyMs: 60_000 }, 'Side task'),
    ).rejects.toThrow(UI_TEXT.sideChatPlanOnly)
    expect(create).not.toHaveBeenCalled()
    expect(t.api.responseBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    await t.host.close()
  })

  it('refuses seeded schedule run and cancel in a side fork after resume (M53)', async () => {
    let now = 1_000_000
    const scheduleStore = createFileScheduleStore({
      directory: path.join(scheduleRoot, 'side-seeded'),
      now: () => now,
      log: new FakeLogOutputChannel(),
    })
    const t = setup({
      store: memorySessionStore(),
      scheduleStore,
      getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      paid: ['scheduledPrompts'],
    })
    const { session, turnDone } = await startSession(t, 'allowAll')
    await answerFirst(t, session, turnDone)
    const { job } = await dueSchedule(t, session)
    const side = await t.host.forkSession(session.sessionId, 'muse-spark-1.3', undefined, {
      sideChat: true,
    })
    expect(side.record.sideChat).toBe(true)
    await expect(side.session.setApprovalMode('allowAll')).rejects.toThrow(UI_TEXT.sideChatPlanOnly)
    const sideJob = { ...job, id: 'seeded-side-job', sessionId: side.record.sessionId }
    await scheduleStore.create(sideJob)
    const claim = vi.spyOn(scheduleStore, 'claim')
    const remove = vi.spyOn(scheduleStore, 'remove')
    side.session.dispose()
    const restored = await t.host.resumeSession(side.record.sessionId, 'muse-spark-1.3')
    const resumedSchedules = restored.session.schedules
    if (resumedSchedules === undefined) {
      throw new Error('expected local schedules after resume')
    }
    t.advanceClock(65_000)
    now = sideJob.nextFireAtMs + 1
    const requestCount = t.api.responseBodies().length
    t.api.script({ text: 'must not run' })
    await expect(resumedSchedules.cancel(sideJob.id)).rejects.toThrow(UI_TEXT.sideChatPlanOnly)
    await expect(
      resumedSchedules.run(
        sideJob.id,
        sideJob.nextFireAtMs,
        confirmedRun(sideJob, restored.session),
      ),
    ).rejects.toThrow(UI_TEXT.sideChatPlanOnly)
    expect(claim).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    const storedJobs = await scheduleStore.list(side.record.sessionId)
    expect(storedJobs[0]?.fireCount).toBe(0)
    expect(t.api.responseBodies()).toHaveLength(requestCount)
    expect(t.paidUses).toEqual([])
    await t.host.close()
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
  it('refuses a send or steer on a disposed session before any Model API request', async () => {
    const t = setup()
    const { session } = await startSession(t)
    session.dispose()
    await expect(session.sendTurn([{ type: 'text', text: 'Stale paid turn' }])).rejects.toThrow(
      UI_TEXT.turnStoppedByRestart,
    )
    await expect(
      session.steer('old-turn', [{ type: 'text', text: 'Stale steer' }]),
    ).rejects.toThrow(UI_TEXT.turnStoppedByRestart)
    expect(t.api.responseBodies()).toEqual([])
    expect(session.history().items).toEqual([])
  })

  it('streams a reply with reasoning into the transcript and replays it with usage', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      reasoning: 'thinking hard',
      text: 'Hello there',
      usage: { input: 100, output: 20, cached: 30 },
    })
    const submission = await session.sendTurn([{ type: 'text', text: 'hi' }], 'hi (shown)')
    expect(submission).toMatchObject({
      turnId: 'id2',
      disposition: 'started',
      userMessageId: expect.any(String),
    })
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
      // One key per shared prefix, and Meta's in-memory default (M56).
      prompt_cache_key: expect.stringMatching(/^muse-spark-code-[\da-f]{32}$/),
      prompt_cache_retention: 'in_memory',
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

  it('refuses a write whose checked target changes while its ordinary card is open', async () => {
    const links: Record<string, string> = { 'alias.txt': `${ROOT}/regular.txt` }
    const io = memoryToolIo({}, ROOT, undefined, links)
    const t = setup({ io })
    const { session, events, turnDone } = await startSession(t)
    scriptWriteCalls(t, { path: 'alias.txt', content: 'secret', callId: 'alias_race' })
    await session.sendTurn([{ type: 'text', text: 'write' }])
    const request = await approvalRequest(events, 0)
    expect(request.isProtectedWrite).toBe(false)
    links['alias.txt'] = `${ROOT}/.muse/hooks.json`
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.files.has(`${ROOT}/.muse/hooks.json`)).toBe(false)
    expect(toolOutput(t, 'alias_race')).toContain('path changed after approval')
  })

  it('asks for a protected write even in Auto, and refuses a choice it never offered (D24)', async () => {
    const t = setup({ files: { 'a.txt': 'alpha\n' } })
    const { session, events, turnDone } = await startSession(t, 'onRequest')
    scriptWriteCalls(
      t,
      { path: 'notes.txt', content: 'x', callId: 'c1' },
      { path: '.git/hooks/pre-commit', content: 'evil', callId: 'c2' },
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
    await completeWriteTurn(t, session, turnDone, '../x', 'y')
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

  it('takes a todo list from outside a turn (M79), refused while one runs, and saves it', async () => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, events, turnDone } = await startSession(t)
    const steps = [{ text: 'Step one', status: 'pending' }]
    session.setTodos(steps)
    expect(events).toContainEqual({ type: 'todoChanged', items: steps })
    expect(session.history().todos).toEqual(steps)
    await vi.waitFor(() => {
      expect(store.saved.get(session.sessionId)?.todos).toEqual(steps)
    })
    const held = Promise.withResolvers<undefined>()
    t.api.script({ hold: held.promise, text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'go' }])
    // todo_write may be replacing the list while the turn runs.
    expect(() => {
      session.setTodos([])
    }).toThrow(UI_TEXT.planWaitForTurn)
    held.resolve(undefined)
    await turnDone()
    expect(session.history().todos).toEqual(steps)
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
    await expect(
      session.steer(first.turnId, [{ type: 'text', text: 'also this' }]),
    ).resolves.toMatchObject({
      turnId: first.turnId,
      disposition: 'steered',
      userMessageId: expect.any(String),
    })
    const queued = await session.sendTurn([{ type: 'text', text: 'two' }])
    expect(queued.disposition).toBe('queued')
    expect(queued.userMessageId).toEqual(expect.any(String))
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
    expect(
      session
        .history()
        .items.find((item) => item.kind === 'userMessage' && item.turnId === queued.turnId)?.itemId,
    ).toBe(queued.userMessageId)

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

  // M56 (PLAN.md D43; dev.meta.ai/docs/prompt-caching): "one stable key per
  // shared prefix", not one per session.
  it('keys the prompt cache by the prefix every request starts with, not by session', async () => {
    const t = setup({ retention: '24h' })
    const first = await startSession(t)
    await answerFirst(t, first.session, first.turnDone)
    const second = await startSession(t)
    t.api.script({ text: 'second' })
    await second.session.sendTurn([{ type: 'text', text: 'another conversation' }])
    await second.turnDone()
    const [one, two] = t.api.responseBodies()
    expect(one?.['prompt_cache_key']).toBe(two?.['prompt_cache_key'])
    expect(one?.['prompt_cache_retention']).toBe('24h')
    // A compaction starts with no tools, so it names its own prefix.
    t.api.script({ text: 'THE SUMMARY' })
    await first.session.compact()
    const compaction = t.api.responseBodies().at(-1)
    expect(compaction?.['prompt_cache_key']).toMatch(/^muse-spark-code-[\da-f]{32}$/)
    expect(compaction?.['prompt_cache_key']).not.toBe(one?.['prompt_cache_key'])
    // Another tool list is another prefix: web search turned on (M33).
    const searching = setup({ paid: ['webSearch'] })
    const third = await startSession(searching)
    await answerFirst(searching, third.session, third.turnDone)
    expect(searching.api.responseBodies()[0]?.['prompt_cache_key']).not.toBe(
      one?.['prompt_cache_key'],
    )
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

  it('sends a PDF as input_file and keeps its name in durable history', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const bytes = pdfFixture(2)
    t.api.script({ text: 'I can read it' })
    await session.sendTurn([
      { type: 'text', text: 'Summarize the report' },
      {
        type: 'file',
        name: 'report.pdf',
        mediaType: 'application/pdf',
        base64Data: Buffer.from(bytes).toString('base64'),
        sizeBytes: bytes.length,
        pageCount: 2,
      },
    ])
    await turnDone()
    expect(t.api.responseBodies()[0]).toMatchObject({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Summarize the report' },
            {
              type: 'input_file',
              filename: 'report.pdf',
              file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,
            },
          ],
        },
      ],
    })
    expect(session.history().items[0]).toMatchObject({
      kind: 'userMessage',
      attachments: [
        { type: 'file', name: 'report.pdf', mediaType: 'application/pdf', pageCount: 2 },
      ],
    })
  })

  it('keeps PDF data URLs out of pre- and post-model hook input', async () => {
    const payloads: string[] = []
    const t = setup({
      hooks: [...hooksFor('PreLLMCall', 'observe'), ...hooksFor('PostLLMCall', 'observe')],
      runHook: (_command, payload) => {
        payloads.push(payload)
        return hookReply()
      },
    })
    const { session, turnDone } = await startSession(t)
    const bytes = pdfFixture(1)
    const base64Data = Buffer.from(bytes).toString('base64')
    t.api.script({ text: 'I read it' })
    await session.sendTurn([
      { type: 'text', text: 'Summarize' },
      {
        type: 'file',
        name: 'private.pdf',
        mediaType: 'application/pdf',
        base64Data,
        sizeBytes: bytes.length,
        pageCount: 1,
      },
    ])
    await turnDone()
    expect(payloads).toHaveLength(2)
    expect(payloads.join('\n')).not.toContain(base64Data)
    expect(payloads.join('\n')).not.toContain('data:application/pdf')
  })

  it('notices when replay leaves older media out while preserving local history', async () => {
    const imageUrl = 'data:image/png;base64,AAAA'
    const store = memorySessionStore()
    const t = setup({ mediaBudgetMaxEncodedChars: imageUrl.length, store })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'first image seen' })
    await session.sendTurn([
      { type: 'text', text: 'First image' },
      { type: 'image', base64Data: 'AAAA', mediaType: 'image/png', width: 1, height: 1 },
    ])
    await turnDone()
    expect(events.some((event) => event.type === 'backendNotice')).toBe(false)
    t.api.script({ text: 'second image seen' })
    await session.sendTurn([
      { type: 'text', text: 'Second image' },
      { type: 'image', base64Data: 'AQ==', mediaType: 'image/png', width: 1, height: 1 },
    ])
    await turnDone()
    expect(events.filter((event) => event.type === 'backendNotice')).toEqual([
      { type: 'backendNotice', level: 'warning', text: UI_TEXT.olderMediaOmitted },
    ])
    expect(t.api.responseBodies()[1]).toMatchObject({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'First image' },
            { type: 'input_text', text: MODEL_TEXT.imageLeftOut },
          ],
        },
        expect.anything(),
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Second image' },
            { type: 'input_image', image_url: 'data:image/png;base64,AQ==' },
          ],
        },
      ],
    })
    expect(session.history().items.filter((item) => item.kind === 'userMessage')).toMatchObject([
      { attachments: [{ type: 'image' }] },
      { attachments: [{ type: 'image' }] },
    ])
    const firstCard = session.history().items.find((item) => item.kind === 'userMessage')
    if (firstCard?.kind !== 'userMessage' || firstCard.turnId === undefined) {
      throw new Error('expected first image card')
    }
    expect(session.sentImages(firstCard.turnId, firstCard.itemId)).toEqual([])
    const saved = session.snapshot()
    expect(JSON.stringify(saved.replay)).not.toContain(imageUrl)
    expect(JSON.stringify(saved.replay)).toContain(MODEL_TEXT.imageLeftOut)
    await t.host.close()
    const restored = setup({ mediaBudgetMaxEncodedChars: imageUrl.length, store })
    await restored.host.load()
    const resumed = await restored.host.resumeSession(session.sessionId, session.modelId)
    if (!(resumed.session instanceof ModelApiSession)) {
      throw new TypeError('expected Model API session')
    }
    expect(JSON.stringify(resumed.session.snapshot().replay)).not.toContain(imageUrl)
    expect(resumed.history.items.filter((item) => item.kind === 'userMessage')).toMatchObject([
      { attachments: [{ type: 'image' }] },
      { attachments: [{ type: 'image' }] },
    ])
    expect(resumed.session.sentImages(firstCard.turnId, firstCard.itemId)).toEqual([])
  })

  it('keeps old image bytes when the fitted request fails before delivery', async () => {
    const imageUrl = 'data:image/png;base64,AAAA'
    const t = setup({ mediaBudgetMaxEncodedChars: imageUrl.length })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'first image seen' })
    await session.sendTurn([
      { type: 'image', base64Data: 'AAAA', mediaType: 'image/png', width: 1, height: 1 },
    ])
    await turnDone()
    t.api.script({ failed: { code: 'invalid_request_error', message: 'request failed' } })
    await session.sendTurn([
      { type: 'image', base64Data: 'AQ==', mediaType: 'image/png', width: 1, height: 1 },
    ])
    await turnDone()
    expect(JSON.stringify(t.api.responseBodies()[1])).not.toContain(imageUrl)
    expect(JSON.stringify(session.snapshot().replay)).toContain(imageUrl)
  })

  it('sends a named text attachment as input_text with a file chip in history', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'It declares a value' })
    await session.sendTurn([
      { type: 'text', text: 'Explain this' },
      {
        type: 'textFile',
        name: 'a.ts',
        mediaType: 'text/plain',
        text: 'const a = 1',
        sizeBytes: 11,
      },
    ])
    await turnDone()
    expect(t.api.responseBodies()[0]).toMatchObject({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Explain this' },
            { type: 'input_text', text: 'Attached text file "a.ts":\n\nconst a = 1' },
          ],
        },
      ],
    })
    expect(session.history().items[0]).toMatchObject({
      attachments: [{ type: 'file', name: 'a.ts', mediaType: 'text/plain' }],
    })
  })

  it('rejects aggregate named text over the Model API allowance before HTTP', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const largeText = 'x'.repeat(Math.ceil(MAX_MODEL_API_TEXT_ATTACHMENT_BYTES / 2))
    const file = (name: string) => ({
      type: 'textFile' as const,
      name,
      mediaType: 'text/plain',
      text: largeText,
      sizeBytes: Buffer.byteLength(largeText),
    })
    await expect(
      session.sendTurn([{ type: 'text', text: 'Read both' }, file('a.txt'), file('b.txt')]),
    ).rejects.toThrow(UI_TEXT.textFilesOverModelApiBudget)
    expect(t.api.responseBodies()).toEqual([])
    expect(session.history().items).toEqual([])

    t.api.script({ text: 'Small file read' })
    await session.sendTurn([
      { type: 'text', text: 'Read one excerpt' },
      { type: 'textFile', name: 'small.txt', mediaType: 'text/plain', text: 'ok', sizeBytes: 2 },
    ])
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(1)
  })

  it('refuses a steer when earlier accepted steering already uses the text allowance', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'first', hold: held.promise }, { text: 'after first steer' })
    const turn = await session.sendTurn([{ type: 'text', text: 'Read the next file' }])
    await session.steer(turn.turnId, [halfBudgetTextPart('first.txt')])
    await expect(session.steer(turn.turnId, [halfBudgetTextPart('second.txt')])).rejects.toThrow(
      UI_TEXT.textFilesOverModelApiBudget,
    )
    held.resolve(undefined)
    await turnDone()
    expect(t.api.responseBodies().length).toBeGreaterThan(0)
    expect(JSON.stringify(t.api.responseBodies())).toContain('first.txt')
    expect(JSON.stringify(t.api.responseBodies())).not.toContain('second.txt')
    expect(session.history().items.some((item) => item.text?.includes('second.txt'))).toBe(false)
  })

  it('counts the active turn text file before accepting a steer', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'first', hold: held.promise })
    const turn = await session.sendTurn([
      { type: 'text', text: 'Read this' },
      halfBudgetTextPart('initial.txt'),
    ])
    await expect(session.steer(turn.turnId, [halfBudgetTextPart('later.txt')])).rejects.toThrow(
      UI_TEXT.textFilesOverModelApiBudget,
    )
    held.resolve(undefined)
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(modelInputAt(t, 0)).toContain('initial.txt')
    expect(session.history().items.some((item) => item.text?.includes('later.txt'))).toBe(false)
  })

  it('keeps the named-text allowance after a steer drains into a model request', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const firstHeld = Promise.withResolvers<undefined>()
    const secondHeld = Promise.withResolvers<undefined>()
    t.api.script(
      { text: 'first', hold: firstHeld.promise },
      { text: 'after steering', hold: secondHeld.promise },
    )
    const turn = await session.sendTurn([{ type: 'text', text: 'Start' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(1)
    })
    await session.steer(turn.turnId, [halfBudgetTextPart('first.txt')])
    firstHeld.resolve(undefined)
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(2)
    })
    await expect(session.steer(turn.turnId, [halfBudgetTextPart('later.txt')])).rejects.toThrow(
      UI_TEXT.textFilesOverModelApiBudget,
    )
    secondHeld.resolve(undefined)
    await turnDone()
    expect(modelInputAt(t, 1)).toContain('first.txt')
    expect(modelInputAt(t, 1)).not.toContain('later.txt')
  })

  it('rejects Muse-admitted text chips after a switch to Model API', async () => {
    const t = setup()
    const { session } = await startSession(t)
    let nextId = 0
    const attachments = new AttachmentStore(() => `att-${String(++nextId)}`)
    const bytes = Buffer.from('x'.repeat(700 * 1024))
    expect(attachments.add('first.txt', bytes, false, true).ok).toBe(true)
    expect(attachments.add('second.txt', bytes, false, true).ok).toBe(true)
    await expect(session.sendTurn(attachments.partsFor(['att-1', 'att-2']))).rejects.toThrow(
      UI_TEXT.textFilesOverModelApiBudget,
    )
    expect(t.api.responseBodies()).toEqual([])
    expect(session.history().items).toEqual([])
    expect(JSON.stringify(session.snapshot().replay)).not.toContain(bytes.toString('utf8'))
  })

  it('fits an MCP result image ahead of an older 50-page PDF in the next request', async () => {
    const mcp = fakeMcpSource([{ server: 'docs', tool: 'picture', isReadOnly: true }])
    const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
    mcp.outcomes = [
      {
        output: 'a picture',
        visibleOutput: 'a picture',
        outputParts: [
          { type: 'input_text', text: 'a picture' },
          { type: 'input_image', image_url: imageUrl, detail: 'auto' },
        ],
      },
    ]
    const t = setup({ mcpServers: mcp })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    const pdf = pdfFixture(50)
    t.api.script(
      { calls: [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'mcp_picture' }] },
      { text: 'done' },
    )
    await session.sendTurn([
      { type: 'text', text: 'Compare the PDF and picture' },
      {
        type: 'file',
        name: 'report.pdf',
        mediaType: 'application/pdf',
        base64Data: Buffer.from(pdf).toString('base64'),
        sizeBytes: pdf.length,
        pageCount: 50,
      },
    ])
    await turnDone()
    expect(t.api.responseBodies()[1]).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Compare the PDF and picture' },
            { type: 'input_text', text: expect.stringContaining('report.pdf') },
          ],
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'mcp_picture',
          output: [
            { type: 'input_text', text: 'a picture' },
            { type: 'input_image', image_url: imageUrl, detail: 'auto' },
          ],
        }),
      ]),
    })
    expect(events).toContainEqual({
      type: 'backendNotice',
      level: 'warning',
      text: UI_TEXT.olderMediaOmitted,
    })
  })

  it.each([
    { name: 'page slots', pages: 50, limit: 'slots' },
    { name: 'encoded characters', pages: 1, limit: 'encoded' },
  ])('refuses a visual read after undelivered MCP image fills $name', async ({ pages, limit }) => {
    const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
    const pdf = pdfFixture(pages)
    const pdfData = `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`
    const mcp = pictureSource(mcpImages(imageUrl))
    const t = setup({
      mcpServers: mcp,
      ...(limit === 'encoded' && {
        mediaBudgetMaxEncodedChars: imageUrl.length + pdfData.length - 1,
      }),
    })
    t.io.binaries.set('/ws/docs/report.pdf', pdf)
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    await completeToolCalls(
      t,
      session,
      turnDone,
      [
        { name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' },
        { name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' },
      ],
      'Read the picture and PDF',
      { text: 'Picture received' },
    )
    const delivered = modelInputAt(t, 1)
    expect(delivered).toContain(imageUrl)
    expect(delivered).not.toContain(pdfData)
    expect(delivered).toContain(MODEL_TEXT.toolMediaBudgetExceeded)
    const read = events.find(
      (event) => event.type === 'itemCompleted' && event.item.tool === 'read_file',
    )
    expect(read).toMatchObject({ item: { status: 'failed' } })
    const replay = JSON.stringify(session.snapshot().replay)
    expect(replay).toContain(imageUrl)
    expect(replay).not.toContain(pdfData)
  })

  it('keeps the earlier MCP image when a second tool image exceeds the encoded budget', async () => {
    const { t, firstUrl, secondUrl } = twoImageBudgetFixture(false)
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    await completeToolCalls(
      t,
      session,
      turnDone,
      [
        { name: 'mcp__docs__picture', arguments: '{}', callId: 'first_picture' },
        { name: 'mcp__docs__picture', arguments: '{}', callId: 'second_picture' },
      ],
      'Look at both pictures',
      { text: 'First picture received' },
    )
    const delivered = modelInputAt(t, 1)
    expect(delivered.includes(firstUrl)).toBe(true)
    expect(delivered.includes(secondUrl)).toBe(false)
    expect(delivered).toContain(MODEL_TEXT.toolMediaBudgetExceeded)
    expect(
      events.flatMap((event) =>
        event.type === 'itemCompleted' && event.item.tool === 'mcp__docs__picture'
          ? [event.item.status]
          : [],
      ),
    ).toEqual(['completed', 'failed'])
    const replay = JSON.stringify(session.snapshot().replay)
    expect(replay.includes(firstUrl)).toBe(true)
    expect(replay.includes(secondUrl)).toBe(false)
  })

  it('fails one MCP result whose two images exceed the aggregate encoded budget', async () => {
    const { t, firstUrl, secondUrl } = twoImageBudgetFixture(true)
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    await completeToolCalls(
      t,
      session,
      turnDone,
      [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'both_pictures' }],
      'Look at this result',
      { text: 'No pictures received' },
    )
    const delivered = modelInputAt(t, 1)
    expect(delivered.includes(firstUrl)).toBe(false)
    expect(delivered.includes(secondUrl)).toBe(false)
    expect(delivered).toContain(MODEL_TEXT.toolMediaBudgetExceeded)
    expectFailedTool(events, 'mcp__docs__picture')
    expect(JSON.stringify(session.snapshot().replay).includes(firstUrl)).toBe(false)
  })

  it('keeps a queued 50-page PDF when a later MCP image cannot fit', async () => {
    const { t, pdfData, imageUrl } = pdfPictureFixture()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    await completeToolCalls(
      t,
      session,
      turnDone,
      [
        { name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' },
        { name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' },
      ],
      'Read PDF and picture',
      { text: 'PDF received' },
    )
    const delivered = modelInputAt(t, 1)
    expect(delivered.includes(pdfData)).toBe(true)
    expect(delivered.includes(imageUrl)).toBe(false)
    expect(delivered).toContain(MODEL_TEXT.toolMediaBudgetExceeded)
    expectFailedTool(events, 'mcp__docs__picture')
    expect(JSON.stringify(session.snapshot().replay).includes(pdfData)).toBe(true)
  })

  it('scrubs an undelivered MCP image when a PostToolBatch hook stops the turn', async () => {
    const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
    const mcp = pictureSource(mcpImages(imageUrl))
    const t = setup({
      mcpServers: mcp,
      hooks: hooksFor('PostToolBatch', 'stop-picture'),
      runHook: () => hookReply(JSON.stringify({ continue: false, stopReason: 'stop picture' })),
    })
    const { session, turnDone } = await startSession(t, 'allowAll')
    await completeToolCalls(
      t,
      session,
      turnDone,
      [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' }],
      'Look at the picture',
    )
    expect(t.api.responseBodies()).toHaveLength(1)
    await expectNoPictureAfterStop(t, session, turnDone, imageUrl)
  })

  it('releases an MCP image reservation after its first completed delivery', async () => {
    const { t, pdfData, imageUrl } = pdfPictureFixture()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' }] },
      {
        calls: [{ name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' }],
      },
      { text: 'Both arrived in their own requests' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read the picture, then the PDF' }])
    await turnDone()
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input']).includes(imageUrl)).toBe(true)
    expect(JSON.stringify(t.api.responseBodies()[2]?.['input']).includes(pdfData)).toBe(true)
    expect(
      events.find((event) => event.type === 'itemCompleted' && event.item.tool === 'read_file'),
    ).toMatchObject({ item: { status: 'completed' } })
  })

  it('scrubs an MCP image when its first delivery request fails', async () => {
    const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
    const mcp = pictureSource(mcpImages(imageUrl))
    const t = setup({ mcpServers: mcp })
    const { session, turnDone } = await startSession(t, 'allowAll')
    await completeToolCalls(
      t,
      session,
      turnDone,
      [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' }],
      'Look at the picture',
      { failed: { code: 'server_error', message: 'delivery failed' } },
    )
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input']).includes(imageUrl)).toBe(true)
    await expectNoPictureAfterStop(t, session, turnDone, imageUrl)
  })

  it('fails a held MCP image when a steered 50-page PDF took the last slots first', async () => {
    const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
    const mcp = pictureSource(mcpImages(imageUrl))
    const held = Promise.withResolvers<undefined>()
    mcp.gate = held.promise
    const t = setup({ mcpServers: mcp })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' }] },
      { text: 'PDF received' },
    )
    const submitted = await session.sendTurn([{ type: 'text', text: 'Review the picture' }])
    await vi.waitFor(() => {
      expect(mcp.calls).toHaveLength(1)
    })
    const pdf = pdfTurnPart(50)
    await expect(session.steer(submitted.turnId, [pdf])).resolves.toMatchObject({
      disposition: 'steered',
    })
    held.resolve(undefined)
    await turnDone()
    expect(
      events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'mcp__docs__picture',
      ),
    ).toMatchObject({ item: { status: 'failed' } })
    const delivered = JSON.stringify(t.api.responseBodies()[1]?.['input'])
    expect(delivered.includes(imageUrl)).toBe(false)
    expect(delivered).toContain(pdf.base64Data)
    expect(delivered).toContain(MODEL_TEXT.toolMediaBudgetExceeded)
  })

  it('refuses a steer that would hide an already completed MCP image', async () => {
    const imageUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
    const mcp = pictureSource(mcpImages(imageUrl))
    const held = Promise.withResolvers<undefined>()
    const t = setup({
      mcpServers: mcp,
      hooks: hooksFor('PostToolBatch', 'hold-picture'),
      runHook: async () => {
        await held.promise
        return await hookReply()
      },
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'mcp__docs__picture', arguments: '{}', callId: 'picture' }] },
      { text: 'Picture received' },
    )
    const submitted = await session.sendTurn([{ type: 'text', text: 'Review the picture' }])
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) => event.type === 'itemCompleted' && event.item.tool === 'mcp__docs__picture',
        ),
      ).toBe(true)
    })
    await expect(session.steer(submitted.turnId, [pdfTurnPart(50)])).rejects.toThrow(
      UI_TEXT.mediaTotalTooLarge,
    )
    held.resolve(undefined)
    await turnDone()
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input']).includes(imageUrl)).toBe(true)
  })

  it('reserves a read-file PDF while its PostToolBatch hook holds first delivery', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const t = setup({
      hooks: hooksFor('PostToolBatch', 'hold-read-pdf'),
      runHook: async () => {
        entered.resolve(undefined)
        await release.promise
        return await hookReply()
      },
    })
    const bytes = pdfFixture(50)
    const pdfData = `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`
    t.io.binaries.set('/ws/docs/report.pdf', bytes)
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [{ name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' }],
      },
      { text: 'Read received' },
    )
    const submitted = await session.sendTurn([{ type: 'text', text: 'Read the PDF' }])
    await entered.promise
    let refused: unknown
    try {
      await session.steer(submitted.turnId, [pdfTurnPart(1)])
    } catch (error: unknown) {
      refused = error
    }
    release.resolve(undefined)
    await turnDone()
    expect(refused).toMatchObject({ message: UI_TEXT.mediaTotalTooLarge })
    expect(
      events.find((event) => event.type === 'itemCompleted' && event.item.tool === 'read_file'),
    ).toMatchObject({ item: { status: 'completed' } })
    expect(modelInputAt(t, 1)).toContain(pdfData)
  })

  it('releases a read-file reservation after its first completed request', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let postCalls = 0
    const t = setup({
      hooks: hooksFor('PostLLMCall', 'hold-after-read-delivery'),
      runHook: async () => {
        postCalls += 1
        if (postCalls === 2) {
          entered.resolve(undefined)
          await release.promise
        }
        return await hookReply()
      },
    })
    const bytes = pdfFixture(50)
    const pdfData = `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`
    t.io.binaries.set('/ws/docs/report.pdf', bytes)
    const { session, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [{ name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' }],
      },
      { text: 'PDF arrived' },
      { text: 'Steer arrived' },
    )
    const submitted = await session.sendTurn([{ type: 'text', text: 'Read the PDF' }])
    await entered.promise
    const steer = pdfTurnPart(1)
    await expect(session.steer(submitted.turnId, [steer])).resolves.toMatchObject({
      disposition: 'steered',
    })
    release.resolve(undefined)
    await turnDone()
    expect(modelInputAt(t, 1)).toContain(pdfData)
    expect(modelInputAt(t, 2)).toContain(steer.base64Data)
  })

  it('places a workspace PDF read after the function output so the next model call sees it', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const bytes = pdfFixture(1)
    t.io.binaries.set('/ws/docs/report.pdf', bytes)
    t.api.script(
      {
        calls: [{ name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' }],
      },
      { text: 'The PDF has one page' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read docs/report.pdf' }])
    await turnDone()
    expect(t.api.responseBodies()[1]).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({ type: 'function_call_output', call_id: 'read_pdf' }),
        expect.objectContaining({
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: expect.stringContaining('docs/report.pdf') },
            {
              type: 'input_file',
              filename: 'report.pdf',
              file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,
            },
          ],
        }),
      ]),
    })
  })

  it.each([
    {
      name: 'two known 30-page PDFs',
      first: pdfFixture(30, '/Review (first)'),
      second: pdfFixture(30, '/Review (second)'),
    },
    {
      name: 'an unknown-page PDF and another PDF',
      first: pdfFixture(1, '/Review /Encr#79pt'),
      second: pdfFixture(1),
    },
  ])('refuses the second tool-read PDF before replay omits the first: $name', async (files) => {
    const firstData = `data:application/pdf;base64,${Buffer.from(files.first).toString('base64')}`
    const secondData = `data:application/pdf;base64,${Buffer.from(files.second).toString('base64')}`
    const t = setup()
    t.io.binaries.set('/ws/docs/first.pdf', files.first)
    t.io.binaries.set('/ws/docs/second.pdf', files.second)
    const { session, events, turnDone } = await startSession(t)
    requestTwoToolPdfs(t, 'First PDF received')
    await session.sendTurn([{ type: 'text', text: 'Read these PDFs in order' }])
    await turnDone()
    const delivered = JSON.stringify(t.api.responseBodies()[1]?.['input'])
    expect(delivered).toContain(firstData)
    expect(delivered).not.toContain(secondData)
    expect(delivered).toContain(MODEL_TEXT.toolMediaBudgetExceeded)
    const statuses = events.flatMap((event) =>
      event.type === 'itemCompleted' && event.item.tool === 'read_file' ? [event.item.status] : [],
    )
    expect(statuses).toEqual(['completed', 'failed'])
    const durableReplay = JSON.stringify(session.snapshot().replay)
    expect(durableReplay).toContain(firstData)
    expect(durableReplay).not.toContain(secondData)
  })

  it('refuses excess PDF tool reads before retaining a batch of encoded files', async () => {
    const bytes = pdfFixture(1)
    const encoded = `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`
    const t = setup({ mediaBudgetMaxEncodedChars: encoded.length + 1 })
    t.io.binaries.set('/ws/docs/first.pdf', bytes)
    t.io.binaries.set('/ws/docs/second.pdf', bytes)
    const { session, events, turnDone } = await startSession(t)
    requestTwoToolPdfs(t, 'I read the first PDF')
    await session.sendTurn([{ type: 'text', text: 'Read both PDFs' }])
    await turnDone()
    expect(t.api.responseBodies()[1]).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'read_second',
          output: expect.stringContaining(MODEL_TEXT.toolMediaBudgetExceeded),
        }),
        expect.objectContaining({
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: expect.stringContaining('docs/first.pdf') },
            { type: 'input_file', filename: 'first.pdf', file_data: encoded },
          ],
        }),
      ]),
    })
    const readStatuses = events.flatMap((event) =>
      event.type === 'itemCompleted' && event.item.tool === 'read_file' ? [event.item.status] : [],
    )
    expect(readStatuses).toEqual(['completed', 'failed'])
  })

  it('does not replay a PDF read when Stop cancels its tool round before model delivery', async () => {
    const t = setup()
    t.io.binaries.set('/ws/docs/report.pdf', pdfFixture(1))
    const { session, events, turnDone } = await startSession(t)
    t.api.script({
      calls: [
        { name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' },
        ASK_USER_CALL,
      ],
    })
    await session.sendTurn([{ type: 'text', text: 'Read then ask' }])
    await awaitQuestion(events)
    await session.cancel()
    await turnDone()
    const nextInput = await nextInputAfterStop(t, session, turnDone)
    expect(nextInput).not.toContain('input_file')
    expect(nextInput).toContain('was not delivered because that tool round ended early')
  })

  it('removes a read-file PDF from future replay when Stop interrupts its delivery', async () => {
    const t = setup()
    t.io.binaries.set('/ws/docs/report.pdf', pdfFixture(1))
    const { session, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [{ name: 'read_file', arguments: '{"path":"docs/report.pdf"}', callId: 'read_pdf' }],
      },
      { hold: held.promise, text: 'held response' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read the PDF' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(2)
    })
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input'])).toContain('input_file')
    await session.cancel()
    held.resolve(undefined)
    await turnDone()
    expect(await nextInputAfterStop(t, session, turnDone)).not.toContain('input_file')
  })

  it('keeps an earlier delivered PDF when Stop interrupts a later PDF delivery in the same turn', async () => {
    const t = setup()
    const { firstData, laterData } = twoToolPdfs(t)
    const { session, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"docs/first.pdf"}' }] },
      { calls: [{ name: 'read_file', arguments: '{"path":"docs/later.pdf"}' }] },
      { hold: held.promise, text: 'held later answer' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read both in order' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(3)
    })
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input'])).toContain(firstData)
    expect(JSON.stringify(t.api.responseBodies()[2]?.['input'])).toContain(laterData)

    await session.cancel()
    held.resolve(undefined)
    await turnDone()
    const nextInput = await nextInputAfterStop(t, session, turnDone)
    expectOnlyFirstPdfDelivered(nextInput, firstData, laterData)
  })

  it('keeps an earlier delivered PDF when a later PDF delivery request fails', async () => {
    const t = setup()
    const { firstData, laterData } = twoToolPdfs(t)
    const { session, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"docs/first.pdf"}' }] },
      { calls: [{ name: 'read_file', arguments: '{"path":"docs/later.pdf"}' }] },
      { failed: { code: 'server_error', message: 'later request failed' } },
    )
    await session.sendTurn([{ type: 'text', text: 'Read both in order' }])
    await turnDone()
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input'])).toContain(firstData)
    expect(JSON.stringify(t.api.responseBodies()[2]?.['input'])).toContain(laterData)

    const nextInput = await nextInputAfterStop(t, session, turnDone)
    expectOnlyFirstPdfDelivered(nextInput, firstData, laterData)
  })

  it('keeps an earlier delivered PDF when a later PostToolBatch hook stops the turn', async () => {
    let batches = 0
    const t = setup({
      hooks: hooksFor('PostToolBatch', 'stop-later-pdf'),
      runHook: () => {
        batches += 1
        return hookReply(
          batches === 2 ? JSON.stringify({ continue: false, stopReason: 'stop later PDF' }) : '{}',
        )
      },
    })
    const { firstData, laterData } = twoToolPdfs(t)
    const { session, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"docs/first.pdf"}' }] },
      { calls: [{ name: 'read_file', arguments: '{"path":"docs/later.pdf"}' }] },
      { text: 'should not run' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read both before the hook stops' }])
    await turnDone()
    expect(batches).toBe(2)
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(JSON.stringify(t.api.responseBodies()[1]?.['input'])).toContain(firstData)

    const nextInput = await nextInputAfterStop(t, session, turnDone)
    expectOnlyFirstPdfDelivered(nextInput, firstData, laterData)
  })

  it.each(['PostToolUse', 'PostToolBatch'] as const)(
    'does not replay a PDF when a %s hook stops its tool round',
    async (event) => {
      const t = setup({
        hooks: hooksFor(event, 'stop-pdf'),
        runHook: () => hookReply(JSON.stringify({ continue: false, stopReason: 'stop PDF' })),
      })
      t.io.binaries.set('/ws/docs/report.pdf', pdfFixture(1))
      const { session, turnDone } = await startSession(t, 'allowAll')
      t.api.script(
        { calls: [{ name: 'read_file', arguments: '{"path":"docs/report.pdf"}' }] },
        { text: 'should not run' },
      )
      await session.sendTurn([{ type: 'text', text: 'Read the PDF' }])
      await turnDone()
      expect(t.api.responseBodies()).toHaveLength(1)
      const nextInput = await nextInputAfterStop(t, session, turnDone)
      expect(nextInput).not.toContain('input_file')
      expect(nextInput).toContain('was not delivered because that tool round ended early')
    },
  )
})

describe('ModelApiSession: hook boundaries (M51)', () => {
  it('vetoes a captured PreLLMCall before any Model API request', async () => {
    const payloads: unknown[] = []
    const t = setup({
      hooks: hooksFor('PreLLMCall', 'veto'),
      runHook: (_command, payload) => {
        payloads.push(JSON.parse(payload))
        return Promise.resolve({
          stdout: JSON.stringify({ decision: 'block', reason: 'M51 pre-call veto' }),
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        })
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'not sent' })
    await session.sendTurn([{ type: 'text', text: 'Do work' }])
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(0)
    expect(payloads).toEqual([
      expect.objectContaining({
        hook_event_name: 'PreLLMCall',
        provider: 'meta',
        attempt: 1,
        step: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Do work' }] }],
      }),
    ])
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      reason: 'M51 pre-call veto',
    })
  })

  it('observes successful model calls and compaction with captured PostLLMCall fields', async () => {
    const payloads: unknown[] = []
    const t = modelCallObserver(payloads)
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'Reply' })
    await session.sendTurn([{ type: 'text', text: 'First prompt' }])
    await turnDone()
    t.api.script({ text: 'Summary' })
    await expect(session.compact()).resolves.toMatchObject({ status: 'accepted' })
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hook_event_name: 'PreLLMCall',
          provider: 'meta',
          attempt: 1,
          step: 0,
          message_count: 1,
          tool_count: expect.any(Number),
        }),
        expect.objectContaining({
          hook_event_name: 'PostLLMCall',
          provider: 'meta',
          status: 'success',
          response_id: expect.any(String),
          output_text_preview: 'Reply',
          tool_call_count: 0,
          usage: expect.objectContaining({ input_tokens: expect.any(Number) }),
        }),
        expect.objectContaining({
          hook_event_name: 'PreLLMCall',
          tool_count: 0,
        }),
        expect.objectContaining({
          hook_event_name: 'PostLLMCall',
          tool_count: 0,
          output_text_preview: 'Summary',
        }),
      ]),
    )
    expect(t.api.responseBodies()).toHaveLength(2)
  })

  it('issues a fresh PreLLMCall for a whole-stream retry and one successful PostLLMCall', async () => {
    const payloads: unknown[] = []
    const t = modelCallObserver(payloads)
    const { session, turnDone } = await startSession(t)
    t.api.script(
      { text: 'partial', streamError: { code: 'server_shutting_down', message: 'draining' } },
      { text: 'final' },
    )
    await session.sendTurn([{ type: 'text', text: 'Try again' }])
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(payloads).toMatchObject([
      { hook_event_name: 'PreLLMCall', attempt: 1, step: 0 },
      { hook_event_name: 'PreLLMCall', attempt: 2, step: 0 },
      { hook_event_name: 'PostLLMCall', attempt: 2, step: 0, status: 'success' },
    ])
  })

  it('stops after a captured PostLLMCall block without executing returned tools', async () => {
    let shouldBlock = true
    const t = setup({
      hooks: hooksFor('PostLLMCall', 'veto'),
      runHook: postVetoHook(() => shouldBlock),
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script({
      calls: [
        {
          name: 'write_file',
          arguments: '{"path":"blocked.txt","content":"bad"}',
          callId: 'blocked-call',
        },
      ],
    })
    await session.sendTurn([{ type: 'text', text: 'Write it' }])
    await turnDone()
    expect(t.files.has(`${ROOT}/blocked.txt`)).toBe(false)
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      reason: 'Post veto',
    })
    shouldBlock = false
    t.api.script({ text: 'Next reply' })
    await session.sendTurn([{ type: 'text', text: 'Continue later' }])
    await turnDone()
    expect(t.api.responseBodies()[1]).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'blocked-call',
          output: expect.stringContaining('Post veto'),
        }),
      ]),
    })
  })

  it('replays model hook context after tool outputs, keeping the request valid', async () => {
    const t = setup({
      hooks: [...hooksFor('PreLLMCall', 'pre-context'), ...hooksFor('PostLLMCall', 'post-context')],
      files: { 'a.txt': 'alpha' },
      runHook: (_command, payload) =>
        Promise.resolve({
          stdout: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: payload.includes('"hook_event_name":"PreLLMCall"')
                ? 'PreLLMCall'
                : 'PostLLMCall',
              additionalContext: payload.includes('"hook_event_name":"PreLLMCall"')
                ? 'Pre note'
                : 'Post note',
            },
          }),
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        }),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'read-one' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read it' }])
    await turnDone()
    const second = t.api.responseBodies()[1]?.['input']
    const input: readonly unknown[] = Array.isArray(second) ? second : []
    const outputIndex = input.findIndex(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'function_call_output',
    )
    const postContextIndex = input.findIndex((item) => JSON.stringify(item).includes('Post note'))
    expect(outputIndex).toBeGreaterThan(0)
    expect(postContextIndex).toBeGreaterThan(outputIndex)
    expect(JSON.stringify(second)).toContain('Pre note')
  })

  it('keeps old history and counts usage when a PostLLMCall hook stops compaction', async () => {
    let shouldBlock = false
    const t = setup({
      hooks: hooksFor('PostLLMCall', 'veto'),
      runHook: postVetoHook(() => shouldBlock),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'Before' })
    await session.sendTurn([{ type: 'text', text: 'First' }])
    await turnDone()
    const before = session.snapshot()
    shouldBlock = true
    t.api.script({ text: 'Summary', usage: { input: 20, output: 3 } })
    await expect(session.compact()).rejects.toThrow('Post veto')
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(session.snapshot().usage.inputTokens - before.usage.inputTokens).toBe(20)
    expect(session.snapshot().usage.outputTokens - before.usage.outputTokens).toBe(3)
    expect(session.history().items.some((item) => item.kind === 'compaction')).toBe(false)
    expect(JSON.stringify(session.snapshot().replay)).toContain('First')
  })

  it('runs SessionStart when a session opens, before its first prompt', async () => {
    const payloads: string[] = []
    const t = setup({
      hooks: hooksFor('SessionStart', 'start'),
      runHook: recordRawHookPayloads(payloads),
    })
    await startSession(t)
    expect(payloads).toHaveLength(1)
    const payload: unknown = JSON.parse(payloads[0] ?? '')
    expect(payload).toMatchObject({ hook_event_name: 'SessionStart', source: 'startup' })
    expect(JSON.stringify(payload)).not.toContain('turn_id')
    expect(t.api.responseBodies()).toHaveLength(0)
  })

  it('fires SessionStart again for a fork and after accepted compaction', async () => {
    const payloads: string[] = []
    const t = setup({
      hooks: hooksFor('SessionStart', 'start'),
      runHook: recordRawHookPayloads(payloads),
    })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await t.host.forkSession(session.sessionId, 'muse-spark-1.3')
    t.api.script({ text: 'summary' })
    expect(await session.compact()).toMatchObject({ status: 'accepted' })
    expect(payloads).toHaveLength(3)
    const fork: unknown = JSON.parse(payloads[1] ?? '')
    const compact: unknown = JSON.parse(payloads[2] ?? '')
    expect(fork).toMatchObject({ hook_event_name: 'SessionStart', source: 'fork' })
    expect(compact).toMatchObject({ hook_event_name: 'SessionStart', source: 'compact' })
  })

  it('blocks a prompt before any API request and excludes it from later replay', async () => {
    let shouldBlock = true
    const t = setup({
      hooks: hooksFor('UserPromptSubmit', 'guard'),
      runHook: () =>
        Promise.resolve({
          stdout: '',
          stderr: shouldBlock ? 'prompt blocked' : '',
          exitCode: shouldBlock ? 2 : 0,
          isTimedOut: false,
          isCancelled: false,
        }),
    })
    const { session, events, turnDone } = await startSession(t)
    await session.sendTurn([{ type: 'text', text: 'blocked prompt' }])
    await turnDone()
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      reason: 'prompt blocked',
    })
    expect(JSON.stringify(t.log.warn.mock.calls)).not.toContain('prompt blocked')
    expect(t.api.responseBodies()).toHaveLength(0)

    shouldBlock = false
    t.api.script({ text: 'allowed' })
    await session.sendTurn([{ type: 'text', text: 'allowed prompt' }])
    await turnDone()
    const input = JSON.stringify(t.api.responseBodies()[0]?.['input'])
    expect(input).toContain('allowed prompt')
    expect(input).not.toContain('blocked prompt')
  })

  it('accepts but ignores continue false on prompt submission, as Muse does', async () => {
    const t = setup({
      hooks: hooksFor('UserPromptSubmit', 'stop'),
      runHook: () =>
        Promise.resolve({
          stdout: JSON.stringify({ continue: false, stopReason: 'stop here' }),
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        }),
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'received' })
    await session.sendTurn([{ type: 'text', text: 'send me' }])
    await turnDone()
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    expect(t.api.responseBodies()).toHaveLength(1)
  })

  it('rechecks permissions after a hook rewrites a tool to a protected path', async () => {
    const t = setup({
      hooks: hooksFor('PreToolUse', 'rewrite'),
      runHook: () =>
        Promise.resolve({
          stdout: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: { path: '.muse/hooks.json', content: 'reviewed' },
            },
          }),
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        }),
    })
    const { session, events, turnDone } = await startSession(t, 'onRequest')
    scriptWriteCalls(t, { path: 'notes.txt', content: 'x', callId: 'hook_write' })
    await session.sendTurn([{ type: 'text', text: 'write' }])
    const request = await approvalRequest(events, 0)
    expect(request).toMatchObject({
      subject: { kind: 'fileWrite', path: '.muse/hooks.json' },
      isProtectedWrite: true,
    })
    expect(t.files.has(`${ROOT}/notes.txt`)).toBe(false)
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'abort',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(t.files.has(`${ROOT}/.muse/hooks.json`)).toBe(false)
  })

  it('lets a PermissionRequest hook deny without showing an approval card', async () => {
    const t = setup({ hooks: hooksFor('PermissionRequest', 'deny'), runHook: denyHook })
    const events = await completeUnpromptedWrite(t)
    expect(t.files.has(`${ROOT}/notes.txt`)).toBe(false)
    expect(
      events.find((event) => event.type === 'itemCompleted' && event.item.kind === 'toolCall'),
    ).toMatchObject({
      item: { status: 'rejected', failureReason: 'write_file rejected by a hook' },
    })
  })

  it('lets an opted-in PermissionRequest hook allow an ordinary edit', async () => {
    const t = setup({
      hooks: hooksFor('PermissionRequest', 'allow'),
      runHook: permitHook,
    })
    await completeUnpromptedWrite(t)
    expect(t.files.get(`${ROOT}/notes.txt`)).toBe('x')
  })

  it('keeps protected writes on cards and paid calls on the popup despite hook allow', async () => {
    const protectedWrite = setup({
      hooks: hooksFor('PermissionRequest', 'allow'),
      runHook: permitHook,
    })
    const first = await startSession(protectedWrite, 'onRequest')
    protectedWrite.api.script(
      {
        calls: [
          {
            name: 'write_file',
            arguments: '{"path":".muse/hooks.json","content":"x"}',
            callId: 'c',
          },
        ],
      },
      { text: 'done' },
    )
    await first.session.sendTurn([{ type: 'text', text: 'write hooks' }])
    const protectedCard = await approvalRequest(first.events, 0)
    expect(protectedCard.isProtectedWrite).toBe(true)
    await first.session.decideApproval({
      approvalId: protectedCard.approvalId,
      choiceId: 'abort',
      requirementId: protectedCard.requirementId,
    })
    await first.turnDone()
    expect(protectedWrite.files.has(`${ROOT}/.muse/hooks.json`)).toBe(false)

    const paid = setup({
      paid: ['imageGeneration'],
      hooks: hooksFor('PermissionRequest', 'allow'),
      runHook: permitHook,
      allowsPaidUse: () => Promise.resolve(false),
    })
    const second = await startSession(paid, 'allowAll')
    paid.api.script({ calls: [imageCall({ prompt: 'one', path: 'one.png' })] }, { text: 'done' })
    await second.session.sendTurn([{ type: 'text', text: 'draw' }])
    await second.turnDone()
    expect(paid.paidRequests).toEqual([
      {
        request: {
          feature: 'imageGeneration',
          kind: 'generate',
          path: 'one.png',
          sources: [],
          prompt: 'one',
        },
        requiresAsking: false,
      },
    ])
    expect(second.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(paid.paidUses).toEqual([])
    expect(paid.io.binaries.has(`${ROOT}/one.png`)).toBe(false)
  })

  it('lets a PermissionRequest hook deny a paid image before the popup asks (M58)', async () => {
    const t = setup({
      paid: ['imageGeneration'],
      hooks: hooksFor('PermissionRequest', 'deny'),
      runHook: denyHook,
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script({ calls: [imageCall({ prompt: 'one', path: 'one.png' })] }, { text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'draw' }])
    await turnDone()
    expect(t.paidRequests).toEqual([])
    expect(hasApprovalCard(events)).toBe(false)
    expect(
      events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'generate_image',
      ),
    ).toMatchObject({
      item: { status: 'rejected', failureReason: 'generate_image rejected by a hook' },
    })
    expect(t.api.imageBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    expect(t.io.binaries.has(`${ROOT}/one.png`)).toBe(false)
  })

  it('emits success, failure, batch and stop hook payloads at their boundaries', async () => {
    const payloads: unknown[] = []
    const hooks = [
      ...hooksFor('PostToolUse', 'observe'),
      ...hooksFor('PostToolUseFailure', 'observe'),
      ...hooksFor('PostToolBatch', 'observe'),
      ...hooksFor('Stop', 'observe'),
    ]
    const t = setup({
      hooks,
      files: { 'a.txt': 'alpha' },
      runHook: recordHookPayloads(payloads),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          { name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'read_a' },
          { name: 'read_file', arguments: '{"path":"missing.txt"}', callId: 'read_missing' },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'Read files' }])
    await turnDone()
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hook_event_name: 'PostToolUse',
          tool_name: 'read_file',
          tool_input: { path: 'a.txt' },
          tool_use_id: expect.any(String),
          tool_response: expect.stringContaining('alpha'),
        }),
        expect.objectContaining({
          hook_event_name: 'PostToolUseFailure',
          tool_name: 'read_file',
          tool_input: { path: 'missing.txt' },
          tool_use_id: expect.any(String),
          is_interrupt: false,
          duration_ms: expect.any(Number),
          error: expect.any(String),
        }),
        expect.objectContaining({
          hook_event_name: 'PostToolBatch',
          tool_calls: [
            expect.objectContaining({ tool_name: 'read_file', tool_input: { path: 'a.txt' } }),
            expect.objectContaining({
              tool_name: 'read_file',
              tool_input: { path: 'missing.txt' },
            }),
          ],
        }),
        expect.objectContaining({
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: 'done',
        }),
      ]),
    )
  })

  it('bounds Stop hook continuations to avoid an unending paid model loop', async () => {
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: JSON.stringify({ decision: 'block', reason: 'continue' }),
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setup({ hooks: hooksFor('Stop', 'keep-going'), runHook })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      ...Array.from({ length: HOOK_MAX_STOP_CONTINUATIONS + 1 }, () => ({ text: 'reply' })),
    )
    await session.sendTurn([{ type: 'text', text: 'finish' }])
    await turnDone()
    expect(t.api.responseBodies()).toHaveLength(HOOK_MAX_STOP_CONTINUATIONS + 1)
    expect(runHook).toHaveBeenCalledTimes(HOOK_MAX_STOP_CONTINUATIONS + 1)
    expect(t.log.warn).toHaveBeenCalledWith('Model API Stop hook reached its continuation limit')
  })

  it('lets PreCompact veto a manual compaction before the model is called', async () => {
    const t = setup({
      hooks: hooksFor('PreCompact', 'veto'),
      runHook: () =>
        Promise.resolve({
          stdout: JSON.stringify({ continue: false, stopReason: 'keep context' }),
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        }),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'first' })
    await session.sendTurn([{ type: 'text', text: 'first' }])
    await turnDone()
    expect(await session.compact()).toEqual({ status: 'noop', reason: 'keep context' })
    expect(t.api.responseBodies()).toHaveLength(1)
  })

  it('emits compaction and model-failure hook payloads at their boundaries', async () => {
    const payloads: unknown[] = []
    const t = setup({
      hooks: [
        ...hooksFor('PreCompact', 'observe'),
        ...hooksFor('PostCompact', 'observe'),
        ...hooksFor('StopFailure', 'observe'),
      ],
      runHook: recordHookPayloads(payloads),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'first' })
    await session.sendTurn([{ type: 'text', text: 'first' }])
    await turnDone()
    t.api.script({ text: 'summary' })
    expect(await session.compact()).toMatchObject({ status: 'accepted' })
    t.api.script({
      httpError: {
        status: 400,
        body: { error: { message: 'bad request', type: 'invalid_request_error' } },
      },
    })
    await session.sendTurn([{ type: 'text', text: 'fail' }])
    await turnDone()
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hook_event_name: 'PreCompact', trigger: 'manual' }),
        expect.objectContaining({ hook_event_name: 'PostCompact', trigger: 'manual' }),
        expect.objectContaining({
          hook_event_name: 'StopFailure',
          error: 'modelApi',
          error_details: 'bad request',
        }),
      ]),
    )
  })

  it('fires Notification for an approval that stays open', async () => {
    const runHook = vi.fn((_command: string, _payload: string) =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setup({
      hooks: hooksFor('Notification', 'notify'),
      hookNotificationDelayMs: 10,
      runHook,
    })
    const { session, events, turnDone } = await startSession(t)
    scriptWriteCalls(t, { path: 'notes.txt', content: 'x', callId: 'c' })
    await session.sendTurn([{ type: 'text', text: 'write' }])
    const request = await approvalRequest(events, 0)
    await vi.waitFor(() => {
      expect(runHook).toHaveBeenCalledOnce()
    })
    const payload: unknown = JSON.parse(String(runHook.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      title: 'write_file',
    })
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'abort',
      requirementId: request.requirementId,
    })
    await turnDone()
  })

  it('fires SessionEnd on orderly host shutdown, once per live session', async () => {
    const payloads: string[] = []
    const t = setup({
      hooks: hooksFor('SessionEnd', 'finish'),
      runHook: (_command, payload) => {
        payloads.push(payload)
        return Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        })
      },
    })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await t.host.close()
    expect(payloads).toHaveLength(1)
    const parsed: unknown = JSON.parse(payloads[0] ?? '')
    expect(parsed).toMatchObject({
      hook_event_name: 'SessionEnd',
      reason: 'shutdown',
      session_id: session.sessionId,
    })
  })
})

const skillFile = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

const toolNames = (body: Record<string, unknown> | undefined) =>
  (body?.['tools'] as { name?: string }[]).map((tool) => tool.name)
const MEMORY_TOOL_NAMES = ['read_memory', 'add_memory', 'edit_memory']
const ADD_DEPLOY = {
  name: 'add_memory',
  arguments: JSON.stringify({
    scope: 'project',
    path: 'deploy.md',
    content: 'Deploys run on Fridays.',
    type: 'reference',
    description: 'Deploy day',
  }),
  callId: 'call_add',
}
const DEPLOY_WRITTEN =
  '{"success":true,"scope":"project","path":"deploy.md","operation":"add","message":"memory note written"}'

function forceMemoryApprovalHook() {
  return hookReply(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    }),
  )
}

/** The memory rows' final snapshots, in order. */
const memoryRows = (events: readonly AgentEvent[]) =>
  events.flatMap((event) =>
    event.type === 'itemCompleted' &&
    event.item.kind === 'toolCall' &&
    MEMORY_TOOL_NAMES.includes(event.item.tool ?? '')
      ? [event.item]
      : [],
  )

describe('ModelApiSession: memory (M49)', () => {
  it.each(['allowAll', 'onRequest'] as const)(
    'makes a PreToolUse ask require a human for memory writes in %s',
    async (mode) => {
      for (const call of [
        ADD_DEPLOY,
        {
          name: 'edit_memory',
          arguments: JSON.stringify({
            scope: 'project',
            path: 'prefs.md',
            old_str: 'Tea',
            new_str: 'Coffee',
          }),
          callId: 'call_edit',
        },
      ]) {
        const t = setup({
          files: { '.agents/memory/prefs.md': 'Tea' },
          hooks: [
            ...hooksFor('PreToolUse', 'ask-memory'),
            ...hooksFor('PermissionRequest', 'allow-memory'),
          ],
          runHook: (_command, payload) =>
            payload.includes('"hook_event_name":"PreToolUse"')
              ? forceMemoryApprovalHook()
              : permitHook(),
        })
        const { session, events, turnDone } = await startSession(t, mode)
        t.api.script({ calls: [call] }, { text: 'done' })
        await session.sendTurn([{ type: 'text', text: 'remember the preference' }])
        const request = await approvalRequest(events, 0)
        expect(request).toMatchObject({
          toolName: call.name,
          subject: { kind: 'fileWrite', toolName: call.name },
          isJudgeEscalated: true,
        })
        expect(t.files.has(`${ROOT}/.agents/memory/deploy.md`)).toBe(false)
        expect(t.files.get(`${ROOT}/.agents/memory/prefs.md`)).toBe('Tea')
        await session.decideApproval({
          approvalId: request.approvalId,
          choiceId: 'abort',
          requirementId: request.requirementId,
        })
        await turnDone()
        expect(memoryRows(events)[0]?.status).toBe('rejected')
        expect(t.files.has(`${ROOT}/.agents/memory/deploy.md`)).toBe(false)
        expect(t.files.get(`${ROOT}/.agents/memory/prefs.md`)).toBe('Tea')
      }
    },
  )

  it('runs a hook-forced memory write only after Allow once in Bypass', async () => {
    const t = setup({
      hooks: hooksFor('PreToolUse', 'ask-memory'),
      runHook: forceMemoryApprovalHook,
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script({ calls: [ADD_DEPLOY] }, { text: 'saved' })
    await session.sendTurn([{ type: 'text', text: 'remember deploy day' }])
    const approval = await approvalRequest(events, 0)
    expect(t.files.has(`${ROOT}/.agents/memory/deploy.md`)).toBe(false)
    await session.decideApproval({
      approvalId: approval.approvalId,
      choiceId: 'allow_once',
      requirementId: approval.requirementId,
    })
    await turnDone()
    expect(memoryRows(events)[0]?.status).toBe('completed')
    expect(t.files.get(`${ROOT}/.agents/memory/deploy.md`)).toContain('Deploys run on Fridays.')
  })

  it('asks before a hook-forced memory read without presenting it as a write', async () => {
    const t = setup({
      files: { '.agents/memory/deploy.md': 'Deploy day' },
      hooks: hooksFor('PreToolUse', 'ask-memory'),
      runHook: forceMemoryApprovalHook,
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'read_memory', arguments: '{"scope":"project","path":"deploy.md"}' }] },
      { text: 'read' },
    )
    await session.sendTurn([{ type: 'text', text: 'read memory' }])
    const approval = await approvalRequest(events, 0)
    expect(approval).toMatchObject({
      toolName: 'read_memory',
      subject: { kind: 'tool', toolName: 'read_memory' },
      isJudgeEscalated: true,
    })
    await session.decideApproval({
      approvalId: approval.approvalId,
      choiceId: 'allow_once',
      requirementId: approval.requirementId,
    })
    await turnDone()
    expect(memoryRows(events)[0]?.status).toBe('completed')
    expect(memoryRows(events)[0]?.visibleOutput).toContain('Deploy day')
  })

  it('keeps Plan denial ahead of a hook-forced memory approval', async () => {
    const t = setup({
      hooks: hooksFor('PreToolUse', 'ask-memory'),
      runHook: forceMemoryApprovalHook,
    })
    const { session, events, turnDone } = await startSession(t, 'denyUnmatched')
    t.api.script({ calls: [ADD_DEPLOY] }, { text: 'refused' })
    await session.sendTurn([{ type: 'text', text: 'remember deploy day' }])
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(memoryRows(events)[0]?.status).toBe('rejected')
    expect(t.files.has(`${ROOT}/.agents/memory/deploy.md`)).toBe(false)
  })

  it('routes a hook-rewritten memory note through its final path approval and store', async () => {
    const t = setup({
      hooks: hooksFor('PreToolUse', 'review-memory'),
      runHook: () =>
        hookReply(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: {
                scope: 'project',
                path: 'reviewed.md',
                content: 'Reviewed memory content.',
                type: 'reference',
                description: 'Reviewed note',
              },
            },
          }),
        ),
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ calls: [ADD_DEPLOY] }, { text: 'saved' })
    await session.sendTurn([{ type: 'text', text: 'remember the review' }])
    const approval = await approvalRequest(events, 0)
    expect(approval.subject).toMatchObject({
      kind: 'fileWrite',
      path: '.agents/memory/reviewed.md',
    })
    await session.decideApproval({
      approvalId: approval.approvalId,
      choiceId: 'allow_once',
      requirementId: approval.requirementId,
    })
    await turnDone()
    expect(t.files.get(`${ROOT}/.agents/memory/reviewed.md`)).toContain('Reviewed memory content.')
    expect(t.files.has(`${ROOT}/.agents/memory/deploy.md`)).toBe(false)
  })

  it('offers the memory tools and the snapshot only in a trusted workspace with a store', async () => {
    const trusted = setup({ files: { '.agents/memory/MEMORY.md': '- [Build](build.md) | npm\n' } })
    const first = await startSession(trusted)
    await answerFirst(trusted, first.session, first.turnDone)
    const body = trusted.api.responseBodies()[0]
    expect(toolNames(body)).toEqual(expect.arrayContaining(MEMORY_TOOL_NAMES))
    expect(body?.['instructions']).toContain('## project\n\nMEMORY.md:\n- [Build](build.md) | npm')
    for (const t of [setup({ isTrusted: false }), setup({ hasMemory: false })]) {
      const { session, turnDone } = await startSession(t)
      await answerFirst(t, session, turnDone)
      const other = t.api.responseBodies()[0]
      expect(toolNames(other)).not.toContain('add_memory')
      expect(other?.['instructions']).not.toContain('# Memory')
    }
  })

  it('writes a note in Manual after a card that names it, and answers as Muse Code does', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ calls: [ADD_DEPLOY] }, { text: 'saved' })
    await session.sendTurn([{ type: 'text', text: 'remember the deploy day' }])
    const request = await approvalRequest(events, 0)
    expect(request).toMatchObject({
      toolName: 'add_memory',
      subject: { kind: 'fileWrite', path: '.agents/memory/deploy.md', toolName: 'add_memory' },
      isProtectedWrite: false,
    })
    expect(t.files.has(`${ROOT}/.agents/memory/deploy.md`)).toBe(false)
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(memoryRows(events)).toEqual([
      expect.objectContaining({ status: 'completed', visibleOutput: DEPLOY_WRITTEN }),
    ])
    expect(t.files.get(`${ROOT}/.agents/memory/deploy.md`)).toBe(
      '---\ntype: reference\ndescription: Deploy day\n---\n\nDeploys run on Fridays.',
    )
    expect(t.files.get(`${ROOT}/.agents/memory/MEMORY.md`)).toBe(
      '- [deploy](deploy.md) | Deploy day\n',
    )
    const replayed = t.api.responseBodies()[1]?.['input'] as Record<string, unknown>[]
    expect(replayed.at(-1)).toEqual({
      type: 'function_call_output',
      call_id: 'call_add',
      output: DEPLOY_WRITTEN,
    })
  })

  it('writes without a card in Auto, reads without one in Manual, and refuses writes in Plan', async () => {
    const auto = setup()
    const autoRun = await startSession(auto, 'onRequest')
    auto.api.script(
      {
        calls: [
          ADD_DEPLOY,
          {
            name: 'read_memory',
            arguments: '{"scope":"project","path":"deploy.md","offset":6}',
            callId: 'call_read',
          },
        ],
      },
      { text: 'ok' },
    )
    await autoRun.session.sendTurn([{ type: 'text', text: 'go' }])
    await autoRun.turnDone()
    expect(autoRun.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(JSON.parse(memoryRows(autoRun.events)[1]?.visibleOutput ?? '')).toEqual({
      success: true,
      scope: 'project',
      path: 'deploy.md',
      start_line_number: 6,
      content: 'Deploys run on Fridays.',
      truncated: false,
    })
    const plan = setup({ files: { '.agents/memory/deploy.md': 'Fridays.' } })
    const planRun = await startSession(plan, 'denyUnmatched')
    plan.api.script(
      {
        calls: [
          ADD_DEPLOY,
          { name: 'read_memory', arguments: '{"scope":"project","path":"deploy.md"}', callId: 'r' },
        ],
      },
      { text: 'ok' },
    )
    await planRun.session.sendTurn([{ type: 'text', text: 'go' }])
    await planRun.turnDone()
    expect(memoryRows(planRun.events).map((row) => row.status)).toEqual(['rejected', 'completed'])
    expect(memoryRows(planRun.events)[0]?.failureReason).toBe(
      'add_memory refused by the permission mode',
    )
    expect(plan.files.get(`${ROOT}/.agents/memory/deploy.md`)).toBe('Fridays.')
  })

  it('refuses a bad path before any card, and memory altogether in Restricted Mode', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          { name: 'add_memory', arguments: '{"path":"../escape.md","content":"x"}', callId: 'a' },
          {
            name: 'edit_memory',
            arguments: '{"path":"prefs.md","scope":"personal","old_str":"a","new_str":"b"}',
            callId: 'b',
          },
        ],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    const request = await approvalRequest(events, 0)
    expect(request.subject).toMatchObject({ path: `${PERSONAL}/prefs.md` })
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(memoryRows(events).map((row) => [row.status, row.failureReason])).toEqual([
      ['failed', 'memory path traversal is not allowed'],
      ['failed', 'memory file not found'],
    ])
    expect(events.filter((event) => event.type === 'approvalRequested')).toHaveLength(1)
    const restricted = setup({ isTrusted: false })
    const restrictedRun = await startSession(restricted, 'allowAll')
    restricted.api.script({ calls: [ADD_DEPLOY] }, { text: 'ok' })
    await restrictedRun.session.sendTurn([{ type: 'text', text: 'go' }])
    await restrictedRun.turnDone()
    expect(memoryRows(restrictedRun.events)[0]).toMatchObject({
      status: 'rejected',
      failureReason:
        'memory is not available while the workspace is in Restricted Mode; trust the workspace to use it',
    })
    const storeless = setup({ hasMemory: false })
    const storelessRun = await startSession(storeless, 'allowAll')
    storeless.api.script({ calls: [ADD_DEPLOY] }, { text: 'ok' })
    await storelessRun.session.sendTurn([{ type: 'text', text: 'go' }])
    await storelessRun.turnDone()
    expect(memoryRows(storelessRun.events)[0]?.failureReason).toBe('unknown tool add_memory')
  })

  it('re-locates a memory write after its approval, refusing a swapped link', async () => {
    const links: Record<string, string> = {}
    const t = setup({
      files: { '.agents/memory/prefs.md': 'Tea.' },
      memoryLinks: links,
    })
    // Beyond the link the swap will point at: the same text, so a stale
    // place would read, match and overwrite it.
    t.files.set('/elsewhere/prefs.md', 'Tea.')
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'edit_memory',
            arguments: '{"scope":"project","path":"prefs.md","old_str":"Tea","new_str":"Coffee"}',
            callId: 'call_swap',
          },
        ],
      },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'switch to coffee' }])
    const request = await approvalRequest(events, 0)
    expect(request.toolName).toBe('edit_memory')
    // A swap while the card is open: the folder now leads outside.
    links[`${ROOT}/.agents/memory`] = '/elsewhere'
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(memoryRows(events).map((row) => row.status)).toEqual(['failed'])
    expect(memoryRows(events)[0]?.failureReason).toContain('link')
    expect(t.files.get(`${ROOT}/.agents/memory/prefs.md`)).toBe('Tea.')
    expect(t.files.get('/elsewhere/prefs.md')).toBe('Tea.')
  })
})

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
  it('does not expose or replay a previous Model API key account after replacement', async () => {
    const store = memorySessionStore()
    const rawA = 'LLM|1|fake-a'
    const rawB = 'LLM|1|fake-b'
    const keyA = createHash('sha256').update(rawA).digest('hex')
    const keyB = createHash('sha256').update(rawB).digest('hex')
    const first = setup({
      store,
      getAccountId: () => Promise.resolve(keyA),
      apiKey: () => Promise.resolve(rawA),
    })
    const { session, turnDone } = await startSession(first)
    first.api.script({ text: 'private reply from A' })
    await session.sendTurn([{ type: 'text', text: 'private prompt from A' }])
    await turnDone()
    await first.host.close()
    expect(store.saved.get(session.sessionId)?.accountId).toBe(keyA)

    let nextBId = 0
    const second = setup({
      store,
      getAccountId: () => Promise.resolve(keyB),
      apiKey: () => Promise.resolve(rawB),
      newId: () => `b${String(++nextBId)}`,
    })
    await second.host.load()
    const secondPage = await second.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(secondPage.sessions).toEqual([])
    await expect(second.host.readSession(session.sessionId)).rejects.toThrow()
    await expect(second.host.resumeSession(session.sessionId, 'muse-spark-1.3')).rejects.toThrow()
    await expect(second.host.forkSession(session.sessionId, 'muse-spark-1.3')).rejects.toThrow()
    const fresh = await startSession(second)
    second.api.script({ text: 'reply to B' })
    await fresh.session.sendTurn([{ type: 'text', text: 'fresh prompt from B' }])
    await fresh.turnDone()
    expect(JSON.stringify(second.api.responseBodies())).not.toContain('private prompt from A')
    expect(second.api.responseBodies()).toHaveLength(1)

    const restoredA = setup({
      store,
      getAccountId: () => Promise.resolve(keyA),
      apiKey: () => Promise.resolve(rawA),
    })
    await restoredA.host.load()
    const originalPage = await restoredA.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(originalPage.sessions).toContainEqual(
      expect.objectContaining({ sessionId: session.sessionId }),
    )
    const oldSession = await restoredA.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(JSON.stringify(oldSession.history.items)).toContain('private prompt from A')
    const exposed = JSON.stringify({
      history: [secondPage.sessions, originalPage.sessions],
      http: [first.api.responseBodies(), second.api.responseBodies()],
      logs: [
        ...first.log.trace.mock.calls,
        ...first.log.debug.mock.calls,
        ...first.log.info.mock.calls,
        ...second.log.trace.mock.calls,
        ...second.log.debug.mock.calls,
        ...second.log.info.mock.calls,
      ],
    })
    for (const secret of [rawA, rawB, keyA, keyB]) {
      expect(exposed).not.toContain(secret)
    }
    expect(JSON.stringify(store.saved.get(session.sessionId))).not.toContain(rawA)
  })

  it('keeps pre-ownership sessions on disk but refuses them to every account', async () => {
    const store = memorySessionStore()
    const first = setup({ store })
    const { session, turnDone } = await startSession(first)
    await answerFirst(first, session, turnDone)
    await first.host.close()
    const legacy = store.saved.get(session.sessionId)
    if (legacy === undefined) {
      throw new Error('expected stored session')
    }
    const unowned = structuredClone(legacy)
    Reflect.deleteProperty(unowned, 'accountId')
    store.saved.set(session.sessionId, unowned)
    const reopened = setup({ store })
    await reopened.host.load()
    const legacyPage = await reopened.host.listSessions({ workspaceRoot: ROOT, limit: 10 })
    expect(legacyPage.sessions).toEqual([])
    await expect(reopened.host.resumeSession(session.sessionId, 'muse-spark-1.3')).rejects.toThrow()
    expect(store.saved.has(session.sessionId)).toBe(true)
  })

  it('refuses a stored read when the active key changes while storage is pending', async () => {
    const store = memorySessionStore()
    const keyA = 'a'.repeat(64)
    const first = setup({ store, getAccountId: () => Promise.resolve(keyA) })
    const { session, turnDone } = await startSession(first)
    await answerFirst(first, session, turnDone)
    await first.host.close()
    let active = keyA
    const second = setup({ store, getAccountId: () => Promise.resolve(active) })
    await second.host.load()
    const originalLoad = store.load.bind(store)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    store.load = async (sessionId) => {
      started.resolve(undefined)
      await release.promise
      return await originalLoad(sessionId)
    }
    const reading = second.host.readSession(session.sessionId)
    await started.promise
    active = 'b'.repeat(64)
    release.resolve(undefined)
    await expect(reading).rejects.toThrow(UI_TEXT.notSignedInReason)
  })

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

async function waitForChildReady(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  responseCount?: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
      'resultReady',
    )
    if (responseCount !== undefined) {
      expect(t.api.responseBodies()).toHaveLength(responseCount)
    }
    expect(session.status).toBe('idle')
  })
}

/** A child can finish while its parent request remains held. */
async function waitForChildResult(session: ModelApiSession): Promise<void> {
  await vi.waitFor(() => {
    expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
      controlStatus: 'resultReady',
    })
  })
}

/** Every stored replay — the parent's and each nested child's — answers every call. */
function expectStoredReplaysSettled(saved: StoredSession | undefined): void {
  expect(saved?.children).toHaveLength(1)
  const replays = [
    saved?.replay ?? [],
    ...(saved?.children ?? []).map((child) => child.session.replay),
  ]
  for (const replay of replays) {
    const answered = new Set(
      replay.flatMap((entry) =>
        entry.item.type === 'function_call_output' ? [entry.item.call_id] : [],
      ),
    )
    expect(
      replay.filter(
        (entry) => entry.item.type === 'function_call' && !answered.has(entry.item.call_id),
      ),
    ).toEqual([])
  }
}

async function delegateAndWaitForChild(
  session: ModelApiSession,
  expected: { readonly controlStatus: string; readonly status?: string; readonly result?: object },
  isParentIdle = false,
): Promise<void> {
  await session.sendTurn([{ type: 'text', text: 'delegate' }])
  await vi.waitFor(() => {
    expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject(expected)
    if (isParentIdle) {
      expect(session.status).toBe('idle')
    }
  })
}

async function waitForIdleResponses(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  responseCount: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(t.api.responseBodies()).toHaveLength(responseCount)
    expect(session.status).toBe('idle')
  })
}

function scriptWorkerSpawn(t: ReturnType<typeof setup>, objective: string): void {
  t.api.script(
    {
      calls: [
        {
          name: 'subagent_spawn',
          arguments: JSON.stringify({ role: 'worker', objective }),
          callId: 'spawn',
        },
      ],
    },
    { text: 'First task done.' },
    { text: 'Parent continues.' },
  )
}

async function queueChildren(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  count = 9,
  isCancelLast = false,
) {
  const hold = Promise.withResolvers<undefined>()
  const calls = Array.from({ length: count }, (_, index) => ({
    name: 'subagent_spawn',
    arguments: JSON.stringify({
      role: `worker-${String(index)}`,
      objective: `Task ${String(index)}`,
    }),
    callId: `spawn-${String(index)}`,
  }))
  t.api.script(
    {
      calls: isCancelLast
        ? [
            ...calls,
            {
              name: 'subagent_send_message',
              arguments: JSON.stringify({
                subagent_id: `subagent-${String(count)}`,
                message: 'Cancelled queued note',
              }),
              callId: 'note-last',
            },
            {
              name: 'subagent_cancel',
              arguments: JSON.stringify({ subagent_id: `subagent-${String(count)}` }),
              callId: 'cancel-last',
            },
          ]
        : calls,
    },
    ...Array.from({ length: 10 }, () => ({ text: 'Done.', hold: hold.promise })),
  )
  await session.sendTurn([{ type: 'text', text: 'delegate tasks' }])
  await vi.waitFor(() => {
    expect(
      session
        .history()
        .items.filter((item) => item.kind === 'toolCall' && item.tool === 'subagent_spawn'),
    ).toHaveLength(count)
  })
  return hold
}

function setupSubagents(options: Parameters<typeof setup>[0] = {}) {
  return setup({ ...options, paid: [...(options.paid ?? []), 'subagents'] })
}

/**
 * A Bypass session whose spawns the paid-use popup allows (M58): the
 * harness's popup allows every use unless a test says otherwise.
 */
async function startApprovedSubagentSession(t: ReturnType<typeof setup>) {
  return await startSession(t, 'allowAll')
}

/** The turn of a spawn the popup refused ends with no child and nothing billed. */
async function expectRefusedSpawn(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  turnDone: () => Promise<void>,
): Promise<void> {
  await turnDone()
  expect(session.history().items.some((item) => item.kind === 'subagent')).toBe(false)
  expect(t.paidUses).toEqual([])
}

/** One `subagent_spawn` call for an explorer to map files, then the parent's reply. */
function scriptExplorerSpawn(t: ReturnType<typeof setup>, callId: string): void {
  t.api.script(
    {
      calls: [
        {
          name: 'subagent_spawn',
          arguments: '{"role":"explorer","objective":"Map files"}',
          callId,
        },
      ],
    },
    { text: 'Parent continues.' },
  )
}

/** The popup request for an explorer's "Map files" task on the default model. */
const MAP_FILES_REQUEST: PaidUseRequest = {
  feature: 'subagents',
  task: { role: 'explorer', objective: 'Map files', modelId: 'muse-spark-1.3', attemptLimit: 4 },
}

/** A settled first child, so follow-up consent tests have no parent race. */
async function completePaidChild(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
  callId: string,
): Promise<number> {
  t.api.script(
    {
      calls: [
        {
          name: 'subagent_spawn',
          arguments: '{"role":"explorer","objective":"First task"}',
          callId,
        },
      ],
    },
    { text: 'First child task done.' },
    { text: 'Parent done.' },
  )
  await session.sendTurn([{ type: 'text', text: 'delegate' }])
  await waitForChildReady(t, session)
  return t.api.responseBodies().length
}

describe('ModelApiSession subagents (M48)', () => {
  it('refuses child creation while its paid gate is off', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Map files"}',
            callId: 'paid_off_spawn',
          },
        ],
      },
      { text: 'Parent continues.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await turnDone()
    expect(session.history().items.some((item) => item.kind === 'subagent')).toBe(false)
    expect(t.paidUses).toEqual([])
  })

  it('asks once for a bounded BYOK child task even in Bypass', async () => {
    const popup = paidPopup()
    const t = setup({ paid: ['subagents'], allowsPaidUse: popup.allowsPaidUse })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    const answer = popup.hold()
    scriptExplorerSpawn(t, 'paid_spawn')
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await paidPopupAsked(t, 1)
    expect(t.paidRequests).toEqual([{ request: MAP_FILES_REQUEST, requiresAsking: false }])
    expect(hasApprovalCard(events)).toBe(false)
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(session.history().items.some((item) => item.kind === 'subagent')).toBe(false)
    answer.resolve(false)
    await expectRefusedSpawn(t, session, turnDone)
    expect(outputFor(t.api.responseBodies()[1], 'paid_spawn')).toMatchObject({
      output: `Error: ${MODEL_TEXT.subagentConsentDeclined}`,
    })
  })

  it('asks a paid spawn only in the popup, leaving no card a forged decision could answer', async () => {
    const popup = paidPopup()
    const t = setupSubagents({ allowsPaidUse: popup.allowsPaidUse })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    const answer = popup.hold()
    scriptExplorerSpawn(t, 'forged_session_spawn')
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await paidPopupAsked(t, 1)
    expect(hasApprovalCard(events)).toBe(false)
    const spawnRow = events.find(
      (event) => event.type === 'itemStarted' && event.item.tool === 'subagent_spawn',
    )
    if (spawnRow?.type !== 'itemStarted') {
      throw new Error('expected the spawn row')
    }
    // A session-wide answer forged for the spawn's own row finds nothing pending.
    const forgedId = spawnRow.item.itemId
    await expect(
      session.decideApproval({
        approvalId: forgedId,
        choiceId: 'allow_session',
        requirementId: { approvalId: forgedId, sourceIndex: 0 },
      }),
    ).rejects.toThrow('is not pending')
    answer.resolve(false)
    await expectRefusedSpawn(t, session, turnDone)
  })

  it('expires a pending paid spawn popup when the parent switches to Plan', async () => {
    const popup = paidPopup()
    const t = setupSubagents({ allowsPaidUse: popup.allowsPaidUse })
    const { session, turnDone } = await startSession(t, 'allowAll')
    const answer = popup.hold()
    scriptExplorerSpawn(t, 'spawn_before_plan')
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await paidPopupAsked(t, 1)
    await session.setApprovalMode('denyUnmatched')
    answer.resolve(true)
    await turnDone()
    expect(session.history().items.some((item) => item.kind === 'subagent')).toBe(false)
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(outputFor(t.api.responseBodies()[1], 'spawn_before_plan')).toMatchObject({
      output: `Error: ${MODEL_TEXT.subagentPlanMode}`,
    })
    expect(t.paidUses).toEqual([])
  })

  it('refuses a child on a model without a verified tariff', async () => {
    const t = setupSubagents()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    await session.setModel('muse-spark-future')
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Map files"}',
            callId: 'unpriced_spawn',
          },
        ],
      },
      { text: 'Parent continues.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(session.history().items.some((item) => item.kind === 'subagent')).toBe(false)
    expect(t.paidUses).toEqual([])
  })

  it.each(['gate', 'key', 'missingKey', 'model'] as const)(
    'rechecks %s at the child HTTP boundary',
    async (variant) => {
      const paid: PaidFeature[] = ['subagents']
      let key: string | undefined = 'LLM|1|secret'
      const t = setup({ paid, apiKey: () => Promise.resolve(key) })
      const { session } = await startApprovedSubagentSession(t)
      session.onEvent((event) => {
        if (event.type !== 'turnStarted' || !event.turnId.includes(':subagent-')) {
          return
        }
        switch (variant) {
          case 'gate': {
            paid.length = 0
            break
          }
          case 'key': {
            key = 'LLM|1|changed'
            break
          }
          case 'missingKey': {
            key = undefined
            break
          }
          case 'model': {
            void session.setModel('muse-spark-1.2')
            break
          }
        }
      })
      t.api.script(
        {
          calls: [
            {
              name: 'subagent_spawn',
              arguments: '{"role":"explorer","objective":"Map files"}',
              callId: `spawn_${variant}`,
            },
          ],
        },
        { text: 'Parent continues.' },
      )
      await session.sendTurn([{ type: 'text', text: 'delegate' }])
      const expectedKind = {
        gate: 'paidOff',
        key: 'keyChanged',
        missingKey: 'keyChanged',
        model: 'modelChanged',
      }[variant]
      await vi.waitFor(() => {
        expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
          controlStatus: 'resultReady',
          result: { errorKind: `subagent_${expectedKind}` },
        })
        expect(session.status).toBe('idle')
      })
      expect(t.api.responseBodies()).toHaveLength(variant === 'missingKey' ? 1 : 2)
      expect(t.paidUses).toEqual([])
      expect(t.subagentUsage).toEqual([])
    },
  )

  it.each(['stop', 'dispose'] as const)(
    'does not revive a closed child after %s while reopen consent waits',
    async (action) => {
      const popup = paidPopup()
      const t = setupSubagents({ allowsPaidUse: popup.allowsPaidUse })
      const { session } = await startApprovedSubagentSession(t)
      const before = await completePaidChild(t, session, `spawn_before_${action}`)
      await session.controlSubagent('subagent-1', 'readResult')
      const attempts = t.paidUses.filter((use) => use.feature === 'subagents').length
      // The spawn asked once; the reopen's popup stays open.
      const pending = popup.hold()
      const reopening = session.controlSubagent('subagent-1', 'reopen')
      await paidPopupAsked(t, 2)
      expect(t.paidRequests[1]).toEqual({
        request: {
          feature: 'subagents',
          task: expect.objectContaining({ role: 'explorer', attemptLimit: 4 }),
        },
        requiresAsking: false,
      })
      if (action === 'stop') {
        await session.controlSubagent('subagent-1', 'stop')
      } else {
        session.disposeAll()
      }
      pending.resolve(true)
      await expect(reopening).rejects.toThrow()
      expect(t.api.responseBodies()).toHaveLength(before)
      expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(attempts)
      if (action !== 'stop') {
        return
      }
      t.api.script({ text: 'Deliberate later reopen.' })
      await session.controlSubagent('subagent-1', 'reopen')
      await vi.waitFor(() => {
        expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(attempts + 1)
      })
    },
  )

  it('does not spend a child attempt when Stop wins during its key read', async () => {
    const keyRead = Promise.withResolvers<string>()
    let isKeyHeld = false
    const pendingKeyReads = vi.fn()
    const t = setupSubagents({
      apiKey: () => {
        if (isKeyHeld) {
          pendingKeyReads()
          return keyRead.promise
        }
        return Promise.resolve('LLM|1|secret')
      },
    })
    const { session } = await startApprovedSubagentSession(t)
    const before = await completePaidChild(t, session, 'spawn_before_held_key')
    const paidBefore = t.paidUses.filter((use) => use.feature === 'subagents').length
    session.onEvent((event) => {
      if (event.type === 'turnStarted' && event.turnId.includes(':subagent-')) {
        isKeyHeld = true
      }
    })
    t.api.script({ text: 'Must not run after Stop.' })
    await session.messageSubagent('subagent-1', 'Second task', true)
    await vi.waitFor(() => {
      expect(pendingKeyReads).toHaveBeenCalled()
    })
    await session.controlSubagent('subagent-1', 'stop')
    keyRead.resolve('LLM|1|secret')
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
        controlStatus: 'closed',
      })
    })
    expect(t.api.responseBodies()).toHaveLength(before)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(paidBefore)
  })

  it('holds the parent save while a child tool call waits for approval', async () => {
    const store = memorySessionStore()
    const t = setupSubagents({ store })
    const { session, events } = await startSession(t, 'promptUnmatched')
    // The popup allows the spawn; the child's own tool approval waits on its card.
    await completePaidChild(t, session, 'spawn_persist')
    expect(hasApprovalCard(events)).toBe(false)
    // A follow-up starts a second child turn while the parent stays idle, so
    // only the child consumes the scripted calls below.
    t.api.script(
      {
        calls: [
          {
            name: 'write_file',
            arguments: '{"path":"a.txt","content":"new"}',
            callId: 'child_write',
          },
        ],
      },
      { text: 'Mapped.' },
      { text: 'Noted.' },
    )
    await session.messageSubagent('subagent-1', 'Second task', true)
    await vi.waitFor(() => {
      expect(
        events.filter(
          (event) => event.type === 'approvalRequested' && event.toolName === 'write_file',
        ),
      ).toHaveLength(1)
    })
    const writeApproval = events.find(
      (event): event is Extract<AgentEvent, { type: 'approvalRequested' }> =>
        event.type === 'approvalRequested' && event.toolName === 'write_file',
    )
    if (writeApproval === undefined) {
      throw new Error('expected the child write approval')
    }
    // The parent is idle while the child still waits: a touch must not save
    // the nested replay with its unanswered call.
    expect(session.status).toBe('idle')
    await session.setModel('muse-spark-1.3')
    await t.host.flush()
    expectStoredReplaysSettled(store.saved.get(session.sessionId))
    // Once the child's call is answered the saves resume with settled replays.
    await session.decideApproval({
      approvalId: writeApproval.approvalId,
      choiceId: 'allow_once',
      requirementId: writeApproval.requirementId,
    })
    await waitForChildResult(session)
    await t.host.flush()
    expectStoredReplaysSettled(store.saved.get(session.sessionId))
  })

  it.each(['resume', 'followup'] as const)(
    'shows a retained queued note in restored child %s consent before its request',
    async (action) => {
      const store = memorySessionStore()
      const first = setupSubagents({ store })
      const { session } = await startApprovedSubagentSession(first)
      await completePaidChild(first, session, `spawn_before_restore_${action}`)
      await first.host.flush()
      session.dispose()
      const stored = store.saved.get(session.sessionId)
      if (stored?.children === undefined) {
        throw new Error('child snapshot missing')
      }
      store.saved.set(session.sessionId, {
        ...stored,
        children: stored.children.map((child) => ({
          ...child,
          state: 'queued',
          pendingMessages: ['Retained note B'],
        })),
      })
      const second = setupSubagents({ store })
      await second.host.load()
      const restored = await second.host.resumeSession(session.sessionId, 'muse-spark-1.3')
      second.api.script({ text: 'Child resumed.' })
      if (action === 'resume') {
        await restored.session.controlSubagent('subagent-1', 'resume')
      } else {
        await restored.session.messageSubagent('subagent-1', 'Follow-up C', true)
      }
      const expected =
        action === 'resume'
          ? `Retained note B\n\n${MODEL_TEXT.subagentResume}`
          : 'Retained note B\n\nFollow-up C'
      expect(second.paidRequests).toEqual([
        {
          request: {
            feature: 'subagents',
            task: {
              role: 'explorer',
              objective: expected,
              modelId: 'muse-spark-1.3',
              attemptLimit: 4,
            },
          },
          requiresAsking: false,
        },
      ])
      await vi.waitFor(() => {
        expect(second.api.responseBodies()).toHaveLength(1)
      })
      expect(JSON.stringify(second.api.responseBodies()[0])).toContain('Retained note B')
    },
  )

  it('refuses a child request after its originating goal is paused', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    session.onEvent((event) => {
      if (event.type === 'turnStarted' && event.turnId.includes(':subagent-')) {
        void session.controlGoal({ verb: 'pause' })
      }
    })
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":100}',
            callId: 'child_goal',
          },
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Map files"}',
            callId: 'goal_child',
          },
        ],
      },
      { text: 'Parent continues.' },
    )
    await delegateAndWaitForChild(session, {
      controlStatus: 'resultReady',
      result: { errorKind: 'subagent_goalEnded' },
    })
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.paidUses).toEqual([])
  })

  it('does not send a child request carrying web search after that gate turns off', async () => {
    const paid: PaidFeature[] = ['subagents', 'webSearch']
    const t = setup({ paid })
    const { session } = await startApprovedSubagentSession(t)
    const streamResponse = t.client.streamResponse.bind(t.client)
    let didSeeSearchTool = false
    vi.spyOn(t.client, 'streamResponse').mockImplementation(
      (body, signal, retry, budget, guard) => {
        if (isChildRequest(body)) {
          didSeeSearchTool = body.tools.some((tool) => tool.type === 'web_search')
          paid.splice(paid.indexOf('webSearch'), 1)
        }
        return streamResponse(body, signal, retry, budget, guard)
      },
    )
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Research files"}',
            callId: 'search_child',
          },
        ],
      },
      { text: 'Parent continues.' },
    )
    await delegateAndWaitForChild(session, {
      controlStatus: 'resultReady',
      result: { errorKind: 'subagent_webSearchOff' },
    })
    expect(didSeeSearchTool).toBe(true)
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toEqual([])
  })

  it('gives a child of a prompt whose web search was denied no search, never asking itself (M58)', async () => {
    const t = setupSubagents({
      paid: ['webSearch'],
      allowsPaidUse: (request) => Promise.resolve(request.feature !== 'webSearch'),
    })
    const { session } = await startApprovedSubagentSession(t)
    await completePaidChild(t, session, 'spawn_after_denied_search')
    const bodies = t.api.responseBodies()
    const childBodies = bodies.filter((body) => isChildRequest(body))
    expect(childBodies).toHaveLength(1)
    for (const body of bodies) {
      expect(webSearchTools(body)).toEqual([])
      expect(body['include']).toEqual(['reasoning.encrypted_content'])
    }
    // The parent's web search popup, then the spawn's; the child asked nothing.
    expect(t.paidRequests).toEqual([
      { request: { feature: 'webSearch' }, requiresAsking: false },
      {
        request: {
          feature: 'subagents',
          task: {
            role: 'explorer',
            objective: 'First task',
            modelId: 'muse-spark-1.3',
            attemptLimit: 4,
          },
        },
        requiresAsking: false,
      },
    ])
  })

  it.each([
    ['allowed always', ['webSearch']],
    ['asked each prompt', []],
  ] as const)(
    'gives a UI follow-up web search only when it is %s in this workspace (M58)',
    async (_label, remembered) => {
      const t = setupSubagents({ paid: ['webSearch'], remembered: [...remembered] })
      const { session } = await startApprovedSubagentSession(t)
      const before = await completePaidChild(t, session, 'spawn_before_ui_search')
      // The prompt allowed search, so its own child searched.
      const firstChild = t.api.responseBodies().find((body) => isChildRequest(body))
      expect(webSearchTools(firstChild)).toEqual([{ type: 'web_search' }])
      t.api.script({ text: 'Second task done.' })
      await session.messageSubagent('subagent-1', 'Second task', true)
      await vi.waitFor(() => {
        expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
          controlStatus: 'resultReady',
          result: { summary: 'Second task done.' },
        })
      })
      expect(t.api.responseBodies()).toHaveLength(before + 1)
      // No prompt is running: the follow-up searches only if search is allowed always.
      expect(webSearchTools(t.api.responseBodies()[before])).toEqual(
        remembered.length > 0 ? [{ type: 'web_search' }] : [],
      )
      expect(t.paidRequests.map(({ request }) => request.feature)).toEqual([
        'webSearch',
        'subagents',
        'subagents',
      ])
    },
  )

  it('leaves UI follow-up and reopen stopped when their paid-use popup is declined', async () => {
    let isAllowed = true
    const t = setupSubagents({ allowsPaidUse: () => Promise.resolve(isAllowed) })
    const { session } = await startApprovedSubagentSession(t)
    const before = await completePaidChild(t, session, 'spawn_for_ui_decline')
    isAllowed = false
    await expect(session.messageSubagent('subagent-1', 'Second task', true)).rejects.toThrow(
      UI_TEXT.subagentConsentDeclined,
    )
    await session.controlSubagent('subagent-1', 'readResult')
    await expect(session.controlSubagent('subagent-1', 'reopen')).rejects.toThrow(
      UI_TEXT.subagentConsentDeclined,
    )
    // The spawn's popup, then one for each of the two owner tasks.
    expect(t.paidRequests).toHaveLength(3)
    expect(t.paidRequests[1]).toEqual({
      request: {
        feature: 'subagents',
        task: {
          role: 'explorer',
          objective: 'Second task',
          modelId: 'muse-spark-1.3',
          attemptLimit: 4,
        },
      },
      requiresAsking: false,
    })
    expect(t.paidRequests[2]).toMatchObject({
      request: { feature: 'subagents' },
      requiresAsking: false,
    })
    expect(t.api.responseBodies()).toHaveLength(before)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(1)
  })

  it.each(['gate', 'key', 'missingKey', 'model'] as const)(
    'expires a UI child-task consent when %s changes while its popup is open',
    async (variant) => {
      const paid: PaidFeature[] = ['subagents']
      let key: string | undefined = 'LLM|1|secret'
      const popup = paidPopup()
      const t = setup({
        paid,
        apiKey: () => Promise.resolve(key),
        allowsPaidUse: popup.allowsPaidUse,
      })
      const { session } = await startApprovedSubagentSession(t)
      const before = await completePaidChild(t, session, `spawn_popup_${variant}`)
      const pending = popup.hold()
      const continuation = session.messageSubagent('subagent-1', 'Second task', true)
      await paidPopupAsked(t, 2)
      switch (variant) {
        case 'gate': {
          paid.length = 0
          break
        }
        case 'key': {
          key = 'LLM|1|changed'
          break
        }
        case 'missingKey': {
          key = undefined
          break
        }
        case 'model': {
          await session.setModel('muse-spark-1.2')
          break
        }
      }
      pending.resolve(true)
      const reason = {
        gate: UI_TEXT.subagentPaidOff,
        key: UI_TEXT.subagentKeyChanged,
        missingKey: UI_TEXT.subagentKeyChanged,
        model: UI_TEXT.subagentModelChanged,
      }[variant]
      await expect(continuation).rejects.toThrow(reason)
      expect(t.api.responseBodies()).toHaveLength(before)
      expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(1)
    },
  )

  it('refuses owner controls and notes for an unknown child', async () => {
    const t = setup()
    const { session } = await startSession(t)
    const asSession: AgentSession = session
    await expect(asSession.controlSubagent('sub-1', 'stop')).rejects.toThrow('unknown subagent')
    await expect(asSession.messageSubagent('sub-1', 'hi', false)).rejects.toThrow('unavailable')
  })

  it('runs a child independently, shows its result, and lets the owner read and reopen it', async () => {
    const t = setupSubagents()
    const { session, events } = await startApprovedSubagentSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Map files","command_id":"one"}',
            callId: 'spawn',
          },
        ],
      },
      { text: 'Mapped files', usage: { input: 30, output: 10 } },
      { text: 'Mapped files', usage: { input: 30, output: 10 } },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) =>
            event.type === 'itemUpdated' &&
            event.item.kind === 'subagent' &&
            event.item.controlStatus === 'resultReady',
        ),
      ).toBe(true)
    })
    const row = session.history().items.find((item) => item.kind === 'subagent')
    expect(row).toMatchObject({
      role: 'explorer',
      objective: 'Map files',
      result: { summary: 'Mapped files' },
    })
    expect(row?.usage?.inputTokens).toBe(30)
    expect(session.snapshot().usage.inputTokens).toBeGreaterThanOrEqual(30)
    expect(row?.childSessionId).toBeDefined()
    const childHistory = await t.host.readSession(row?.childSessionId ?? '')
    expect(
      childHistory.items.some(
        (item) => item.kind === 'agentMessage' && item.text === 'Mapped files',
      ),
    ).toBe(true)
    await session.controlSubagent('subagent-1', 'readResult')
    expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
      'closed',
    )
    await session.controlSubagent('subagent-1', 'reopen')
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
        'resultReady',
      )
    })
    await session.sendTurn([{ type: 'text', text: 'What did the child find?' }])
    await vi.waitFor(() => {
      expect(
        t.api
          .responseBodies()
          .some((body) => JSON.stringify(body['input']).includes(MODEL_TEXT.subagentResult)),
      ).toBe(true)
    })
  })

  it('refuses spawn in Plan before any child starts', async () => {
    const t = setupSubagents()
    const { session, events, turnDone } = await startSession(t, 'denyUnmatched')
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Map files"}',
            callId: 'spawn',
          },
        ],
      },
      { text: 'cannot delegate' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await turnDone()
    expect(
      events.some((event) => event.type === 'itemStarted' && event.item.kind === 'subagent'),
    ).toBe(false)
    expect(
      events.some(
        (event) =>
          event.type === 'itemCompleted' &&
          event.item.tool === 'subagent_spawn' &&
          event.item.status === 'rejected',
      ),
    ).toBe(true)
  })

  it('asks before spawning in Manual and keeps a child transcript after session disposal', async () => {
    const store = memorySessionStore()
    const popup = paidPopup()
    const t = setupSubagents({ store, allowsPaidUse: popup.allowsPaidUse })
    const { session, events } = await startSession(t)
    const answer = popup.hold()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"reviewer","objective":"Review files"}',
            callId: 'spawn',
          },
        ],
      },
      { text: 'Reviewed files' },
      { text: 'Reviewed files' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await paidPopupAsked(t, 1)
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'subagents',
          task: {
            role: 'reviewer',
            objective: 'Review files',
            modelId: 'muse-spark-1.3',
            attemptLimit: 4,
          },
        },
        requiresAsking: false,
      },
    ])
    expect(hasApprovalCard(events)).toBe(false)
    expect(session.history().items.some((item) => item.kind === 'subagent')).toBe(false)
    answer.resolve(true)
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
        'resultReady',
      )
    })
    const childId =
      session.history().items.find((item) => item.kind === 'subagent')?.childSessionId ?? ''
    expect(JSON.stringify(session.snapshot())).not.toContain('keyDigest')
    await t.host.flush()
    expect(parseStoredSession(store.saved.get(session.sessionId)).ok).toBe(true)
    session.dispose()
    const child = await t.host.readSession(childId)
    expect(
      child.items.some((item) => item.kind === 'agentMessage' && item.text === 'Reviewed files'),
    ).toBe(true)
    await expect(t.host.readSession(`${session.sessionId}:subagent-404`)).rejects.toThrow(
      'not held by this window',
    )
    const confirmRestored = vi.fn(() => Promise.resolve(false))
    const second = setupSubagents({ store, allowsPaidUse: confirmRestored })
    await second.host.load()
    const restored = await second.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(restored.history.items.find((item) => item.kind === 'subagent')).toMatchObject({
      childSessionId: childId,
      controlStatus: 'resultReady',
    })
    const restoredChild = await second.host.readSession(childId)
    expect(restoredChild.items).toEqual(child.items)
    await restored.session.controlSubagent('subagent-1', 'readResult')
    const restoredParent = await second.host.readSession(session.sessionId)
    expect(restoredParent.items.find((item) => item.kind === 'subagent')).toMatchObject({
      controlStatus: 'closed',
    })
    await expect(restored.session.controlSubagent('subagent-1', 'reopen')).rejects.toThrow(
      UI_TEXT.subagentConsentDeclined,
    )
    expect(confirmRestored).toHaveBeenCalledOnce()
    expect(second.paidRequests).toEqual([
      {
        request: { feature: 'subagents', task: expect.objectContaining({ role: 'reviewer' }) },
        requiresAsking: false,
      },
    ])
    expect(second.api.responseBodies()).toEqual([])
  })

  it('routes a child write approval through the parent session', async () => {
    const t = setupSubagents()
    const { session, events } = await startSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"writer","objective":"Write child-note.txt"}',
            callId: 'spawn',
          },
        ],
      },
      { text: 'Child ready.' },
      { text: 'Parent continues.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate the write' }])
    // The spawn asks in the popup (allowed), never on a card.
    await waitForChildReady(t, session)
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'subagents',
          task: expect.objectContaining({ role: 'writer', objective: 'Write child-note.txt' }),
        },
        requiresAsking: false,
      },
    ])
    expect(hasApprovalCard(events)).toBe(false)
    const childSessionId = session
      .history()
      .items.find((item) => item.kind === 'subagent')?.childSessionId
    if (childSessionId === undefined) {
      throw new Error('expected child session id')
    }
    t.api.script(
      {
        calls: [
          {
            name: 'write_file',
            arguments: '{"path":"child-note.txt","content":"from child"}',
            callId: 'child_write',
          },
        ],
      },
      { text: 'Child finished.' },
    )
    await session.messageSubagent('subagent-1', 'Write child-note.txt now', true)
    const write = await approvalRequest(events, 0)
    expect(write.subject).toMatchObject({ kind: 'fileWrite', path: 'child-note.txt' })
    expect(
      events.find((event) => event.type === 'itemStarted' && event.item.itemId === write.itemId),
    ).toMatchObject({ item: { turnId: expect.stringContaining(`${childSessionId}:`) } })
    const lateEvents: AgentEvent[] = []
    const detachLate = session.onEvent((event) => {
      lateEvents.push(event)
    })
    try {
      const pending = lateEvents.filter((event) => event.type === 'approvalRequested')
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({ approvalId: write.approvalId, isReplayed: true })
    } finally {
      await session.decideApproval({
        approvalId: write.approvalId,
        choiceId: 'allow_once',
        requirementId: write.requirementId,
      })
      detachLate()
    }
    await vi.waitFor(() => {
      expect(t.files.get(`${ROOT}/child-note.txt`)).toBe('from child')
    })
  })

  it('asks each paid use in its conversation, a child’s in its parent’s (M58, PLAN.md D62)', async () => {
    const t = setupSubagents({
      paid: ['webSearch', 'imageGeneration'],
      allowsPaidUse: (request) => Promise.resolve(request.feature !== 'imageGeneration'),
    })
    const other = await startSession(t)
    await answerFirst(t, other.session, other.turnDone)
    const { session } = await startSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"designer","objective":"Draw the logo"}',
            callId: 'spawn',
          },
        ],
      },
      { text: 'Child ready.' },
      { text: 'Parent continues.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate the logo' }])
    await waitForChildReady(t, session)
    t.api.script(
      {
        calls: [
          {
            name: 'generate_image',
            arguments: '{"path":"logo.png","prompt":"a logo"}',
            callId: 'child_image',
          },
        ],
      },
      { text: 'Child finished.' },
    )
    await session.messageSubagent('subagent-1', 'Draw it now', true)
    await paidPopupAsked(t, 5)
    // Web search in each conversation, the spawn, the owner's follow-up, then
    // the child's image: the host serves both conversations, and the child
    // asks in its parent's.
    expect(t.paidRequests.map(({ request }) => request.feature)).toEqual([
      'webSearch',
      'webSearch',
      'subagents',
      'subagents',
      'imageGeneration',
    ])
    expect(t.paidSessions).toEqual([
      other.session.sessionId,
      ...Array.from({ length: 4 }, () => session.sessionId),
    ])
    expect(other.session.sessionId).not.toBe(session.sessionId)
  })

  it('reuses the same child when a spawn command id is retried', async () => {
    const t = setupSubagents()
    const { session, events } = await startApprovedSubagentSession(t)
    const spawn = {
      name: 'subagent_spawn',
      arguments: '{"role":"explorer","objective":"Map files","command_id":"same-command"}',
    }
    t.api.script(
      { calls: [{ ...spawn, callId: 'first_spawn' }] },
      { text: 'Child mapped files.' },
      { text: 'Parent ready.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate once' }])
    await waitForChildReady(t, session)
    t.api.script({ calls: [{ ...spawn, callId: 'retried_spawn' }] }, { text: 'Same child.' })
    await session.sendTurn([{ type: 'text', text: 'retry the same command' }])
    await vi.waitFor(() => {
      expect(
        events.filter(
          (event) => event.type === 'itemCompleted' && event.item.tool === 'subagent_spawn',
        ),
      ).toHaveLength(2)
      expect(session.status).toBe('idle')
    })
    expect(session.history().items.filter((item) => item.kind === 'subagent')).toHaveLength(1)
    expect(session.history().items.find((item) => item.kind === 'subagent')?.subagentId).toBe(
      'subagent-1',
    )
    t.api.script(
      {
        calls: [
          {
            ...spawn,
            arguments:
              '{"role":"explorer","objective":"Different task","command_id":"same-command"}',
            callId: 'conflicting_spawn',
          },
        ],
      },
      { text: 'Refused.' },
    )
    await session.sendTurn([{ type: 'text', text: 'reuse the id for another task' }])
    await vi.waitFor(() => {
      expect(
        events.filter(
          (event) => event.type === 'itemCompleted' && event.item.tool === 'subagent_spawn',
        ),
      ).toHaveLength(3)
      expect(session.status).toBe('idle')
    })
    expect(
      events.findLast(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'subagent_spawn',
      ),
    ).toMatchObject({ item: { status: 'failed' } })
    expect(session.history().items.filter((item) => item.kind === 'subagent')).toHaveLength(1)
  })

  it('runs at most eight children and starts the ninth when a slot opens', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const hold = await queueChildren(t, session)
    const rows = session.history().items.filter((item) => item.kind === 'subagent')
    expect(rows.filter((item) => item.controlStatus === 'running')).toHaveLength(8)
    expect(rows.filter((item) => item.controlStatus === 'queued')).toHaveLength(1)
    expect(rows.at(-1)?.subagentId).toBe('subagent-9')
    hold.resolve(undefined)
    await vi.waitFor(() => {
      expect(
        session
          .history()
          .items.filter((item) => item.kind === 'subagent' && item.controlStatus === 'resultReady'),
      ).toHaveLength(9)
    })
  })

  it('refuses the 65th child without losing the first 64', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const hold = await queueChildren(t, session, 65)
    try {
      const rows = session.history().items.filter((item) => item.kind === 'subagent')
      expect(rows).toHaveLength(64)
      expect(rows.at(-1)?.subagentId).toBe('subagent-64')
      expect(
        session
          .history()
          .items.findLast((item) => item.kind === 'toolCall' && item.tool === 'subagent_spawn'),
      ).toMatchObject({ status: 'failed' })
    } finally {
      await t.host.close()
      hold.resolve(undefined)
    }
  })

  it('marks a queued child stopped without ever starting its turn', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const hold = await queueChildren(t, session)
    try {
      await session.controlSubagent('subagent-9', 'stop')
      const ninth = session
        .history()
        .items.find((item) => item.kind === 'subagent' && item.subagentId === 'subagent-9')
      expect(ninth).toMatchObject({ status: 'cancelled', controlStatus: 'closed' })
      const childHistory = await t.host.readSession(ninth?.childSessionId ?? '')
      expect(childHistory.items).toEqual([])
    } finally {
      hold.resolve(undefined)
    }
    await vi.waitFor(() => {
      expect(
        session
          .history()
          .items.filter((item) => item.kind === 'subagent' && item.controlStatus === 'resultReady'),
      ).toHaveLength(8)
    })
  })

  it('drops a stopped queued child’s note from persistence and a later reopen', async () => {
    const t = setupSubagents({ store: memorySessionStore() })
    const { session } = await startApprovedSubagentSession(t)
    const hold = await queueChildren(t, session)
    try {
      await session.messageSubagent('subagent-9', 'Cancelled queued note', true)
      await session.controlSubagent('subagent-9', 'stop')
      const saved = session.snapshot().children?.find((child) => child.id === 'subagent-9')
      expect(saved?.pendingMessages).toEqual([])
      await session.controlSubagent('subagent-9', 'reopen')
      hold.resolve(undefined)
      await vi.waitFor(() => {
        expect(
          session
            .history()
            .items.find((item) => item.kind === 'subagent' && item.subagentId === 'subagent-9'),
        ).toMatchObject({ controlStatus: 'resultReady' })
      })
      const history = await t.host.readSession(`${session.sessionId}:subagent-9`)
      expect(JSON.stringify(history.items)).not.toContain('Cancelled queued note')
    } finally {
      hold.resolve(undefined)
      await t.host.close()
    }
  })

  it('lets the model cancel a queued child without reporting completion', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const hold = await queueChildren(t, session, 9, true)
    try {
      await vi.waitFor(() => {
        expect(
          session
            .history()
            .items.find((item) => item.kind === 'subagent' && item.subagentId === 'subagent-9'),
        ).toMatchObject({ status: 'cancelled', controlStatus: 'closed' })
      })
      const saved = session.snapshot().children?.find((child) => child.id === 'subagent-9')
      expect(saved?.pendingMessages).toEqual([])
    } finally {
      hold.resolve(undefined)
    }
  })

  it('stops a running child before its held model response can complete', async () => {
    const t = setupSubagents()
    const { session, events } = await startApprovedSubagentSession(t)
    const hold = Promise.withResolvers<undefined>()
    scriptWorkerSpawn(t, 'Wait for work')
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await waitForChildReady(t, session, 3)
    const childSessionId =
      session.history().items.find((item) => item.kind === 'subagent')?.childSessionId ?? ''
    const priorChildTurns = events.filter(
      (event) => event.type === 'turnCompleted' && event.turnId.startsWith(`${childSessionId}:`),
    ).length
    t.api.script({ text: 'A late child reply.', hold: hold.promise })
    await session.messageSubagent('subagent-1', 'Wait again', true)
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
        'running',
      )
      expect(t.api.responseBodies()).toHaveLength(4)
    })
    await session.controlSubagent('subagent-1', 'stop')
    hold.resolve(undefined)
    await vi.waitFor(() => {
      expect(
        events.filter(
          (event) =>
            event.type === 'turnCompleted' && event.turnId.startsWith(`${childSessionId}:`),
        ).length,
      ).toBe(priorChildTurns + 1)
    })
    expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
      status: 'cancelled',
      controlStatus: 'closed',
    })
  })

  it('returns a completed child result to a waiting parent call', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"worker","objective":"Finish task"}',
            callId: 'spawn',
          },
          {
            name: 'subagent_wait',
            arguments: '{"subagent_id":"subagent-1","timeout_ms":1000}',
            callId: 'wait_child',
          },
        ],
      },
      { text: 'Child result.' },
      { text: 'Parent received it.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate and wait' }])
    await waitForIdleResponses(t, session, 3)
    expect(outputFor(t.api.responseBodies()[2], 'wait_child')).toMatchObject({
      output: expect.stringContaining('"summary":"Child result."'),
    })
    expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
      'resultReady',
    )
  })

  it('times out a wait without stopping the child', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const hold = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"worker","objective":"Finish later"}',
            callId: 'spawn',
          },
          {
            name: 'subagent_wait',
            arguments: '{"subagent_id":"subagent-1","timeout_ms":1}',
            callId: 'wait_child',
          },
        ],
      },
      { text: 'Child finished.', hold: hold.promise },
      { text: 'Parent saw the timeout.' },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate and wait briefly' }])
      await waitForIdleResponses(t, session, 3)
      expect(outputFor(t.api.responseBodies()[2], 'wait_child')).toMatchObject({
        output: expect.stringContaining('"timed_out":true'),
      })
      expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
        'running',
      )
    } finally {
      hold.resolve(undefined)
    }
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')?.controlStatus).toBe(
        'resultReady',
      )
    })
  })

  it('delivers a follow-up task to the same child conversation', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    scriptWorkerSpawn(t, 'First task')
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await waitForChildReady(t, session)
    const childSessionId =
      session.history().items.find((item) => item.kind === 'subagent')?.childSessionId ?? ''
    t.api.script({ text: 'Second task done.' })
    await session.messageSubagent('subagent-1', 'Second task', true)
    await vi.waitFor(() => {
      expect(
        session.history().items.find((item) => item.kind === 'subagent')?.result?.summary,
      ).toBe('Second task done.')
    })
    const child = await t.host.readSession(childSessionId)
    expect(
      child.items.filter((item) => item.kind === 'userMessage').map((item) => item.text),
    ).toEqual(['First task', 'Second task'])
  })

  it('counts two children and a follow-up in the parent usage exactly once', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"first","objective":"First task"}',
            callId: 'first',
          },
          {
            name: 'subagent_spawn',
            arguments: '{"role":"second","objective":"Second task"}',
            callId: 'second',
          },
        ],
        usage: { input: 2, output: 1 },
      },
      { text: 'First child done.', usage: { input: 10, output: 2 } },
      { text: 'Second child done.', usage: { input: 20, output: 3 } },
      { text: 'Parent done.', usage: { input: 5, output: 1 } },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate twice' }])
    await vi.waitFor(() => {
      expect(
        session
          .history()
          .items.filter((item) => item.kind === 'subagent' && item.controlStatus === 'resultReady'),
      ).toHaveLength(2)
      expect(session.status).toBe('idle')
    })
    expect(t.api.responseBodies()).toHaveLength(4)
    expect(session.snapshot().usage).toMatchObject({ inputTokens: 37, outputTokens: 7 })
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(2)
    expect(t.subagentUsage).toHaveLength(2)
    const rows = session.history().items.filter((item) => item.kind === 'subagent')
    expect(t.subagentUsage.reduce((sum, use) => sum + use.inputTokens, 0)).toBe(
      rows.reduce((sum, item) => sum + (item.usage?.inputTokens ?? 0), 0),
    )
    expect(t.subagentUsage.reduce((sum, use) => sum + use.outputTokens, 0)).toBe(
      rows.reduce((sum, item) => sum + (item.usage?.outputTokens ?? 0), 0),
    )
    t.api.script({ text: 'Follow-up done.', usage: { input: 7, output: 3 } })
    await session.messageSubagent('subagent-1', 'Follow-up', true)
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(5)
      expect(
        session.history().items.find((item) => item.kind === 'subagent')?.result?.summary,
      ).toBe('Follow-up done.')
    })
    expect(session.snapshot().usage).toMatchObject({ inputTokens: 44, outputTokens: 10 })
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(3)
    expect(t.subagentUsage.at(-1)).toMatchObject({ inputTokens: 7, outputTokens: 3 })
  })

  it('stops a newly approved follow-up before its fifth HTTP attempt', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const before = await completePaidChild(t, session, 'spawn_limited')
    t.api.script(
      ...Array.from({ length: 4 }, (_unused, index) => ({
        calls: [
          {
            name: 'read_file',
            arguments: '{"path":"missing.txt"}',
            callId: `child_read_${String(index)}`,
          },
        ],
      })),
      { text: 'Must not run.' },
    )
    await session.messageSubagent('subagent-1', 'Check missing.txt again', true)
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
        controlStatus: 'resultReady',
        result: {
          summary: expect.stringContaining('4 requests'),
          errorKind: 'subagent_requestLimit',
        },
      })
    })
    expect(t.api.responseBodies()).toHaveLength(before + 4)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(5)
  })

  it('asks anew before a model-requested child follow-up in Bypass', async () => {
    const t = setupSubagents()
    const { session, events } = await startApprovedSubagentSession(t)
    await completePaidChild(t, session, 'spawn_before_model_followup')
    const priorAsks = t.paidRequests.length
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_send_message',
            arguments: '{"subagent_id":"subagent-1","message":"Next task"}',
            callId: 'model_followup',
          },
        ],
      },
      { text: 'Second task done.' },
      { text: 'Parent done.' },
    )
    await session.sendTurn([{ type: 'text', text: 'give the child another task' }])
    await vi.waitFor(() => {
      expect(t.paidRequests).toHaveLength(priorAsks + 1)
      expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(2)
      expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
        controlStatus: 'resultReady',
      })
    })
    expect(t.paidRequests.at(-1)).toEqual({
      request: {
        feature: 'subagents',
        task: {
          role: 'explorer',
          objective: 'Next task',
          modelId: 'muse-spark-1.3',
          attemptLimit: 4,
        },
      },
      requiresAsking: false,
    })
    expect(hasApprovalCard(events)).toBe(false)
  })

  it('lets a running-child note use its existing grant without renewing consent', async () => {
    const t = setupSubagents()
    const { session, events } = await startApprovedSubagentSession(t)
    const holdChild = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"First task"}',
            callId: 'spawn_for_note',
          },
        ],
      },
      { text: 'Parent done.' },
      { text: 'Child done.', hold: holdChild.promise },
    )
    try {
      await delegateAndWaitForChild(session, { controlStatus: 'running' }, true)
      const priorAsks = t.paidRequests.length
      const priorAttempts = t.paidUses.filter((use) => use.feature === 'subagents').length
      t.api.script(
        {
          calls: [
            {
              name: 'subagent_send_message',
              arguments: '{"subagent_id":"subagent-1","message":"Check the next file"}',
              callId: 'running_note',
            },
          ],
        },
        { text: 'Parent noted.' },
      )
      await session.sendTurn([{ type: 'text', text: 'send a note' }])
      await vi.waitFor(() => {
        expect(session.status).toBe('idle')
      })
      expect(priorAsks).toBe(1)
      expect(t.paidRequests).toHaveLength(priorAsks)
      expect(hasApprovalCard(events)).toBe(false)
      expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(priorAttempts)
    } finally {
      holdChild.resolve(undefined)
    }
  })

  it('spends the same four-attempt child grant on HTTP retries', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const before = await completePaidChild(t, session, 'spawn_retry_limited')
    t.api.script(...Array.from({ length: 4 }, () => ({ httpError: { status: 429 } })), {
      text: 'Must not run.',
    })
    await session.messageSubagent('subagent-1', 'Try again', true)
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
        controlStatus: 'resultReady',
        result: { errorKind: 'subagent_requestLimit' },
      })
    })
    expect(t.api.responseBodies()).toHaveLength(before + 4)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(5)
    expect(t.subagentUsage).toHaveLength(1)
  })

  it('charges reported usage on a failed child response once to its parent and goal', async () => {
    const t = setupSubagents()
    const { session } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":100}',
            callId: 'goal_before_failed_child',
          },
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review tests"}',
            callId: 'spawn_failed_child',
          },
        ],
        usage: { input: 1, output: 1 },
      },
      { text: 'Parent done.', usage: { input: 2, output: 1 }, hold: holdParent.promise },
      {
        failed: { code: 'model_failure', message: 'The child failed.' },
        usage: { input: 30, output: 7, cached: 4 },
      },
    )
    try {
      await delegateAndWaitForChild(session, { controlStatus: 'resultReady', status: 'failed' })
    } finally {
      holdParent.resolve(undefined)
    }
    await vi.waitFor(() => {
      expect(session.status).toBe('idle')
    })
    expect(t.subagentUsage).toEqual([
      { modelId: 'muse-spark-1.3', inputTokens: 30, outputTokens: 7, cachedTokens: 4 },
    ])
    expect(session.snapshot().goal).toMatchObject({ tokens_used: 40 })
    expect(session.snapshot().usage).toMatchObject({ inputTokens: 33, outputTokens: 9 })
  })

  it('charges child tokens to the goal active when that child turn began', async () => {
    const t = setupSubagents()
    const { session, turnDone } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":100}',
            callId: 'goal_for_child',
          },
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review tests"}',
            callId: 'spawn_for_goal',
          },
        ],
        usage: { input: 1, output: 1 },
      },
      { text: 'Parent finished', hold: holdParent.promise },
      { text: 'Reviewed tests', usage: { input: 90, output: 20 } },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate the review' }])
      await waitForChildResult(session)
      expect(session.snapshot().goal).toMatchObject({ status: 'budget_limited' })
      expect(session.snapshot().goal?.tokens_used).toBeGreaterThanOrEqual(100)
      const attempts = t.paidUses.filter((use) => use.feature === 'subagents').length
      await expect(session.messageSubagent('subagent-1', 'Keep going', true)).rejects.toThrow(
        UI_TEXT.subagentGoalEnded,
      )
      expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(attempts)
    } finally {
      holdParent.resolve(undefined)
      await turnDone()
    }
  })

  it('does not charge a replacement goal for an earlier child turn', async () => {
    const t = setupSubagents()
    const { session, turnDone } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    const holdChild = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Original","token_budget":100}',
            callId: 'original_goal',
          },
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review tests"}',
            callId: 'spawn_for_original_goal',
          },
        ],
      },
      { text: 'Parent finished', hold: holdParent.promise },
      { text: 'Reviewed tests', usage: { input: 90, output: 20 }, hold: holdChild.promise },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate the review' }])
      await vi.waitFor(() => {
        expect(t.api.responseBodies()).toHaveLength(3)
        expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
          controlStatus: 'running',
        })
      })
      await session.controlGoal({ verb: 'set', objective: 'Replacement' })
      const replacementId = session.snapshot().goal?.goal_id
      holdChild.resolve(undefined)
      await waitForChildResult(session)
      expect(session.snapshot().goal).toMatchObject({
        goal_id: replacementId,
        status: 'active',
        tokens_used: 0,
      })
      expect(session.snapshot().usage.inputTokens).toBeGreaterThanOrEqual(90)
    } finally {
      holdChild.resolve(undefined)
      holdParent.resolve(undefined)
      await turnDone()
    }
  })
})

/** The `function_call_output` the replay holds for one call id, from a request body. */
function outputFor(body: Record<string, unknown> | undefined, callId: string): unknown {
  const raw = body?.['input']
  if (!Array.isArray(raw)) {
    return undefined
  }
  const input: readonly unknown[] = raw
  return input.find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      'type' in item &&
      item.type === 'function_call_output' &&
      'call_id' in item &&
      item.call_id === callId,
  )
}

it('refuses malformed fake response input before replay inspection', () => {
  expect(
    outputFor({ input: { type: 'function_call_output', call_id: 'one' } }, 'one'),
  ).toBeUndefined()
  expect(
    outputFor({ input: [null, 1, { type: 'function_call_output', call_id: 'one' }] }, 'one'),
  ).toMatchObject({ call_id: 'one' })
})

describe('ModelApiSession: child hook boundaries (M51 with M48)', () => {
  it('stops dispatching stored hooks as soon as the machine opt-in turns off', async () => {
    let isEnabled = true
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setup({
      hooks: hooksFor('UserPromptSubmit', 'observe'),
      isHooksEnabled: () => isEnabled,
      runHook,
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'First done.' }, { text: 'Second done.' })
    await session.sendTurn([{ type: 'text', text: 'first' }])
    await turnDone()
    expect(runHook).toHaveBeenCalledOnce()
    isEnabled = false
    await session.sendTurn([{ type: 'text', text: 'second' }])
    await turnDone()
    expect(runHook).toHaveBeenCalledOnce()
  })

  it('runs SubagentStart once at the admitted child turn and keeps its context in the child', async () => {
    const seen: unknown[] = []
    const t = setupSubagents({
      hooks: hooksFor('SubagentStart', 'announce'),
      runHook: (_command, payload) => {
        seen.push(z.unknown().parse(JSON.parse(payload)))
        return Promise.resolve({
          stdout: 'Child-only start context',
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        })
      },
    })
    const { session } = await startApprovedSubagentSession(t)
    await completePaidChild(t, session, 'spawn_child_start_hook')
    expect(seen).toMatchObject([
      {
        hook_event_name: 'SubagentStart',
        subagent_id: 'subagent-1',
        child_session_id: `${session.sessionId}:subagent-1`,
      },
    ])
    const bodies = t.api.responseBodies()
    const childBody = bodies.find((body) => isChildRequest(body))
    expect(JSON.stringify(childBody?.['input'])).toContain('Child-only start context')
    expect(
      bodies
        .filter((body) => !isChildRequest(body))
        .some((body) => JSON.stringify(body['input']).includes('Child-only start context')),
    ).toBe(false)
    t.api.script({ text: 'Follow-up done.' })
    await session.messageSubagent('subagent-1', 'Another task', true)
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(bodies.length + 1)
    })
    expect(seen).toHaveLength(1)
  })

  it('does not start a child hook when paid spawn consent is declined', async () => {
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: 'Must not run',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setupSubagents({
      hooks: hooksFor('SubagentStart', 'announce'),
      runHook,
      allowsPaidUse: () => Promise.resolve(false),
    })
    const { session, turnDone } = await startSession(t, 'allowAll')
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review files"}',
            callId: 'declined_start_hook',
          },
        ],
      },
      { text: 'Parent continues.' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await turnDone()
    expect(t.paidRequests).toEqual([
      {
        request: { feature: 'subagents', task: expect.objectContaining({ role: 'explorer' }) },
        requiresAsking: false,
      },
    ])
    expect(runHook).not.toHaveBeenCalled()
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(0)
  })

  it('does not start a hook for a queued child cancelled before capacity opens', async () => {
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setupSubagents({ hooks: hooksFor('SubagentStart', 'announce'), runHook })
    const { session } = await startApprovedSubagentSession(t)
    const hold = await queueChildren(t, session)
    try {
      await vi.waitFor(() => {
        expect(runHook).toHaveBeenCalledTimes(8)
      })
      await session.controlSubagent('subagent-9', 'stop')
      expect(runHook).toHaveBeenCalledTimes(8)
    } finally {
      hold.resolve(undefined)
      await t.host.close()
    }
  })

  it('uses SubagentStop to continue a natural child reply within its existing paid grant', async () => {
    const seen: unknown[] = []
    const t = setupSubagents({
      hooks: hooksFor('SubagentStop', 'continue-child'),
      runHook: (_command, payload) => {
        seen.push(z.unknown().parse(JSON.parse(payload)))
        return Promise.resolve({
          stdout:
            seen.length === 1
              ? JSON.stringify({ decision: 'block', reason: 'Review one more file' })
              : '',
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        })
      },
    })
    const { session, events } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review files"}',
            callId: 'spawn_for_stop_hook',
          },
        ],
      },
      { text: 'Parent done.', hold: holdParent.promise },
      { text: 'Child first answer.' },
      { text: 'Child final answer.' },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate' }])
      await waitForChildResult(session)
    } finally {
      holdParent.resolve(undefined)
    }
    expect(seen).toMatchObject([
      {
        hook_event_name: 'SubagentStop',
        subagent_id: 'subagent-1',
        child_session_id: `${session.sessionId}:subagent-1`,
        stop_hook_active: false,
        last_assistant_message: 'Child first answer.',
      },
      {
        hook_event_name: 'SubagentStop',
        stop_hook_active: true,
        last_assistant_message: 'Child final answer.',
      },
    ])
    expect(t.api.responseBodies().filter((body) => isChildRequest(body))).toHaveLength(2)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(2)
    // The continuation spends the spawn's grant: the popup asked once, for the spawn.
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'subagents',
          task: expect.objectContaining({ role: 'explorer', objective: 'Review files' }),
        },
        requiresAsking: false,
      },
    ])
    expect(hasApprovalCard(events)).toBe(false)
  })

  it('lets SubagentStop block only within the four-request child grant', async () => {
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: JSON.stringify({ decision: 'block', reason: 'Keep reviewing' }),
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setupSubagents({ hooks: hooksFor('SubagentStop', 'keep-reviewing'), runHook })
    const { session } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review files"}',
            callId: 'spawn_for_stop_cap',
          },
        ],
      },
      { text: 'Parent done.', hold: holdParent.promise },
      ...Array.from({ length: 4 }, () => ({ text: 'Child keeps reviewing.' })),
      { text: 'Must not run.' },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate' }])
      await waitForChildResult(session)
    } finally {
      holdParent.resolve(undefined)
    }
    expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
      result: { errorKind: 'subagent_requestLimit' },
    })
    expect(t.api.responseBodies().filter((body) => isChildRequest(body))).toHaveLength(4)
    expect(t.paidUses.filter((use) => use.feature === 'subagents')).toHaveLength(4)
    expect(runHook).toHaveBeenCalledTimes(4)
  })

  it('does not let SubagentStop veto an explicit owner Stop', async () => {
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: JSON.stringify({ decision: 'block', reason: 'Keep going' }),
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const t = setupSubagents({ hooks: hooksFor('SubagentStop', 'keep-going'), runHook })
    const { session } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    const holdChild = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review files"}',
            callId: 'spawn_before_explicit_stop',
          },
        ],
      },
      { text: 'Parent done.', hold: holdParent.promise },
      { text: 'Child answer.', hold: holdChild.promise },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate' }])
      await vi.waitFor(() => {
        expect(t.api.responseBodies().filter((body) => isChildRequest(body))).toHaveLength(1)
      })
      await session.controlSubagent('subagent-1', 'stop')
      expect(runHook).not.toHaveBeenCalled()
    } finally {
      holdChild.resolve(undefined)
      holdParent.resolve(undefined)
    }
  })
})

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

/** The web search tools a request body offered (M33). */
function webSearchTools(body: Record<string, unknown> | undefined): readonly unknown[] {
  const tools = z.array(z.record(z.string(), z.unknown())).parse(body?.['tools'])
  return tools.filter((tool) => tool['type'] === 'web_search')
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

  it('asks in the popup once per prompt, however many requests the prompt makes (M58)', async () => {
    const t = setup({ paid: ['webSearch'], files: { 'a.txt': 'alpha' } })
    const { session, events, turnDone } = await startSession(t)
    await readAlphaTurn(t, session, turnDone)
    await answerFirst(t, session, turnDone)
    expect(t.api.responseBodies()).toHaveLength(3)
    expect(t.paidRequests).toEqual([
      { request: { feature: 'webSearch' }, requiresAsking: false },
      { request: { feature: 'webSearch' }, requiresAsking: false },
    ])
    expect(hasApprovalCard(events)).toBe(false)
    for (const body of t.api.responseBodies()) {
      expect(webSearchTools(body)).toEqual([{ type: 'web_search' }])
    }
  })

  it('sends a prompt whose popup was denied without the search tool or its results (M58)', async () => {
    let isAllowed = false
    const t = setup({ paid: ['webSearch'], allowsPaidUse: () => Promise.resolve(isAllowed) })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    isAllowed = true
    await answerFirst(t, session, turnDone)
    const [denied, allowed] = t.api.responseBodies()
    expect(webSearchTools(denied)).toEqual([])
    expect(denied?.['include']).toEqual(['reasoning.encrypted_content'])
    expect(webSearchTools(allowed)).toEqual([{ type: 'web_search' }])
    expect(allowed?.['include']).toEqual(['reasoning.encrypted_content', 'web_search_call.results'])
    expect(t.paidRequests).toEqual([
      { request: { feature: 'webSearch' }, requiresAsking: false },
      { request: { feature: 'webSearch' }, requiresAsking: false },
    ])
  })

  it('never asks about web search while it is off (M58)', async () => {
    const t = setup({ paid: ['imageGeneration', 'subagents'] })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    await answerFirst(t, session, turnDone)
    expect(t.paidRequests).toEqual([])
    expect(webSearchTools(t.api.responseBodies()[0])).toEqual([])
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
  it('offers no image tool while it is off, and refuses one called anyway without asking', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script({ calls: [imageCall({ prompt: 'a cat', path: 'cat.png' })] }, { text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'draw a cat' }])
    await turnDone()
    const tools = t.api.responseBodies()[0]?.['tools'] as readonly Record<string, unknown>[]
    expect(tools.some((tool) => tool['name'] === 'generate_image')).toBe(false)
    expect(hasApprovalCard(events)).toBe(false)
    expect(t.paidRequests).toEqual([])
    expect(t.api.imageBodies()).toEqual([])
    expect(toolOutput(t, 'call_img')).toContain('image generation is off')
    expect(t.paidUses).toEqual([])
  })

  it('asks before the image, naming it paid, then writes the PNG and counts it', async () => {
    const popup = paidPopup()
    const t = setup({ paid: ['imageGeneration'], allowsPaidUse: popup.allowsPaidUse })
    const { session, events, turnDone } = await startSession(t)
    const answer = popup.hold()
    t.api.images.push({ revisedPrompt: 'a calm tabby cat' })
    t.api.script(
      { calls: [imageCall({ prompt: 'a cat', path: 'art/cat.png', aspect: 'landscape' })] },
      { text: 'Done.' },
    )
    await session.sendTurn([{ type: 'text', text: 'draw a cat' }])
    await paidPopupAsked(t, 1)
    const tools = t.api.responseBodies()[0]?.['tools'] as readonly Record<string, unknown>[]
    expect(tools.filter((tool) => tool['name'] === 'generate_image')).toEqual([
      expect.objectContaining({
        parameters: expect.objectContaining({ required: ['prompt', 'path'] }),
      }),
    ])
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'imageGeneration',
          kind: 'generate',
          path: 'art/cat.png',
          sources: [],
          prompt: 'a cat',
        },
        requiresAsking: false,
      },
    ])
    expect(hasApprovalCard(events)).toBe(false)
    expect(t.api.imageBodies()).toEqual([])
    answer.resolve(true)
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
      await turnDone()
      // One popup per image, the first allowed or not.
      expect(t.paidRequests).toEqual(
        ['one', 'two'].map((name) => ({
          request: {
            feature: 'imageGeneration',
            kind: 'generate',
            path: `${name}.png`,
            sources: [],
            prompt: name,
          },
          requiresAsking: false,
        })),
      )
      expect(hasApprovalCard(events)).toBe(false)
      expect(t.api.imageBodies()).toHaveLength(2)
      expect(t.paidUses).toHaveLength(2)
    }
    const plan = setup({ paid: ['imageGeneration'] })
    const { session, events, turnDone } = await startSession(plan, 'denyUnmatched')
    plan.api.script({ calls: [imageCall({ prompt: 'a', path: 'a.png' })] }, { text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'draw' }])
    await turnDone()
    expect(hasApprovalCard(events)).toBe(false)
    expect(plan.paidRequests).toEqual([])
    expect(plan.api.imageBodies()).toEqual([])
    expect(toolOutput(plan, 'call_img')).toContain('refused by the permission mode')
  })

  it('refuses before the popup what could not be saved, so nothing is asked or billed', async () => {
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
      expect(hasApprovalCard(events)).toBe(false)
      expect(t.paidRequests).toEqual([])
      expect(t.api.imageBodies()).toEqual([])
      expect(toolOutput(t, 'call_img')?.toLowerCase()).toContain(reason)
    }
  })

  it('calls nothing when the popup is denied, and counts a billed image that was not a PNG', async () => {
    // Deny for the first image; the second's popup stays open.
    const second = Promise.withResolvers<boolean>()
    const t = setup({
      paid: ['imageGeneration'],
      allowsPaidUse: (request) =>
        'path' in request && request.path === 'no.png' ? Promise.resolve(false) : second.promise,
    })
    const { session, turnDone } = await startSession(t)
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
    await paidPopupAsked(t, 2)
    expect(t.paidRequests.map(({ request }) => 'path' in request && request.path)).toEqual([
      'no.png',
      'odd.png',
    ])
    expect(t.api.imageBodies()).toEqual([])
    second.resolve(true)
    await turnDone()
    expect(toolOutput(t, 'c1')).toContain(`generate_image ${MODEL_TEXT.toolRejectedByUser}`)
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
    await turnDone()
    expect(t.paidRequests).toHaveLength(1)
    expect(hasApprovalCard(events)).toBe(false)
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
    await turnDone()
    // A protected target asks even when the feature is allowed always.
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'imageGeneration',
          kind: 'generate',
          path: '.vscode/icon.png',
          sources: [],
          prompt: 'x',
        },
        requiresAsking: true,
      },
    ])
    expect(hasApprovalCard(events)).toBe(false)
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

/** Image generation on while `paid` says so, with a popup a test can hold open. */
function imagePopupSetup(paid: PaidFeature[] = ['imageGeneration']) {
  const popup = paidPopup()
  return { t: setup({ paid, allowsPaidUse: popup.allowsPaidUse }), popup }
}

/** One image call in Bypass, its popup allowed once `beforeApproval` has run. */
async function approvedImage(
  { t, popup }: ReturnType<typeof imagePopupSetup>,
  path: string,
  beforeApproval: () => void = () => undefined,
) {
  const { session, events, turnDone } = await startSession(t, 'allowAll')
  const answer = popup.hold()
  t.api.script({ calls: [imageCall({ prompt: 'x', path })] }, { text: 'ok' })
  await session.sendTurn([{ type: 'text', text: 'draw' }])
  await paidPopupAsked(t, 1)
  beforeApproval()
  answer.resolve(true)
  await turnDone()
  expect(hasApprovalCard(events)).toBe(false)
  return toolOutput(t, 'call_img')
}

describe('ModelApiSession: image generation, the review of PR #27 (M34)', () => {
  it('buys nothing when the feature is turned off while the popup is open', async () => {
    const paid: PaidFeature[] = ['imageGeneration']
    const held = imagePopupSetup(paid)
    const { t } = held
    const output = await approvedImage(held, 'off.png', () => {
      paid.length = 0
    })
    expect(t.api.imageBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    expect(output).toContain('image generation is off')
  })

  it('buys nothing when the path is taken while the popup is open', async () => {
    const held = imagePopupSetup()
    const { t } = held
    const output = await approvedImage(held, 'late.png', () => {
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
      const held = imagePopupSetup()
      const { t } = held
      t.api.images.push(image, {})
      await approvedImage(held, 'once.png')
      expect(t.api.imageBodies()).toHaveLength(1)
      // The reserved file goes when no image came.
      expect(t.io.binaries.has(`${ROOT}/once.png`)).toBe(false)
      expect(t.paidUses).toEqual([])
    }
  })

  it('retries a rate limit, which Meta refused before any work', async () => {
    const held = imagePopupSetup()
    const { t } = held
    t.api.images.push({ httpError: { status: 429, message: 'slow down' } }, {})
    await approvedImage(held, 'later.png')
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
function editSetup(
  sources: Readonly<Record<string, Uint8Array>> = {},
  allowsPaidUse?: ModelApiHostDeps['allowsPaidUse'],
) {
  const t = setup({
    paid: ['imageGeneration'],
    files: { 'notes.txt': 'x', 'taken.png': 'x' },
    ...(allowsPaidUse !== undefined && { allowsPaidUse }),
  })
  for (const [name, bytes] of Object.entries(sources)) {
    t.io.binaries.set(`${ROOT}/${name}`, bytes)
  }
  return t
}

const SOURCE_PNG = Buffer.from(TINY_PNG_BASE64, 'base64')

/** Hold a paid image edit at its popup so a workspace link can change. */
async function pendingEditPopup(
  t: ReturnType<typeof setup>,
  popup: ReturnType<typeof paidPopup>,
  args: Record<string, unknown>,
  callId: string,
) {
  const { session, events, turnDone } = await startSession(t, 'allowAll')
  const answer = popup.hold()
  t.api.script({ calls: [editCall(args, callId)] }, { text: 'ok' })
  await session.sendTurn([{ type: 'text', text: 'edit' }])
  await paidPopupAsked(t, 1)
  expect(hasApprovalCard(events)).toBe(false)
  return { turnDone, answer }
}

/** Allow a paid image popup and wait until its call has finished. */
async function allowImagePopup(pending: Awaited<ReturnType<typeof pendingEditPopup>>) {
  pending.answer.resolve(true)
  await pending.turnDone()
}

describe('ModelApiSession: image edits, paid and asked every time (M44)', () => {
  it('refuses an edit when a source link changes while the paid popup is open', async () => {
    const links: Record<string, string> = { 'source.png': `${ROOT}/safe.png` }
    const io = memoryToolIo({}, ROOT, undefined, links)
    io.binaries.set(`${ROOT}/safe.png`, SOURCE_PNG)
    io.binaries.set(`${ROOT}/.muse/private.png`, SOURCE_PNG)
    const popup = paidPopup()
    const t = setup({ io, paid: ['imageGeneration'], allowsPaidUse: popup.allowsPaidUse })
    const pending = await pendingEditPopup(
      t,
      popup,
      { prompt: 'edit', images: ['source.png'], path: 'out.png' },
      'source_race',
    )
    links['source.png'] = `${ROOT}/.muse/private.png`
    await allowImagePopup(pending)
    expect(t.api.editBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    expect(toolOutput(t, 'source_race')).toContain('path changed after approval')
  })

  it('refuses an image output whose link changes to a protected target during approval', async () => {
    const links: Record<string, string> = { 'output.png': `${ROOT}/safe-output.png` }
    const io = memoryToolIo({}, ROOT, undefined, links)
    const popup = paidPopup()
    const t = setup({ io, paid: ['imageGeneration'], allowsPaidUse: popup.allowsPaidUse })
    io.binaries.set(`${ROOT}/source.png`, SOURCE_PNG)
    const pending = await pendingEditPopup(
      t,
      popup,
      { prompt: 'edit', images: ['source.png'], path: 'output.png' },
      'output_race',
    )
    // Asked about a safe target, so the popup did not have to ask.
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'imageGeneration',
          kind: 'edit',
          path: 'output.png',
          sources: ['source.png'],
          prompt: 'edit',
        },
        requiresAsking: false,
      },
    ])
    links['output.png'] = `${ROOT}/.muse/output.png`
    await allowImagePopup(pending)
    expect(t.api.editBodies()).toEqual([])
    expect(t.paidUses).toEqual([])
    expect(t.io.binaries.has(`${ROOT}/.muse/output.png`)).toBe(false)
    expect(toolOutput(t, 'output_race')).toContain('path changed after approval')
  })

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
    const popup = paidPopup()
    const t = editSetup(
      { 'art/fox.png': SOURCE_PNG, 'art/hat.webp': SOURCE_PNG },
      popup.allowsPaidUse,
    )
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    const answer = popup.hold()
    const args = {
      prompt: 'put the hat on the fox',
      images: ['art/fox.png', 'art/hat.webp'],
      path: 'art/fox-hat.png',
    }
    t.api.script({ calls: [editCall(args)] }, { text: 'Done.' })
    await session.sendTurn([{ type: 'text', text: 'give the fox a hat' }])
    await paidPopupAsked(t, 1)
    expect(t.paidRequests).toEqual([
      {
        request: {
          feature: 'imageGeneration',
          kind: 'edit',
          path: 'art/fox-hat.png',
          sources: ['art/fox.png', 'art/hat.webp'],
          prompt: 'put the hat on the fox',
        },
        requiresAsking: false,
      },
    ])
    expect(hasApprovalCard(events)).toBe(false)
    expect(t.api.editBodies()).toEqual([])
    answer.resolve(true)
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

  it('refuses before the popup a source it could not send or a result it could not save', async () => {
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
      expect(hasApprovalCard(events)).toBe(false)
      expect(t.paidRequests).toEqual([])
      expect(t.api.editBodies()).toEqual([])
      expect(toolOutput(t, 'call_edit')?.toLowerCase()).toContain(reason)
    }
  })

  it('is refused in Plan, and with image generation off, without asking', async () => {
    const plan = editSetup({ 'a.png': SOURCE_PNG })
    const planned = await startSession(plan, 'denyUnmatched')
    plan.api.script(
      { calls: [editCall({ prompt: 'a', images: ['a.png'], path: 'b.png' })] },
      { text: 'ok' },
    )
    await planned.session.sendTurn([{ type: 'text', text: 'edit' }])
    await planned.turnDone()
    expect(toolOutput(plan, 'call_edit')).toContain('refused by the permission mode')
    expect(hasApprovalCard(planned.events)).toBe(false)
    expect(plan.paidRequests).toEqual([])
    const off = setup()
    const { session, events, turnDone } = await startSession(off, 'allowAll')
    off.api.script(
      { calls: [editCall({ prompt: 'a', images: ['a.png'], path: 'b.png' })] },
      { text: 'ok' },
    )
    await session.sendTurn([{ type: 'text', text: 'edit' }])
    await turnDone()
    expect(hasApprovalCard(events)).toBe(false)
    expect(off.paidRequests).toEqual([])
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

async function startUnbudgetedGoal(t: ReturnType<typeof setup>) {
  const started = await startSession(t)
  t.api.script({ text: 'Goal work' })
  await started.session.controlGoal({ verb: 'set', objective: 'Ship it' })
  await started.turnDone()
  return started
}

async function startBudgetedGoal(t: ReturnType<typeof setup>) {
  const started = await startSession(t)
  await beginBudgetGoal(t, started.session, started.turnDone)
  return started
}

function holdCompactionCount(t: ReturnType<typeof setup>) {
  const counted = Promise.withResolvers<number>()
  const countStarted = Promise.withResolvers<undefined>()
  vi.spyOn(t.client, 'countInputTokens').mockImplementation(() => {
    countStarted.resolve(undefined)
    return counted.promise
  })
  return { counted, countStarted }
}

async function expectReplacementGoalWake(
  t: ReturnType<typeof setup>,
  session: ModelApiSession,
): Promise<void> {
  await vi.waitFor(() => {
    expect(t.api.responseBodies()).toHaveLength(3)
  })
  expect(session.snapshot().goal).toMatchObject({ objective: 'Goal B', status: 'active' })
  expect(instructionsOf(t, 2)).toContain('- Objective: Goal B')
}

/** Fifty tool replies, with the final one held for a busy command. */
function scriptHeldFinalToolRound(
  t: ReturnType<typeof setup>,
  hold: Promise<void>,
  finalText: string,
): void {
  const tool = { name: 'get_goal', arguments: '{}' }
  t.api.script(
    ...Array.from({ length: MODEL_API_MAX_TOOL_ROUNDS - 1 }, () => ({ calls: [tool] })),
    { calls: [tool], hold },
    { text: finalText },
  )
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
  it('rejects an overlong user objective in the installed language', async () => {
    setUiText({ ...EN, goalObjectiveTooLong: 'Ziel höchstens {limit} Zeichen.' }, 'de')
    try {
      const t = setup()
      const { session } = await startSession(t)
      await expect(
        session.controlGoal({ verb: 'set', objective: 'x'.repeat(GOAL_OBJECTIVE_MAX_CHARS + 1) }),
      ).rejects.toThrow('Ziel höchstens 4.000 Zeichen.')
    } finally {
      setUiText(EN, BASE_LOCALE)
    }
  })

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
      UI_TEXT.goalObjectiveMissing,
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
    scriptHeldFinalToolRound(t, held.promise, 'Working on the goal')
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

  it('starts a fresh turn for steering accepted in the last tool round', async () => {
    const store = memorySessionStore()
    const t = setup({ store })
    const { session, events, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    scriptHeldFinalToolRound(t, held.promise, 'Steered answer')
    const running = await session.sendTurn([{ type: 'text', text: 'many tool rounds' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS)
    })
    const steeredImage = Buffer.from('late steer').toString('base64')
    const steered = await session.steer(running.turnId, [
      { type: 'text', text: 'New instruction' },
      { type: 'image', mediaType: 'image/png', base64Data: steeredImage, width: 1, height: 1 },
    ])
    held.resolve(undefined)
    await turnDone()
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS + 1)
    })
    expect(JSON.stringify(t.api.responseBodies()[MODEL_API_MAX_TOOL_ROUNDS]?.['input'])).toContain(
      'New instruction',
    )
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(2)
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'turnCompleted')).toHaveLength(2)
    })
    const changed = events.find(
      (event) =>
        event.type === 'userMessageTurnChanged' && event.userMessageId === steered.userMessageId,
    )
    if (changed?.type !== 'userMessageTurnChanged') {
      throw new Error('expected promoted-steer turn mapping')
    }
    expect(changed.turnId).not.toBe(running.turnId)
    expect(session.sentImages(changed.turnId, steered.userMessageId ?? '')).toEqual([
      { mediaType: 'image/png', base64Data: steeredImage },
    ])
    await t.host.flush()
    expect(
      store.saved
        .get(session.sessionId)
        ?.replay.find((entry) => entry.userMessageId === steered.userMessageId)?.turnId,
    ).toBe(changed.turnId)
    session.dispose()
    const reopened = setup({ store })
    await reopened.host.load()
    const loaded = await reopened.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(loaded.session.sentImages?.(changed.turnId, steered.userMessageId ?? '')).toEqual([
      { mediaType: 'image/png', base64Data: steeredImage },
    ])
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

  it('keeps a replacement goal active when Stop is still unwinding an old turn', async () => {
    const t = setup()
    const { session, turnDone } = await startUnbudgetedGoal(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'Old reply', hold: held.promise }, { text: 'Working on B' })
    await session.sendTurn([{ type: 'text', text: 'continue A' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(2)
    })
    const stopping = session.cancel()
    const setting = session.controlGoal({ verb: 'set', objective: 'Goal B' })
    await Promise.all([stopping, setting])
    held.resolve(undefined)
    await turnDone()
    await expectReplacementGoalWake(t, session)
  })

  it('refuses steering after Stop while an old response is still unwinding', async () => {
    const t = setup()
    const { session, turnDone } = await startSession(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script({ text: 'Old reply', hold: held.promise })
    const running = await session.sendTurn([{ type: 'text', text: 'go' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(1)
    })
    await session.cancel()
    await expect(
      session.steer(running.turnId, [{ type: 'text', text: 'Too late' }]),
    ).rejects.toThrow('the turn is not running')
    held.resolve(undefined)
    await turnDone()
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

  it('keeps steering accepted while a response exhausts the goal budget', async () => {
    const t = setup()
    const { session, turnDone } = await startBudgetedGoal(t)
    const held = Promise.withResolvers<undefined>()
    t.api.script(
      { text: 'Budget reply', hold: held.promise, usage: { input: 90, output: 10 } },
      { text: 'Separate answer' },
    )
    const running = await session.sendTurn([{ type: 'text', text: 'continue' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(3)
    })
    await session.steer(running.turnId, [{ type: 'text', text: 'Separate question' }])
    held.resolve(undefined)
    await turnDone()
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(4)
    })
    expect(session.snapshot().goal).toMatchObject({ status: 'budget_limited' })
    expect(JSON.stringify(t.api.responseBodies()[3]?.['input'])).toContain('Separate question')
  })

  it('does not replay steering after Stop when a completed budget reply was buffered', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    await beginBudgetGoal(t, session, turnDone)
    const streamed = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalStream = t.client.streamResponse.bind(t.client)
    vi.spyOn(t.client, 'streamResponse').mockImplementation(async function* (...args) {
      yield* originalStream(...args)
      streamed.resolve(undefined)
      await release.promise
    })
    t.api.script(
      { text: 'Budget reply', usage: { input: 90, output: 10 } },
      { text: 'Must not run' },
    )
    const running = await session.sendTurn([{ type: 'text', text: 'continue' }])
    await streamed.promise
    await session.steer(running.turnId, [{ type: 'text', text: 'Should be cancelled' }])
    await session.cancel()
    release.resolve(undefined)
    await turnDone()
    expect(events.filter((event) => event.type === 'turnStarted')).toHaveLength(2)
    expect(t.api.responseBodies()).toHaveLength(3)
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

  it('withdraws a superseded goal wake queued during compaction', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'Intro' })
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await turnDone()
    const held = Promise.withResolvers<undefined>()
    t.api.script(
      { text: 'Summary', hold: held.promise },
      { text: 'Working on B' },
      { text: 'Duplicate work on B' },
    )
    const compacting = session.compact()
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(2)
    })
    const first = await session.controlGoal({ verb: 'set', objective: 'Goal A' })
    const second = await session.controlGoal({ verb: 'set', objective: 'Goal B' })
    held.resolve(undefined)
    await compacting
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: 'turnWithdrawn',
        turnId: first.turnId,
        reason: UI_TEXT.goalWakeWithdrawn,
      })
    })
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(3)
    })
    expect(instructionsOf(t, 2)).toContain('- Objective: Goal B')
    expect(events).toContainEqual({ type: 'turnStarted', turnId: second.turnId })
  })

  it('charges a held response to its original goal even when the goal is paused', async () => {
    const t = setup()
    const { session, turnDone } = await startBudgetedGoal(t)
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
    const { session } = await startUnbudgetedGoal(t)
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

  it('pauses the goal when Stop arrives after the compaction summary committed', async () => {
    const t = setup()
    const { session } = await startUnbudgetedGoal(t)
    const { counted, countStarted } = holdCompactionCount(t)
    t.api.script({ text: 'Summary' })
    const compacting = session.compact()
    await countStarted.promise
    await session.cancel()
    counted.resolve(42)
    // The summary was already committed; Stop pauses future goal work.
    await expect(compacting).resolves.toMatchObject({ status: 'accepted' })
    expect(session.snapshot().goal).toMatchObject({ status: 'paused' })
  })

  it('does not pause a replacement goal set after Stop during compaction counting', async () => {
    const t = setup()
    const { session } = await startUnbudgetedGoal(t)
    const { counted, countStarted } = holdCompactionCount(t)
    t.api.script({ text: 'Summary' }, { text: 'Working on B' })
    const compacting = session.compact()
    await countStarted.promise
    await session.cancel()
    await session.controlGoal({ verb: 'set', objective: 'Goal B' })
    counted.resolve(42)
    await expect(compacting).resolves.toMatchObject({ status: 'accepted' })
    await expectReplacementGoalWake(t, session)
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

// --- M46: background work, the user's `!` commands, explanations ---

/** A `bash` call the fake API asks for: a dev server, as a long command. */
const DEV_SERVER_CALL = {
  name: 'bash',
  arguments: '{"command":"npm run dev","description":"Start the dev server"}',
  callId: 'call_dev',
}

/** A session on a held shell whose first turn is running `npm run dev` (M46). */
async function runningShell(store?: ReturnType<typeof memorySessionStore>) {
  const io = heldShellToolIo({}, ROOT)
  const t = setup({ io, ...(store !== undefined && { store }) })
  const started = await startSession(t, 'allowAll')
  t.api.script({ calls: [DEV_SERVER_CALL] }, { text: 'Started it.' }, { text: 'Noted.' })
  await started.session.sendTurn([{ type: 'text', text: 'start the dev server' }])
  await vi.waitFor(() => {
    expect(io.runs).toHaveLength(1)
  })
  const call = started.events.find(
    (event): event is Extract<AgentEvent, { type: 'itemStarted' }> =>
      event.type === 'itemStarted' && event.item.tool === 'bash',
  )
  const run = io.runs[0]
  if (call === undefined || run === undefined) {
    throw new Error('expected the running shell call')
  }
  return { ...started, t, io, run, itemId: call.item.itemId }
}

/** The completion of one item, once it arrives. */
async function completionOf(events: readonly AgentEvent[], itemId: string) {
  await vi.waitFor(() => {
    expect(
      events.some((event) => event.type === 'itemCompleted' && event.item.itemId === itemId),
    ).toBe(true)
  })
  const completed = events.find(
    (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
      event.type === 'itemCompleted' && event.item.itemId === itemId,
  )
  if (completed === undefined) {
    throw new Error('expected a completion')
  }
  return completed.item
}

/** The rows of the user's own commands, as they started. */
function userShellStarts(events: readonly AgentEvent[]) {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: 'itemStarted' }> =>
      event.type === 'itemStarted' && event.item.kind === 'userShell',
  )
}

/** A user message's text as the replay holds it. */
const userNoteSchema = z.object({
  role: z.literal('user'),
  content: z.array(z.object({ text: z.string() })),
})

function noteText(item: unknown): string | undefined {
  const parsed = userNoteSchema.safeParse(item)
  return parsed.success ? parsed.data.content[0]?.text : undefined
}

/** The input of the n-th request (0-based) the fake API saw. */
function requestInput(t: ReturnType<typeof setup>, index: number): readonly unknown[] {
  return z.array(z.unknown()).parse(t.api.responseBodies()[index]?.['input'])
}

/** Ask a fork about the inherited shell and return exactly what its model read. */
async function forkInput(
  t: ReturnType<typeof setup>,
  session: AgentSession,
): Promise<readonly unknown[]> {
  const { turnDone } = watchTurns(session)
  t.api.script({ text: 'It was ready.' })
  await session.sendTurn([{ type: 'text', text: 'what happened?' }])
  await turnDone()
  return requestInput(t, t.api.responseBodies().length - 1)
}

describe('ModelApiSession: background shell commands (M46)', () => {
  it('shows a quiet foreground shell to a second surface, then replaces its moved and completed row', async () => {
    const r = await runningShell()
    const loaded = await r.t.host.resumeSession(r.session.sessionId, r.session.modelId)
    expect(loaded.history.items.find((item) => item.itemId === r.itemId)).toMatchObject({
      kind: 'toolCall',
      status: 'inProgress',
      tool: 'bash',
    })
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    expect(r.session.history().items.filter((item) => item.itemId === r.itemId)).toEqual([
      expect.objectContaining({ status: 'inProgress', background: true }),
    ])
    r.run.finish({ stdout: 'ready', exitCode: 0 })
    await completionOf(r.events, r.itemId)
    expect(r.session.history().items.filter((item) => item.itemId === r.itemId)).toEqual([
      expect.objectContaining({ status: 'completed', background: true }),
    ])
    loaded.session.dispose()
  })

  it('answers the model at once and keeps the command running, without its time limit', async () => {
    const r = await runningShell()
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    expect(r.run.isLifted).toBe(true)
    expect(r.run.signal?.aborted).toBe(false)
    expect(r.events).toContainEqual({
      type: 'itemUpdated',
      item: expect.objectContaining({
        itemId: r.itemId,
        status: 'inProgress',
        background: true,
        backgroundInitiator: 'user',
      }),
    })
    // The row is not completed, and the history holds it running.
    expect(
      r.events.some((event) => event.type === 'itemCompleted' && event.item.itemId === r.itemId),
    ).toBe(false)
    expect(r.session.history().items.find((item) => item.itemId === r.itemId)?.status).toBe(
      'inProgress',
    )
    expect(requestInput(r.t, 1)).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_dev',
      output: MODEL_TEXT.shellMovedToBackground,
    })
  })

  it('runs the post-tool hook on a moved shell result while its background row remains live', async () => {
    const io = heldShellToolIo({}, ROOT)
    const observed: unknown[] = []
    const t = setup({
      io,
      hooks: hooksFor('PostToolUse', 'observe'),
      runHook: (_command, payload) => {
        observed.push(JSON.parse(payload))
        return permitHook()
      },
    })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    t.api.script({ calls: [DEV_SERVER_CALL] }, { text: 'Started it.' })
    await session.sendTurn([{ type: 'text', text: 'start the dev server' }])
    await vi.waitFor(() => {
      expect(io.runs).toHaveLength(1)
    })
    const started = events.find(
      (event): event is Extract<AgentEvent, { type: 'itemStarted' }> =>
        event.type === 'itemStarted' && event.item.tool === 'bash',
    )
    if (started === undefined) {
      throw new Error('expected the running shell call')
    }
    await session.moveToBackground(started.item.itemId)
    await turnDone()
    expect(observed).toContainEqual(
      expect.objectContaining({
        hook_event_name: 'PostToolUse',
        tool_name: 'bash',
        tool_response: MODEL_TEXT.shellMovedToBackground,
      }),
    )
    expect(requestInput(t, 1)).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_dev',
      output: MODEL_TEXT.shellMovedToBackground,
    })
    expect(
      session.history().items.find((item) => item.itemId === started.item.itemId),
    ).toMatchObject({
      status: 'inProgress',
      background: true,
    })
    io.runs[0]?.finish({ stdout: 'ready', exitCode: 0 })
    expect(await completionOf(events, started.item.itemId)).toMatchObject({
      status: 'completed',
      background: true,
    })
    expect(
      events.filter(
        (event) => event.type === 'itemCompleted' && event.item.itemId === started.item.itemId,
      ),
    ).toHaveLength(1)
  })

  it('completes the row when the command ends and tells the model with its next request', async () => {
    const r = await runningShell()
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    r.run.finish({ stdout: 'listening on 3000', exitCode: 0 })
    expect(await completionOf(r.events, r.itemId)).toMatchObject({
      status: 'completed',
      background: true,
      visibleOutput: 'listening on 3000\n[exit code 0]',
    })
    expect(r.session.history().items.find((item) => item.itemId === r.itemId)?.status).toBe(
      'completed',
    )
    await r.session.sendTurn([{ type: 'text', text: 'is it up?' }])
    await r.turnDone()
    const input = requestInput(r.t, 2)
    expect(noteText(input.at(-2))).toBe(
      `${MODEL_TEXT.backgroundEndedLead}\n$ npm run dev\nlistening on 3000\n[exit code 0]`,
    )
    expect(noteText(input.at(-1))).toBe('is it up?')
  })

  it('outlives the turn’s Stop; its own Stop ends it, marked stopped', async () => {
    const io = heldShellToolIo({}, ROOT)
    const t = setup({ io })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [DEV_SERVER_CALL] },
      { calls: [{ name: 'write_file', arguments: '{"path":"n.txt","content":"x"}' }] },
      { text: 'Stopped.' },
    )
    await session.sendTurn([{ type: 'text', text: 'start it, then write n.txt' }])
    const shell = await approvalRequest(events, 0)
    await session.decideApproval({
      approvalId: shell.approvalId,
      choiceId: 'allow_once',
      requirementId: shell.requirementId,
    })
    await vi.waitFor(() => {
      expect(io.runs).toHaveLength(1)
    })
    await session.moveToBackground(shell.itemId)
    // The turn goes on to the next card; Stop ends the turn, not the command.
    await approvalRequest(events, 1)
    await session.cancel()
    await turnDone()
    expect(io.runs[0]?.signal?.aborted).toBe(false)
    await session.stopTask(shell.itemId)
    expect(io.runs[0]?.signal?.aborted).toBe(true)
    expect(await completionOf(events, shell.itemId)).toMatchObject({
      status: 'cancelled',
      failureReason: 'stopped by the user',
    })
    // Stopped once, it is no task any more.
    await expect(session.stopTask(shell.itemId)).rejects.toThrow(UI_TEXT.taskNotRunning)
  })

  it('leaves a command in the foreground to the turn’s Stop, as before (D25)', async () => {
    const r = await runningShell()
    await r.session.cancel()
    await r.turnDone()
    expect(r.run.signal?.aborted).toBe(true)
    expect(await completionOf(r.events, r.itemId)).toMatchObject({
      failureReason: 'stopped by the user',
    })
    await expect(r.session.moveToBackground(r.itemId)).rejects.toThrow(UI_TEXT.taskNotRunning)
  })

  it('stops the background commands with Stop all, and any left when the session goes', async () => {
    const r = await runningShell()
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    await r.session.stopAllTasks()
    expect(r.run.signal?.aborted).toBe(true)
    // A second one, left running, goes with the session.
    r.t.api.script({ calls: [{ ...DEV_SERVER_CALL, callId: 'call_two' }] }, { text: 'Again.' })
    await r.session.sendTurn([{ type: 'text', text: 'again' }])
    await vi.waitFor(() => {
      expect(r.io.runs).toHaveLength(2)
    })
    const second = r.events.findLast(
      (event): event is Extract<AgentEvent, { type: 'itemStarted' }> =>
        event.type === 'itemStarted' && event.item.tool === 'bash',
    )
    await r.session.moveToBackground(second?.item.itemId ?? '')
    await r.turnDone()
    r.session.dispose()
    expect(r.io.runs[1]?.signal?.aborted).toBe(true)
  })

  it('brings a session back without the command its window took, and tells the model', async () => {
    const store = memorySessionStore()
    const r = await runningShell(store)
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    // Another window reads what this one saved while the command ran.
    const next = setup({ store })
    await next.host.load()
    const resumed = await next.host.resumeSession(r.session.sessionId, 'muse-spark-1.3')
    expect(resumed.history.items.find((item) => item.itemId === r.itemId)?.status).toBe(
      'interrupted',
    )
    const { turnDone } = watchTurns(resumed.session)
    next.api.script({ text: 'I will start it again.' })
    await resumed.session.sendTurn([{ type: 'text', text: 'is the server up?' }])
    await turnDone()
    const input = requestInput(next, 0)
    expect(noteText(input.at(-2))).toBe(`${MODEL_TEXT.backgroundLostLead}\n$ npm run dev`)
    expect(noteText(input.at(-1))).toBe('is the server up?')
  })

  it('shows a fork the command still running in its original as interrupted', async () => {
    const r = await runningShell()
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    const fork = await r.t.host.forkSession(r.session.sessionId, 'muse-spark-1.3')
    expect(fork.history.items.find((item) => item.itemId === r.itemId)?.status).toBe('interrupted')
    const { turnDone } = watchTurns(fork.session)
    r.t.api.script({ text: 'I will restart it.' })
    await fork.session.sendTurn([{ type: 'text', text: 'is the server running?' }])
    await turnDone()
    const input = requestInput(r.t, r.t.api.responseBodies().length - 1)
    expect(noteText(input.at(-2))).toBe(`${MODEL_TEXT.backgroundLostLead}\n$ npm run dev`)
  })

  it('copies a background completion note into a fork cut before that note', async () => {
    const r = await runningShell()
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    const firstTurnId = r.session.snapshot().turnIds[0]
    r.t.api.script({ text: 'Waiting.' })
    await r.session.sendTurn([{ type: 'text', text: 'continue' }])
    await r.turnDone()
    r.run.finish({ stdout: 'ready', exitCode: 0 })
    await completionOf(r.events, r.itemId)
    const fork = await r.t.host.forkSession(r.session.sessionId, 'muse-spark-1.3', firstTurnId)
    const input = await forkInput(r.t, fork.session)
    expect(noteText(input.at(-2))).toBe(
      `${MODEL_TEXT.backgroundEndedLead}\n$ npm run dev\nready\n[exit code 0]`,
    )
  })

  it('does not duplicate a background completion note the fork already retained', async () => {
    const r = await runningShell()
    await r.session.moveToBackground(r.itemId)
    await r.turnDone()
    r.run.finish({ stdout: 'ready', exitCode: 0 })
    await completionOf(r.events, r.itemId)
    const fork = await r.t.host.forkSession(r.session.sessionId, 'muse-spark-1.3')
    const input = await forkInput(r.t, fork.session)
    expect(
      input.filter((item) => noteText(item)?.startsWith(MODEL_TEXT.backgroundEndedLead)),
    ).toHaveLength(1)
  })
})

describe('ModelApiSession: the user’s own shell commands (M46)', () => {
  it('includes a running command in a second surface’s history and replaces its row on completion', async () => {
    const io = heldShellToolIo({}, ROOT)
    const t = setup({ io })
    const { session, events } = await startSession(t)
    await session.runUserShell('sleep 30')
    const [started] = userShellStarts(events)
    const loaded = await t.host.resumeSession(session.sessionId, session.modelId)
    expect(loaded.history.items.find((item) => item.itemId === started?.item.itemId)).toMatchObject(
      { kind: 'userShell', status: 'inProgress', commandText: 'sleep 30' },
    )
    io.runs[0]?.finish({ stdout: 'done', exitCode: 0 })
    await completionOf(events, started?.item.itemId ?? '')
    expect(session.history().items.filter((item) => item.itemId === started?.item.itemId)).toEqual([
      expect.objectContaining({ status: 'completed', visibleOutput: 'done' }),
    ])
    loaded.session.dispose()
  })

  it('persists a running user-shell row before another host restores the session', async () => {
    const store = memorySessionStore()
    const io = heldShellToolIo({}, ROOT)
    const first = setup({ io, store })
    const { session, events } = await startSession(first)
    await session.runUserShell('sleep 30')
    const [started] = userShellStarts(events)
    await first.host.flush()
    const other = setup({ store })
    await other.host.load()
    const restored = await other.host.resumeSession(session.sessionId, session.modelId)
    expect(
      restored.history.items.find((item) => item.itemId === started?.item.itemId),
    ).toMatchObject({ kind: 'userShell', status: 'interrupted', commandText: 'sleep 30' })
    await session.stopTask(started?.item.itemId ?? '')
    await completionOf(events, started?.item.itemId ?? '')
  })

  it('runs one outside any turn, as its own row, and tells the model before the next prompt', async () => {
    const io = heldShellToolIo({}, ROOT)
    const t = setup({ io })
    const { session, events, turnDone } = await startSession(t)
    await session.runUserShell('ls')
    const [started] = userShellStarts(events)
    // Muse Code's shape (captured 2026-09-25): the command, and no turn.
    expect(started?.item).toEqual({
      itemId: started?.item.itemId,
      kind: 'userShell',
      status: 'inProgress',
      commandText: 'ls',
    })
    expect(io.shellCalls[0]).toMatchObject({ command: 'ls', cwd: ROOT })
    io.runs[0]?.finish({ stdout: 'a.txt\n', exitCode: 0 })
    const done = await completionOf(events, started?.item.itemId ?? '')
    expect(done).toMatchObject({
      status: 'completed',
      exitCode: 0,
      visibleOutput: 'a.txt',
      durationMs: 1000,
    })
    expect(done.turnId).toBeUndefined()
    t.api.script({ text: 'I see a.txt.' })
    await session.sendTurn([{ type: 'text', text: 'what did I list?' }])
    await turnDone()
    const input = requestInput(t, 0)
    expect(noteText(input.at(-2))).toBe(`${MODEL_TEXT.userShellLead}\n$ ls\na.txt\n[exit code 0]`)
    expect(noteText(input.at(-1))).toBe('what did I list?')
    expect(session.history().items.map((item) => item.kind)).toContain('userShell')
  })

  it('marks a failing command failed with its exit code, and a stopped one stopped', async () => {
    const io = heldShellToolIo({}, ROOT)
    const t = setup({ io })
    const { session, events } = await startSession(t)
    await session.runUserShell('exit 3')
    await session.runUserShell('sleep 30')
    const [failing, sleeping] = userShellStarts(events)
    io.runs[0]?.finish({ stdout: 'failing-m46', exitCode: 3 })
    expect(await completionOf(events, failing?.item.itemId ?? '')).toMatchObject({
      status: 'failed',
      exitCode: 3,
    })
    // Stop all is for background work; the user's own command runs on.
    await session.stopAllTasks()
    expect(io.runs[1]?.signal?.aborted).toBe(false)
    await session.stopTask(sleeping?.item.itemId ?? '')
    expect(await completionOf(events, sleeping?.item.itemId ?? '')).toMatchObject({
      status: 'cancelled',
      failureReason: 'stopped by the user',
    })
  })

  it('reads a command that ended during a turn at the turn’s next request', async () => {
    const io = heldShellToolIo({}, ROOT)
    const t = setup({ io })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'write_file', arguments: '{"path":"n.txt","content":"x"}' }] },
      { text: 'Written.' },
    )
    await session.sendTurn([{ type: 'text', text: 'write n.txt' }])
    const approval = await approvalRequest(events, 0)
    await session.runUserShell('git status')
    io.runs[0]?.finish({ stdout: 'clean', exitCode: 0 })
    const [started] = userShellStarts(events)
    await completionOf(events, started?.item.itemId ?? '')
    await session.decideApproval({
      approvalId: approval.approvalId,
      choiceId: 'allow_once',
      requirementId: approval.requirementId,
    })
    await turnDone()
    expect(noteText(requestInput(t, 1).at(-1))).toBe(
      `${MODEL_TEXT.userShellLead}\n$ git status\nclean\n[exit code 0]`,
    )
  })

  it('runs none in Restricted Mode (D13)', async () => {
    const io = heldShellToolIo({}, ROOT)
    const t = setup({ io, isTrusted: false })
    const { session, events } = await startSession(t)
    await expect(session.runUserShell('ls')).rejects.toThrow(UI_TEXT.userShellRestricted)
    expect(io.shellCalls).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})

describe('ModelApiSession: an explanation instead of an answer (M46)', () => {
  it('settles the question clarified and hands the model the text, as Muse Code does', async () => {
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ calls: [ASK_USER_CALL] }, { text: 'Green, then.' })
    await session.sendTurn([{ type: 'text', text: 'go' }])
    const question = await awaitQuestion(events)
    await expect(session.clarifyQuestions(question.userInputId, ' '.repeat(3))).rejects.toThrow()
    await expect(
      session.clarifyQuestions(question.userInputId, 'x'.repeat(CLARIFICATION_MAX_CHARS + 1)),
    ).rejects.toThrow()
    await session.clarifyQuestions(question.userInputId, ' Neither: I prefer green. ')
    await turnDone()
    expect(events.find((event) => event.type === 'questionSettled')).toEqual({
      type: 'questionSettled',
      userInputId: question.userInputId,
      outcome: 'clarified',
      answers: [],
      clarification: 'Neither: I prefer green.',
    })
    expect(requestInput(t, 1)).toContainEqual(
      expect.objectContaining({
        type: 'function_call_output',
        output: `${MODEL_TEXT.clarificationLead}\nNeither: I prefer green.`,
      }),
    )
  })

  it('takes an answer given as the card arrives: the question is pending before it is shown', async () => {
    // The live Model API sweep's answerer replies inside the event (2026-09-27):
    // the card was announced before it was pending, so the answer was refused
    // "not pending" and the turn waited for ever. Approvals were already ordered.
    const t = setup()
    const { session, events, turnDone } = await startSession(t)
    const refusals: string[] = []
    session.onEvent((event) => {
      if (event.type === 'questionRequested') {
        void session.clarifyQuestions(event.userInputId, 'Green.').catch((error: unknown) => {
          refusals.push(String(error))
        })
      }
    })
    t.api.script({ calls: [ASK_USER_CALL] }, { text: 'Green, then.' })
    const done = turnDone()
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await vi.waitFor(() => {
      expect(refusals.length > 0 || events.some((event) => event.type === 'questionSettled')).toBe(
        true,
      )
    })
    expect(refusals).toEqual([])
    await done
    expect(events.find((event) => event.type === 'questionSettled')).toMatchObject({
      outcome: 'clarified',
      clarification: 'Green.',
    })
  })
})

/** The tool rows as they completed. */
function toolRows(events: readonly AgentEvent[]) {
  return events.flatMap((event) =>
    event.type === 'itemCompleted' && event.item.kind === 'toolCall' ? [event.item] : [],
  )
}

/** Every function output the fake API was sent, in order (each request replays the earlier ones). */
function outputs(t: ReturnType<typeof setup>): readonly unknown[] {
  const last = t.api.responseBodies().at(-1)?.['input'] as { type: string; output?: unknown }[]
  return last.filter((item) => item.type === 'function_call_output').map((item) => item.output)
}

function loseRequiredMcp(mcp: FakeMcpSource): void {
  mcp.snapshotValue = {
    ...mcp.snapshotValue,
    servers: [{ name: 'docs', isRequired: true, state: { status: 'failed', reason: 'gone' } }],
  }
}

function expectRequiredMcpLoss(events: readonly AgentEvent[]): void {
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'turnCompleted',
      terminal: 'failed',
      reason: fill(UI_TEXT.mcpRequiredFailed, { name: 'docs', reason: 'gone' }),
    }),
  )
}

describe('ModelApiHost: MCP servers and the IDE tool (M50)', () => {
  it('rechecks an MCP hook rewrite through the normal approval and external dispatch', async () => {
    const mcp = fakeMcpSource([{ server: 'docs', tool: 'search' }])
    const payloads: unknown[] = []
    const t = setup({
      mcpServers: mcp,
      hooks: [
        ...hooksFor('PreToolUse', 'rewrite'),
        ...hooksFor('PostToolUse', 'observe'),
        ...hooksFor('PostToolBatch', 'observe'),
      ],
      runHook: (_command, payload) => {
        const frame = z.looseObject({ hook_event_name: z.string() }).parse(JSON.parse(payload))
        payloads.push(frame)
        return frame.hook_event_name === 'PreToolUse'
          ? hookReply(
              JSON.stringify({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  updatedInput: { path: 'reviewed.md' },
                },
              }),
            )
          : hookReply()
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'mcp__docs__search', arguments: '{"path":"draft.md"}' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'search' }])
    const approval = await approvalRequest(events, 0)
    expect(approval.rawArgs).toBe('{"path":"reviewed.md"}')
    await session.decideApproval({
      approvalId: approval.approvalId,
      choiceId: 'allow_once',
      requirementId: approval.requirementId,
    })
    await turnDone()
    expect(mcp.calls).toEqual([{ name: 'mcp__docs__search', args: '{"path":"reviewed.md"}' }])
    expect(payloads).toEqual([
      expect.objectContaining({ hook_event_name: 'PreToolUse', tool_input: { path: 'draft.md' } }),
      expect.objectContaining({
        hook_event_name: 'PostToolUse',
        tool_input: { path: 'reviewed.md' },
      }),
      expect.objectContaining({
        hook_event_name: 'PostToolBatch',
        tool_calls: [expect.objectContaining({ tool_input: { path: 'reviewed.md' } })],
      }),
    ])
  })

  it('keeps MCP media and credential fields out of hook stdin while preserving the model result', async () => {
    const media = `data:image/png;base64,${'A'.repeat(20_000)}`
    const secret = 'mcp-private-token'
    const args = { path: 'notes.md', data: media, authorization: `Bearer ${secret}` }
    const mcp = fakeMcpSource([{ server: 'docs', tool: 'search' }])
    mcp.outcomes = [
      {
        output: media,
        outputParts: [
          { type: 'input_text', text: 'Picture result' },
          { type: 'input_image', image_url: media, detail: 'auto' },
        ],
        visibleOutput: 'Picture result',
      },
    ]
    const payloads: string[] = []
    const t = setup({
      mcpServers: mcp,
      hooks: [
        ...hooksFor('PreToolUse', 'observe'),
        ...hooksFor('PermissionRequest', 'observe'),
        ...hooksFor('PostToolUse', 'observe'),
        ...hooksFor('PostToolBatch', 'observe'),
      ],
      runHook: (_command, payload) => {
        payloads.push(payload)
        return hookReply()
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          { name: 'mcp__docs__search', arguments: JSON.stringify(args), callId: 'mcp_media' },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'search the notes' }])
    const approval = await approvalRequest(events, 0)
    await session.decideApproval({
      approvalId: approval.approvalId,
      choiceId: 'allow_once',
      requirementId: approval.requirementId,
    })
    await turnDone()
    expect(mcp.calls[0]?.args).toBe(JSON.stringify(args))
    expect(payloads).toHaveLength(4)
    expect(payloads.join('\n')).toContain('notes.md')
    expect(payloads.join('\n').includes(media)).toBe(false)
    expect(payloads.join('\n').includes(secret)).toBe(false)
    expect(payloads.every((payload) => Buffer.byteLength(payload) < 8192)).toBe(true)
    expect(JSON.stringify(t.api.responseBodies().at(-1)?.['input'])).toContain(media)
  })

  const DIAGNOSTICS: McpTool = {
    name: 'getDiagnostics',
    description: 'Problems',
    inputSchema: { type: 'object', properties: { uri: { type: 'string' } } },
    call: (args) =>
      args['uri'] === 'bad'
        ? Promise.reject(new Error('no such file'))
        : Promise.resolve('No diagnostics.'),
  }
  const TOOLS = [
    { server: 'docs', tool: 'search' },
    { server: 'docs', tool: 'lookup', isReadOnly: true },
  ]

  /** A session on a host with the fake servers, scripted to call `calls` and then answer. */
  async function mcpTurn(
    options: {
      mode?: string
      isTrusted?: boolean
      mcp?: FakeMcpSource
      calls?: readonly { name: string; arguments: string }[]
    } = {},
  ) {
    const mcp = options.mcp ?? fakeMcpSource(TOOLS)
    const t = setup({
      mcpServers: mcp,
      ideTools: [DIAGNOSTICS],
      isTrusted: options.isTrusted ?? true,
    })
    const started = await startSession(t, options.mode)
    t.api.script({ calls: options.calls ?? [] }, { text: 'done' })
    await started.session.sendTurn([{ type: 'text', text: 'go' }])
    return { ...started, t, mcp }
  }

  function connectedRequiredMcp(): FakeMcpSource {
    return fakeMcpSource(TOOLS, {
      servers: [
        {
          name: 'docs',
          isRequired: true,
          state: { status: 'connected', toolCount: 2, unofferedCount: 0 },
        },
      ],
    })
  }

  function heldRequiredHook(event: string, answer = '{}') {
    const release = Promise.withResolvers<undefined>()
    const mcp = connectedRequiredMcp()
    const runHook = vi.fn(async () => {
      await release.promise
      return await hookReply(answer)
    })
    const t = setup({ mcpServers: mcp, hooks: hooksFor(event, 'held'), runHook })
    return { release, mcp, runHook, t }
  }

  async function heldMcpCall(mcp: FakeMcpSource, gate: Promise<void>) {
    mcp.gate = gate
    const started = await mcpTurn({
      mode: 'allowAll',
      mcp,
      calls: [{ name: 'mcp__docs__search', arguments: '{}' }],
    })
    await vi.waitFor(() => {
      expect(mcp.calls).toHaveLength(1)
    })
    return started
  }

  it('offers the IDE tool always, and the MCP tools in a trusted workspace', async () => {
    const trusted = await mcpTurn()
    await trusted.turnDone()
    const names = (trusted.t.api.responseBodies()[0]?.['tools'] as { name?: string }[]).map(
      (tool) => tool.name,
    )
    expect(names).toEqual(
      expect.arrayContaining([
        'mcp__ide__getDiagnostics',
        'mcp__docs__search',
        'mcp__docs__lookup',
      ]),
    )
    expect(trusted.mcp.starts).toBeGreaterThan(0)
    const restricted = await mcpTurn({ isTrusted: false })
    await restricted.turnDone()
    const offered = (restricted.t.api.responseBodies()[0]?.['tools'] as { name?: string }[]).map(
      (tool) => tool.name,
    )
    expect(offered).toContain('mcp__ide__getDiagnostics')
    expect(offered).not.toContain('mcp__docs__search')
  })

  it('asks before an MCP tool in Manual, as a tool, and remembers "always allow"', async () => {
    const { session, events, turnDone, t, mcp } = await mcpTurn({
      calls: [
        { name: 'mcp__docs__search', arguments: '{"path":"notes.md"}' },
        { name: 'mcp__docs__search', arguments: '{"q":2}' },
      ],
    })
    const request = await approvalRequest(events, 0)
    expect(request).toMatchObject({
      toolName: 'mcp__docs__search',
      subject: { kind: 'tool', toolName: 'mcp__docs__search' },
    })
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
    expect(mcp.calls).toEqual([
      { name: 'mcp__docs__search', args: '{"path":"notes.md"}' },
      { name: 'mcp__docs__search', args: '{"q":2}' },
    ])
    expect(outputs(t)).toEqual(['mcp ok', 'mcp ok'])
    expect(toolRows(events).map((row) => [row.tool, row.status])).toEqual([
      ['mcp__docs__search', 'completed'],
      ['mcp__docs__search', 'completed'],
    ])
  })

  it('runs a read-only tool without a card in Auto, and asks for the rest', async () => {
    const { session, events, turnDone, mcp } = await mcpTurn({
      mode: 'onRequest',
      calls: [
        { name: 'mcp__docs__lookup', arguments: '{}' },
        { name: 'mcp__docs__search', arguments: '{}' },
      ],
    })
    const request = await approvalRequest(events, 0)
    expect(request.toolName).toBe('mcp__docs__search')
    expect(mcp.calls.map((call) => call.name)).toEqual(['mcp__docs__lookup'])
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'abort',
      requirementId: request.requirementId,
    })
    await turnDone()
    expect(toolRows(events).map((row) => row.status)).toEqual(['completed', 'rejected'])
  })

  it('refuses an MCP tool in Plan unless its server marks it read-only, which asks', async () => {
    const { session, events, turnDone, mcp } = await mcpTurn({
      mode: 'denyUnmatched',
      calls: [
        { name: 'mcp__docs__search', arguments: '{}' },
        { name: 'mcp__docs__lookup', arguments: '{}' },
        { name: 'mcp__ide__getDiagnostics', arguments: '{}' },
      ],
    })
    const request = await approvalRequest(events, 0)
    expect(request.toolName).toBe('mcp__docs__lookup')
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'allow_once',
      requirementId: request.requirementId,
    })
    await turnDone()
    const rows = toolRows(events)
    expect(rows.map((row) => [row.tool, row.status])).toEqual([
      ['mcp__docs__search', 'rejected'],
      ['mcp__docs__lookup', 'completed'],
      ['mcp__ide__getDiagnostics', 'completed'],
    ])
    expect(rows[0]?.failureReason).toBe(`mcp__docs__search ${MODEL_TEXT.toolRefusedByMode}`)
    expect(rows[2]?.visibleOutput).toBe('No diagnostics.')
    expect(mcp.calls.map((call) => call.name)).toEqual(['mcp__docs__lookup'])
  })

  it('runs MCP tools without asking in Bypass', async () => {
    const { events, turnDone, mcp } = await mcpTurn({
      mode: 'allowAll',
      calls: [{ name: 'mcp__docs__search', arguments: '{}' }],
    })
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(mcp.calls).toHaveLength(1)
  })

  it('refuses an MCP tool in Restricted Mode without a card', async () => {
    const { events, turnDone, mcp } = await mcpTurn({
      isTrusted: false,
      calls: [{ name: 'mcp__docs__search', arguments: '{}' }],
    })
    await turnDone()
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(toolRows(events)[0]).toMatchObject({
      status: 'rejected',
      failureReason: MODEL_TEXT.mcpRestrictedMode,
    })
    expect(mcp.calls).toEqual([])
  })

  it('hands the model pictures as content parts, and marks a tool error failed', async () => {
    const mcp = fakeMcpSource(TOOLS)
    const parts = [
      { type: 'input_text', text: 'a dot' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
    ] as const
    mcp.outcomes = [
      { output: 'a dot', outputParts: parts, visibleOutput: 'a dot\n[image image/png]' },
      { output: 'Error: it broke', visibleOutput: 'it broke', failureReason: 'it broke' },
      new Error('the connection closed: it exited with code 1'),
    ]
    const { events, turnDone, t, session } = await mcpTurn({
      mode: 'allowAll',
      mcp,
      calls: [
        { name: 'mcp__docs__search', arguments: '{}' },
        { name: 'mcp__docs__search', arguments: '{}' },
        { name: 'mcp__docs__search', arguments: '{}' },
      ],
    })
    await turnDone()
    expect(outputs(t)).toEqual([
      parts,
      'Error: it broke',
      'Error: the connection closed: it exited with code 1',
    ])
    expect(toolRows(events).map((row) => [row.status, row.visibleOutput])).toEqual([
      ['completed', 'a dot\n[image image/png]'],
      ['failed', 'it broke'],
      ['failed', 'the connection closed: it exited with code 1'],
    ])
    const stored = parseStoredSession(structuredClone(session.snapshot()))
    expect(stored.ok).toBe(true)
  })

  it('cancels an MCP call on Stop', async () => {
    const mcp = fakeMcpSource(TOOLS)
    const { session, events, turnDone } = await heldMcpCall(
      mcp,
      new Promise<never>(() => undefined),
    )
    await session.cancel()
    await turnDone()
    expect(toolRows(events)[0]?.status).toBe('cancelled')
  })

  it('reports a failed IDE tool call as a failed row', async () => {
    const { events, turnDone } = await mcpTurn({
      calls: [{ name: 'mcp__ide__getDiagnostics', arguments: '{"uri":"bad"}' }],
    })
    await turnDone()
    expect(toolRows(events)[0]).toMatchObject({ status: 'failed', failureReason: 'no such file' })
  })

  it('says once per session that an optional server is not running', async () => {
    const mcp = fakeMcpSource(TOOLS, {
      servers: [
        {
          name: 'flaky',
          isRequired: false,
          state: { status: 'failed', reason: 'it exited with code 1' },
        },
        {
          name: 'docs',
          isRequired: true,
          state: { status: 'connected', toolCount: 2, unofferedCount: 0 },
        },
      ],
    })
    const { session, events, turnDone, t } = await mcpTurn({ mcp })
    await turnDone()
    t.api.script({ text: 'again' })
    await session.sendTurn([{ type: 'text', text: 'again' }])
    await turnDone()
    const notices = events.filter((event) => event.type === 'backendNotice')
    expect(notices).toEqual([
      {
        type: 'backendNotice',
        level: 'warning',
        text: fill(UI_TEXT.mcpServerUnavailable, {
          name: 'flaky',
          reason: 'it exited with code 1',
        }),
      },
    ])
  })

  it('fails the turn while a required server is not running, saying how to fix it', async () => {
    const mcp = fakeMcpSource(TOOLS, {
      servers: [{ name: 'must', isRequired: true, state: { status: 'failed', reason: 'boom' } }],
    })
    const { events, turnDone, t } = await mcpTurn({ mcp })
    await turnDone()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turnCompleted',
        terminal: 'failed',
        reason: fill(UI_TEXT.mcpRequiredFailed, { name: 'must', reason: 'boom' }),
      }),
    )
    expect(t.api.responseBodies()).toHaveLength(0)
  })

  it('fails the active turn when a required server stops during the model stream', async () => {
    for (const reply of [
      { text: 'done' },
      { calls: [{ name: 'mcp__docs__search', arguments: '{}' }] },
    ]) {
      const release = Promise.withResolvers<undefined>()
      const mcp = connectedRequiredMcp()
      const t = setup({ mcpServers: mcp, ideTools: [DIAGNOSTICS] })
      const { session, events, turnDone } = await startSession(t)
      t.api.script({ ...reply, hold: release.promise }, { text: 'second' })
      await session.sendTurn([{ type: 'text', text: 'go' }])
      await vi.waitFor(() => {
        expect(t.api.responseBodies()).toHaveLength(1)
      })
      loseRequiredMcp(mcp)
      release.resolve(undefined)
      await turnDone()
      expectRequiredMcpLoss(events)
      expect(mcp.calls).toEqual([])
      expect(t.api.responseBodies()).toHaveLength(1)
    }
  })

  it.each([
    { event: 'PreLLMCall', answer: '{}', requestCount: 0 },
    {
      event: 'PostLLMCall',
      answer: JSON.stringify({ decision: 'block', reason: 'hook refused' }),
      requestCount: 1,
    },
    { event: 'Stop', answer: '{}', requestCount: 1 },
  ])('required server loss wins after a held $event hook', async (scenario) => {
    const held = heldRequiredHook(scenario.event, scenario.answer)
    const { session, events, turnDone } = await startSession(held.t)
    held.t.api.script({ text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await vi.waitFor(() => {
      expect(held.runHook).toHaveBeenCalledOnce()
    })
    loseRequiredMcp(held.mcp)
    held.release.resolve(undefined)
    await turnDone()
    expectRequiredMcpLoss(events)
    expect(held.t.api.responseBodies()).toHaveLength(scenario.requestCount)
  })

  it('does not fetch after a required server dies during key retrieval', async () => {
    const release = Promise.withResolvers<undefined>()
    const mcp = connectedRequiredMcp()
    let keyReads = 0
    const t = setup({
      mcpServers: mcp,
      apiKey: async () => {
        keyReads += 1
        await release.promise
        return 'LLM|1|secret'
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script({ text: 'should not run' })
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await vi.waitFor(() => {
      expect(keyReads).toBeGreaterThan(0)
    })
    loseRequiredMcp(mcp)
    release.resolve(undefined)
    await turnDone()
    expectRequiredMcpLoss(events)
    expect(t.api.responseBodies()).toHaveLength(0)
  })

  it('fails a paid child when required MCP dies during its SubagentStop hook', async () => {
    const release = Promise.withResolvers<undefined>()
    const mcp = connectedRequiredMcp()
    const runHook = vi.fn(async () => {
      await release.promise
      return await hookReply()
    })
    const t = setupSubagents({
      mcpServers: mcp,
      hooks: hooksFor('SubagentStop', 'held'),
      runHook,
    })
    const { session } = await startApprovedSubagentSession(t)
    const holdParent = Promise.withResolvers<undefined>()
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Review files"}',
            callId: 'spawn_before_required_loss',
          },
        ],
      },
      { text: 'Parent done.', hold: holdParent.promise },
      { text: 'Child done.' },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'delegate' }])
      await vi.waitFor(() => {
        expect(runHook).toHaveBeenCalledOnce()
      })
      loseRequiredMcp(mcp)
      release.resolve(undefined)
      await waitForChildResult(session)
      expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
        status: 'failed',
      })
    } finally {
      release.resolve(undefined)
      holdParent.resolve(undefined)
    }
  })

  it('does not start another model round after a required server stops during a tool call', async () => {
    const release = Promise.withResolvers<undefined>()
    const mcp = connectedRequiredMcp()
    const { events, turnDone, t } = await heldMcpCall(mcp, release.promise)
    loseRequiredMcp(mcp)
    release.resolve(undefined)
    await turnDone()
    expectRequiredMcpLoss(events)
    expect(t.api.responseBodies()).toHaveLength(1)
  })

  it.each(['PostToolUse', 'PostToolBatch'] as const)(
    'reports required MCP loss even when a %s hook asks to stop',
    async (event) => {
      const release = Promise.withResolvers<undefined>()
      const mcp = connectedRequiredMcp()
      mcp.gate = release.promise
      const payloads: unknown[] = []
      const t = setup({
        mcpServers: mcp,
        hooks: hooksFor(event, 'stop'),
        runHook: (_command, payload) => {
          payloads.push(JSON.parse(payload))
          return hookReply(JSON.stringify({ continue: false, stopReason: 'hook stopped batch' }))
        },
      })
      const { session, events, turnDone } = await startSession(t, 'allowAll')
      t.api.script(
        { calls: [{ name: 'mcp__docs__search', arguments: '{"path":"notes.md"}' }] },
        { text: 'should not run' },
      )
      await session.sendTurn([{ type: 'text', text: 'search' }])
      await vi.waitFor(() => {
        expect(mcp.calls).toHaveLength(1)
      })
      loseRequiredMcp(mcp)
      release.resolve(undefined)
      await turnDone()
      expect(payloads).toHaveLength(1)
      expectRequiredMcpLoss(events)
      expect(t.api.responseBodies()).toHaveLength(1)
    },
  )

  it('says why no server of the settings is loaded', async () => {
    const cases = [
      [{ kind: 'keys' }, UI_TEXT.mcpNoServersKeys],
      [{ kind: 'mode', servers: ['a', 'b'] }, fill(UI_TEXT.mcpNoServersMode, { servers: 'a, b' })],
      [
        { kind: 'unreadable', reason: 'EACCES' },
        fill(UI_TEXT.mcpNoServersUnreadable, { reason: 'EACCES' }),
      ],
    ] as const
    for (const [fault, text] of cases) {
      const { events, turnDone } = await mcpTurn({ mcp: fakeMcpSource([], { fault }) })
      await turnDone()
      expect(events.filter((event) => event.type === 'backendNotice')).toEqual([
        { type: 'backendNotice', level: 'warning', text },
      ])
    }
  })

  it('ends the wait for the servers on Stop', async () => {
    const mcp = fakeMcpSource(TOOLS)
    mcp.start = () => new Promise(() => undefined)
    const t = setup({ mcpServers: mcp })
    const { session, events, turnDone } = await startSession(t)
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await session.cancel()
    await turnDone()
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'turnCompleted', terminal: 'cancelled' }),
    )
  })

  it('starts the servers with a conversation, shows their state, and stops them with the host', async () => {
    const mcp = fakeMcpSource(TOOLS)
    const t = setup({ mcpServers: mcp })
    expect(t.host.mcpSnapshot()).toEqual(mcp.snapshotValue)
    const { session, turnDone } = await startSession(t)
    expect(mcp.starts).toBe(1)
    await answerFirst(t, session, turnDone)
    await t.host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(mcp.starts).toBe(3)
    await t.host.close()
    expect(mcp.isClosed).toBe(true)
    expect(setup().host.mcpSnapshot()).toBeUndefined()
  })

  it('logs a start that failed outright', async () => {
    const mcp = fakeMcpSource(TOOLS)
    mcp.start = () => Promise.reject(new Error('nope'))
    const t = setup({ mcpServers: mcp })
    await startSession(t)
    await vi.waitFor(() => {
      expect(countLogged(t.log, 'The MCP servers could not be started: nope')).toBe(1)
    })
  })
})

// --- Web fetch (M69, PLAN.md D49) ---

const FETCHED_PAGE: WebFetchResult = {
  kind: 'page',
  page: {
    url: 'https://docs.example.com/guide',
    finalUrl: 'https://docs.example.com/guide',
    status: 200,
    type: 'text/html',
    bytes: 42,
  },
  text: 'Fetched https://docs.example.com/guide (HTTP 200, text/html, 42 bytes). The page.',
}

/** A web fetch that records what it was asked and answers with `result`. */
function recordingFetch(result: (url: string) => WebFetchResult = () => FETCHED_PAGE) {
  const urls: string[] = []
  const fetcher: WebFetcher = (url) => {
    urls.push(url)
    return Promise.resolve(result(url))
  }
  return { fetcher, urls }
}

/** One `web_fetch` call per URL, a round each, then a reply. */
function scriptFetches(t: ReturnType<typeof setup>, ...urls: readonly string[]): void {
  t.api.script(
    ...urls.map((url, index) => ({
      calls: [
        { name: 'web_fetch', arguments: JSON.stringify({ url }), callId: `fetch_${String(index)}` },
      ],
    })),
    { text: 'done' },
  )
}

function fetchRows(events: readonly AgentEvent[]) {
  return events.flatMap((event) =>
    event.type === 'itemCompleted' && event.item.tool === 'web_fetch' ? [event.item] : [],
  )
}

/** Answers the n-th card with `choiceId`, and returns it. */
async function answerCard(
  session: ModelApiSession,
  events: readonly AgentEvent[],
  index: number,
  choiceId: string,
) {
  const request = await approvalRequest(events, index)
  await session.decideApproval({
    approvalId: request.approvalId,
    choiceId,
    requirementId: request.requirementId,
  })
  return request
}

describe('web fetch on the Model API backend (M69)', () => {
  it('is offered, and named in the instructions, only in a trusted workspace with a fetch', async () => {
    const fetch = recordingFetch()
    for (const [options, isOffered] of [
      [{ webFetch: fetch.fetcher }, true],
      [{ webFetch: fetch.fetcher, isTrusted: false }, false],
      [{}, false],
    ] as const) {
      const t = setup(options)
      const { session, turnDone } = await startSession(t)
      await answerFirst(t, session, turnDone)
      const body = t.api.responseBodies()[0]
      expect(toolNames(body).includes('web_fetch'), JSON.stringify(options)).toBe(isOffered)
      expect(String(body?.['instructions']).includes('web_fetch reads one public')).toBe(isOffered)
    }
  })

  it('asks per host in Manual, names the URL, and keeps "always" to that host', async () => {
    const fetch = recordingFetch()
    const t = setup({ webFetch: fetch.fetcher })
    const { session, events, turnDone } = await startSession(t)
    scriptFetches(
      t,
      'https://Docs.Example.com/guide#intro',
      'https://docs.example.com/other?q=1',
      'https://evil.example.net/?leak=1',
    )
    await session.sendTurn([{ type: 'text', text: 'read the docs' }])
    const first = await answerCard(session, events, 0, 'allow_session')
    expect(first.subject).toEqual({
      kind: 'webFetch',
      target: 'https://docs.example.com/guide',
      toolName: 'web_fetch',
    })
    expect(first.availableChoices[1]?.label).toBe('Always allow in this session: docs.example.com')
    // The same host runs without a card; another host asks again.
    const second = await answerCard(session, events, 1, 'abort')
    expect(second.subject.target).toBe('https://evil.example.net/?leak=1')
    await turnDone()
    expect(fetch.urls).toEqual([
      'https://docs.example.com/guide',
      'https://docs.example.com/other?q=1',
    ])
    expect(toolOutput(t, 'fetch_0')).toBe(FETCHED_PAGE.text)
    const rows = fetchRows(events)
    expect(rows.map((row) => row.status)).toEqual(['completed', 'completed', 'rejected'])
    expect(rows[0]?.visibleOutput).toBe(FETCHED_PAGE.text)
    expect(rows.every((row) => row.paid === undefined)).toBe(true)
  })

  it('asks in Auto, runs in Bypass, and is refused in Plan without a request', async () => {
    for (const [mode, isAsked, isFetched] of [
      ['onRequest', true, true],
      ['allowAll', false, true],
      ['denyUnmatched', false, false],
    ] as const) {
      const fetch = recordingFetch()
      const t = setup({ webFetch: fetch.fetcher })
      const { session, events, turnDone } = await startSession(t, mode)
      scriptFetches(t, 'https://docs.example.com/guide')
      await session.sendTurn([{ type: 'text', text: 'read' }])
      if (isAsked) {
        await answerCard(session, events, 0, 'allow_once')
      }
      await turnDone()
      expect(hasApprovalCard(events), mode).toBe(isAsked)
      expect(fetch.urls.length, mode).toBe(isFetched ? 1 : 0)
      if (!isFetched) {
        expect(fetchRows(events)[0]).toMatchObject({
          status: 'rejected',
          failureReason: 'web_fetch refused by the permission mode',
        })
      }
    }
  })

  it("keeps the per-host card when a PermissionRequest hook allows; a hook's deny still refuses", async () => {
    const fetch = recordingFetch()
    const allowing = setup({
      webFetch: fetch.fetcher,
      hooks: hooksFor('PermissionRequest', 'allow'),
      runHook: permitHook,
    })
    const first = await startSession(allowing)
    scriptFetches(allowing, 'https://docs.example.com/guide')
    await first.session.sendTurn([{ type: 'text', text: 'read' }])
    // The hook's allow is not the user's: the card still asks, and a refusal holds.
    await answerCard(first.session, first.events, 0, 'abort')
    await first.turnDone()
    expect(fetch.urls).toEqual([])
    expect(fetchRows(first.events)[0]?.status).toBe('rejected')

    const denying = setup({
      webFetch: fetch.fetcher,
      hooks: hooksFor('PermissionRequest', 'deny'),
      runHook: denyHook,
    })
    const second = await startSession(denying)
    scriptFetches(denying, 'https://docs.example.com/guide')
    await second.session.sendTurn([{ type: 'text', text: 'read' }])
    await second.turnDone()
    expect(hasApprovalCard(second.events)).toBe(false)
    expect(fetch.urls).toEqual([])
    expect(fetchRows(second.events)[0]).toMatchObject({
      status: 'rejected',
      failureReason: 'web_fetch rejected by a hook',
    })
  })

  it('asks trust and the mode again after the card, and fetches nothing once either is gone', async () => {
    const fetch = recordingFetch()
    const options = { webFetch: fetch.fetcher, isTrusted: true }
    const untrusted = setup(options)
    const first = await startSession(untrusted)
    scriptFetches(untrusted, 'https://docs.example.com/guide')
    await first.session.sendTurn([{ type: 'text', text: 'read' }])
    const card = await approvalRequest(first.events, 0)
    // Trust is revoked while the card is open; the user then allows.
    options.isTrusted = false
    await first.session.decideApproval({
      approvalId: card.approvalId,
      choiceId: 'allow_once',
      requirementId: card.requirementId,
    })
    await first.turnDone()
    expect(fetch.urls).toEqual([])
    expect(fetchRows(first.events)[0]).toMatchObject({
      status: 'rejected',
      failureReason: UI_TEXT.webFetchRestrictedMode,
    })

    const planned = setup({ webFetch: fetch.fetcher })
    const second = await startSession(planned)
    scriptFetches(planned, 'https://docs.example.com/guide')
    await second.session.sendTurn([{ type: 'text', text: 'read' }])
    const secondCard = await approvalRequest(second.events, 0)
    // The mode turns to Plan while the card is open.
    await second.session.setApprovalMode('denyUnmatched')
    await second.session.decideApproval({
      approvalId: secondCard.approvalId,
      choiceId: 'allow_once',
      requirementId: secondCard.requirementId,
    })
    await second.turnDone()
    expect(fetch.urls).toEqual([])
    expect(fetchRows(second.events)[0]?.status).toBe('rejected')
  })

  it('gives the fetch a check it asks before each request, and drops a page trust no longer allows', async () => {
    const answers: boolean[] = []
    const options: { webFetch: WebFetcher; isTrusted: boolean } = {
      webFetch: (_url, _signal, isStillAllowed) => {
        answers.push(isStillAllowed?.() ?? true)
        // Trust is revoked while the page is being fetched.
        options.isTrusted = false
        answers.push(isStillAllowed?.() ?? true)
        return Promise.resolve(FETCHED_PAGE)
      },
      isTrusted: true,
    }
    const t = setup(options)
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    scriptFetches(t, 'https://docs.example.com/guide')
    await session.sendTurn([{ type: 'text', text: 'read' }])
    await turnDone()
    expect(answers).toEqual([true, false])
    expect(toolOutput(t, 'fetch_0')).toBe(`Error: ${MODEL_TEXT.webFetchRestrictedMode}`)
    expect(fetchRows(events)[0]?.failureReason).toBe(UI_TEXT.webFetchRestrictedMode)
  })

  it('refuses a URL the fetch would refuse before any card, in the words of the user', async () => {
    const fetch = recordingFetch()
    const t = setup({ webFetch: fetch.fetcher })
    const { session, events, turnDone } = await startSession(t)
    // The same page over plain HTTP, then the cloud metadata address.
    const plainHttp = 'https://docs.example.com/'.replace('https:', 'http:')
    scriptFetches(t, plainHttp, 'https://169.254.169.254/latest/meta-data/')
    await session.sendTurn([{ type: 'text', text: 'read' }])
    await turnDone()
    expect(hasApprovalCard(events)).toBe(false)
    expect(fetch.urls).toEqual([])
    expect(fetchRows(events).map((row) => row.failureReason)).toEqual([
      UI_TEXT.webFetchNotHttps,
      fill(UI_TEXT.webFetchPrivateAddress, { host: '169.254.169.254', address: '169.254.169.254' }),
    ])
    expect(toolOutput(t, 'fetch_1')).toContain('not a public internet address')
  })

  it('is refused in Restricted Mode even when the model calls it', async () => {
    const fetch = recordingFetch()
    const t = setup({ webFetch: fetch.fetcher, isTrusted: false })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    scriptFetches(t, 'https://docs.example.com/guide')
    await session.sendTurn([{ type: 'text', text: 'read' }])
    await turnDone()
    expect(fetch.urls).toEqual([])
    expect(fetchRows(events)[0]).toMatchObject({
      status: 'rejected',
      failureReason: UI_TEXT.webFetchRestrictedMode,
    })
    expect(toolOutput(t, 'fetch_0')).toBe(`Error: ${MODEL_TEXT.webFetchRestrictedMode}`)
  })

  it('shows a redirect to another host in the words of the user, and the model its own', async () => {
    const moved: WebFetchResult = {
      kind: 'moved',
      location: 'https://other.example.net/',
      text: 'model text with markers',
      visibleText: 'visible text',
    }
    const fetch = recordingFetch(() => moved)
    const t = setup({ webFetch: fetch.fetcher })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    scriptFetches(t, 'https://docs.example.com/guide')
    await session.sendTurn([{ type: 'text', text: 'read' }])
    await turnDone()
    expect(fetchRows(events)[0]).toMatchObject({
      status: 'completed',
      visibleOutput: 'visible text',
    })
    expect(toolOutput(t, 'fetch_0')).toBe('model text with markers')
  })

  it('is not offered in a side chat, whose Plan mode refuses every fetch', async () => {
    const fetch = recordingFetch()
    const t = setup({ webFetch: fetch.fetcher, store: memorySessionStore() })
    const { session, turnDone } = await startSession(t)
    await answerFirst(t, session, turnDone)
    const side = await openSideFork(t, session)
    const sideTurns = watchTurns(side.session)
    t.api.script({ text: 'side reply' })
    await side.session.sendTurn([{ type: 'text', text: 'side question' }])
    await sideTurns.turnDone()
    const body = t.api.responseBodies().at(-1)
    expect(toolNames(body)).not.toContain('web_fetch')
    expect(String(body?.['instructions'])).not.toContain('web_fetch reads one public')
  })

  it("shows the fetch's own refusal to the user and the model", async () => {
    const refused = recordingFetch(() => ({
      kind: 'failed',
      failure: {
        kind: 'contentType',
        reason: 'the response is image/png',
        visibleReason: 'Not text',
      },
    }))
    const t = setup({ webFetch: refused.fetcher })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    scriptFetches(t, 'https://docs.example.com/logo.png')
    await session.sendTurn([{ type: 'text', text: 'read' }])
    await turnDone()
    expect(fetchRows(events)[0]).toMatchObject({ status: 'failed', failureReason: 'Not text' })
    expect(toolOutput(t, 'fetch_0')).toBe('Error: the response is image/png')
  })

  it('ends a fetch the user stops', async () => {
    const signals: AbortSignal[] = []
    const hanging: WebFetcher = (_url, signal) => {
      signals.push(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('stopped'))
        })
      })
    }
    const t = setup({ webFetch: hanging })
    const { session, events, turnDone } = await startSession(t, 'allowAll')
    scriptFetches(t, 'https://docs.example.com/slow')
    await session.sendTurn([{ type: 'text', text: 'read' }])
    await vi.waitFor(() => {
      expect(signals).toHaveLength(1)
    })
    await session.cancel()
    await turnDone()
    expect(signals[0]?.aborted).toBe(true)
    expect(fetchRows(events)[0]).toMatchObject({ status: 'cancelled' })
  })
})
