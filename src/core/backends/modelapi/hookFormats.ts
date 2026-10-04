// Foreign hook-format adapters (M91 lane P, PLAN.md D70).
//
// One adapter per format — gemini, cursor, copilot (CLI/cloud and VS Code
// payloads), windsurf, kiro — translating our hook event + payload into that
// agent's documented stdin shape, and mapping its stdout/exit code back onto
// HookAnswer (src/core/backends/modelapi/hooks.ts, the M51 contract).
//
// Contract sources (no wire capture exists for foreign agents; per the round 2
// lead decision the vendor documentation stands in for it):
// - docs/certification/m91-research.md: the per-format rows (event names,
//   tool maps, exit codes, decision fields, timeouts in ms vs s).
// - PLAN.md D70 and the M91 lane rules: each source's fail-closed rules are
//   kept and none of its grants (a foreign "allow" never skips an approval
//   card — it only means "no objection"); an adapter parse failure is a
//   failure, never allow.
//
// Pure module: no I/O. The caller runs the foreign command (with the hook
// limits from hooks.ts) and feeds the result back into the parse function.

import * as z from 'zod/mini'
import path from 'node:path'
import {
  type EXTENSION_HOOK_EVENTS,
  HOOK_MATCHER_VALUE_MAX_CHARS,
  HOOK_MAX_TIMEOUT_SECONDS,
  HOOK_TOOL_OUTPUT_PREVIEW_CHARS,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/constants'
import { type HookAnswer, type HookEvent } from './hooks'

export const HOOK_FORMATS = ['gemini', 'cursor', 'copilot', 'windsurf', 'kiro'] as const
export type HookFormat = (typeof HOOK_FORMATS)[number]

/** The events an adapter accepts: Muse Code's plus the extension-only ones. */
export type AdapterEvent = HookEvent | (typeof EXTENSION_HOOK_EVENTS)[number]

/** What building a foreign stdin decided: run it, skip it, or refuse it. */
export type ForeignStdinResult =
  | { readonly outcome: 'run'; readonly stdin: string }
  /** The hook does not run, and that is not a failure (Kiro's path filter). */
  | { readonly outcome: 'skip'; readonly reason: string }
  /**
   * The event + payload cannot be translated faithfully. The caller records
   * a hook failure; it never runs the command with a guessed shape.
   */
  | { readonly outcome: 'refused'; readonly reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExtraFields(value: unknown, allowed: ReadonlySet<string>): boolean {
  return isRecord(value) && Object.keys(value).some((key) => !allowed.has(key))
}

function textField(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function recordField(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key]
  return isRecord(value) ? value : undefined
}

/** Copy our payload's text field into the foreign stdin when it is present. */
function copyText(
  stdin: Record<string, unknown>,
  payload: Readonly<Record<string, unknown>>,
  key: string,
): void {
  const value = payload[key]
  if (typeof value === 'string' && value !== '') {
    stdin[key] = value
  }
}

function toolNameOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  return textField(payload, 'tool_name')
}

function toolInputOf(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return recordField(payload, 'tool_input') ?? {}
}

function fileOf(input: Record<string, unknown>): string | undefined {
  const direct = input['file_path']
  if (typeof direct === 'string' && direct !== '') {
    return direct
  }
  const nested = input['path']
  return typeof nested === 'string' && nested !== '' ? nested : undefined
}

/** Prefer stderr, then stdout, then a fixed fallback; never an empty reason. */
function blockReason(stderr: string, stdout: string, fallback: string): string {
  const fromStderr = stderr.trim()
  if (fromStderr !== '') {
    return fromStderr
  }
  const fromStdout = stdout.trim()
  return fromStdout === '' ? fallback : fromStdout
}

function failed(reason: string): HookAnswer {
  return { status: 'failed', reason }
}

function cleanReason(reason: string | undefined, fallback: string): string {
  const trimmed = reason?.trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/** Our `mcp__<server>__<tool>` name split at its first boundary. */
function splitMcpName(name: string): { server: string; tool: string } | undefined {
  const prefix = 'mcp__'
  if (!name.startsWith(prefix)) {
    return undefined
  }
  const rest = name.slice(prefix.length)
  const boundary = rest.indexOf('__')
  return boundary === -1
    ? undefined
    : { server: rest.slice(0, boundary), tool: rest.slice(boundary + 2) }
}

function isShellTool(tool: string): boolean {
  return tool === 'bash' || tool === 'powershell'
}

function isMcpTool(tool: string): boolean {
  return tool.startsWith('mcp__')
}

// --- Gemini CLI (geminicli.com/docs/hooks) ---
//
// Kept events (research): BeforeTool→PreToolUse, AfterTool→PostToolUse,
// BeforeAgent→UserPromptSubmit, AfterAgent→Stop, SessionStart, SessionEnd,
// PreCompress→PreCompact, Notification. BeforeModel, AfterModel and
// BeforeToolSelection are refused: their fields modify the request or the
// response (lead decision I). Timeouts are milliseconds (default 60000);
// geminiTimeoutMsToSeconds converts them to our seconds.

const GEMINI_EVENT_NAMES: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  UserPromptSubmit: 'BeforeAgent',
  PreToolUse: 'BeforeTool',
  PostToolUse: 'AfterTool',
  Stop: 'AfterAgent',
  PreCompact: 'PreCompress',
  Notification: 'Notification',
}

function geminiToolName(tool: string): string {
  if (tool === 'bash') {
    return 'run_shell_command'
  }
  if (tool === 'edit_file') {
    return 'replace'
  }
  const mcp = splitMcpName(tool)
  return mcp === undefined ? tool : `mcp_${mcp.server}_${mcp.tool}`
}

export function buildGeminiStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
): ForeignStdinResult {
  const name = GEMINI_EVENT_NAMES[event]
  if (name === undefined) {
    return {
      outcome: 'refused',
      reason: `gemini: ${event} has no Gemini event (BeforeModel and AfterModel are refused: they modify the request or response)`,
    }
  }
  const stdin: Record<string, unknown> = { hook_event_name: name }
  copyText(stdin, payload, 'session_id')
  copyText(stdin, payload, 'cwd')
  switch (event) {
    case 'UserPromptSubmit': {
      copyText(stdin, payload, 'prompt')
      break
    }
    case 'Notification': {
      copyText(stdin, payload, 'message')
      break
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const tool = toolNameOf(payload)
      if (tool !== undefined) {
        stdin['tool_name'] = geminiToolName(tool)
      }
      const input = recordField(payload, 'tool_input')
      if (input !== undefined) {
        stdin['tool_input'] = input
      }
      break
    }
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

/** Milliseconds (Gemini config) to whole seconds (our HookDefinition). */
export function geminiTimeoutMsToSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  const seconds = Math.ceil(value / MILLISECONDS_PER_SECOND)
  return Math.min(Math.max(seconds, 1), HOOK_MAX_TIMEOUT_SECONDS)
}

const geminiOutputShape = z.object({
  decision: z.optional(z.string()),
  reason: z.optional(z.string()),
  additionalContext: z.optional(z.string()),
})
const GEMINI_OUTPUT_FIELDS = new Set(['decision', 'reason', 'additionalContext'])
const GEMINI_DECISIONS = new Set(['approve', 'allow', 'deny', 'block', 'ask'])

export function parseGeminiResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): HookAnswer {
  if (exitCode === 2) {
    return event === 'PreToolUse'
      ? {
          status: 'blocked',
          reason: blockReason(stderr, stdout, 'gemini BeforeTool hook blocked the call'),
        }
      : failed(`gemini: exit 2 is not valid on ${event}`)
  }
  if (exitCode !== 0) {
    return failed(stderr.trim() || `gemini: hook exited ${String(exitCode)}`)
  }
  if (stdout.trim() === '') {
    return { status: 'completed' }
  }
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return failed('gemini: hook output is not valid JSON')
  }
  if (!isRecord(value) || hasExtraFields(value, GEMINI_OUTPUT_FIELDS)) {
    return failed(
      'gemini: hook output has unsupported fields (request/response modifiers are refused)',
    )
  }
  const parsed = geminiOutputShape.safeParse(value)
  if (!parsed.success) {
    return failed('gemini: hook output has invalid fields')
  }
  const { decision, reason, additionalContext } = parsed.data
  if (decision !== undefined && !GEMINI_DECISIONS.has(decision)) {
    return failed('gemini: hook decision is not approve, allow, deny, block or ask')
  }
  if (decision === 'deny' || decision === 'block') {
    if (event !== 'PreToolUse') {
      return failed(`gemini: ${event} cannot block`)
    }
    return {
      status: 'blocked',
      reason: cleanReason(reason, 'gemini BeforeTool hook blocked the call'),
    }
  }
  if (decision === 'ask') {
    return event === 'PreToolUse'
      ? { status: 'completed', permissionDecision: 'ask', context: additionalContext }
      : failed(`gemini: ask is not valid on ${event}`)
  }
  if (reason !== undefined) {
    return failed('gemini: reason needs a block decision')
  }
  // approve, allow, or no decision: no objection. Never an approval grant.
  return { status: 'completed', context: additionalContext }
}

// --- Cursor (cursor.com/docs/hooks) ---
//
// Kept events (research): sessionStart/sessionEnd, pre/postToolUse,
// postToolUseFailure, subagentStop; shell/MCP/readFile hooks run as
// Pre/PostToolUse with matchers; beforeSubmitPrompt→UserPromptSubmit;
// preCompact; stop; afterAgentResponse→PostLLMCall (async). Refused:
// subagentStart (it can block where ours cannot), afterAgentThought, both Tab
// hooks, workspaceOpen. `permission` (and preToolUse's `decision`) map onto
// our decision; `ask` forces a card; `followup_message` on Stop blocks.
// Fail-closed rules kept: invalid JSON from a permission hook blocks, and a
// `failClosed` entry blocks on crash, timeout, non-zero exit or missing JSON.

function cursorToolEvent(event: 'PreToolUse' | 'PostToolUse', tool: string | undefined): string {
  if (tool !== undefined) {
    if (isShellTool(tool)) {
      return event === 'PreToolUse' ? 'beforeShellExecution' : 'afterShellExecution'
    }
    if (isMcpTool(tool)) {
      return event === 'PreToolUse' ? 'beforeMCPExecution' : 'afterMCPExecution'
    }
    if (event === 'PreToolUse' && tool === 'read_file') {
      return 'beforeReadFile'
    }
    if (event === 'PostToolUse' && CURSOR_EDIT_TOOLS.has(tool)) {
      return 'afterFileEdit'
    }
  }
  return event === 'PreToolUse' ? 'preToolUse' : 'postToolUse'
}

const CURSOR_EDIT_TOOLS = new Set(['read_file', 'write_file', 'edit_file'])

const CURSOR_EVENT_NAMES: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'sessionStart',
  SessionEnd: 'sessionEnd',
  PostToolUseFailure: 'postToolUseFailure',
  SubagentStop: 'subagentStop',
  UserPromptSubmit: 'beforeSubmitPrompt',
  PreCompact: 'preCompact',
  Stop: 'stop',
  PostLLMCall: 'afterAgentResponse',
}

export function buildCursorStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
): ForeignStdinResult {
  const name =
    event === 'PreToolUse' || event === 'PostToolUse'
      ? cursorToolEvent(event, toolNameOf(payload))
      : CURSOR_EVENT_NAMES[event]
  if (name === undefined) {
    return {
      outcome: 'refused',
      reason: `cursor: ${event} has no Cursor event (subagentStart, Tab hooks and workspaceOpen are refused)`,
    }
  }
  const stdin: Record<string, unknown> = { hook_event_name: name }
  copyText(stdin, payload, 'session_id')
  copyText(stdin, payload, 'cwd')
  const tool = toolNameOf(payload)
  if (tool !== undefined) {
    stdin['tool_name'] = tool
  }
  const input = recordField(payload, 'tool_input')
  if (input !== undefined) {
    stdin['tool_input'] = input
    if (name === 'beforeShellExecution' || name === 'afterShellExecution') {
      const command = input['command']
      if (typeof command === 'string' && command !== '') {
        stdin['command'] = command
      }
    }
  }
  if (name === 'beforeSubmitPrompt') {
    copyText(stdin, payload, 'prompt')
  } else if (name === 'afterAgentResponse') {
    copyText(stdin, payload, 'response')
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

export interface CursorAdapterOptions {
  /** A `failClosed` entry from `.cursor/hooks.json`: errors block the tool. */
  readonly failClosed?: boolean | undefined
}

const cursorOutputShape = z.object({
  permission: z.optional(z.string()),
  decision: z.optional(z.string()),
  followup_message: z.optional(z.string()),
  additional_context: z.optional(z.string()),
})
const CURSOR_OUTPUT_FIELDS = new Set([
  'permission',
  'decision',
  'followup_message',
  'additional_context',
])
const CURSOR_PERMISSIONS = new Set(['allow', 'deny', 'ask'])
const CURSOR_DECISIONS = new Set(['allow', 'deny'])

export function parseCursorResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: CursorAdapterOptions,
): HookAnswer {
  if (exitCode === 2) {
    return event === 'PreToolUse'
      ? { status: 'blocked', reason: blockReason(stderr, stdout, 'cursor hook denied the call') }
      : failed(`cursor: exit 2 is not valid on ${event}`)
  }
  const isFailClosed = options?.failClosed === true
  if (exitCode !== 0) {
    if (isFailClosed && event === 'PreToolUse') {
      return {
        status: 'blocked',
        reason: blockReason(stderr, stdout, 'cursor hook failed closed'),
      }
    }
    return failed(stderr.trim() || `cursor: hook exited ${String(exitCode)}`)
  }
  if (stdout.trim() === '') {
    return isFailClosed && event === 'PreToolUse'
      ? { status: 'blocked', reason: 'cursor hook failed closed' }
      : { status: 'completed' }
  }
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    // Invalid JSON from a permission hook blocks, even without failClosed.
    return event === 'PreToolUse'
      ? { status: 'blocked', reason: 'cursor: hook output is not valid JSON' }
      : failed('cursor: hook output is not valid JSON')
  }
  if (!isRecord(value) || hasExtraFields(value, CURSOR_OUTPUT_FIELDS)) {
    return failed('cursor: hook output has unsupported fields')
  }
  const parsed = cursorOutputShape.safeParse(value)
  if (!parsed.success) {
    return failed('cursor: hook output has invalid fields')
  }
  const { permission, decision, followup_message, additional_context } = parsed.data
  if (permission !== undefined && !CURSOR_PERMISSIONS.has(permission)) {
    return failed('cursor: permission is not allow, deny or ask')
  }
  if (decision !== undefined && !CURSOR_DECISIONS.has(decision)) {
    return failed('cursor: decision is not allow or deny')
  }
  if (event !== 'PreToolUse' && (permission !== undefined || decision !== undefined)) {
    return failed(`cursor: permission is not valid on ${event}`)
  }
  if (permission === 'deny' || decision === 'deny') {
    return {
      status: 'blocked',
      reason: blockReason(stderr, stdout, 'cursor hook denied the call'),
    }
  }
  if (permission === 'ask') {
    // Ask forces an approval card; it never grants one.
    return { status: 'completed', permissionDecision: 'ask', context: additional_context }
  }
  if (followup_message !== undefined) {
    if (event !== 'Stop' && event !== 'SubagentStop') {
      return failed(`cursor: followup_message is not valid on ${event}`)
    }
    const message = followup_message.trim()
    return message === ''
      ? failed('cursor: followup_message is empty')
      : { status: 'blocked', reason: message }
  }
  // allow, or no verdict: no objection. Never an approval grant.
  return { status: 'completed', context: additional_context }
}

// --- Copilot CLI/cloud and VS Code agent hooks ---
//
// Kept Copilot events (research, camelCase with PascalCase aliases):
// sessionStart, sessionEnd, userPromptSubmitted, preToolUse,
// permissionRequest (CLI only), postToolUse, postToolUseFailure, preCompact,
// agentStop→Stop, errorOccurred→StopFailure, subagentStart, subagentStop,
// notification (CLI only). userPromptTransformed is refused (it rewrites the
// prompt where ours only observes). VS Code runs 8 of these: SessionStart,
// UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart,
// SubagentStop, Stop. Output is flat: `permissionDecision` with
// `permissionDecisionReason`, an optional `modifiedArgs` rewrite and
// additional context. Fail-closed rule kept: a preToolUse (or
// permissionRequest) error — non-zero exit, crash or invalid JSON — denies.
// `cwd` is sent only when relative and confined to the workspace; `env` is
// always refused (round 2 lead decision).

const COPILOT_EVENT_NAMES: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'sessionStart',
  SessionEnd: 'sessionEnd',
  UserPromptSubmit: 'userPromptSubmitted',
  PreToolUse: 'preToolUse',
  PermissionRequest: 'permissionRequest',
  PostToolUse: 'postToolUse',
  PostToolUseFailure: 'postToolUseFailure',
  PreCompact: 'preCompact',
  Stop: 'agentStop',
  StopFailure: 'errorOccurred',
  SubagentStart: 'subagentStart',
  SubagentStop: 'subagentStop',
  Notification: 'notification',
}

const VSCODE_EVENT_NAMES: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'SessionStart',
  UserPromptSubmit: 'UserPromptSubmit',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  PreCompact: 'PreCompact',
  SubagentStart: 'SubagentStart',
  SubagentStop: 'SubagentStop',
  Stop: 'Stop',
}

export interface CopilotAdapterOptions {
  /** VS Code's Preview agent hooks run the 8-event subset on one shape. */
  readonly flavor?: 'copilot' | 'vscode' | undefined
  /** The workspace root `cwd` is confined to; without it only relative paths pass. */
  readonly workspaceRoot?: string | undefined
  readonly platform?: NodeJS.Platform | undefined
}

/** A workspace-relative `cwd` to send, or undefined when it must be refused. */
function copilotCwd(
  cwd: string,
  workspaceRoot: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  const pick = platform === 'win32' ? path.win32 : path.posix
  if (workspaceRoot === undefined) {
    if (pick.isAbsolute(cwd)) {
      return undefined
    }
    const normalized = pick.normalize(cwd)
    return normalized === '..' || normalized.startsWith(`..${pick.sep}`) ? undefined : normalized
  }
  const root = pick.normalize(workspaceRoot)
  const absolute = pick.isAbsolute(cwd) ? pick.normalize(cwd) : pick.normalize(pick.join(root, cwd))
  if (absolute !== root && !absolute.startsWith(root + pick.sep)) {
    return undefined
  }
  const relative = pick.relative(root, absolute)
  return relative === '' ? '.' : relative
}

export function buildCopilotStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: CopilotAdapterOptions,
): ForeignStdinResult {
  const table = options?.flavor === 'vscode' ? VSCODE_EVENT_NAMES : COPILOT_EVENT_NAMES
  if (table[event] === undefined) {
    return {
      outcome: 'refused',
      reason: `copilot: ${event} has no Copilot event (userPromptTransformed is refused)`,
    }
  }
  if (payload['env'] !== undefined || payload['environment'] !== undefined) {
    return { outcome: 'refused', reason: 'copilot: env is refused' }
  }
  const stdin: Record<string, unknown> = {}
  copyText(stdin, payload, 'prompt')
  const sessionId = textField(payload, 'session_id')
  if (sessionId !== undefined) {
    stdin['sessionId'] = sessionId
  }
  const cwd = textField(payload, 'cwd')
  if (cwd !== undefined) {
    const confined = copilotCwd(cwd, options?.workspaceRoot, options?.platform ?? process.platform)
    if (confined === undefined) {
      return { outcome: 'refused', reason: 'copilot: cwd must stay inside the workspace' }
    }
    stdin['cwd'] = confined
  }
  const tool = toolNameOf(payload)
  if (tool !== undefined) {
    stdin['toolName'] = tool
  }
  const input = recordField(payload, 'tool_input')
  if (input !== undefined) {
    stdin['toolArgs'] = input
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

const copilotOutputShape = z.object({
  permissionDecision: z.optional(z.string()),
  permissionDecisionReason: z.optional(z.string()),
  modifiedArgs: z.optional(z.record(z.string(), z.unknown())),
  additionalContext: z.optional(z.string()),
})
const COPILOT_OUTPUT_FIELDS = new Set([
  'permissionDecision',
  'permissionDecisionReason',
  'modifiedArgs',
  'additionalContext',
])
const COPILOT_DECISIONS = new Set(['allow', 'deny', 'ask'])

export function parseCopilotResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): HookAnswer {
  const isGuard = event === 'PreToolUse' || event === 'PermissionRequest'
  if (exitCode !== 0) {
    // PreToolUse errors fail closed: exit 2, crashes and other non-zero
    // exits deny the call.
    return isGuard
      ? { status: 'blocked', reason: blockReason(stderr, stdout, 'copilot hook denied the call') }
      : failed(stderr.trim() || `copilot: hook exited ${String(exitCode)}`)
  }
  if (stdout.trim() === '') {
    return { status: 'completed' }
  }
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return isGuard
      ? { status: 'blocked', reason: 'copilot: hook output is not valid JSON' }
      : failed('copilot: hook output is not valid JSON')
  }
  if (!isRecord(value) || hasExtraFields(value, COPILOT_OUTPUT_FIELDS)) {
    return failed('copilot: hook output has unsupported fields')
  }
  const parsed = copilotOutputShape.safeParse(value)
  if (!parsed.success) {
    return failed('copilot: hook output has invalid fields')
  }
  const { permissionDecision, permissionDecisionReason, modifiedArgs, additionalContext } =
    parsed.data
  if (permissionDecision !== undefined && !COPILOT_DECISIONS.has(permissionDecision)) {
    return failed('copilot: permissionDecision is not allow, deny or ask')
  }
  if (permissionDecisionReason !== undefined && permissionDecision === undefined) {
    return failed('copilot: permissionDecisionReason needs permissionDecision')
  }
  if (permissionDecision === 'deny') {
    if (!isGuard) {
      return failed(`copilot: deny is not valid on ${event}`)
    }
    const reason = cleanReason(permissionDecisionReason, 'copilot hook denied the call')
    return event === 'PermissionRequest'
      ? { status: 'blocked', reason, approvalDecision: 'deny' }
      : { status: 'blocked', reason }
  }
  if (permissionDecision === 'ask') {
    if (!isGuard) {
      return failed(`copilot: ask is not valid on ${event}`)
    }
    // Ask forces an approval card; it never grants one.
    return { status: 'completed', permissionDecision: 'ask', context: additionalContext }
  }
  if (modifiedArgs !== undefined && event !== 'PreToolUse') {
    return failed(`copilot: modifiedArgs is not valid on ${event}`)
  }
  // allow, or no verdict: no objection. Never an approval grant.
  return {
    status: 'completed',
    context: additionalContext,
    ...(modifiedArgs !== undefined && { updatedInput: modifiedArgs }),
  }
}

// --- Windsurf / Devin Desktop Cascade (docs.devin.ai/desktop/cascade/hooks) ---
//
// Kept events (research): pre_* run as PreToolUse and post_* as PostToolUse
// with a matcher per kind (read_code, write_code, run_command, mcp_tool_use);
// pre_user_prompt→UserPromptSubmit; post_cascade_response→Stop (async);
// post_setup_worktree→WorktreeCreate. The `_with_transcript` variant is
// refused. Exit codes only: 0 proceeds, 2 blocks on a pre event (the stderr
// message reaches the agent), any other exit fails open. There is no stdout
// contract and no ask.

function windsurfToolEvent(
  event: 'PreToolUse' | 'PostToolUse',
  tool: string | undefined,
): string | undefined {
  if (tool === undefined) {
    return undefined
  }
  const prefix = event === 'PreToolUse' ? 'pre_' : 'post_'
  if (tool === 'read_file') {
    return `${prefix}read_code`
  }
  if (tool === 'write_file' || tool === 'edit_file') {
    return `${prefix}write_code`
  }
  if (isShellTool(tool)) {
    return `${prefix}run_command`
  }
  return isMcpTool(tool) ? `${prefix}mcp_tool_use` : undefined
}

function windsurfEvent(event: AdapterEvent, tool: string | undefined): string | undefined {
  if (event === 'UserPromptSubmit') {
    return 'pre_user_prompt'
  }
  if (event === 'Stop') {
    return 'post_cascade_response'
  }
  if (event === 'WorktreeCreate') {
    return 'post_setup_worktree'
  }
  return event === 'PreToolUse' || event === 'PostToolUse'
    ? windsurfToolEvent(event, tool)
    : undefined
}

export function buildWindsurfStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
): ForeignStdinResult {
  const name = windsurfEvent(event, toolNameOf(payload))
  if (name === undefined) {
    return {
      outcome: 'refused',
      reason: `windsurf: ${event} has no Windsurf event (post_cascade_response_with_transcript is refused)`,
    }
  }
  const input = toolInputOf(payload)
  const stdin: Record<string, unknown> = {}
  switch (name) {
    case 'pre_read_code':
    case 'post_read_code': {
      const file = fileOf(input)
      if (file === undefined) {
        return { outcome: 'refused', reason: `windsurf: ${name} needs a file path` }
      }
      stdin['file_path'] = file

      break
    }
    case 'pre_write_code':
    case 'post_write_code': {
      const file = fileOf(input)
      if (file === undefined) {
        return { outcome: 'refused', reason: `windsurf: ${name} needs a file path` }
      }
      stdin['file_path'] = file
      const code = input['content']
      if (typeof code !== 'string' || code === '') {
        const fallback = input['code']
        if (typeof fallback === 'string' && fallback !== '') {
          stdin['code'] = fallback
        }
      } else {
        stdin['code'] = code
      }

      break
    }
    case 'pre_run_command':
    case 'post_run_command': {
      const command = input['command']
      if (typeof command !== 'string' || command === '') {
        return { outcome: 'refused', reason: `windsurf: ${name} needs a command` }
      }
      stdin['command_string'] = command
      if (name === 'post_run_command') {
        const exit = payload['exit_code']
        if (typeof exit === 'number') {
          stdin['exit_code'] = exit
        }
        const output = textField(payload, 'output_snippet') ?? textField(payload, 'output')
        if (output !== undefined) {
          stdin['output_snippet'] = output
        }
      }

      break
    }
    case 'pre_mcp_tool_use':
    case 'post_mcp_tool_use': {
      const tool = toolNameOf(payload)
      const mcp = tool === undefined ? undefined : splitMcpName(tool)
      if (mcp === undefined) {
        return { outcome: 'refused', reason: `windsurf: ${name} needs an MCP tool` }
      }
      stdin['tool_name'] = mcp.tool
      stdin['mcp_server_name'] = mcp.server
      const args = input['arguments']
      if (isRecord(args)) {
        stdin['arguments'] = args
      }

      break
    }
    case 'pre_user_prompt': {
      const prompt = textField(payload, 'prompt')
      if (prompt === undefined) {
        return { outcome: 'refused', reason: 'windsurf: pre_user_prompt needs a prompt' }
      }
      stdin['prompt'] = prompt

      break
    }
    case 'post_setup_worktree': {
      copyText(stdin, payload, 'worktree_path')
      copyText(stdin, payload, 'path')

      break
    }
    default: {
      copyText(stdin, payload, 'stop_reason')
    }
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

export function parseWindsurfResult(
  event: AdapterEvent,
  exitCode: number | null,
  _stdout: string,
  stderr: string,
): HookAnswer {
  if (exitCode === 0) {
    return { status: 'completed' }
  }
  if (exitCode === 2) {
    if (event === 'PreToolUse' || event === 'UserPromptSubmit') {
      return {
        status: 'blocked',
        reason: blockReason(stderr, '', 'windsurf hook blocked the call'),
      }
    }
    // A non-zero exit fails the WorktreeCreate attempt (D70 event table);
    // post hooks cannot block, so their exit 2 is a failure.
    return event === 'WorktreeCreate'
      ? { status: 'blocked', reason: blockReason(stderr, '', 'windsurf hook failed the attempt') }
      : failed(`windsurf: exit 2 is not valid on ${event}`)
  }
  return failed(
    exitCode === null ? 'windsurf: hook did not exit' : `windsurf: hook exited ${String(exitCode)}`,
  )
}

// --- Kiro (.kiro/hooks/*.json, v1) ---
//
// Command actions on SessionStart, SessionEnd, UserPromptSubmit, PreToolUse,
// PostToolUse and Stop; Kiro PreTaskExec→TaskCreated and
// PostTaskExec→TaskCompleted (lead decision I). Manual triggers and agent
// actions are refused here: Manual has no turn to attach to, and agent
// actions become prompt/agent handlers in lane H. Tools: fs_read→Read,
// fs_write→Write|Edit, execute_bash→Bash (research). Only exit 2 blocks; a
// success injects stdout as context. Kiro file triggers (PostFileCreate,
// PostFileSave, PostFileDelete) map to PostToolUse with matcher Edit|Write,
// and this adapter applies the trigger's path regex itself before running, so
// the scope stays the same and does not widen.

const KIRO_EVENT_NAMES: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  UserPromptSubmit: 'UserPromptSubmit',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  Stop: 'Stop',
  TaskCreated: 'PreTaskExec',
  TaskCompleted: 'PostTaskExec',
}

const KIRO_TRIGGERS = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PreTaskExec',
  'PostTaskExec',
  'PostFileCreate',
  'PostFileSave',
  'PostFileDelete',
])

export interface KiroAdapterOptions {
  /** The originating Kiro trigger (file triggers share our PostToolUse). */
  readonly trigger?: string | undefined
  /** A file trigger's path regex, applied before the hook runs. */
  readonly pathPattern?: string | undefined
}

function kiroToolName(tool: string): string {
  if (tool === 'bash' || tool === 'powershell') {
    return 'execute_bash'
  }
  if (tool === 'read_file') {
    return 'fs_read'
  }
  return tool === 'write_file' || tool === 'edit_file' ? 'fs_write' : tool
}

function kiroFileOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  const input = recordField(payload, 'tool_input')
  if (input !== undefined) {
    const fromInput = fileOf(input)
    if (fromInput !== undefined) {
      return fromInput
    }
  }
  return textField(payload, 'file_path') ?? textField(payload, 'path')
}

export function buildKiroStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: KiroAdapterOptions,
): ForeignStdinResult {
  if (KIRO_EVENT_NAMES[event] === undefined) {
    return {
      outcome: 'refused',
      reason: `kiro: ${event} has no Kiro trigger (Manual triggers and agent actions are refused)`,
    }
  }
  const trigger = options?.trigger
  if (trigger !== undefined && !KIRO_TRIGGERS.has(trigger)) {
    return { outcome: 'refused', reason: 'kiro: unknown trigger' }
  }
  const name = trigger ?? KIRO_EVENT_NAMES[event]
  const pattern = options?.pathPattern
  if (pattern !== undefined) {
    const file = kiroFileOf(payload)
    if (file === undefined) {
      return { outcome: 'skip', reason: 'kiro: file trigger has no file path' }
    }
    if (file.length > HOOK_MATCHER_VALUE_MAX_CHARS) {
      return { outcome: 'refused', reason: 'kiro: file path is too long to match' }
    }
    let expression: RegExp
    try {
      expression = new RegExp(pattern)
    } catch {
      return { outcome: 'refused', reason: 'kiro: path pattern is not a valid expression' }
    }
    if (!expression.test(file)) {
      return { outcome: 'skip', reason: 'kiro: file path is outside the trigger scope' }
    }
  }
  const stdin: Record<string, unknown> = { hook_event_name: name }
  copyText(stdin, payload, 'session_id')
  copyText(stdin, payload, 'cwd')
  if (event === 'UserPromptSubmit') {
    copyText(stdin, payload, 'prompt')
  } else if (event === 'PreToolUse' || event === 'PostToolUse') {
    const tool = toolNameOf(payload)
    if (tool !== undefined) {
      stdin['tool_name'] = kiroToolName(tool)
    }
    const input = recordField(payload, 'tool_input')
    if (input !== undefined) {
      stdin['tool_input'] = input
    }
    if (event === 'PostToolUse') {
      const response = recordField(payload, 'tool_response')
      if (response !== undefined) {
        stdin['tool_response'] = response
      }
    }
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

export function parseKiroResult(
  _event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): HookAnswer {
  if (exitCode === 2) {
    return { status: 'blocked', reason: blockReason(stderr, stdout, 'kiro hook blocked the call') }
  }
  if (exitCode !== 0) {
    return failed(stderr.trim() || `kiro: hook exited ${String(exitCode)}`)
  }
  const trimmed = stdout.trim()
  if (trimmed === '') {
    return { status: 'completed' }
  }
  // A success injects stdout as context.
  return { status: 'completed', context: trimmed.slice(0, HOOK_TOOL_OUTPUT_PREVIEW_CHARS) }
}
