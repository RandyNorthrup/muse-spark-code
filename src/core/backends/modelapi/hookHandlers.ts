import type { UsdAmount } from '../../../shared/usd'
// The M91 hook handler types (PLAN.md D70, lane H): `http`, `mcp_tool`,
// `prompt` and `agent`. `command` stays in hooks.ts, exactly as today.
//
// Every handler's answer is parsed like a command's (the caller lends
// `parseAnswer`): it can only refuse, narrow or add context — never grant,
// never widen. A handler whose runner is absent, or whose guards refuse it,
// is skipped with a warning, the same fail-closed shape as a command whose
// runner is unavailable.
//
// This module never imports hooks.ts, and hooks.ts is its only importer, so
// no dependency cycle can form. Boundary shapes are structural on purpose.

import { Buffer } from 'node:buffer'
import { isIP } from 'node:net'
import {
  HOOK_HTTP_ALLOWLIST_ENTRY_MAX_CHARS,
  HOOK_IP_V4_FAMILY,
  HOOK_IP_V6_FAMILY,
  HOOK_HTTP_REDIRECT_MIN_STATUS,
  HTTP_STATUS,
  HOOK_HTTP_URL_MAX_CHARS,
  HOOK_MODEL_TEXT,
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  UI_TEXT,
  WEB_FETCH_USER_AGENT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { modelApiPaidTier, type SubagentUsage } from '../../../shared/paid'

/** The handler kinds a hook file may name; `command` runs in hooks.ts. */
export type HookHandlerType = 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent'

/** The wire answer every handler returns, parsed like a command's. */
export interface TypedHookAnswer {
  readonly status: 'completed' | 'blocked' | 'failed'
  readonly reason?: string | undefined
  readonly context?: string | undefined
  readonly systemMessage?: string | undefined
  readonly permissionDecision?: 'deny' | 'ask' | 'allow' | undefined
  readonly updatedInput?: Record<string, unknown> | undefined
  readonly stopReason?: string | undefined
  readonly approvalDecision?: 'allow' | 'deny' | undefined
}

/** One handler's configuration, as hooks.ts parsed it. */
export interface TypedHandlerConfig {
  readonly type: Exclude<HookHandlerType, 'command'>
  /** The hook event it runs on, e.g. `PreToolUse`. */
  readonly event: string
  readonly source: 'managed' | 'user' | 'project'
  /** `http`: the configured URL. */
  readonly httpUrl?: string | undefined
  /** `mcp_tool`: the configured server and tool names. */
  readonly mcpServer?: string | undefined
  readonly mcpTool?: string | undefined
  /** `prompt` and `agent`: the configured model prompt. */
  readonly modelPrompt?: string | undefined
}

/** What the host's pinned HTTP path answers with. */
export interface HookHttpResult {
  readonly status: number
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly bodyText: string
}

/**
 * One POST of the bounded hook payload, through the existing pinned-request
 * path (src/host/web/pinnedRequest.ts): HTTPS to the pinned address, no
 * redirects followed. Fixed headers only: no credential name ever becomes a
 * header.
 */
export type HookHttpPost = (
  url: string,
  body: string,
  signal: AbortSignal,
) => Promise<HookHttpResult>

/** The fixed headers an http hook sends: nothing configured, nothing secret. */
export function hookHttpHeaders(): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': WEB_FETCH_USER_AGENT,
  }
}

/** The runners the host lends per handler type; each is optional. */
export interface HookHandlerRunners {
  readonly httpPost?: HookHttpPost | undefined
  readonly callMcpTool?: HookMcpCall | undefined
  readonly runModelTurn?: HookModelTurnRunner | undefined
  /**
   * `runTypedHandler` itself, lent from the hook runtime's bundle
   * (dist/hookRuntime.js, M91) so dist/modelApi.js does not carry the
   * runners. Absent, a typed handler is skipped with a warning.
   */
  readonly runTyped?: typeof runTypedHandler | undefined
}

/** One prompt/agent handler's own model call: its answer text and billable use. */
export interface HookModelTurn {
  readonly text: string
  readonly usage: SubagentUsage
}

/** Shared daily-budget owner supplied by the defaults lane; absent in this tree. */
export interface HookModelDailyBudget {
  readonly capUsd: () => UsdAmount
  readonly reserve: (
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    signal: AbortSignal,
  ) => Promise<{
    readonly check: () => void
    readonly settle: (costUsd: UsdAmount, isUnknown: boolean) => Promise<void>
  }>
}

/**
 * One model call with the hook's prompt and payload, hooks off, one attempt,
 * no retry. `agent` gets the read-only tools (read, grep, list, code
 * intelligence); `prompt` gets none. Never billed to the subscription.
 */
export type HookModelTurnRunner = (
  input: { readonly kind: 'prompt' | 'agent'; readonly system: string; readonly user: string },
  signal: AbortSignal,
) => Promise<HookModelTurn>

/** The paid gate around a prompt/agent run, re-read at every run. */
export interface HookModelPolicy {
  /** Whether `museSpark.modelApiHookModels` is on (the kill switch). */
  readonly isHookModelsOn: () => boolean
  /** The paid-use popup (M58, D48): true when this run may be billed. */
  readonly allowsHookModelUse: (request: {
    readonly event: string
    readonly kind: 'prompt' | 'agent'
    readonly modelId: string
  }) => Promise<boolean>
  /** Counts the run on the hookModels tally line. */
  readonly noteHookModelRun: () => void
  /** Settles the run's reported use into tokens and cost. */
  readonly noteHookModelUsage?:
    ((modelId: string, usage: HookModelTurn['usage']) => void) | undefined
  /** The conversation's model, which the run uses. */
  readonly modelId: string
}

/** What the host's MCP tool call answers: found and called, missing, or not approved. */
export type HookMcpOutcome =
  | { readonly kind: 'called'; readonly text: string; readonly isError: boolean }
  | { readonly kind: 'missing' }
  | { readonly kind: 'denied' }

/**
 * One call of the hook's tool on its configured MCP server, through that
 * tool's own approval path (the policy judgement, the trust check and the
 * approval card are the tool's own). Helper calls fire no hooks and skip the
 * Auto reviewer, so a hook can never approve or review itself into a loop.
 * The hook's event payload, a JSON object, is the tool's arguments.
 */
export type HookMcpCall = (
  server: string,
  tool: string,
  argsJson: string,
  signal: AbortSignal,
) => Promise<HookMcpOutcome>

/**
 * What a typed handler may read: the allowlist setting and the window's
 * network posture, both re-read at every run.
 */
export interface HookHandlerPolicy {
  /** `museSpark.hookHttpAllowedHosts`, as the settings reader validated it. */
  readonly httpAllowlist: () => readonly string[]
  /** Whether the window's network posture allows the network now. */
  readonly isNetworkAllowed: () => boolean
}

/**
 * Everything a typed handler needs: its runners and its policy. Absent
 * runners skip the handler with a warning, exactly like a command whose
 * runner is unavailable.
 */
export interface TypedHookHandlers
  extends HookHandlerRunners, HookHandlerPolicy, Partial<HookModelPolicy> {}

/** A command answer parser, lent by hooks.ts so answers parse identically. */
export type HookAnswerParser = (
  event: string,
  exitCode: number | null,
  stdout: string,
  stderr: string,
) => TypedHookAnswer

/** The hook events a prompt or agent handler may run on (D70, Claude's set). */

function normalizedHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '')
}

function normalizedEntry(entry: string): string {
  return entry.trim().toLowerCase()
}

/** Whether the host is an IP literal loopback (`127.0.0.0/8` or `::1`). */
export function isLoopbackLiteral(host: string): boolean {
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const family = isIP(literal)
  return family === HOOK_IP_V4_FAMILY
    ? literal.split('.', 1)[0] === '127'
    : family === HOOK_IP_V6_FAMILY && literal === '::1'
}

/** Whether the host is any IP literal at all. */
function isIpLiteral(host: string): boolean {
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return isIP(literal) !== 0
}

/**
 * The http allowlist match (D70, lane-common binding): exact hosts, or
 * `*.example.com` for subdomains only (never the bare domain). No IP
 * literals except loopback, which still needs its own exact entry: with an
 * empty allowlist, no http hook runs.
 */
export function isHttpHostAllowed(host: string, allowlist: readonly string[]): boolean {
  const name = normalizedHost(host)
  if (name === '') {
    return false
  }
  if (isIpLiteral(name)) {
    return isLoopbackLiteral(name) && allowlist.some((entry) => normalizedEntry(entry) === name)
  }
  for (const raw of allowlist) {
    const entry = normalizedEntry(raw)
    if (entry === '' || entry.length > HOOK_HTTP_ALLOWLIST_ENTRY_MAX_CHARS) {
      continue
    }
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2)
      if (suffix !== '' && !isIpLiteral(suffix) && name.endsWith(`.${suffix}`)) {
        return true
      }
      continue
    }
    if (entry === name && !entry.includes('*')) {
      return true
    }
  }
  return false
}

/** Whether the status is a redirect: none is ever followed. */
function isRedirect(status: number): boolean {
  return status >= HOOK_HTTP_REDIRECT_MIN_STATUS && status < HTTP_STATUS.badRequest
}

/** Whether the status carries an answer body. */
function isAnswer(status: number): boolean {
  return status >= HTTP_STATUS.ok && status < HOOK_HTTP_REDIRECT_MIN_STATUS
}

function failed(reason: string): TypedHookAnswer {
  return { status: 'failed', reason }
}

/**
 * Runs one `http` handler: user scope only, HTTPS only, an allowlisted host,
 * only while the network posture allows, no redirects, the same bounded
 * payload and answer schema as a command, and fixed headers. Anything else
 * fails the handler with a warning, never widening.
 */
export async function runHttpHandler(
  config: TypedHandlerConfig,
  payloadJson: string,
  runners: HookHandlerRunners,
  policy: HookHandlerPolicy,
  signal: AbortSignal,
  warn: (message: string) => void,
  parseAnswer: HookAnswerParser,
): Promise<TypedHookAnswer> {
  if (config.source !== 'user') {
    warn(UI_TEXT.hookHttpProjectRefused)
    return failed(UI_TEXT.hookHttpProjectRefused)
  }
  const rawUrl = config.httpUrl ?? ''
  if (rawUrl === '' || rawUrl.length > HOOK_HTTP_URL_MAX_CHARS) {
    warn(`${config.event}: http hook has an invalid url`)
    return failed('http hook has an invalid url')
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    warn(`${config.event}: http hook has an invalid url`)
    return failed('http hook has an invalid url')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    warn(UI_TEXT.hookHttpSchemeRefused)
    return failed(UI_TEXT.hookHttpSchemeRefused)
  }
  if (!policy.isNetworkAllowed()) {
    warn(UI_TEXT.hookHttpNetworkRefused)
    return failed(UI_TEXT.hookHttpNetworkRefused)
  }
  const host = normalizedHost(url.hostname)
  if (!isHttpHostAllowed(host, policy.httpAllowlist())) {
    const reason = fill(UI_TEXT.hookHttpHostRefused, { host })
    warn(reason)
    return failed(reason)
  }
  if (Buffer.byteLength(payloadJson) > HOOK_STDIN_MAX_BYTES) {
    warn(`${config.event}: http hook input exceeds limit; the hook was not sent`)
    return failed('http hook input exceeds limit')
  }
  const post = runners.httpPost
  if (post === undefined) {
    warn(`${config.event}: http hook runner is unavailable`)
    return failed('http hook runner is unavailable')
  }
  let result: HookHttpResult
  try {
    result = await post(url.href, payloadJson, signal)
  } catch (error: unknown) {
    if (signal.aborted) {
      throw error
    }
    warn(`${config.event}: http hook request failed`)
    return failed('http hook request failed')
  }
  if (isRedirect(result.status)) {
    const location = result.headers['location'] ?? ''
    let target = host
    try {
      if (location !== '') {
        target = normalizedHost(new URL(location, url.href).hostname)
      }
    } catch {
      // The request's own host names the refusal when Location is unreadable.
    }
    const reason = fill(UI_TEXT.hookHttpRedirectRefused, { host: target })
    warn(reason)
    return failed(reason)
  }
  if (!isAnswer(result.status)) {
    warn(`${config.event}: http hook answered ${String(result.status)}`)
    return failed(`http hook answered ${String(result.status)}`)
  }
  return parseAnswer(config.event, 0, result.bodyText.slice(0, HOOK_OUTPUT_MAX_BYTES), '')
}

/**
 * Runs one typed handler. Undefined skips it with no onFailure, like a
 * command whose runner is unavailable; a failed answer may run the hook's
 * onFailure command, like a failed command.
 */
export async function runTypedHandler(
  config: TypedHandlerConfig,
  payloadJson: string,
  handlers: TypedHookHandlers | undefined,
  signal: AbortSignal,
  warn: (message: string) => void,
  parseAnswer: HookAnswerParser,
): Promise<TypedHookAnswer | undefined> {
  if (handlers === undefined) {
    warn(`${config.event}: ${config.type} hook runner is unavailable`)
    return undefined
  }
  if (config.type === 'http') {
    if (handlers.httpPost === undefined) {
      warn(`${config.event}: http hook runner is unavailable`)
      return undefined
    }
    return await runHttpHandler(config, payloadJson, handlers, handlers, signal, warn, parseAnswer)
  }
  if (config.type === 'mcp_tool') {
    if (handlers.callMcpTool === undefined) {
      warn(`${config.event}: mcp_tool hook runner is unavailable`)
      return undefined
    }
    return await runMcpToolHandler(
      config,
      payloadJson,
      handlers.callMcpTool,
      signal,
      warn,
      parseAnswer,
    )
  }
  {
    if (
      handlers.runModelTurn === undefined ||
      handlers.isHookModelsOn === undefined ||
      handlers.allowsHookModelUse === undefined ||
      handlers.noteHookModelRun === undefined ||
      handlers.modelId === undefined
    ) {
      warn(`${config.event}: ${config.type} hook runner is unavailable`)
      return undefined
    }
    return await runModelHandler(
      config,
      payloadJson,
      handlers.runModelTurn,
      {
        isHookModelsOn: handlers.isHookModelsOn,
        allowsHookModelUse: handlers.allowsHookModelUse,
        noteHookModelRun: handlers.noteHookModelRun,
        ...(handlers.noteHookModelUsage !== undefined && {
          noteHookModelUsage: handlers.noteHookModelUsage,
        }),
        modelId: handlers.modelId,
      },
      signal,
      warn,
      parseAnswer,
    )
  }
}

/**
 * Runs one `prompt` or `agent` handler: the paid gate first, then one model
 * call, then the answer parsed like a command's. The gate (kill switch),
 * the price check and the paid-use popup all run before any model request;
 * a refused or denied run never reaches the model. The run is tallied on
 * the hookModels line, apart from the conversation.
 */
export async function runModelHandler(
  config: TypedHandlerConfig,
  payloadJson: string,
  runTurn: HookModelTurnRunner,
  policy: HookModelPolicy,
  signal: AbortSignal,
  warn: (message: string) => void,
  parseAnswer: HookAnswerParser,
): Promise<TypedHookAnswer> {
  const kind = config.type
  if (kind !== 'prompt' && kind !== 'agent') {
    throw new Error('a model handler is prompt or agent')
  }
  if (!policy.isHookModelsOn()) {
    warn(UI_TEXT.hookModelPaidOff)
    return { status: 'blocked', reason: UI_TEXT.hookModelPaidOff }
  }
  const modelId = policy.modelId
  if (modelApiPaidTier(modelId) === undefined) {
    warn(`${config.event}: ${kind} hook model has no verified price`)
    return { status: 'blocked', reason: UI_TEXT.subagentTariffUnknown }
  }
  const prompt = config.modelPrompt ?? ''
  if (prompt === '') {
    warn(`${config.event}: ${kind} hook has no prompt`)
    return failed(`${kind} hook has no prompt`)
  }
  if (Buffer.byteLength(payloadJson) > HOOK_STDIN_MAX_BYTES) {
    warn(`${config.event}: ${kind} hook input exceeds limit; the model was not asked`)
    return failed(`${kind} hook input exceeds limit`)
  }
  const isAllowed = await policy.allowsHookModelUse({ event: config.event, kind, modelId })
  if (!isAllowed) {
    warn(`${config.event}: ${kind} hook run was not allowed`)
    return failed(`${kind} hook run was not allowed`)
  }
  signal.throwIfAborted()
  if (!policy.isHookModelsOn()) {
    return { status: 'blocked', reason: UI_TEXT.hookModelPaidOff }
  }
  policy.noteHookModelRun()
  let turn: HookModelTurn
  try {
    turn = await runTurn(
      {
        kind,
        system: `${kind === 'agent' ? HOOK_MODEL_TEXT.hookAgentRole : HOOK_MODEL_TEXT.hookPromptRole} ${HOOK_MODEL_TEXT.hookAnswer}`,
        user: `${prompt}\n\n${payloadJson}`,
      },
      signal,
    )
  } catch (error: unknown) {
    if (signal.aborted) {
      throw error
    }
    warn(`${config.event}: ${kind} hook model call failed`)
    return failed(`${kind} hook model call failed`)
  }
  policy.noteHookModelUsage?.(modelId, turn.usage)
  const text = turn.text.slice(0, HOOK_OUTPUT_MAX_BYTES)
  return parseAnswer(config.event, 0, text, '')
}

/**
 * Runs one `mcp_tool` handler: the tool on its configured MCP server,
 * through that tool's own approval path. A tool that is not offered, or one
 * the user does not approve, fails the handler with a warning: it never
 * widens. The answer parses like a command's.
 */
export async function runMcpToolHandler(
  config: TypedHandlerConfig,
  payloadJson: string,
  call: HookMcpCall,
  signal: AbortSignal,
  warn: (message: string) => void,
  parseAnswer: HookAnswerParser,
): Promise<TypedHookAnswer> {
  const server = config.mcpServer ?? ''
  const tool = config.mcpTool ?? ''
  if (server === '' || tool === '') {
    warn(`${config.event}: mcp_tool hook names no server or tool`)
    return failed('mcp_tool hook names no server or tool')
  }
  let outcome: HookMcpOutcome
  try {
    outcome = await call(server, tool, payloadJson, signal)
  } catch (error: unknown) {
    if (signal.aborted) {
      throw error
    }
    warn(`${config.event}: mcp_tool hook call failed`)
    return failed('mcp_tool hook call failed')
  }
  if (outcome.kind === 'missing') {
    const reason = fill(UI_TEXT.hookMcpToolMissing, { tool: `${server}/${tool}` })
    warn(reason)
    return failed(reason)
  }
  if (outcome.kind === 'denied') {
    warn(`${config.event}: mcp_tool hook call was not approved`)
    return failed('mcp_tool hook call was not approved')
  }
  return parseAnswer(
    config.event,
    outcome.isError ? 1 : 0,
    outcome.text.slice(0, HOOK_OUTPUT_MAX_BYTES),
    '',
  )
}
