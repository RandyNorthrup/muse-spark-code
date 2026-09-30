// The live sweep of the Model API backend before a release (PLAN.md M7,
// M33–M35, M42–M54): the stack the extension builds in `activate`, that is
// `ModelApiBackendManager` over the real Model API client and the live
// `fetch`, with the real file, shell, memory, MCP, hook and schedule I/O,
// in an empty temporary workspace, against Meta's real API. Only the UI is
// replaced: an automatic answerer allows each card once, accepts each price
// and explains instead of answering a question. One `it` per feature, so
// each runs alone (`vitest run <this file> -t case07`).
//
// The host comes from the built dist/modelApi.js, as in the extension (M57,
// PLAN.md D6), so run `npm run build:dev` first (the search worker needs it
// too). The budget stop answers as Meta refuses a request, an HTTP 400
// with an error body, so the bundled client reports it and does not retry;
// an error thrown from here would be this file's class, not the bundle's.
//
// Opt-in only, never in CI: it bills the owner's Model API key. It runs
// when MUSE_LIVE_MODEL_API=1, reading the ACP agent's existing operating
// system credential entry in this process, inside the enabled suite. The
// legacy key environment variable is refused, never read or deleted. No
// process it starts (shell, hook, MCP fixture or speech synthesizer) receives
// the stored key; it is never printed or written, and each case checks
// that no log line, event or file holds it. Every model call is on the
// contributor tier (muse-spark-1.3-contributor: training is allowed on this
// throwaway content), subagents included. Each request to api.meta.ai goes
// through the global `fetch` the client calls per request (`liveFetch`),
// where it is counted with its method, path and status and the usage Meta
// returned; a run stops sending once its estimate passes BUDGET_USD. Where
// a case cannot go through the panel, it drives the lowest production layer
// that still makes the real request: the schedule's confirmed run (M52),
// Muse Voice's stream with the microphone replaced by a WAV that Windows'
// speech synthesizer says (M35), the session's compact (the `/compact` path).
// Measured 2026-09-27 on 0.9.0: a full run of the 18 cases is 59 requests
// (58 HTTP, one WebSocket) and about $0.033, of which $0.02 is the two
// images; a case alone is well under a tenth of a cent, case12 aside.
// case20 (M79; case19 in its 2026-09-28 standalone capture) drives the panel's own ConversationController
// over the rig's backend: 10 requests, about $0.0008.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { crc32, deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import type { AgentSession, TurnPart } from '../../src/core/agent/agentBackend'
import type {
  CodeLocation,
  CodeSymbol,
  LanguageServiceHost,
} from '../../src/core/codeIntel/languageService'
import { APPROVAL_CHOICE_IDS } from '../../src/core/backends/modelapi/permissions'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import { parseLoopPrompt } from '../../src/core/backends/modelapi/schedules'
import { type Usage, usageSchema } from '../../src/core/backends/modelapi/schemas'
import { parseSse } from '../../src/core/backends/modelapi/sse'
import { personalSkillsRoot } from '../../src/core/context/skills'
import { diagnosticsTool } from '../../src/core/diagnostics'
import { listWorkspaceFiles } from '../../src/core/eval/workspace'
import { readImageInfo } from '../../src/core/imageDimensions'
import { memoryDataRoot } from '../../src/core/memory/memoryLocation'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { PaidFeatureGate, PaidUsage } from '../../src/core/paid/paidFeatures'
import { pdfPageCount } from '../../src/core/pdf'
import { planBody } from '../../src/core/plans/planDocument'
import { listItems } from '../../src/core/plans/planMarkdown'
import { estimateCostUsd } from '../../src/core/usage/insights'
import type { DictationHandle, DictationListener } from '../../src/core/voice/dictation'
import { MuseVoiceDictation } from '../../src/core/voice/museVoice'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { describeEnvironment } from '../../src/host/backend/environment'
import { createFileScheduleStore } from '../../src/host/backend/fileScheduleStore'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { modelApiMcpPoolDeps } from '../../src/host/backend/mcpServers'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { museSettingsPath } from '../../src/host/backend/museSettings'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { createToolIo } from '../../src/host/backend/toolIo'
import { processGitRunner } from '../../src/host/git'
import { createLogger, type Logger } from '../../src/host/logger'
import { liveFetch } from '../../src/host/networkPosture'
import { ConversationController } from '../../src/host/conversation/conversationController'
import type { AuthSnapshot } from '../../src/host/auth/authService'
import { createPlanFiles, createPlanIo } from '../../src/host/planFeatures'
import { planMarkdownLoader } from '../../src/host/planMarkdownBundle'
import { openWebSocket } from '../../src/host/voice/dictationHost'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import {
  DEFAULT_EFFORT,
  DEFAULT_MEMORY_SCOPE,
  FILE_EDIT_TOOLS,
  MEMORY_SCOPES,
  MODEL_API_BASE_URL,
  MODEL_API_BUNDLE_FILE,
  MODEL_API_EFFORT_OFF,
  MODEL_API_SCHEDULED_TOOL,
  MODEL_API_SCHEDULES_DIR,
  MODEL_API_SESSIONS_DIR,
  MODEL_API_WEB_SEARCH_TOOL,
  MUSE_VOICE_BYTES_PER_SECOND,
  MUSE_VOICE_REALTIME_URL,
  MUSE_VOICE_SAMPLE_RATE,
  PLAN_MARKDOWN_BUNDLE_FILE,
  PAID_PRICES_USD,
  type PaidFeature,
  PLAN_TODO_PENDING_STATUS,
  PNG_SIGNATURE,
  type PromptCacheRetention,
  SEARCH_WORKER_FILE,
  SEARCHES_PER_PRICE_UNIT,
  SECONDS_PER_HOUR,
  SETTING_DEFAULTS,
  SHELL_TOOLS,
  THINKING_OFF_EFFORT,
  type CheckCommandSetting,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { PaidTally } from '../../src/shared/paid'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { FakeLogOutputChannel, fakeSurface } from '../unit/helpers/fakes'
import { readJobSource } from '../unit/helpers/jobSource'
import { logLines } from '../unit/helpers/logText'
import { FAKE_MCP_SERVER, fixtureJobLifecycle } from '../unit/helpers/mcpFixtures'
import { filesUnder, removeFolder } from '../unit/helpers/temporaryFolders'
import {
  assertNoLiveKeyEnvironment,
  loadEvalLiveCredentials,
  type EvalLiveCredentials,
} from './evalLiveSupport'

const IS_ENABLED = process.env['MUSE_LIVE_MODEL_API'] === '1'
assertNoLiveKeyEnvironment(process.env)
const live: { credentials: EvalLiveCredentials | undefined } = { credentials: undefined }

function credentialsForLiveRun(): EvalLiveCredentials {
  if (live.credentials === undefined) {
    throw new Error('The live Model API credential store has not been loaded.')
  }
  return live.credentials
}

const MODEL_ID = 'muse-spark-1.3-contributor'
const BUDGET_USD = 0.5
const TURN_MS = 240_000
const CASE_MS = 300_000
const LONG_CASE_MS = 600_000
const VOICE_FINAL_MS = 60_000
const SCHEDULE_MARGIN_MS = 1500
const ERROR_BODY_MAX_CHARS = 2000
const SOCKET_METHOD = 'WS'
const HTTP_SWITCHING_PROTOCOLS = 101
const SOCKET_CLOSE_WAIT_MS = 5000
const CLARIFICATION = 'Proceed without asking; take the simplest reading of the request.'
const META_HOST = new URL(MODEL_API_BASE_URL).host
const API_PATH = new URL(MODEL_API_BASE_URL).pathname
const RESPONSES_PATH = `${API_PATH}/responses`
const IMAGE_PATHS: ReadonlySet<string> = new Set([
  `${API_PATH}/images/generations`,
  `${API_PATH}/images/edits`,
])
const HTTP_OK = 200
const HTTP_CLIENT_ERROR_MIN = 400
const HTTP_CLIENT_ERROR_MAX = 499
const HTTP_TOO_MANY = 429
// 100 ms of 16 kHz 16-bit mono audio, sent every 100 ms: the microphone's pace.
const VOICE_CHUNK_MS = 100
const VOICE_CHUNK_BYTES = (MUSE_VOICE_BYTES_PER_SECOND * VOICE_CHUNK_MS) / 1000
const VOICE_SENTENCE = 'The quick brown fox jumps over the lazy dog.'
const HOOK_MARKER = 'hook-marker.txt'
const HOOK_WORD = 'ZEPHYR'
const RULES_WORD = 'MANGO'
// An 8x8 image reached Meta intact but is a few tokens (Meta: a 1x1 image is
// about 3): the model answered "grey", then "white", after looking for the
// file with list_files (2026-09-27). At 64x64 it is seen.
const IMAGE_SIDE = 64

// --- the wire: every request to Meta, counted ---

interface WireCall {
  readonly caseName: string
  readonly method: string
  readonly path: string
  readonly model: string | undefined
  /** Tool names (or types) the request offered. */
  readonly tools: readonly string[]
  /** The replayed input's item kinds (`reasoning`, `message:assistant:commentary`, …). */
  readonly inputKinds: readonly string[]
  /** `reasoning.effort` and `prompt_cache_retention` as sent. */
  readonly effort: string | undefined
  readonly retention: string | undefined
  status: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  /** The API's error body or the failure, never the key. */
  detail: string | undefined
}

const wire: WireCall[] = []
const usageReads: Promise<void>[] = []
const summaries: string[] = []
const caseCosts: number[] = []
const realFetch = globalThis.fetch.bind(globalThis)
/** The case the next request belongs to. */
const running = { caseName: 'setup' }

/** Anything this file prints goes through here: the key never reaches the output. */
function scrub(text: string): string {
  return live.credentials?.redact(text) ?? text
}

/**
 * The record the owner reads. Straight to stderr: vitest 5's default
 * reporter keeps a passing test's console output to itself.
 */
function report(text: string): void {
  process.stderr.write(`${scrub(text)}\n`)
}

function describeError(error: unknown): string {
  return scrub(error instanceof Error ? error.message : String(error))
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const requestBodySchema = z.object({
  model: z.optional(z.string()),
  tools: z.optional(z.array(z.object({ type: z.string(), name: z.optional(z.string()) }))),
  input: z.optional(
    z.array(
      z.object({
        type: z.string(),
        role: z.optional(z.string()),
        phase: z.optional(z.nullable(z.string())),
        content: z.optional(z.unknown()),
        output: z.optional(z.unknown()),
      }),
    ),
  ),
  reasoning: z.optional(z.object({ effort: z.optional(z.string()) })),
  prompt_cache_retention: z.optional(z.string()),
})
const contentTypesSchema = z.array(z.object({ type: z.string() }))

/** A message's (or a function output's) media parts by type (`[input_image]`); text is left out. */
function mediaKinds(content: unknown): string {
  const parsed = contentTypesSchema.safeParse(content)
  const media = parsed.success
    ? parsed.data.map((part) => part.type).filter((type) => type !== 'input_text')
    : []
  return media.length === 0 ? '' : `[${media.join(',')}]`
}

/** What a request carried that the summary and the assertions read: never its text. */
function requestFacts(
  body: RequestInit['body'],
): Pick<WireCall, 'model' | 'tools' | 'inputKinds' | 'effort' | 'retention'> {
  const parsed = requestBodySchema.safeParse(typeof body === 'string' ? parseJson(body) : undefined)
  if (!parsed.success) {
    return { model: undefined, tools: [], inputKinds: [], effort: undefined, retention: undefined }
  }
  const { model, tools = [], input = [] } = parsed.data
  return {
    model,
    effort: parsed.data.reasoning?.effort,
    retention: parsed.data.prompt_cache_retention,
    tools: tools.map((tool) => tool.name ?? tool.type),
    inputKinds: input.map(
      (item) =>
        `${[item.type, item.role, item.phase].filter((part) => part != null).join(':')}${mediaKinds(item.content ?? item.output)}`,
    ),
  }
}

const terminalFrameSchema = z.object({
  type: z.enum(['response.completed', 'response.incomplete', 'response.failed']),
  response: z.object({ usage: z.optional(z.nullable(usageSchema)) }),
})
const jsonUsageSchema = z.object({ usage: z.optional(z.nullable(usageSchema)) })

function addUsage(call: WireCall, usage: Usage | null | undefined): void {
  if (usage == null) {
    return
  }
  call.inputTokens += usage.input_tokens
  call.cachedTokens += usage.input_tokens_details?.cached_tokens ?? 0
  call.outputTokens += usage.output_tokens
}

/** The usage of a streamed reply, read from a copy of its stream. */
async function readStreamUsage(stream: ReadableStream<Uint8Array>, call: WireCall): Promise<void> {
  try {
    for await (const frame of parseSse(stream)) {
      const parsed = terminalFrameSchema.safeParse(parseJson(frame.data))
      if (parsed.success) {
        addUsage(call, parsed.data.response.usage)
      }
    }
  } catch (error: unknown) {
    call.detail ??= `stream ended early: ${describeError(error)}`
  }
}

function isBilledResponse(call: WireCall): boolean {
  return call.path === RESPONSES_PATH
}

function tokenUsd(calls: readonly WireCall[]): number {
  let total = 0
  for (const call of calls) {
    if (isBilledResponse(call)) {
      total += estimateCostUsd(
        {
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          cachedTokens: call.cachedTokens,
        },
        call.model ?? MODEL_ID,
      )
    }
  }
  return total
}

function imagesBought(calls: readonly WireCall[]): number {
  return calls.filter((call) => IMAGE_PATHS.has(call.path) && call.status === HTTP_OK).length
}

/** The running estimate the budget stop reads: tokens and images so far. */
function spentUsd(): number {
  return tokenUsd(wire) + imagesBought(wire) * PAID_PRICES_USD.imageGeneration
}

/** The global `fetch` while the sweep runs: Meta's requests counted, anything else passed on. */
async function meteredFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.host !== META_HOST) {
    return await realFetch(input, init)
  }
  if (spentUsd() > BUDGET_USD) {
    const error = {
      message: `the live sweep's budget of $${BUDGET_USD.toFixed(2)} is spent`,
      type: 'live_budget',
      code: 'live_budget',
    }
    return Response.json({ error }, { status: HTTP_CLIENT_ERROR_MIN })
  }
  const call: WireCall = {
    caseName: running.caseName,
    method: init?.method ?? 'GET',
    path: url.pathname,
    ...requestFacts(init?.body),
    status: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    detail: undefined,
  }
  wire.push(call)
  let response: Response
  try {
    response = await realFetch(input, init)
  } catch (error: unknown) {
    call.detail = describeError(error)
    throw error
  }
  call.status = response.status
  if (!response.ok) {
    const body = await response.clone().text()
    call.detail = scrub(body.slice(0, ERROR_BODY_MAX_CHARS))
    return response
  }
  if (response.body !== null && isBilledResponse(call)) {
    const [mine, theirs] = response.body.tee()
    usageReads.push(readStreamUsage(mine, call))
    return new Response(theirs, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  const json: unknown = parseJson(await response.clone().text())
  const parsed = jsonUsageSchema.safeParse(json)
  if (parsed.success) {
    addUsage(call, parsed.data.usage)
  }
  return response
}

function describeCall(call: WireCall): string {
  return `${call.method} ${call.path} ${String(call.status)}${call.detail === undefined ? '' : ` (${call.detail})`}`
}

/** A request our side got wrong: any 4xx but a rate limit (which the client retries). */
function isClientError(call: WireCall): boolean {
  return (
    call.method !== SOCKET_METHOD &&
    call.status >= HTTP_CLIENT_ERROR_MIN &&
    call.status <= HTTP_CLIENT_ERROR_MAX &&
    call.status !== HTTP_TOO_MANY
  )
}

function caseUsd(calls: readonly WireCall[], tally: PaidTally): number {
  return (
    tokenUsd(calls) +
    (tally.webSearches / SEARCHES_PER_PRICE_UNIT) * PAID_PRICES_USD.webSearchPerThousand +
    tally.images * PAID_PRICES_USD.imageGeneration +
    (tally.voiceSeconds / SECONDS_PER_HOUR) * PAID_PRICES_USD.voicePerHour
  )
}

function total(values: readonly number[]): number {
  let sum = 0
  for (const value of values) {
    sum += value
  }
  return sum
}

function summaryLine(
  name: string,
  calls: readonly WireCall[],
  tally: PaidTally,
  notes: readonly string[],
): string {
  const replies = calls.filter((call) => isBilledResponse(call))
  const sum = (pick: (call: WireCall) => number) => total(replies.map((call) => pick(call)))
  // The image endpoints' own usage objects, if Meta sends any: not priced here (per image).
  const imageUsage = calls
    .filter((call) => IMAGE_PATHS.has(call.path) && call.inputTokens + call.outputTokens > 0)
    .map((call) => `${call.path} in ${String(call.inputTokens)} out ${String(call.outputTokens)}`)
  const usd = caseUsd(calls, tally)
  caseCosts.push(usd)
  return [
    `live modelapi ${name}: ${String(calls.length)} requests`,
    `[${calls.map((call) => `${call.method} ${call.path} ${String(call.status)}`).join(', ')}]`,
    `reply tokens in ${String(sum((call) => call.inputTokens))} (cached ${String(sum((call) => call.cachedTokens))}) out ${String(sum((call) => call.outputTokens))}`,
    ...(imageUsage.length > 0 ? [`image usage ${imageUsage.join(', ')}`] : []),
    `paid: searches ${String(tally.webSearches)}, images ${String(tally.images)}, voice ${String(tally.voiceSeconds)} s, scheduled runs ${String(tally.scheduledRuns)}, child requests ${String(tally.subagentRequests ?? 0)}`,
    `est. $${usd.toFixed(4)}`,
    ...notes,
  ].join(' | ')
}

// --- a session's events, and the automatic answerer ---

type TurnCompleted = Extract<AgentEvent, { type: 'turnCompleted' }>

interface Finished {
  readonly turn: TurnCompleted
  readonly reply: string
  readonly rows: readonly ItemSnapshot[]
}

class Watch {
  private readonly wakers = new Set<() => void>()
  public readonly events: AgentEvent[] = []
  /** The tools whose cards were allowed, in order. */
  public readonly approved: string[] = []
  /** The tools whose card was answered with Stop instead. */
  public readonly stopped: string[] = []
  public readonly problems: string[] = []
  /** How the next card is answered: allowed once, or the turn stopped while it is open. */
  public onCard: 'allow' | 'stop' = 'allow'

  public constructor(private readonly session: AgentSession) {
    session.onEvent((event) => {
      this.events.push(event)
      this.answer(event)
      for (const wake of this.wakers) {
        wake()
      }
    })
  }

  /** What the owner would click here: allow once (or Stop), and explain instead of choosing. */
  private answer(event: AgentEvent): void {
    if (event.type === 'approvalRequested' && event.isReplayed !== true && this.onCard === 'stop') {
      this.stopped.push(event.toolName)
      void this.session.cancel().catch((error: unknown) => {
        this.problems.push(`stop: ${describeError(error)}`)
      })
    } else if (event.type === 'approvalRequested' && event.isReplayed !== true) {
      this.approved.push(event.toolName)
      void this.session
        .decideApproval({
          approvalId: event.approvalId,
          choiceId: APPROVAL_CHOICE_IDS.allowOnce,
          requirementId: event.requirementId,
        })
        .catch((error: unknown) => {
          this.problems.push(`approval ${event.toolName}: ${describeError(error)}`)
        })
    } else if (event.type === 'questionRequested') {
      void this.session
        .clarifyQuestions(event.userInputId, CLARIFICATION)
        .catch((error: unknown) => {
          this.problems.push(`question: ${describeError(error)}`)
        })
    }
  }

  public until<T>(what: string, find: () => T | undefined, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wakers.delete(check)
        reject(new Error(`timed out waiting for ${what}`))
      }, timeoutMs)
      const check = (): void => {
        const found = find()
        if (found === undefined) {
          return
        }
        clearTimeout(timer)
        this.wakers.delete(check)
        resolve(found)
      }
      this.wakers.add(check)
      check()
    })
  }

  public items(): readonly ItemSnapshot[] {
    return this.events.flatMap((event) => (event.type === 'itemCompleted' ? [event.item] : []))
  }

  public async finished(turnId: string): Promise<Finished> {
    const turn = await this.until(
      `turn ${turnId}`,
      () =>
        this.events.find(
          (event): event is TurnCompleted =>
            event.type === 'turnCompleted' && event.turnId === turnId,
        ),
      TURN_MS,
    )
    const items = this.items().filter((item) => item.turnId === turnId)
    return {
      turn,
      reply: items
        .filter((item) => item.kind === 'agentMessage')
        .map((item) => item.text ?? '')
        .join('\n'),
      rows: items.filter((item) => item.kind === 'toolCall'),
    }
  }
}

interface Driver {
  readonly session: AgentSession
  readonly watch: Watch
}

async function send(driver: Driver, prompt: string | readonly TurnPart[]): Promise<Finished> {
  const parts: readonly TurnPart[] =
    typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : prompt
  const submission = await driver.session.sendTurn(parts)
  return await driver.watch.finished(submission.turnId)
}

function expectCompleted(finished: Finished): void {
  expect({ terminal: finished.turn.terminal, reason: finished.turn.reason }).toEqual({
    terminal: 'completed',
    reason: undefined,
  })
}

function toolsRun(finished: Finished): readonly string[] {
  return finished.rows.map((row) => `${row.tool ?? '?'}:${row.status}`)
}

// --- the stack, as `activate` builds it, in a temporary folder ---

interface RigOptions {
  readonly isTrusted?: boolean
  readonly hasHooks?: boolean
  readonly paid?: readonly PaidFeature[]
  /** Muse Code's settings file (hooks, MCP servers), in the rig's own config home. */
  readonly settings?: Readonly<Record<string, unknown>>
  readonly files?: Readonly<Record<string, string | Uint8Array>>
  readonly mcpJobPath?: string | undefined
  /** `museSpark.modelApiPromptCacheRetention`; the setting's default when absent. */
  readonly promptCacheRetention?: PromptCacheRetention
  /** The verify loop (M68): its settings and a stand-in for the language servers. */
  readonly verify?: VerifyHooks
  /** Language services for the code intelligence tools (M67), over the rig's workspace. */
  readonly codeIntel?: (workspace: string) => LanguageServiceHost
}

interface Rig {
  readonly root: string
  readonly workspace: string
  readonly channel: FakeLogOutputChannel
  readonly log: Logger
  /** The first window's backend. */
  readonly manager: ModelApiBackendManager
  /** Another window on the same workspace and storage (D14); closed with the rig. */
  readonly openWindow: () => ModelApiBackendManager
  readonly windows: ModelApiBackendManager[]
  readonly memory: MemoryStore
  readonly gate: PaidFeatureGate
  readonly usage: PaidUsage
  readonly watches: Watch[]
  readonly notes: string[]
}

/** The paid gate with the price confirmation answered yes, and the window's tally. */
async function paidFeatures(
  log: Logger,
  features: readonly PaidFeature[],
): Promise<{ readonly gate: PaidFeatureGate; readonly usage: PaidUsage }> {
  // The machine settings and the global state's acceptances, in memory.
  const stored: { on: ReadonlySet<PaidFeature>; accepted: ReadonlySet<PaidFeature> } = {
    on: new Set(),
    accepted: new Set(),
  }
  const gate = new PaidFeatureGate({
    log,
    isWindowFocused: () => true,
    // The price confirmation, answered yes by the automatic answerer.
    confirm: () => Promise.resolve(true),
    isSettingOn: (feature) => stored.on.has(feature),
    readAccepted: () => stored.accepted,
    setSetting: (feature, isOn) => {
      const others = [...stored.on].filter((candidate) => candidate !== feature)
      stored.on = new Set(isOn ? [...others, feature] : others)
      return Promise.resolve()
    },
    writeAccepted: (next) => {
      stored.accepted = new Set(next)
      return Promise.resolve()
    },
  })
  for (const feature of features) {
    expect(await gate.turnOn(feature)).toBe(true)
  }
  return { gate, usage: new PaidUsage(log) }
}

async function openRig(options: RigOptions): Promise<Rig> {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-live-modelapi-'))
  const workspace = path.join(root, 'workspace')
  mkdirSync(workspace)
  const files = Object.entries(options.files ?? {})
  for (const [name, content] of files) {
    const file = path.join(workspace, ...name.split('/'))
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  const config = {
    platform: process.platform,
    homeDir: path.join(root, 'home'),
    xdgConfigHome: path.join(root, 'config'),
  }
  const settingsPath = museSettingsPath(config)
  if (options.settings !== undefined) {
    mkdirSync(path.dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(options.settings))
  }
  const channel = new FakeLogOutputChannel()
  const log = createLogger(channel)
  const isTrusted = () => options.isTrusted ?? true
  const toolIo = createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    listFiles: () => listWorkspaceFiles(workspace),
    env: () => process.env,
    // Built by `npm run build:dev`; no case here needs the search tool.
    searchWorkerPath: path.join(process.cwd(), 'dist', SEARCH_WORKER_FILE),
    unsavedFiles: () => [],
    log: (message) => {
      log.warn(message)
    },
    // Each Windows command and hook in a job object of its own (M27), as in activate.
    shellJobAssembly:
      process.platform === 'win32'
        ? shellJobAssembly({
            readJobSource,
            storageDir: path.join(root, 'storage'),
            systemRoot: process.env['SystemRoot'] ?? '',
            log: (message) => {
              log.warn(message)
            },
          })
        : undefined,
  })
  const memory = new MemoryStore({
    io: createMemoryIo(toolIo, {
      warn: (message) => {
        log.warn(`Memory: ${message}`)
      },
    }),
    platform: process.platform,
    workspaceRoot: workspace,
    dataRoot: () =>
      memoryDataRoot({
        platform: process.platform,
        homeDir: config.homeDir,
        xdgDataHome: path.join(root, 'data'),
      }),
    systemPath,
    warn: (message) => {
      log.warn(`Memory: ${message}`)
    },
  })
  const { gate, usage } = await paidFeatures(log, options.paid ?? [])
  const storage = path.join(root, 'storage')
  const windows: ModelApiBackendManager[] = []
  const openWindow = (): ModelApiBackendManager => {
    const window = new ModelApiBackendManager({
      workspaceRoot: workspace,
      log,
      fetch: liveFetch,
      getApiKey: credentialsForLiveRun().apiKey,
      random: Math.random,
      now: Date.now,
      sleep: (ms) => delay(ms),
      newId: () => randomUUID(),
      io: toolIo,
      contextIo: fileContextIo,
      memory,
      personalSkillsRoot: personalSkillsRoot(config),
      isWorkspaceTrusted: isTrusted,
      hookSettingsPath: settingsPath,
      isHooksEnabled: () => options.hasHooks === true,
      store: createFileSessionStore({
        directory: path.join(storage, MODEL_API_SESSIONS_DIR),
        retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
        now: Date.now,
        sleep: (ms) => delay(ms),
        log,
      }),
      scheduleStore: createFileScheduleStore({
        directory: path.join(storage, MODEL_API_SCHEDULES_DIR),
        now: Date.now,
        log,
      }),
      describeEnvironment: () =>
        describeEnvironment({
          runGit: processGitRunner(),
          workspaceRoot: workspace,
          isWorkspaceTrusted: isTrusted,
          now: Date.now,
          log,
        }),
      promptCacheRetention: () =>
        options.promptCacheRetention ?? SETTING_DEFAULTS.modelApiPromptCacheRetention,
      isPaidFeatureOn: (feature) => gate.isOn(feature),
      notePaidUse: (feature, units) => {
        usage.add(feature, units)
      },
      // The paid-use popup (M58), answered "Allow once" like every card.
      allowsPaidUse: (request) => Promise.resolve(gate.isOn(request.feature)),
      isPaidUseRemembered: () => false,
      noteSubagentUsage: (modelId, childUsage) => {
        usage.addSubagentUsage(modelId, childUsage)
      },
      createMcpServers: (workspaceRoot, newPool) =>
        newPool(
          modelApiMcpPoolDeps({
            workspaceRoot,
            settingsPath: () => settingsPath,
            isWorkspaceTrusted: isTrusted,
            clientVersion: '0.0.0-live-modelapi',
            platform: process.platform,
            jobExecutablePath: options.mcpJobPath,
            env: () => process.env,
            fetch: globalThis.fetch.bind(globalThis),
            log,
          }),
        ),
      // Built by `npm run build:dev`, as in activate (M57).
      bundlePath: path.join(process.cwd(), 'dist', MODEL_API_BUNDLE_FILE),
      ...(options.verify !== undefined && { verify: options.verify }),
      codeIntel: options.codeIntel?.(workspace),
      ideTools: [
        diagnosticsTool({
          getDiagnostics: () => [],
          workspaceRoot: workspace,
          platform: process.platform,
          relativeInRoot: (absolutePath) => path.relative(workspace, absolutePath),
        }),
      ],
    })
    windows.push(window)
    return window
  }
  return {
    root,
    workspace,
    channel,
    log,
    manager: openWindow(),
    openWindow,
    windows,
    memory,
    gate,
    usage,
    watches: [],
    notes: [],
  }
}

async function startSession(rig: Rig, approvalMode = 'onRequest'): Promise<Driver> {
  const host = await rig.manager.ensureHost()
  const session = await host.startSession({
    workspaceRoot: rig.workspace,
    modelId: MODEL_ID,
    approvalMode,
  })
  return watched(rig, session)
}

/** A session with the automatic answerer on it, its events kept for the case. */
function watched(rig: Rig, session: AgentSession): Driver {
  const watch = new Watch(session)
  rig.watches.push(watch)
  return { session, watch }
}

/**
 * The user messages that directly follow a function output in any request of
 * the case, by their media: where a file `read_file` read goes (D47).
 */
function mediaAfterOutput(calls: readonly WireCall[]): string {
  const found: string[] = []
  for (const call of calls) {
    for (const [index, kind] of call.inputKinds.entries()) {
      const next = call.inputKinds[index + 1] ?? ''
      if (kind.startsWith('function_call_output') && next.startsWith('message:user')) {
        found.push(next)
      }
    }
  }
  return found.join(' ')
}

/** Where the key turned up: a log line, an event, a file the case left. Names only. */
function keyLeaks(rig: Rig): readonly string[] {
  const credentials = credentialsForLiveRun()
  const leaks: string[] = []
  if (logLines(rig.channel).some((line) => credentials.contains(line))) {
    leaks.push('the log')
  }
  if (rig.watches.some((watch) => credentials.contains(JSON.stringify(watch.events)))) {
    leaks.push('the events')
  }
  for (const file of filesUnder(rig.root)) {
    if (credentials.contains(readFileSync(file))) {
      leaks.push(path.relative(rig.root, file))
    }
  }
  return leaks
}

/** A transcript item in one line: its kind, tool, status and the start of its text. */
function describeItem(item: ItemSnapshot): string {
  const text = item.text ?? item.visibleOutput ?? item.failureReason ?? ''
  return `${item.kind} ${item.tool ?? ''} ${item.status} ${JSON.stringify(text.slice(0, ERROR_BODY_MAX_CHARS))}`
}

function printDiagnostics(rig: Rig, name: string): void {
  const lines = [
    ...wire
      .filter((call) => call.caseName === name)
      .map((call) => `${describeCall(call)} input ${call.inputKinds.join(' ')}`),
    ...rig.watches.flatMap((watch) => [
      ...watch.problems,
      ...watch.items().map((item) => describeItem(item)),
    ]),
    ...rig.channel.warn.mock.calls.map((call) => `warn: ${call.map(String).join(' ')}`),
    ...rig.channel.error.mock.calls.map((call) => `error: ${call.map(String).join(' ')}`),
  ]
  report([`live modelapi ${name} failed:`, ...lines].join('\n  '))
}

/**
 * One case on a fresh stack: the stack is closed, the usage counted, the
 * folder searched for the key and removed, whatever happened.
 */
async function runCase(
  name: string,
  options: RigOptions,
  body: (rig: Rig) => Promise<void>,
): Promise<void> {
  running.caseName = name
  const rig = await openRig(options)
  let failure: unknown
  let isFailed = false
  try {
    await body(rig)
  } catch (error: unknown) {
    isFailed = true
    failure = error
  }
  for (const window of rig.windows) {
    await window.dispose()
  }
  await Promise.all(usageReads.splice(0))
  const calls = wire.filter((call) => call.caseName === name)
  summaries.push(scrub(summaryLine(name, calls, rig.usage.current, rig.notes)))
  const leaks = keyLeaks(rig)
  await removeFolder(rig.root)
  if (isFailed) {
    printDiagnostics(rig, name)
    throw failure
  }
  expect(leaks).toEqual([])
  expect(calls.filter((call) => isClientError(call)).map((call) => describeCall(call))).toEqual([])
  expect(rig.watches.flatMap((watch) => watch.problems)).toEqual([])
}

function callsOf(name: string): readonly WireCall[] {
  return wire.filter((call) => call.caseName === name)
}

// --- the panel's controller on the rig (M79) ---

/** What a live case never reaches: reaching it fails the case. */
function unreached(): Promise<never> {
  return Promise.reject(new Error('not reached by this case'))
}

interface LivePanel {
  readonly controller: ConversationController
  readonly posted: readonly HostToWebviewMessage[]
  /** The tools whose cards the panel's automatic answerer allowed once, in order. */
  readonly allowed: readonly string[]
}

/**
 * One panel's `ConversationController` on the rig's first window, wired as
 * `activate` wires it for the Model API, with the real plan files. Only the
 * webview is replaced: each approval card it is sent is answered Allow once,
 * and each modal (the protected `.agents/` save) is answered yes. What the
 * case never reaches rejects, so reaching it fails the case.
 */
function livePanel(rig: Rig): LivePanel {
  const allowed: string[] = []
  const surface = fakeSurface('live')
  const holder: { controller?: ConversationController } = {}
  const signedIn: AuthSnapshot = { status: 'signedIn', detail: undefined, backend: 'modelApi' }
  surface.post = (message) => {
    surface.posted.push(message)
    const event = message.type === 'agentEvent' ? message.event : undefined
    if (event?.type !== 'approvalRequested' || event.isReplayed === true) {
      return
    }
    allowed.push(event.toolName)
    void holder.controller?.handle({
      type: 'decideApproval',
      approvalId: event.approvalId,
      choiceId: APPROVAL_CHOICE_IDS.allowOnce,
      requirementId: event.requirementId,
    })
  }
  const controller = new ConversationController({
    surface,
    auth: {
      current: signedIn,
      backend: 'modelApi',
      toMessage: () => ({ type: 'authState', status: 'signedIn' }),
      signIn: unreached,
      installMuseCode: unreached,
      cancelSignIn: () => undefined,
      signOut: unreached,
      refresh: () => Promise.resolve(signedIn),
      markAuthRequired: () => signedIn,
      markBackendError: () => signedIn,
      checkAgain: () => Promise.resolve(signedIn),
    },
    ensureHost: () => rig.manager.ensureHost(),
    workspaceRoot: rig.workspace,
    modelId: MODEL_ID,
    initialPermissionMode: 'manual',
    hasApprovalUi: true,
    openExternal: () => undefined,
    mentions: { search: () => Promise.resolve([]), contains: () => Promise.resolve(false) },
    files: {
      showOpenDialog: () => Promise.resolve([]),
      readFile: unreached,
      canonicalRelativePath: () => Promise.resolve(undefined),
      pickMentionFile: () => Promise.resolve(undefined),
      toRelativePath: () => undefined,
    },
    isBypassAllowed: () => false,
    isRemoteWindow: false,
    confirmRemoteBypass: () => Promise.resolve(false),
    isConfidentialWorkspace: () => false,
    // The live cases' model is the contributor one: its one yes (M7), given.
    confirmContributor: () => Promise.resolve(true),
    runHostAction: () => Promise.resolve(),
    copyText: unreached,
    insertCode: unreached,
    onSandboxUnavailable: () => undefined,
    platform: process.platform,
    userProfileDir: undefined,
    shellSandbox: () => ({ isSandboxed: false, reason: 'setting' }),
    editorContext: () => undefined,
    isAutosaveEnabled: () => false,
    saveAll: () => Promise.resolve(),
    unsavedFiles: () => [],
    applyCode: unreached,
    editReview: { openDiff: unreached, revert: unreached },
    openDocument: unreached,
    openFile: unreached,
    readToolImage: unreached,
    ideMcpEndpoint: () => Promise.resolve(undefined),
    newAttachmentId: () => randomUUID(),
    sessions: {
      archivedIds: () => [],
      setArchivedIds: () => Promise.resolve(),
      lastSession: () => undefined,
      setLastSession: () => Promise.resolve(),
    },
    accountFacts: () => Promise.resolve({ signInMethod: 'apiKey' as const }),
    usageInsights: () => Promise.resolve(undefined),
    isRestorable: false,
    dictation: { isAvailable: false, reason: 'no microphone in the live sweep' },
    museVoice: () => undefined,
    exports: { saveMarkdown: unreached, saveSessionLog: unreached },
    plans: createPlanFiles({
      workspaceRoot: rig.workspace,
      platform: process.platform,
      io: createPlanIo({ log: rig.log, now: Date.now }),
      pick: unreached,
      confirm: () => Promise.resolve(true),
      // Built by `npm run build:dev`, as in activate: the plan reader's own bundle.
      markdown: planMarkdownLoader({
        bundlePath: path.join(process.cwd(), 'dist', PLAN_MARKDOWN_BUNDLE_FILE),
        log: rig.log,
      }),
    }),
    setPaidFeature: unreached,
    isWorkspaceTrusted: () => true,
    onForegroundTasksChanged: () => undefined,
    allowsPaidUse: () => Promise.resolve(false),
    forgetPaidUse: unreached,
    now: Date.now,
    log: rig.log,
  })
  holder.controller = controller
  return { controller, posted: surface.posted, allowed }
}

/** What the panel was told: its notices, for a failure's message. */
function panelNotices(panel: LivePanel): string {
  return JSON.stringify(
    panel.posted.flatMap((message) => (message.type === 'notice' ? [message.text] : [])),
  )
}

/** The panel's events of one kind, in order, from its `from`th message on. */
function panelEvents<T extends AgentEvent['type']>(
  panel: LivePanel,
  type: T,
  from = 0,
): readonly Extract<AgentEvent, { type: T }>[] {
  return panel.posted
    .slice(from)
    .flatMap((message) =>
      message.type === 'agentEvent' && message.event.type === type
        ? [message.event as Extract<AgentEvent, { type: T }>]
        : [],
    )
}

/** The turn the panel's message `localId` became, once finished, and its last reply. */
async function panelTurn(
  panel: LivePanel,
  localId: string,
): Promise<{ readonly terminal: string; readonly reply: ItemSnapshot | undefined }> {
  const turnId = await vi.waitFor(
    () => {
      const accepted = panel.posted.find(
        (message) => message.type === 'turnAccepted' && message.localId === localId,
      )
      if (accepted?.type !== 'turnAccepted') {
        throw new Error(`no turn for ${localId} yet; notices ${panelNotices(panel)}`)
      }
      return accepted.turnId
    },
    { timeout: TURN_MS, interval: 250 },
  )
  const completed = await vi.waitFor(
    () => {
      const found = panelEvents(panel, 'turnCompleted').find((event) => event.turnId === turnId)
      if (found === undefined) {
        throw new Error(`turn ${turnId} still running; notices ${panelNotices(panel)}`)
      }
      return found
    },
    { timeout: TURN_MS, interval: 250 },
  )
  const replies = panelEvents(panel, 'itemCompleted')
    .map((event) => event.item)
    .filter((item) => item.turnId === turnId && item.kind === 'agentMessage')
  return { terminal: completed.terminal, reply: replies.at(-1) }
}

// --- fixtures made in the test ---

function pngChunk(type: string, data: Uint8Array): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(typed))
  return Buffer.concat([size, typed, check])
}

/** A real PNG of one colour: 8-bit truecolour rows, filter 0, deflated. */
function solidPng(side: number, rgb: readonly [number, number, number]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(2, 9)
  const row = Buffer.from([0, ...Array.from({ length: side }, () => rgb).flat()])
  const pixels = Buffer.concat(Array.from({ length: side }, () => row))
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

/** A one-page PDF with one word set in Helvetica, cross-reference table and all. */
function wordPdf(word: string): Uint8Array {
  const content = `BT /F1 36 Tf 40 60 Td (${word}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let document = '%PDF-1.4\n'
  const starts: string[] = []
  for (const [index, object] of objects.entries()) {
    starts.push(`${String(document.length).padStart(10, '0')} 00000 n \n`)
    document += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  }
  const xref = document.length
  const size = String(objects.length + 1)
  document += `xref\n0 ${size}\n0000000000 65535 f \n${starts.join('')}`
  document += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(document)
}

// The code intelligence case's workspace (M67): one function, used twice.
const CODE_FILES = {
  'src/greet.ts': 'export function greet(name: string): string {\n  return `Hello, ${name}`\n}\n',
  'src/main.ts':
    "import { greet } from './greet'\n\nexport const pair = [greet('Ada'), greet('Grace')]\n",
}
const CODE_SYMBOL = 'greet'
const CODE_SYMBOL_USE = /\bgreet\b/g
// VS Code's `SymbolKind.Function`.
const FUNCTION_KIND = 11
// A quote that opens or closes a string literal in the case's files.
const QUOTE = /['"`]/g

/** Whether a column of a line is inside a string literal (the module path `'./greet'`). */
function isInString(line: string, column: number): boolean {
  return (line.slice(0, column).match(QUOTE)?.length ?? 0) % 2 === 1
}

/**
 * VS Code's language services live only in the extension host. A stand-in
 * that knows the case's one symbol answers from the files' text, so the
 * model uses the code intelligence tools against Meta's real API; the real
 * services' answers are the integration test's (test/integration).
 */
function textLanguageService(workspace: string): LanguageServiceHost {
  const fileOf = (name: string) => path.join(workspace, ...name.split('/'))
  const uses = (): CodeLocation[] =>
    Object.keys(CODE_FILES).flatMap((name) =>
      readFileSync(fileOf(name), 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          const found: CodeLocation[] = []
          for (const match of line.matchAll(CODE_SYMBOL_USE)) {
            // As TypeScript's service does, a name inside a string is no use of it.
            if (!isInString(line, match.index)) {
              found.push({
                path: fileOf(name),
                range: {
                  start: { line: index, character: match.index },
                  end: { line: index, character: match.index + CODE_SYMBOL.length },
                },
              })
            }
          }
          return found
        }),
    )
  const declaration = (): readonly CodeSymbol[] =>
    uses()
      .slice(0, 1)
      .map((location) => ({
        name: CODE_SYMBOL,
        kind: FUNCTION_KIND,
        detail: undefined,
        container: undefined,
        location,
        selection: location.range,
        children: [],
      }))
  return {
    open: (file) =>
      Promise.resolve({
        languageId: 'typescript',
        text: readFileSync(file, 'utf8'),
        isDirty: false,
      }),
    definitions: () => Promise.resolve(declaration().map((symbol) => symbol.location)),
    references: () => Promise.resolve(uses()),
    hover: () => Promise.resolve(['function greet(name: string): string']),
    documentSymbols: (file) =>
      Promise.resolve(file === fileOf('src/greet.ts') ? declaration() : []),
    workspaceSymbols: (query) => Promise.resolve(CODE_SYMBOL.includes(query) ? declaration() : []),
    callHierarchy: () => Promise.resolve(undefined),
    libraryRoots: () => [],
    rename: (_file, _at, newName) =>
      Promise.resolve({
        files: Object.keys(CODE_FILES).map((name) => ({
          path: fileOf(name),
          edits: uses()
            .filter((use) => use.path === fileOf(name))
            .map((use) => ({ range: use.range, newText: newName })),
        })),
        fileOperations: 'none',
      }),
  }
}

function isPngFile(file: string): boolean {
  try {
    return readFileSync(file).subarray(0, PNG_SIGNATURE.length).equals(Buffer.from(PNG_SIGNATURE))
  } catch {
    return false
  }
}

/** Windows' own speech synthesizer says the sentence into a 16 kHz 16-bit mono WAV. */
async function spokenWav(file: string, sentence: string): Promise<Buffer> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'try { $voice.SetOutputToWaveFile($env:MUSE_LIVE_WAV, $format); $voice.Speak($env:MUSE_LIVE_SENTENCE) } finally { $voice.Dispose() }',
  ].join('\n')
  const powershell = path.join(
    process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  await promisify(execFile)(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { env: { ...process.env, MUSE_LIVE_WAV: file, MUSE_LIVE_SENTENCE: sentence } },
  )
  return readFileSync(file)
}

/** The PCM of a WAV, its format checked to be what Muse Voice is sent. */
function wavPcm(wav: Buffer): Buffer {
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  let offset = 12
  let pcm: Buffer | undefined
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const chunk = wav.subarray(offset + 8, offset + 8 + size)
    if (id === 'fmt ') {
      expect({
        format: chunk.readUInt16LE(0),
        channels: chunk.readUInt16LE(2),
        rate: chunk.readUInt32LE(4),
        bits: chunk.readUInt16LE(14),
      }).toEqual({ format: 1, channels: 1, rate: MUSE_VOICE_SAMPLE_RATE, bits: 16 })
    } else if (id === 'data') {
      pcm = chunk
    }
    offset += 8 + size + (size % 2)
  }
  if (pcm === undefined) {
    throw new Error('the WAV has no data chunk')
  }
  return pcm
}

/** The microphone replaced by a recording: its PCM at real time, then the stop. */
function recordingCapture(pcm: Buffer): (listener: DictationListener) => DictationHandle {
  return (listener) => {
    let timer: ReturnType<typeof setInterval> | undefined
    let offset = 0
    const halt = (): void => {
      clearInterval(timer)
      timer = undefined
    }
    return {
      start: () => {
        listener.onStatus('listening')
        timer = setInterval(() => {
          const chunk = pcm.subarray(offset, offset + VOICE_CHUNK_BYTES)
          offset += chunk.length
          if (chunk.length > 0) {
            listener.onAudio?.(chunk)
          }
          if (offset < pcm.length) {
            return
          }
          halt()
          listener.onStopped?.()
          listener.onStatus('idle')
        }, VOICE_CHUNK_MS)
      },
      stop: () => {
        // The recording ends when the file does.
      },
      dispose: halt,
    }
  }
}

// --- the sweep ---

describe.skipIf(!IS_ENABLED)('live Model API sweep (MUSE_LIVE_MODEL_API=1)', () => {
  beforeAll(async () => {
    live.credentials = await loadEvalLiveCredentials(IS_ENABLED)
    vi.stubGlobal('fetch', meteredFetch)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    report(
      [
        ...summaries,
        `live modelapi total: ${String(wire.length)} requests, est. $${total(caseCosts).toFixed(4)}`,
      ].join('\n'),
    )
  })

  it(
    'case01 plain reply: the catalogue, a turn, and one with thinking off',
    async () => {
      const name = 'case01 plain reply'
      // 24h is the retention a user can choose (M56); every other case sends the default.
      await runCase(name, { promptCacheRetention: '24h' }, async (rig) => {
        const host = await rig.manager.ensureHost()
        const models = await host.listModels()
        expect(models.map((model) => model.modelId)).toContain(MODEL_ID)
        const driver = await startSession(rig)
        const finished = await send(driver, 'Reply with exactly the word OK and nothing else.')
        expectCompleted(finished)
        expect(finished.reply).toContain('OK')
        const second = await send(driver, 'Reply with exactly the word AGAIN and nothing else.')
        expectCompleted(second)
        expect(second.reply).toContain('AGAIN')
        await driver.session.setReasoningEffort(THINKING_OFF_EFFORT)
        const quick = await send(driver, 'Reply with exactly the word FAST and nothing else.')
        expectCompleted(quick)
        expect(quick.reply).toContain('FAST')
        const requests = callsOf(name).filter((call) => isBilledResponse(call))
        const sent = requests.map((call) => `${call.effort ?? '?'}/${call.retention ?? '?'}`)
        expect(sent).toEqual([
          `${DEFAULT_EFFORT}/24h`,
          `${DEFAULT_EFFORT}/24h`,
          `${MODEL_API_EFFORT_OFF}/24h`,
        ])
        rig.notes.push(
          `replies ${[finished, second, quick].map((turn) => JSON.stringify(turn.reply)).join(' ')}`,
          `effort/retention ${sent.join(' ')}`,
          `cached ${requests.map((call) => `${String(call.cachedTokens)}/${String(call.inputTokens)}`).join(' ')}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case02 tools: read, edit and a shell command, each through the Manual card',
    async () => {
      await runCase(
        'case02 tools',
        { files: { 'fruit.txt': 'My favourite pie is apple pie.\n' } },
        async (rig) => {
          const driver = await startSession(rig, 'promptUnmatched')
          const finished = await send(
            driver,
            'In fruit.txt, change the word apple to pear. Read it with read_file and change it with edit_file; do not use a shell. Then reply DONE.',
          )
          expectCompleted(finished)
          const text = readFileSync(path.join(rig.workspace, 'fruit.txt'), 'utf8')
          expect(text).toContain('pear')
          expect(text).not.toContain('apple')
          const tools = finished.rows.map((row) => row.tool)
          expect(tools).toContain('read_file')
          expect(tools.some((tool) => FILE_EDIT_TOOLS.has(tool ?? ''))).toBe(true)
          expect(driver.watch.approved.some((tool) => FILE_EDIT_TOOLS.has(tool))).toBe(true)
          // The shell tool (PowerShell here, in a job object of its own, M27).
          const shell = await send(
            driver,
            'Use your shell tool to run the command: echo SHELLOK. Then reply with exactly what it printed.',
          )
          expectCompleted(shell)
          const command = shell.rows.find((row) => SHELL_TOOLS.has(row.tool ?? ''))
          expect(command).toMatchObject({ status: 'completed' })
          expect(command?.visibleOutput).toContain('SHELLOK')
          expect(driver.watch.approved).toContain(command?.tool)
          expect(shell.reply).toContain('SHELLOK')
          rig.notes.push(
            `rows ${[...toolsRun(finished), ...toolsRun(shell)].join(' ')}`,
            `cards ${driver.watch.approved.join(' ')}`,
          )
        },
      )
    },
    CASE_MS,
  )

  it(
    'case03 replay: a second turn that needs the first (M42)',
    async () => {
      const name = 'case03 replay'
      await runCase(name, { files: { 'word.txt': 'BLUEBERRY\n' } }, async (rig) => {
        const driver = await startSession(rig)
        const first = await send(
          driver,
          'Read word.txt with read_file, then reply with exactly the word it contains and nothing else.',
        )
        expectCompleted(first)
        expect(first.rows.map((row) => row.tool)).toContain('read_file')
        const second = await send(
          driver,
          'What word did you just write? Reply with that word only.',
        )
        expectCompleted(second)
        expect(second.reply.toUpperCase()).toContain('BLUEBERRY')
        const last = callsOf(name).findLast((call) => isBilledResponse(call))
        expect(last?.status).toBe(HTTP_OK)
        expect(last?.inputKinds).toEqual(
          expect.arrayContaining(['reasoning', 'function_call', 'function_call_output']),
        )
        rig.notes.push(`replayed ${[...new Set(last?.inputKinds)].join(' ')}`)
      })
    },
    CASE_MS,
  )

  it(
    'case04 images: one attached, one read by read_file (M54)',
    async () => {
      const name = 'case04 image'
      const files = { 'blue.png': solidPng(IMAGE_SIDE, [0, 0, 255]) }
      await runCase(name, { files }, async (rig) => {
        const png = solidPng(IMAGE_SIDE, [255, 0, 0])
        const info = readImageInfo(png)
        expect(info).toEqual({ mediaType: 'image/png', width: IMAGE_SIDE, height: IMAGE_SIDE })
        const driver = await startSession(rig)
        const finished = await send(driver, [
          {
            type: 'text',
            text: 'What is the dominant colour of the attached image? Reply with one lowercase word.',
          },
          {
            type: 'image',
            base64Data: png.toString('base64'),
            mediaType: 'image/png',
            width: info?.width ?? 0,
            height: info?.height ?? 0,
          },
        ])
        expectCompleted(finished)
        expect(finished.reply.toLowerCase()).toContain('red')
        // A tool-read image follows the round's outputs in a user message (D47).
        const read = await send(
          driver,
          'Use read_file on blue.png, then reply with its dominant colour in one lowercase word.',
        )
        expectCompleted(read)
        expect(read.rows.map((row) => row.tool)).toContain('read_file')
        expect(read.reply.toLowerCase()).toContain('blue')
        expect(mediaAfterOutput(callsOf(name))).toContain('input_image')
        rig.notes.push(`replies ${JSON.stringify(finished.reply)} ${JSON.stringify(read.reply)}`)
      })
    },
    CASE_MS,
  )

  it(
    'case05 PDFs: one attached, one read by read_file (M54)',
    async () => {
      const name = 'case05 pdf'
      await runCase(name, { files: { 'second.pdf': wordPdf('TANGERINE') } }, async (rig) => {
        const pdf = wordPdf('MARIGOLD')
        expect(pdfPageCount(pdf)).toBe(1)
        const driver = await startSession(rig)
        const finished = await send(driver, [
          {
            type: 'text',
            text: 'What single word is printed in the attached PDF? Reply with that word only.',
          },
          {
            type: 'file',
            base64Data: Buffer.from(pdf).toString('base64'),
            mediaType: 'application/pdf',
            name: 'word.pdf',
            sizeBytes: pdf.length,
            pageCount: pdfPageCount(pdf),
          },
        ])
        expectCompleted(finished)
        expect(finished.reply.toUpperCase()).toContain('MARIGOLD')
        const read = await send(
          driver,
          'Use read_file on second.pdf, then reply with the single word printed in it and nothing else.',
        )
        expectCompleted(read)
        expect(read.rows.map((row) => row.tool)).toContain('read_file')
        expect(read.reply.toUpperCase()).toContain('TANGERINE')
        expect(mediaAfterOutput(callsOf(name))).toContain('input_file')
        rig.notes.push(`replies ${JSON.stringify(finished.reply)} ${JSON.stringify(read.reply)}`)
      })
    },
    CASE_MS,
  )

  it(
    'case06 goals: a goal set by the user wakes a turn that closes it (M45)',
    async () => {
      const name = 'case06 goals'
      await runCase(name, {}, async (rig) => {
        const driver = await startSession(rig)
        const { turnId } = await driver.session.controlGoal({
          verb: 'set',
          objective:
            'Call update_goal with status complete, then reply with exactly the word DONE.',
        })
        if (turnId === undefined) {
          throw new Error('setting an active goal woke no turn')
        }
        const finished = await driver.watch.finished(turnId)
        expectCompleted(finished)
        const request = callsOf(name).find((call) => isBilledResponse(call))
        expect(request?.status).toBe(HTTP_OK)
        expect(request?.tools).toEqual(
          expect.arrayContaining(['create_goal', 'get_goal', 'update_goal', 'report_progress']),
        )
        const goals = driver.watch.events.flatMap((event) =>
          event.type === 'goalChanged' ? [event.goal?.status ?? 'cleared'] : [],
        )
        expect(goals[0]).toBe('active')
        expect(goals.at(-1)).toBe('complete')
        rig.notes.push(`goal ${goals.join(' > ')}`, `rows ${toolsRun(finished).join(' ')}`)
      })
    },
    CASE_MS,
  )

  it(
    'case07 memory: a fact remembered where the memory store places it (M49)',
    async () => {
      await runCase('case07 memory', {}, async (rig) => {
        const finished = await send(
          await startSession(rig),
          'Use add_memory to save a note at path codename.md with this content: The project codename is HELIOTROPE. Then reply DONE.',
        )
        expectCompleted(finished)
        const row = finished.rows.find((candidate) => candidate.tool === 'add_memory')
        expect(row?.status).toBe('completed')
        const args = z
          .object({ path: z.string(), scope: z.optional(z.enum(MEMORY_SCOPES)) })
          .parse(parseJson(row?.args ?? ''))
        const place = await rig.memory.locate(args.scope ?? DEFAULT_MEMORY_SCOPE, args.path)
        if (!place.ok) {
          throw new Error(place.reason)
        }
        expect(place.value.absolute.startsWith(rig.root)).toBe(true)
        expect(readFileSync(place.value.absolute, 'utf8')).toContain('HELIOTROPE')
        const index = readFileSync(
          path.join(path.dirname(place.value.absolute), 'MEMORY.md'),
          'utf8',
        )
        expect(index).toContain(args.path)
        rig.notes.push(`note ${path.relative(rig.root, place.value.absolute)}`)
      })
    },
    CASE_MS,
  )

  it(
    'case08 MCP: a stdio server from Muse Code settings, its tool called (M50)',
    async () => {
      const job = fixtureJobLifecycle()
      await job.setup()
      try {
        await runCase(
          'case08 mcp',
          {
            settings: {
              mcpServers: { fixture: { command: process.execPath, args: [FAKE_MCP_SERVER] } },
            },
            mcpJobPath: job.path,
          },
          async (rig) => {
            const driver = await startSession(rig)
            const finished = await send(
              driver,
              'Call the echo tool of the fixture MCP server with the text LANTERN, then reply with exactly the text the tool returned.',
            )
            expectCompleted(finished)
            const echo = finished.rows.find((row) => row.tool?.endsWith('echo') === true)
            expect(echo?.status).toBe('completed')
            expect(echo?.visibleOutput).toContain('echo: LANTERN')
            expect(finished.reply).toContain('LANTERN')
            // A tool result with a picture goes back as function-output content (M50).
            const picture = await send(
              driver,
              'Call the picture tool of the fixture MCP server, then say in a few words what it returned.',
            )
            expectCompleted(picture)
            expect(picture.rows.find((row) => row.tool?.endsWith('picture') === true)?.status).toBe(
              'completed',
            )
            const last = callsOf('case08 mcp').findLast((call) => isBilledResponse(call))
            expect(last?.inputKinds).toContain('function_call_output[input_image]')
            rig.notes.push(
              `rows ${[...toolsRun(finished), ...toolsRun(picture)].join(' ')}`,
              `replies ${JSON.stringify(finished.reply)} ${JSON.stringify(picture.reply)}`,
            )
          },
        )
      } finally {
        await job.dispose()
      }
    },
    CASE_MS,
  )

  it(
    'case09 hooks: a UserPromptSubmit hook runs when trusted, never when not (M51)',
    async () => {
      // The hook leaves a marker and says a word, which reaches the model as context.
      const settings = {
        schema_version: 1,
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `echo hooked > ${HOOK_MARKER}; echo The hook word is ${HOOK_WORD}.`,
                  commandWindows: `echo hooked>${HOOK_MARKER}& echo The hook word is ${HOOK_WORD}.`,
                },
              ],
            },
          ],
        },
      }
      // Hook context is replayed as user-level text, unlabelled (M51), so the
      // prompt asks for the word, not for where it came from.
      const prompt =
        'What is the hook word? Reply with that word only, or with exactly NONE if you have not been told one.'
      for (const isTrusted of [true, false]) {
        await runCase(
          `case09 hooks ${isTrusted ? 'trusted' : 'untrusted'}`,
          { settings, hasHooks: true, isTrusted },
          async (rig) => {
            const finished = await send(await startSession(rig), prompt)
            expectCompleted(finished)
            const isMarked = readdirSync(rig.workspace).includes(HOOK_MARKER)
            expect(isMarked).toBe(isTrusted)
            expect(finished.reply).toContain(isTrusted ? HOOK_WORD : 'NONE')
            rig.notes.push(
              `marker ${isMarked ? 'written' : 'absent'}`,
              `reply ${JSON.stringify(finished.reply)}`,
            )
          },
        )
      }
    },
    CASE_MS,
  )

  it(
    'case10 subagents: a child task, its price accepted, runs and returns (M48)',
    async () => {
      await runCase('case10 subagents', { paid: ['subagents'] }, async (rig) => {
        const driver = await startSession(rig)
        const finished = await send(
          driver,
          'Use subagent_spawn to start one subagent with role "helper" and objective "Reply with exactly the word PONG and nothing else." Then call subagent_wait with its subagent_id, and finally reply with exactly the word the subagent replied.',
        )
        expectCompleted(finished)
        expect(driver.watch.approved).toContain('subagent_spawn')
        const child = driver.watch.events
          .flatMap((event) =>
            (event.type === 'itemUpdated' || event.type === 'itemCompleted') &&
            event.item.kind === 'subagent'
              ? [event.item]
              : [],
          )
          .findLast((item) => item.result !== undefined)
        expect(child?.result?.text ?? '').toContain('PONG')
        expect(finished.reply).toContain('PONG')
        expect(rig.usage.current.subagentRequests ?? 0).toBeGreaterThan(0)
        const childCalls = callsOf('case10 subagents').filter(
          (call) => isBilledResponse(call) && !call.tools.includes('subagent_spawn'),
        )
        expect(childCalls.length).toBeGreaterThan(0)
        rig.notes.push(
          `child ${child?.controlStatus ?? '?'} ${JSON.stringify(child?.result?.text)}`,
          `rows ${toolsRun(finished).join(' ')}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case11 web search: a search runs, is counted, and replays (M33)',
    async () => {
      const name = 'case11 web search'
      await runCase(name, { paid: ['webSearch'] }, async (rig) => {
        const driver = await startSession(rig)
        const finished = await send(
          driver,
          "What is today's date according to a web search? One line.",
        )
        expectCompleted(finished)
        const search = finished.rows.find((row) => row.tool === MODEL_API_WEB_SEARCH_TOOL)
        expect(search).toMatchObject({ status: 'completed', paid: 'webSearch' })
        expect(rig.usage.current.webSearches).toBeGreaterThan(0)
        expect(finished.reply.trim()).not.toBe('')
        // The search and any commentary before it go back in the next request.
        const again = await send(
          driver,
          'Without searching again, repeat the date you found as YYYY-MM-DD and nothing else.',
        )
        expectCompleted(again)
        expect(again.reply).toMatch(/\d{4}-\d{2}-\d{2}/)
        const last = callsOf(name).findLast((call) => isBilledResponse(call))
        expect(last?.inputKinds).toContain('web_search_call')
        rig.notes.push(
          `reply ${JSON.stringify(finished.reply)}`,
          `then ${JSON.stringify(again.reply)}`,
          `replayed ${[...new Set(last?.inputKinds)].join(' ')}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case12 images: one generated, then edited, each confirmed (M34, M44)',
    async () => {
      await runCase('case12 images', { paid: ['imageGeneration'] }, async (rig) => {
        const driver = await startSession(rig)
        const made = await send(
          driver,
          'Use generate_image with path circle.png and aspect square to make a flat red circle on a white background. Then reply DONE.',
        )
        expectCompleted(made)
        expect(isPngFile(path.join(rig.workspace, 'circle.png'))).toBe(true)
        const edited = await send(
          driver,
          'Use edit_image on circle.png to make the circle blue, saving the result as circle-blue.png. Then reply DONE.',
        )
        expectCompleted(edited)
        expect(isPngFile(path.join(rig.workspace, 'circle-blue.png'))).toBe(true)
        expect(driver.watch.approved).toEqual(
          expect.arrayContaining(['generate_image', 'edit_image']),
        )
        expect(rig.usage.current.images).toBe(2)
        rig.notes.push(`rows ${[...toolsRun(made), ...toolsRun(edited)].join(' ')}`)
      })
    },
    LONG_CASE_MS,
  )

  it(
    'case13 scheduled prompt: a /loop schedule run through its confirmed Run now (M52)',
    async () => {
      await runCase('case13 schedule', { paid: ['scheduledPrompts'] }, async (rig) => {
        const driver = await startSession(rig)
        const { schedules } = driver.session
        if (schedules === undefined) {
          throw new Error('the session offers no schedules')
        }
        const loop = parseLoopPrompt('/loop 1m Reply with exactly the word TICK and nothing else.')
        if (loop?.ok !== true || loop.command.verb !== 'create') {
          throw new Error('the /loop command did not parse')
        }
        const job = await schedules.create(loop.command.cadence, loop.command.prompt)
        // The panel's Run now needs the occurrence due, and the price accepted.
        await delay(Math.max(job.nextFireAtMs - Date.now(), 0) + SCHEDULE_MARGIN_MS)
        const submission = await schedules.run(job.id, job.nextFireAtMs, {
          sessionId: driver.session.sessionId,
          modelId: driver.session.modelId,
          prompt: job.prompt,
        })
        const finished = await driver.watch.finished(submission.turnId)
        expectCompleted(finished)
        expect(finished.reply).toContain('TICK')
        expect(finished.rows.find((row) => row.tool === MODEL_API_SCHEDULED_TOOL)).toMatchObject({
          paid: 'scheduledPrompts',
        })
        expect(rig.usage.current.scheduledRuns).toBe(1)
        expect(await schedules.cancel(job.id)).toBe(true)
        rig.notes.push(`reply ${JSON.stringify(finished.reply)}`)
      })
    },
    CASE_MS,
  )

  it.skipIf(process.platform !== 'win32')(
    'case14 Muse Voice: a spoken sentence streamed and transcribed (M35)',
    async () => {
      await runCase('case14 voice', { paid: ['voice'] }, async (rig) => {
        expect(rig.gate.isOn('voice')).toBe(true)
        const pcm = wavPcm(await spokenWav(path.join(rig.root, 'sentence.wav'), VOICE_SENTENCE))
        let dictation: MuseVoiceDictation | undefined
        const closed = Promise.withResolvers<undefined>()
        const transcript = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(
            () => {
              reject(new Error('no final transcript'))
            },
            VOICE_FINAL_MS + (pcm.length / MUSE_VOICE_BYTES_PER_SECOND) * 1000,
          )
          dictation = new MuseVoiceDictation(
            {
              createCapture: recordingCapture(pcm),
              openSocket: (url, handlers) => {
                const call: WireCall = {
                  caseName: running.caseName,
                  method: SOCKET_METHOD,
                  path: new URL(url).pathname,
                  model: undefined,
                  tools: [],
                  inputKinds: [],
                  effort: undefined,
                  retention: undefined,
                  status: 0,
                  inputTokens: 0,
                  cachedTokens: 0,
                  outputTokens: 0,
                  detail: undefined,
                }
                wire.push(call)
                return openWebSocket(url, {
                  onOpen: () => {
                    call.status = HTTP_SWITCHING_PROTOCOLS
                    handlers.onOpen()
                  },
                  onText: (text) => {
                    handlers.onText(text)
                  },
                  onClose: (code, reason) => {
                    call.status = code
                    call.detail = reason === '' ? undefined : scrub(reason)
                    handlers.onClose(code, reason)
                    closed.resolve(undefined)
                  },
                })
              },
              url: MUSE_VOICE_REALTIME_URL,
              apiKey: credentialsForLiveRun().apiKey,
              onSeconds: (seconds) => {
                rig.usage.add('voice', seconds)
              },
              log: rig.log,
            },
            {
              onStatus: () => {
                // The panel's microphone state; nothing to show here.
              },
              onText: (text) => {
                clearTimeout(timer)
                resolve(text)
              },
              onError: (reason) => {
                clearTimeout(timer)
                reject(new Error(reason))
              },
            },
          )
          dictation.start()
        })
        dictation?.dispose()
        // The socket's close, for the record: the stream closes it after the final text.
        await Promise.race([closed.promise, delay(SOCKET_CLOSE_WAIT_MS)])
        expect(transcript.toLowerCase()).toContain('quick')
        expect(transcript.toLowerCase()).toContain('fox')
        expect(rig.usage.current.voiceSeconds).toBeGreaterThan(0)
        rig.notes.push(`transcript ${JSON.stringify(transcript)}`)
      })
    },
    CASE_MS,
  )

  it(
    'case15 compaction: /compact after a tool call, and the next turn replays the summary',
    async () => {
      const name = 'case15 compaction'
      await runCase(name, { files: { 'note.txt': 'CINNAMON\n' } }, async (rig) => {
        const driver = await startSession(rig)
        const first = await send(
          driver,
          'Read note.txt with read_file, then reply with exactly the word it contains and nothing else.',
        )
        expectCompleted(first)
        expect(first.rows.map((row) => row.tool)).toContain('read_file')
        const outcome = await driver.session.compact()
        expect(outcome).toMatchObject({ status: 'accepted' })
        expect(driver.watch.items().some((item) => item.kind === 'compaction')).toBe(true)
        // The summary call replays the tool call and its output with no tools offered.
        const summary = callsOf(name).findLast((call) => isBilledResponse(call))
        expect(summary?.tools).toEqual([])
        expect(summary?.inputKinds).toContain('function_call')
        const after = await send(
          driver,
          'What word did note.txt contain? Reply with that word only, without reading it again.',
        )
        expectCompleted(after)
        expect(after.reply.toUpperCase()).toContain('CINNAMON')
        rig.notes.push(
          `summary request replayed ${[...new Set(summary?.inputKinds)].join(' ')}`,
          `reply after ${JSON.stringify(after.reply)}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case16 resume and rewind: a stored session in a new window, a fork and a side chat (D14, M53)',
    async () => {
      await runCase('case16 resume', { files: { 'word.txt': 'SAFFRON\n' } }, async (rig) => {
        const first = await startSession(rig)
        const opened = await send(
          first,
          'Read word.txt with read_file, then reply with exactly the word it contains and nothing else.',
        )
        expectCompleted(opened)
        const { sessionId } = first.session
        // The window closes (its saves are flushed); another opens on the same storage.
        await rig.manager.dispose()
        const host = await rig.openWindow().ensureHost()
        const resumed = await host.resumeSession(sessionId, MODEL_ID)
        expect(JSON.stringify(resumed.history)).toContain('SAFFRON')
        const again = await send(
          watched(rig, resumed.session),
          'What word did you write? Reply with that word only.',
        )
        expectCompleted(again)
        expect(again.reply.toUpperCase()).toContain('SAFFRON')
        // Rewind to the first turn: a fork that keeps it and drops the second.
        const fork = await host.forkSession(sessionId, MODEL_ID, opened.turn.turnId)
        const forked = await send(
          watched(rig, fork.session),
          'Repeat the word you wrote first, in lowercase, and nothing else.',
        )
        expectCompleted(forked)
        expect(forked.reply.toLowerCase()).toContain('saffron')
        const side = await host.forkSession(sessionId, MODEL_ID, undefined, { sideChat: true })
        const aside = await send(
          watched(rig, side.session),
          'In one word: what word did word.txt contain?',
        )
        expectCompleted(aside)
        expect(aside.reply.toUpperCase()).toContain('SAFFRON')
        rig.notes.push(
          `replies ${[again, forked, aside].map((turn) => JSON.stringify(turn.reply)).join(' ')}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case17 workspace context: the rules file and a project skill (D13, M10)',
    async () => {
      const files = {
        'AGENTS.md': `# Project rules\n\nEnd every reply with the word ${RULES_WORD} on a line of its own.\n`,
        '.agents/skills/shout/SKILL.md':
          '---\nname: shout\ndescription: Repeat the given word in capital letters.\n---\nReply with the argument in capital letters, then follow the project rules.\n',
      }
      await runCase('case17 context', { files }, async (rig) => {
        const driver = await startSession(rig)
        const skills = await driver.session.listSkills()
        expect(skills.map((skill) => skill.selector)).toContain('shout')
        const ruled = await send(driver, 'Reply with the word hello.')
        expectCompleted(ruled)
        expect(ruled.reply).toContain(RULES_WORD)
        const skilled = await send(driver, [
          { type: 'skill', selector: 'shout', arguments: 'papaya' },
        ])
        expectCompleted(skilled)
        expect(skilled.reply).toContain('PAPAYA')
        rig.notes.push(`replies ${JSON.stringify(ruled.reply)} ${JSON.stringify(skilled.reply)}`)
      })
    },
    CASE_MS,
  )

  it(
    'case21 verify loop: then_run, the automatic check and the diagnostics after an edit (M68)',
    async () => {
      const name = 'case21 verify loop'
      // The check reads the file it is given after --, or value.txt, and
      // fails while it still says BROKEN.
      const files = {
        'value.txt': 'BROKEN\n',
        'check.js': [
          "const fs = require('fs')",
          "const file = process.argv[3] ?? 'value.txt'",
          "if (!fs.readFileSync(file, 'utf8').includes('FIXED')) {",
          "  console.log(file + ' still says BROKEN')",
          '  process.exit(1)',
          '}',
          "console.log('CHECKOK ' + file)",
          '',
        ].join('\n'),
      }
      const checks: readonly CheckCommandSetting[] = [
        { name: 'check', command: 'node check.js', changedFiles: true, timeoutSeconds: 60 },
      ]
      // No language server runs here: the stand-in reports an error while
      // the file says BROKEN, as one would.
      const verify: VerifyHooks = {
        isDiagnosticsOn: () => true,
        checkCommands: () => checks,
        isFormatOnEdit: () => false,
        diagnosticsAfterEdit: (edited) =>
          Promise.resolve(
            edited.map((file) => ({
              file,
              entries: readFileSync(file.absolute, 'utf8').includes('BROKEN')
                ? [
                    {
                      path: file.relative,
                      severity: 'error' as const,
                      line: 1,
                      column: 1,
                      message: 'The value is still BROKEN.',
                      source: 'live',
                    },
                  ]
                : [],
            })),
          ),
        formatAfterEdit: () => Promise.resolve(undefined),
      }
      await runCase(name, { files, verify }, async (rig) => {
        // Auto: the edit runs, each command asks, and the answerer allows it once.
        const driver = await startSession(rig)
        const finished = await send(
          driver,
          'In value.txt, replace the word BROKEN with FIXED using edit_file, and set its then_run to: node check.js. Then reply DONE.',
        )
        expectCompleted(finished)
        expect(readFileSync(path.join(rig.workspace, 'value.txt'), 'utf8')).toContain('FIXED')
        const checked = finished.rows.find((row) => row.tool === 'verify_edits')
        expect(checked?.verifySummary).toEqual({
          files: ['value.txt'],
          errors: 0,
          warnings: 0,
          checks: [{ name: 'check', outcome: 'passed' }],
        })
        const requests = callsOf(name).filter((call) => isBilledResponse(call))
        expect(requests[0]?.tools).toEqual(expect.arrayContaining(['run_checks', 'edit_file']))
        // The request after the edit round (the model may read first): the
        // round's outputs, then the check as a note, and Meta took it.
        const afterEdit = requests.filter(
          (call) =>
            call.inputKinds.at(-2) === 'function_call_output' &&
            call.inputKinds.at(-1) === 'message:user',
        )
        expect(afterEdit).toHaveLength(1)
        expect(afterEdit[0]?.status).toBe(HTTP_OK)
        const edit = finished.rows.find((row) => row.tool === 'edit_file')
        rig.notes.push(
          `requests ${requests.map((call) => call.inputKinds.slice(-2).join('+')).join(' | ')}`,
          `rows ${toolsRun(finished).join(' ')}`,
          `then_run ${edit?.thenRun === undefined ? 'not used' : `${edit.thenRun.outcome} ${JSON.stringify(edit.thenRun.output)}`}`,
          `cards ${driver.watch.approved.join(' ')}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case18 a question, and Stop while a card is open, then the next turn (M16, D26)',
    async () => {
      const name = 'case18 question and stop'
      await runCase(name, {}, async (rig) => {
        const driver = await startSession(rig, 'promptUnmatched')
        const asked = await send(
          driver,
          'Use the ask_user tool to ask me one question: which colour I prefer, red or blue. Then reply with one sentence about my answer.',
        )
        expectCompleted(asked)
        expect(driver.watch.events.find((event) => event.type === 'questionSettled')).toMatchObject(
          { outcome: 'clarified' },
        )
        driver.watch.onCard = 'stop'
        const stopped = await send(
          driver,
          'Use your shell tool to run the command: echo STOPPED. Then reply DONE.',
        )
        expect(stopped.turn.terminal).toBe('cancelled')
        expect(driver.watch.stopped.some((tool) => SHELL_TOOLS.has(tool))).toBe(true)
        driver.watch.onCard = 'allow'
        const resumed = await send(driver, 'Reply with exactly the word RESUMED and nothing else.')
        expectCompleted(resumed)
        expect(resumed.reply).toContain('RESUMED')
        // The stopped call went back with an output, or this request would be a 400.
        const last = callsOf(name).findLast((call) => isBilledResponse(call))
        expect(last?.inputKinds).toEqual(
          expect.arrayContaining(['function_call', 'function_call_output']),
        )
        rig.notes.push(
          `rows ${[...toolsRun(asked), ...toolsRun(stopped)].join(' ')}`,
          `replies ${JSON.stringify(asked.reply)} ${JSON.stringify(resumed.reply)}`,
        )
      })
    },
    CASE_MS,
  )

  it(
    'case20 plans as files: through the panel’s controller, a Plan-mode reply saved byte for byte, then implemented in a fresh conversation with its steps as the todo list (M79)',
    async () => {
      const name = 'case20 plans'
      await runCase(name, {}, async (rig) => {
        const panel = livePanel(rig)
        const { controller } = panel
        try {
          await controller.handle({ type: 'setPermissionMode', mode: 'plan' })
          await controller.handle({
            type: 'sendMessage',
            localId: 'plan-1',
            text: 'Plan how to create a file named hello.txt that contains the single word hi. Give the plan as exactly two numbered steps. Only the plan; do not carry it out.',
            attachmentIds: [],
          })
          const planned = await panelTurn(panel, 'plan-1')
          expect(planned.terminal).toBe('completed')
          const reply = planned.reply
          expect(reply?.text?.trim()).toBeTruthy()
          const sessionInfo = panel.posted.findLast((message) => message.type === 'sessionInfo')
          const sourceSessionId =
            sessionInfo?.type === 'sessionInfo' ? String(sessionInfo.sessionId) : ''
          const itemId = String(reply?.itemId)
          // Save plan: the file holds the reply's plan, byte for byte.
          await controller.handle({ type: 'savePlan', sourceSessionId, itemId })
          const plansFolder = path.join(rig.workspace, '.agents', 'plans')
          const saved = readdirSync(plansFolder)
          expect(saved, panelNotices(panel)).toHaveLength(1)
          const relativePath = `.agents/plans/${String(saved[0])}`
          const text = planBody(String(reply?.text))
          expect(readFileSync(path.join(plansFolder, String(saved[0])), 'utf8')).toBe(text)
          // Implement: the same file found (no second one), a fresh conversation in Manual.
          await controller.handle({ type: 'implementPlan', sourceSessionId, itemId })
          expect(readdirSync(plansFolder)).toEqual(saved)
          const brief = panel.posted.find((message) => message.type === 'briefSubmitted')
          expect(brief?.type === 'briefSubmitted' && brief.text, panelNotices(panel)).toBe(
            fill(UI_TEXT.planBriefText, { path: relativePath }),
          )
          const localId = brief?.type === 'briefSubmitted' ? brief.localId : ''
          const built = await panelTurn(panel, localId)
          expect(built.terminal).toBe('completed')
          expect(readFileSync(path.join(rig.workspace, 'hello.txt'), 'utf8').trim()).toBe('hi')
          const modes = panel.posted.flatMap((message) =>
            message.type === 'composerState' ? [message.permissionMode] : [],
          )
          expect(modes.at(-1)).toBe('manual')
          const briefAt = brief === undefined ? 0 : panel.posted.indexOf(brief)
          const lists = panelEvents(panel, 'todoChanged', briefAt).map((event) =>
            event.items.map((item) => item.status).join(','),
          )
          // The new conversation's first list is the plan's steps, set before the brief went.
          expect(lists[0]).toBe(
            listItems(text)
              .map(() => PLAN_TODO_PENDING_STATUS)
              .join(','),
          )
          rig.notes.push(
            `plan ${relativePath} (${String(listItems(text).length)} steps)`,
            `todo lists ${lists.join(' | ')}`,
            `cards allowed ${panel.allowed.join(' ')}`,
          )
        } finally {
          controller.dispose()
        }
      })
    },
    CASE_MS,
  )

  it(
    'case19 code intelligence: references, then a rename through its card (M67, D49)',
    async () => {
      const options = { files: CODE_FILES, codeIntel: textLanguageService }
      await runCase('case19 code intelligence', options, async (rig) => {
        const driver = await startSession(rig, 'promptUnmatched')
        const finished = await send(
          driver,
          'Use the find_references tool on the symbol greet to see where it is used, then use the rename_symbol tool to rename greet to welcome. Reply with how many references find_references listed.',
        )
        expectCompleted(finished)
        const rows = toolsRun(finished)
        expect(rows).toContain('find_references:completed')
        expect(rows).toContain('rename_symbol:completed')
        expect(driver.watch.approved).toContain('rename_symbol')
        // The import names the new function; its module path is unchanged.
        expect(readFileSync(path.join(rig.workspace, 'src', 'main.ts'), 'utf8')).toBe(
          "import { welcome } from './greet'\n\nexport const pair = [welcome('Ada'), welcome('Grace')]\n",
        )
        rig.notes.push(`rows ${rows.join(' ')}`, `reply ${JSON.stringify(finished.reply)}`)
      })
    },
    CASE_MS,
  )
})
