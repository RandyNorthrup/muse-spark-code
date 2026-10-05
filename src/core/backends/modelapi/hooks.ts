// Muse Code's settings-level hook shape, used by Model API sessions (M51).
// The config, matcher and result contracts are documented by Muse Code SDK
// 1.3.0: https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/
// and https://meta-models.github.io/muse-code-sdk/next/guides/plugins/reference/hook-events/.
// Interrupt (1.4.0) and SessionFork (1.4.2) join HOOK_EVENTS here (M91 lane
// R): Interrupt fires async-only where the captures show Muse Code firing it
// (docs/certification/m91.md), and SessionFork parses sync-only but fires
// nothing until upstream meta-models/muse-code-sdk#84 is answered.

import * as z from 'zod/mini'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { createContext, Script } from 'node:vm'
import {
  HOOK_CONFIG_MAX_BYTES,
  HOOK_DEFAULT_TIMEOUT_SECONDS,
  HOOK_FORBIDDEN_ENV_NAMES,
  HOOK_FORMATS,
  HOOK_HTTP_URL_MAX_CHARS,
  HOOK_MATCHER_MAX_CHARS,
  HOOK_MATCHER_COMPILE_TIMEOUT_MS,
  HOOK_MATCHER_TIMEOUT_MS,
  HOOK_MATCHER_VALUE_MAX_CHARS,
  HOOK_MAX_RUNNING_COMMANDS,
  HOOK_MANAGED_ENV_MAX_NAMES,
  HOOK_MANAGED_ENV_NAME_MAX_CHARS,
  HOOK_ON_FAILURE_MAX_DEPTH,
  HOOK_SOURCE_MAX_HANDLERS,
  HOOK_TOTAL_MAX_HANDLERS,
  HOOK_MAX_TIMEOUT_SECONDS,
  HOOK_STDIN_MAX_BYTES,
  HOOK_SYSTEM_MESSAGE_MAX_CHARS,
  HOOK_CONTROL_CODE_LIMIT,
  HOOK_NEWLINE_CODE,
  HOOK_DELETE_CODE,
  CODE_INTEL_TOOLS,
  MILLISECONDS_PER_SECOND,
  MODEL_API_TOOLS,
  PLUGIN_FORMATS,
  PLUGIN_HOOK_TIMEOUT_MS,
  PROJECT_HOOKS_SEGMENTS,
  SPARK_HOOKS_SEGMENTS,
} from '../../../shared/constants'
import { type ContextIo, decodeContextText } from '../../context/contextFiles'
import { confineWorkspacePath } from '../../workspacePath'
import { unlessAborted } from '../../timeouts'
import type { ShellResult, ToolIo } from './tools'
import {
  HOOK_MODEL_EVENTS,
  type HookHandlerType,
  type TypedHookAnswer,
  type TypedHookHandlers,
} from './hookHandlers'

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PreLLMCall',
  'PostLLMCall',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'Notification',
  'Interrupt',
  'SessionFork',
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]
export type HookSource = 'managed' | 'user' | 'project'
const HOOK_EVENT_NAMES: ReadonlySet<string> = new Set(HOOK_EVENTS)

export interface HookDefinition {
  readonly event: HookEvent
  readonly source: HookSource
  /** `command` runs a process; the M91 types run in hookHandlers.ts. */
  readonly type?: HookHandlerType
  readonly command: string
  /** `http`: the configured URL. */
  readonly httpUrl?: string | undefined
  /** `mcp_tool`: the configured server and tool names. */
  readonly mcpServer?: string | undefined
  readonly mcpTool?: string | undefined
  /** `prompt` and `agent`: the configured model prompt. */
  readonly modelPrompt?: string | undefined
  readonly timeoutSeconds: number
  readonly matcher: HookMatcher | undefined
  readonly extraEnvNames?: readonly string[]
  readonly isAsync: boolean
  readonly onFailure?: HookDefinition
  /**
   * A hook imported in another agent's format (M91 lane W, PLAN.md D70): it
   * never runs natively. Its stdin and answer go through lane P's adapter,
   * which `dispatchHooks` takes from the caller; without one it is skipped.
   */
  readonly foreign?: ForeignHookSpec
}

/** A `spark-hooks.json` group's import record (docs/certification/m91-i.md). */
export interface ForeignHookSpec {
  /** The source format: one of `HOOK_FORMATS`. */
  readonly format: string
  /** The source's own event name, verbatim. */
  readonly sourceEvent: string
  /** Copilot's contract: `copilot` (CLI) or `vscode` (VS Code Local). */
  readonly flavor?: string | undefined
  /** Cursor's per-script failClosed. */
  readonly failClosed?: boolean | undefined
  /** Kiro's file-path regex, applied by the adapter before the hook runs. */
  readonly pathPattern?: string | undefined
  /** Cursor's shell-command regex, applied before the hook runs. */
  readonly commandPattern?: string | undefined
  /** Cursor's stop and subagentStop continuation bound; null is none of its own. */
  readonly loopLimit?: number | null | undefined
  /** The definition's workspace-relative working directory (Copilot, VS Code Local). */
  readonly cwd?: string | undefined
  /** Kiro's hook name. */
  readonly description?: string | undefined
  /** Amp's and OpenCode's plugin file (M91b): absolute and normalized. */
  readonly plugin?: string | undefined
}

/** A documented output replacement, applied before packing (D70 SoL-Pi rule 2). */
export interface HookReplacement {
  readonly target: 'toolResult' | 'subagentResponse'
  readonly value: string | Readonly<Record<string, unknown>>
}

/** How a foreign hook's process ended, for its adapter to judge by its source's rules. */
export type ForeignRunResult =
  | {
      readonly kind: 'exit'
      readonly exitCode: number | null
      readonly stdout: string
      readonly stderr: string
    }
  /** Killed at its timeout: Copilot fails open; the others treat it as a crash. */
  | { readonly kind: 'timeout' }
  /** Could not start, or its output went past the cap. */
  | { readonly kind: 'crash' }
  /**
   * Never started: its stdin could not be translated, or its directory left
   * the workspace. `blockOperation`: lane P's rule for a blocking source event
   * whose input cannot be built: the guarded operation is refused, never let
   * through as a failed hook.
   */
  | { readonly kind: 'refused'; readonly reason: string; readonly blockOperation?: true }

export type ForeignPreparation =
  | {
      readonly outcome: 'run'
      readonly stdin: string
      readonly cwd: string
      /** The command line in place of the hook's own (a Windows PowerShell source). */
      readonly command?: string | undefined
    }
  /**
   * An Amp or OpenCode plugin (M91b): the adapter runs it in its own child
   * and answers by the source's rules; hooks.ts gives it the host-wide cap.
   */
  | {
      readonly outcome: 'plugin'
      readonly run: (signal: AbortSignal | undefined) => Promise<HookAnswer>
    }
  /** The source would not run it here, and that is not a failure. */
  | { readonly outcome: 'skip'; readonly reason: string }
  | { readonly outcome: 'refused'; readonly reason: string; readonly blockOperation?: true }

/** What a running operation tells foreign adapters beyond the payload (Kiro's file triggers). */
export interface ForeignDispatchContext {
  /** An edit-family call's effect: a file it created, or one it changed. */
  readonly fileOperation?: 'create' | 'save' | undefined
}

/** Lane P's adapters behind one door, given by the caller so this module stays small. */
export interface ForeignHookAdapter {
  prepare(
    hook: HookDefinition,
    spec: ForeignHookSpec,
    event: HookEvent,
    payload: Readonly<Record<string, unknown>>,
    context: ForeignDispatchContext | undefined,
  ): Promise<ForeignPreparation>
  answer(
    hook: HookDefinition,
    spec: ForeignHookSpec,
    event: HookEvent,
    result: ForeignRunResult,
    payload: Readonly<Record<string, unknown>>,
  ): HookAnswer
  /** Ends what the adapter still runs (plugin children) with the session. */
  dispose?(): void
}

export type HookMatcher =
  | { readonly kind: 'exact'; readonly names: ReadonlySet<string> }
  | { readonly kind: 'regex'; readonly pattern: string }

export interface HookConfigResult {
  readonly hooks: readonly HookDefinition[]
  readonly warnings: readonly string[]
}

export interface HookLoadDeps {
  readonly io: ContextIo
  readonly platform: NodeJS.Platform
  readonly settingsPath: string
  readonly workspaceRoot: string
  readonly isWorkspaceTrusted: () => boolean
  readonly warn: (message: string) => void
}

/** Known fields stay `unknown` until each boundary check accepts their shape. */
interface HookRecord extends Record<string, unknown> {
  readonly schema_version?: unknown
  readonly managed_hooks_env_vars?: unknown
  readonly managed_hooks_path?: unknown
  readonly hooks?: unknown
  readonly type?: unknown
  readonly url?: unknown
  readonly server?: unknown
  readonly tool?: unknown
  readonly prompt?: unknown
  readonly timeout?: unknown
  readonly async?: unknown
  readonly statusMessage?: unknown
  readonly outputCapabilities?: unknown
  readonly if?: unknown
  readonly commandWindows?: unknown
  readonly command_windows?: unknown
  readonly command?: unknown
  readonly onFailure?: unknown
  readonly matcher?: unknown
  readonly cwd?: unknown
  readonly hookSpecificOutput?: unknown
  readonly decision?: unknown
}

function withManagedEnv(hook: HookDefinition, names: readonly string[]): HookDefinition {
  return {
    ...hook,
    extraEnvNames: names,
    ...(hook.onFailure !== undefined && { onFailure: withManagedEnv(hook.onFailure, names) }),
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function managedEnvNames(value: unknown): readonly string[] | string {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return 'managed_hooks_env_vars must be an array of names'
  }
  if (value.length > HOOK_MANAGED_ENV_MAX_NAMES) {
    return 'managed_hooks_env_vars has too many names'
  }
  const names: string[] = []
  const seen = new Set<string>()
  for (const name of value) {
    if (
      typeof name !== 'string' ||
      name.length > HOOK_MANAGED_ENV_NAME_MAX_CHARS ||
      !ENV_NAME.test(name)
    ) {
      return 'managed_hooks_env_vars contains an invalid name'
    }
    const upper = name.toUpperCase()
    if (seen.has(upper) || upper.endsWith('_API_KEY') || HOOK_FORBIDDEN_ENV_NAMES.has(upper)) {
      return 'managed_hooks_env_vars contains a duplicate or provider credential name'
    }
    seen.add(upper)
    names.push(name)
  }
  return names
}

async function readHookText(
  deps: HookLoadDeps,
  file: string,
  confinedTo: string | undefined,
): Promise<string | undefined> {
  try {
    if (confinedTo !== undefined) {
      const resolution = await confineWorkspacePath(confinedTo, file, deps.platform, deps.io)
      if (!resolution.ok) {
        deps.warn(`${path.basename(file)}: ${resolution.reason}`)
        return undefined
      }
    }
    const bytes = await deps.io.readFile(file)
    if (bytes === undefined) {
      return undefined
    }
    if (bytes.length > HOOK_CONFIG_MAX_BYTES) {
      deps.warn(`${path.basename(file)}: hook configuration is too large`)
      return undefined
    }
    const decoded = decodeContextText(bytes)
    if (!decoded.ok) {
      deps.warn(`${path.basename(file)}: ${decoded.reason}`)
      return undefined
    }
    return decoded.text
  } catch (error: unknown) {
    deps.warn(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Sources stay in Muse Code's managed, user, project order for one session.
 * An untrusted workspace loads none of them: a user or managed hook commonly
 * runs the workspace's own tools (a formatter, `npm test`), and Restricted
 * Mode promises that no shell command runs.
 */
export async function loadHookDefinitions(deps: HookLoadDeps): Promise<readonly HookDefinition[]> {
  if (!deps.isWorkspaceTrusted()) {
    return []
  }
  const settingsText = await readHookText(deps, deps.settingsPath, undefined)
  let settings: HookRecord | undefined
  let managedNames: readonly string[] = []
  if (settingsText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(settingsText)
      if (isRecord(parsed) && parsed.schema_version === 1) {
        const names = managedEnvNames(parsed.managed_hooks_env_vars)
        if (typeof names === 'string') {
          deps.warn(`settings.json: ${names}; user and managed hooks are off`)
        } else {
          settings = parsed
          managedNames = names
        }
      } else {
        deps.warn('settings.json: hook settings need schema_version 1')
      }
    } catch {
      deps.warn('settings.json: invalid JSON; user and managed hooks are off')
    }
  }
  const sources: { readonly source: HookSource; readonly text: string | undefined }[] = []
  const managed = settings?.managed_hooks_path
  if (typeof managed === 'string' && managed.trim() !== '') {
    const target = path.isAbsolute(managed)
      ? managed
      : path.join(path.dirname(deps.settingsPath), managed)
    sources.push({ source: 'managed', text: await readHookText(deps, target, undefined) })
  }
  if (settings?.hooks !== undefined) {
    sources.push({ source: 'user', text: settingsText })
  }
  const project = path.join(deps.workspaceRoot, ...PROJECT_HOOKS_SEGMENTS)
  sources.push({ source: 'project', text: await readHookText(deps, project, deps.workspaceRoot) })
  const hooks: HookDefinition[] = []
  for (const { source, text } of sources) {
    const parsed = parseHookConfig(text, source, deps.platform)
    for (const warning of parsed.warnings) {
      deps.warn(warning)
    }
    hooks.push(
      ...(source === 'managed'
        ? parsed.hooks.map((hook) => withManagedEnv(hook, managedNames))
        : parsed.hooks),
    )
    if (hooks.length > HOOK_TOTAL_MAX_HANDLERS) {
      deps.warn('hook configuration exceeds the session handler limit; no hooks loaded')
      return []
    }
  }
  return hooks
}

const MAX_HANDLER_FIELDS = new Set([
  'type',
  'command',
  'commandWindows',
  'command_windows',
  'url',
  'server',
  'tool',
  'prompt',
  'timeout',
  'statusMessage',
  'async',
  'onFailure',
  'outputCapabilities',
  'silent',
  'if',
])
function isHandlerType(value: unknown): value is HookHandlerType {
  return (
    typeof value === 'string' && ['command', 'http', 'mcp_tool', 'prompt', 'agent'].includes(value)
  )
}
const GROUP_FIELDS = new Set(['matcher', 'hooks', 'description'])
const MATCH_EXACT = /^[A-Za-z0-9_|]+$/
const MATCH_EVERYTHING = new Set(['', '*'])
// Compile untrusted patterns in a reused V8 context with a bounded deadline.
const MATCH_COMPILE_SCRIPT = new Script('new RegExp(pattern).source')
const COMPILE_VALUES = { pattern: '' }
const COMPILE_CONTEXT = createContext(COMPILE_VALUES)
const WIRED_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PreLLMCall',
  'PostLLMCall',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'Notification',
  'Interrupt',
  'SessionFork',
])

function isRecord(value: unknown): value is HookRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEvent(name: string): name is HookEvent {
  return HOOK_EVENT_NAMES.has(name)
}

function matcherFor(value: unknown, event: HookEvent): HookMatcher | undefined | string {
  if (value === undefined || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    return 'matcher must be a string'
  }
  // Neither carries a match dimension: a batch names many tools, and a fork
  // names none (SessionFork fires nothing until upstream #84 is answered).
  if (event === 'PostToolBatch' || event === 'SessionFork') {
    return undefined
  }
  if (MATCH_EVERYTHING.has(value)) {
    return undefined
  }
  if (value !== '*' && (event === 'UserPromptSubmit' || event === 'Stop')) {
    return `matcher is not valid for ${event}`
  }
  if (value.length > HOOK_MATCHER_MAX_CHARS) {
    return 'matcher is too long'
  }
  if (MATCH_EXACT.test(value)) {
    return { kind: 'exact', names: new Set(value.split('|')) }
  }
  try {
    COMPILE_VALUES.pattern = value
    const pattern: unknown = MATCH_COMPILE_SCRIPT.runInContext(COMPILE_CONTEXT, {
      timeout: HOOK_MATCHER_COMPILE_TIMEOUT_MS,
    })
    return typeof pattern === 'string'
      ? { kind: 'regex', pattern }
      : 'invalid regular-expression matcher'
  } catch {
    return 'invalid regular-expression matcher'
  }
}

// Pattern and input are data in the context; script itself is fixed. V8's
// timeout interrupts catastrophic backtracking before it stalls the host.
const MATCH_SCRIPT = new Script('new RegExp(pattern).test(value)')
const MATCH_VALUES = { pattern: '', value: '' }
const MATCH_CONTEXT = createContext(MATCH_VALUES)

function isMatch(
  matcher: HookMatcher,
  name: string,
  warn: (message: string) => void,
  timeoutMs: number,
): boolean {
  if (matcher.kind === 'exact') {
    return matcher.names.has(name)
  }
  if (name.length > HOOK_MATCHER_VALUE_MAX_CHARS) {
    warn('hook matcher value is too long')
    return false
  }
  try {
    MATCH_VALUES.pattern = matcher.pattern
    MATCH_VALUES.value = name
    const matched: unknown = MATCH_SCRIPT.runInContext(MATCH_CONTEXT, { timeout: timeoutMs })
    return matched === true
  } catch {
    warn('hook regular-expression matcher timed out or failed')
    return false
  }
}

/** A short configured name: server, tool. Bounded like a matcher value. */
function configuredName(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= HOOK_MATCHER_VALUE_MAX_CHARS
    ? value
    : undefined
}

function handler(
  value: unknown,
  event: HookEvent,
  source: HookSource,
  platform: NodeJS.Platform,
  matcher: HookMatcher | undefined,
  depth = 0,
): HookDefinition | string {
  if (!isRecord(value)) {
    return 'handler must be an object'
  }
  const unknownField = Object.keys(value).find((key) => !MAX_HANDLER_FIELDS.has(key))
  if (unknownField !== undefined) {
    return `unsupported handler field ${unknownField}`
  }
  if (!isHandlerType(value.type)) {
    return 'handler type must be one of command, http, mcp_tool, prompt, agent'
  }
  const type = value.type
  if (
    value.timeout !== undefined &&
    (typeof value.timeout !== 'number' || !Number.isSafeInteger(value.timeout) || value.timeout < 0)
  ) {
    return 'handler timeout must be a non-negative integer'
  }
  if (typeof value.timeout === 'number' && value.timeout > HOOK_MAX_TIMEOUT_SECONDS) {
    return `handler timeout exceeds ${String(HOOK_MAX_TIMEOUT_SECONDS)} seconds`
  }
  if (value.async !== undefined && typeof value.async !== 'boolean') {
    return 'handler async must be a boolean'
  }
  if (depth > 0 && value.async === true) {
    return 'onFailure cannot be asynchronous'
  }
  // Research run C: Muse Code 1.4.2 accepts Interrupt only as async and
  // SessionFork only as sync (the fork waits on its verdict).
  if (event === 'Interrupt' && value.async !== true) {
    return 'Interrupt must be asynchronous'
  }
  if (event === 'SessionFork' && value.async === true) {
    return 'SessionFork cannot be asynchronous'
  }
  if (value.statusMessage !== undefined && typeof value.statusMessage !== 'string') {
    return 'handler statusMessage must be a string'
  }
  if (value.outputCapabilities !== undefined || value.if !== undefined) {
    // A selector we do not evaluate must not widen execution.
    return 'handler uses an unsupported selector or output capability'
  }
  const hasCommand =
    value.command !== undefined ||
    value.commandWindows !== undefined ||
    value.command_windows !== undefined
  const hasTypedFields =
    value.url !== undefined ||
    value.server !== undefined ||
    value.tool !== undefined ||
    value.prompt !== undefined
  if (type === 'command' && hasTypedFields) {
    return 'a command handler takes no url, server, tool or prompt field'
  }
  if (type !== 'command' && hasCommand) {
    return `a ${type} handler takes no command field`
  }
  const fields: readonly string[] = {
    command: [],
    http: ['url'],
    mcp_tool: ['server', 'tool'],
    prompt: ['prompt'],
    agent: ['prompt'],
  }[type]
  if (
    ['url', 'server', 'tool', 'prompt'].some(
      (field) => value[field] !== undefined && !fields.includes(field),
    )
  ) {
    return `a ${type} handler has fields for another handler type`
  }
  let httpUrl: string | undefined
  let mcpServer: string | undefined
  let mcpTool: string | undefined
  let modelPrompt: string | undefined
  let platformCommand = ''
  switch (type) {
    case 'command': {
      const selected =
        platform === 'win32'
          ? (value.commandWindows ?? value.command_windows ?? value.command)
          : value.command
      if (typeof selected !== 'string' || selected.trim() === '') {
        return 'handler command is empty or unavailable on this platform'
      }
      platformCommand = selected

      break
    }
    case 'http': {
      if (
        typeof value.url !== 'string' ||
        value.url === '' ||
        value.url.length > HOOK_HTTP_URL_MAX_CHARS
      ) {
        return 'http handler url is empty or too long'
      }
      let scheme: string
      try {
        scheme = new URL(value.url).protocol
      } catch {
        return 'http handler url is invalid'
      }
      if (scheme !== 'https:') {
        return 'http handler url must use HTTPS'
      }
      if (source !== 'user') {
        return 'http handler in a project file is refused: http hooks run only from your own files'
      }
      httpUrl = value.url

      break
    }
    case 'mcp_tool': {
      mcpServer = configuredName(value.server)
      mcpTool = configuredName(value.tool)
      if (mcpServer === undefined || mcpTool === undefined) {
        return 'mcp_tool handler needs a server and a tool name'
      }

      break
    }
    default: {
      if (
        typeof value.prompt !== 'string' ||
        value.prompt.trim() === '' ||
        Buffer.byteLength(value.prompt) > HOOK_STDIN_MAX_BYTES
      ) {
        return `${type} handler prompt is empty or too long`
      }
      if (!HOOK_MODEL_EVENTS.has(event)) {
        return `${type} handler cannot run on ${event}`
      }
      modelPrompt = value.prompt
    }
  }
  let onFailure: HookDefinition | undefined
  if (value.onFailure !== undefined) {
    if (depth >= HOOK_ON_FAILURE_MAX_DEPTH) {
      return 'onFailure exceeds three levels'
    }
    const nested = handler(value.onFailure, event, source, platform, undefined, depth + 1)
    if (typeof nested === 'string') {
      return `onFailure: ${nested}`
    }
    if ((nested.type ?? 'command') !== 'command') {
      return 'onFailure must be a command handler'
    }
    onFailure = nested
  }
  return {
    event,
    source,
    type,
    command: platformCommand,
    ...(httpUrl !== undefined && { httpUrl }),
    ...(mcpServer !== undefined && { mcpServer }),
    ...(mcpTool !== undefined && { mcpTool }),
    ...(modelPrompt !== undefined && { modelPrompt }),
    timeoutSeconds: Math.max(
      typeof value.timeout === 'number' ? value.timeout : HOOK_DEFAULT_TIMEOUT_SECONDS,
      1,
    ),
    matcher,
    isAsync: value.async === true,
    ...(onFailure !== undefined && { onFailure }),
  }
}

/** A hook file's `hooks` object, or why there is none: no file, bad JSON, no object. */
type HooksObject =
  | { readonly ok: true; readonly hooks: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly fault: 'absent' | 'json' | 'shape' }

function hooksObjectOf(text: string | undefined): HooksObject {
  if (text === undefined) return { ok: false, fault: 'absent' }
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return { ok: false, fault: 'json' }
  }
  return isRecord(document) && isRecord(document.hooks)
    ? { ok: true, hooks: document.hooks }
    : { ok: false, fault: 'shape' }
}

const HOOKS_OBJECT_FAULTS = {
  absent: undefined,
  json: 'invalid JSON',
  shape: 'missing hooks object',
} as const

/** Invalid typed fields reject one whole source; unknown entries warn and skip. */
export function parseHookConfig(
  text: string | undefined,
  source: HookSource,
  platform: NodeJS.Platform,
): HookConfigResult {
  const document = hooksObjectOf(text)
  if (!document.ok) {
    const fault = HOOKS_OBJECT_FAULTS[document.fault]
    return { hooks: [], warnings: fault === undefined ? [] : [`${source} hooks: ${fault}`] }
  }
  const warnings: string[] = []
  const hooks: HookDefinition[] = []
  for (const [name, groups] of Object.entries(document.hooks)) {
    if (!isEvent(name)) {
      warnings.push(`${source} hooks: unsupported event ${name}`)
      continue
    }
    if (!WIRED_EVENTS.has(name)) {
      warnings.push(`${source} hooks: ${name} is not wired on the Model API backend`)
      continue
    }
    if (!Array.isArray(groups)) {
      return { hooks: [], warnings: [`${source} hooks: ${name} must be an array`] }
    }
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        return { hooks: [], warnings: [`${source} hooks: ${name} has an invalid group`] }
      }
      const extraGroupField = Object.keys(group).find((key) => !GROUP_FIELDS.has(key))
      if (extraGroupField !== undefined) {
        warnings.push(`${source} hooks: ${name} has unsupported group field ${extraGroupField}`)
        continue
      }
      const matcher = matcherFor(group.matcher, name)
      if (typeof matcher === 'string') {
        warnings.push(`${source} hooks: ${name}: ${matcher}`)
        continue
      }
      for (const entry of group.hooks) {
        const parsed = handler(entry, name, source, platform, matcher)
        if (typeof parsed === 'string') {
          if (
            parsed.includes('must be a non-negative integer') ||
            parsed.includes('must be a boolean')
          ) {
            return { hooks: [], warnings: [`${source} hooks: ${name}: ${parsed}`] }
          }
          warnings.push(`${source} hooks: ${name}: ${parsed}`)
        } else {
          if (hooks.length >= HOOK_SOURCE_MAX_HANDLERS) {
            return { hooks: [], warnings: [`${source} hooks exceed the handler limit`] }
          }
          hooks.push(parsed)
        }
      }
    }
  }
  return { hooks, warnings }
}

// --- Imported hooks in spark-hooks.json (M91 lane W, PLAN.md D70) ---
//
// Lane I writes each foreign hook as one group with its import record
// (docs/certification/m91-i.md). The record is checked field by field here,
// with the handler and matcher parsed by the native rules above, so an
// imported hook is bounded exactly as a native one is. Groups without a
// `format` tag, and extension events, are lane E's parser's.

const FOREIGN_GROUP_FIELDS = new Set([
  'matcher',
  'hooks',
  'format',
  'sourceEvent',
  'flavor',
  'sourceEntry',
  'pathPattern',
  'commandPattern',
  'failClosed',
  'loop_limit',
  'description',
  'async',
  'plugin',
])
const FOREIGN_HANDLER_FIELDS = new Set([
  'type',
  'command',
  'commandWindows',
  'timeout',
  'cwd',
  'prompt',
])
const FOREIGN_FORMATS: ReadonlySet<string> = new Set([...HOOK_FORMATS, ...PLUGIN_FORMATS])
const PLUGIN_FORMAT_NAMES: ReadonlySet<string> = new Set(PLUGIN_FORMATS)
const PLUGIN_HANDLER_FIELDS = new Set(['type', 'timeout'])
const FOREIGN_FLAVORS: Readonly<Record<string, ReadonlySet<string>>> = {
  copilot: new Set(['copilot', 'vscode']),
  cursor: new Set(['generic', 'specialized']),
}
const FOREIGN_LOOP_EVENTS = new Set<HookEvent>(['Stop', 'SubagentStop'])

/** A source regex, compiled once under the bounded deadline; a string says why it is refused. */
function sourcePattern(value: unknown, name: string): string | undefined {
  if (typeof value !== 'string' || value === '') {
    return `${name} must be a non-empty string`
  }
  if (value.length > HOOK_MATCHER_MAX_CHARS) {
    return `${name} is too long`
  }
  try {
    COMPILE_VALUES.pattern = value
    const compiled: unknown = MATCH_COMPILE_SCRIPT.runInContext(COMPILE_CONTEXT, {
      timeout: HOOK_MATCHER_COMPILE_TIMEOUT_MS,
    })
    return typeof compiled === 'string' ? undefined : `${name} is not a valid regular expression`
  } catch {
    return `${name} is not a valid regular expression`
  }
}

/** A definition's working directory: relative, and inside the workspace by its text. */
function relativeCwd(value: unknown, platform: NodeJS.Platform): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  const p = platform === 'win32' ? path.win32 : path.posix
  if (p.isAbsolute(value) || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) {
    return undefined
  }
  const normalized = p.normalize(value)
  return normalized === '..' || normalized.startsWith(`..${p.sep}`) ? undefined : normalized
}

/** The import record's own fields, each checked against its format. */
function foreignSpec(group: HookRecord, event: HookEvent): ForeignHookSpec | string {
  const { format, sourceEvent, flavor } = group
  if (typeof format !== 'string' || !FOREIGN_FORMATS.has(format)) {
    return `format ${typeof format === 'string' ? format : typeof format} has no adapter in this version`
  }
  if (
    typeof sourceEvent !== 'string' ||
    sourceEvent === '' ||
    sourceEvent.length > HOOK_MATCHER_MAX_CHARS
  ) {
    return 'sourceEvent must name the source event'
  }
  if (
    flavor !== undefined &&
    (typeof flavor !== 'string' || !FOREIGN_FLAVORS[format]?.has(flavor))
  ) {
    return `flavor ${typeof flavor === 'string' ? flavor : typeof flavor} is not a ${format} contract`
  }
  const isCursor = format === 'cursor'
  const checks: readonly (readonly [boolean, string])[] = [
    [group['pathPattern'] !== undefined && format !== 'kiro', 'pathPattern is Kiro’s only'],
    [group['commandPattern'] !== undefined && !isCursor, 'commandPattern is Cursor’s only'],
    [group['failClosed'] !== undefined && !isCursor, 'failClosed is Cursor’s only'],
    [
      group['failClosed'] !== undefined && typeof group['failClosed'] !== 'boolean',
      'failClosed must be a boolean',
    ],
    [
      group['loop_limit'] !== undefined && (!isCursor || !FOREIGN_LOOP_EVENTS.has(event)),
      'loop_limit is Cursor’s, on Stop and SubagentStop only',
    ],
    [
      group['description'] !== undefined && typeof group['description'] !== 'string',
      'description must be a string',
    ],
    [
      group['plugin'] !== undefined && !PLUGIN_FORMAT_NAMES.has(format),
      'plugin is Amp’s and OpenCode’s only',
    ],
  ]
  const failed = checks.find(([isFailed]) => isFailed)
  if (failed !== undefined) {
    return failed[1]
  }
  const limit = group['loop_limit']
  let loopLimit: number | null | undefined
  if (limit === null || (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0)) {
    loopLimit = limit
  } else if (limit !== undefined) {
    return 'loop_limit must be a non-negative integer or null'
  }
  for (const name of ['pathPattern', 'commandPattern'] as const) {
    const problem = group[name] === undefined ? undefined : sourcePattern(group[name], name)
    if (problem !== undefined) {
      return problem
    }
  }
  return {
    format,
    sourceEvent,
    ...(typeof flavor === 'string' && { flavor }),
    ...(typeof group['failClosed'] === 'boolean' && { failClosed: group['failClosed'] }),
    ...(typeof group['pathPattern'] === 'string' && { pathPattern: group['pathPattern'] }),
    ...(typeof group['commandPattern'] === 'string' && {
      commandPattern: group['commandPattern'],
    }),
    ...(loopLimit !== undefined && { loopLimit }),
    ...(typeof group['description'] === 'string' && { description: group['description'] }),
  }
}

/** The one handler an imported group holds, with only `fields`; a string says why not. */
function onlyEntry(group: HookRecord, fields: ReadonlySet<string>): HookRecord | string {
  const entries: unknown = group.hooks
  const entry: unknown = Array.isArray(entries) && entries.length === 1 ? entries[0] : undefined
  if (!isRecord(entry)) {
    return 'an imported group holds exactly one handler'
  }
  const unknownField = Object.keys(entry).find((key) => !fields.has(key))
  return unknownField === undefined ? entry : `unsupported handler field ${unknownField}`
}

/** A plugin path: absolute and already in its normalized form, or undefined. */
function pluginPath(value: unknown, platform: NodeJS.Platform): string | undefined {
  if (typeof value !== 'string' || value === '' || value.length > HOOK_MATCHER_VALUE_MAX_CHARS) {
    return undefined
  }
  const p = platform === 'win32' ? path.win32 : path.posix
  return p.isAbsolute(value) && p.normalize(value) === value ? value : undefined
}

/**
 * An Amp or OpenCode plugin group (M91b): one `{ type: 'plugin' }` handler
 * and the plugin's absolute path. Built here, not by `handler()`, which
 * takes commands only; its timeout and matcher follow the native rules.
 */
function pluginGroup(
  group: HookRecord,
  spec: ForeignHookSpec,
  event: HookEvent,
  source: HookSource,
  platform: NodeJS.Platform,
): HookDefinition | string {
  const plugin = pluginPath(group['plugin'], platform)
  if (plugin === undefined) {
    return 'plugin must be an absolute, normalized path'
  }
  const entry = onlyEntry(group, PLUGIN_HANDLER_FIELDS)
  if (typeof entry === 'string') {
    return entry
  }
  if (entry.type !== 'plugin') {
    return 'handler type must be plugin'
  }
  const { timeout } = entry
  if (
    timeout !== undefined &&
    (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 0)
  ) {
    return 'handler timeout must be a non-negative integer'
  }
  if (typeof timeout === 'number' && timeout > HOOK_MAX_TIMEOUT_SECONDS) {
    return `handler timeout exceeds ${String(HOOK_MAX_TIMEOUT_SECONDS)} seconds`
  }
  if (event === 'Interrupt' && group.async !== true) {
    return 'Interrupt must be asynchronous'
  }
  if (event === 'SessionFork' && group.async === true) {
    return 'SessionFork cannot be asynchronous'
  }
  const matcher = matcherFor(group.matcher, event)
  if (typeof matcher === 'string') {
    return matcher
  }
  return {
    event,
    source,
    command: plugin,
    timeoutSeconds: Math.max(
      typeof timeout === 'number' ? timeout : PLUGIN_HOOK_TIMEOUT_MS / MILLISECONDS_PER_SECOND,
      1,
    ),
    matcher,
    isAsync: group.async === true,
    foreign: { ...spec, plugin },
  }
}

/** One foreign group as a definition, or why it is refused. */
function foreignGroup(
  group: HookRecord,
  event: HookEvent,
  source: HookSource,
  platform: NodeJS.Platform,
): HookDefinition | string {
  const extra = Object.keys(group).find((key) => !FOREIGN_GROUP_FIELDS.has(key))
  if (extra !== undefined) {
    return `unsupported group field ${extra}`
  }
  if (group.async !== undefined && typeof group.async !== 'boolean') {
    return 'async must be a boolean'
  }
  const spec = foreignSpec(group, event)
  if (typeof spec === 'string') {
    return spec
  }
  if (PLUGIN_FORMAT_NAMES.has(spec.format)) {
    return pluginGroup(group, spec, event, source, platform)
  }
  const entry = onlyEntry(group, FOREIGN_HANDLER_FIELDS)
  if (typeof entry === 'string') {
    return entry
  }
  let cwd: string | undefined
  if (entry.cwd !== undefined) {
    cwd = relativeCwd(entry.cwd, platform)
    if (cwd === undefined) {
      return 'cwd must be a relative directory inside the workspace'
    }
  }
  const matcher = matcherFor(group.matcher, event)
  if (typeof matcher === 'string') {
    return matcher
  }
  const isModelHandler = entry.type === 'prompt'
  if (isModelHandler !== (entry.prompt !== undefined) || (isModelHandler && cwd !== undefined)) {
    return 'an imported prompt handler holds a prompt and no command or cwd'
  }
  const parsed = handler(
    {
      type: entry.type,
      ...(isModelHandler ? { prompt: entry.prompt } : { command: entry.command }),
      ...(entry.commandWindows !== undefined && { commandWindows: entry.commandWindows }),
      ...(entry.timeout !== undefined && { timeout: entry.timeout }),
      ...(group.async !== undefined && { async: group.async }),
    },
    event,
    source,
    platform,
    matcher,
  )
  if (typeof parsed === 'string') {
    return parsed
  }
  // A Kiro agent action is lane H's `prompt` handler (lead decision I): its
  // prompt goes to the model under the paid-use gates, with no stdin to
  // translate, so it runs as a typed handler, never through an adapter.
  return isModelHandler
    ? parsed
    : { ...parsed, foreign: { ...spec, ...(cwd !== undefined && { cwd }) } }
}

/**
 * The imported hooks of one spark-hooks.json: its groups that carry a
 * `format` tag, on Muse Code's events. Everything else in the file is lane
 * E's (the extension events and the native groups) and is passed over here.
 */
export function parseForeignHooks(
  text: string | undefined,
  source: Extract<HookSource, 'user' | 'project'>,
  platform: NodeJS.Platform,
): HookConfigResult {
  const document = hooksObjectOf(text)
  // Lane E's parser reports the file's own faults once.
  if (!document.ok) return { hooks: [], warnings: [] }
  const warnings: string[] = []
  const hooks: HookDefinition[] = []
  for (const [name, groups] of Object.entries(document.hooks)) {
    if (!isEvent(name) || !Array.isArray(groups)) {
      continue
    }
    for (const group of groups) {
      if (!isRecord(group) || group['format'] === undefined) {
        continue
      }
      const parsed = foreignGroup(group, name, source, platform)
      if (typeof parsed === 'string') {
        warnings.push(`${source} spark-hooks.json: ${name}: ${parsed}`)
        continue
      }
      if (hooks.length >= HOOK_SOURCE_MAX_HANDLERS) {
        return { hooks: [], warnings: [`${source} spark-hooks.json exceeds the handler limit`] }
      }
      hooks.push(parsed)
    }
  }
  return { hooks, warnings }
}

/**
 * The imported hooks of both spark-hooks.json files, under M51's gates: an
 * untrusted workspace loads none, the project's file is confined to the
 * workspace, and the caller keeps the per-session snapshot.
 */
export async function loadForeignHookDefinitions(
  deps: HookLoadDeps,
): Promise<readonly HookDefinition[]> {
  if (!deps.isWorkspaceTrusted()) {
    return []
  }
  const files = sparkHooksFiles(deps)
  const sources = [
    { source: 'user', text: await readHookText(deps, files.user, undefined) },
    { source: 'project', text: await readHookText(deps, files.project, deps.workspaceRoot) },
  ] as const
  const hooks: HookDefinition[] = []
  for (const { source, text } of sources) {
    const parsed = parseForeignHooks(text, source, deps.platform)
    for (const warning of parsed.warnings) {
      deps.warn(warning)
    }
    hooks.push(...parsed.hooks)
    if (hooks.length > HOOK_TOTAL_MAX_HANDLERS) {
      deps.warn('imported hooks exceed the session handler limit; none loaded')
      return []
    }
  }
  return hooks
}

/**
 * Matcher grammar is from Muse Code 1.3.0; tool aliases are resolved by
 * caller. `timeoutMs` bounds one regular-expression match; only tests pass
 * another value, so a loaded rig cannot lapse a deadline the test does not
 * measure.
 */
export function matchingHooks(
  hooks: readonly HookDefinition[],
  event: HookEvent,
  value: string | readonly string[] | undefined,
  warn: (message: string) => void = () => {
    // A caller without a diagnostic sink still gets safe nonmatches.
  },
  timeoutMs: number = HOOK_MATCHER_TIMEOUT_MS,
): readonly HookDefinition[] {
  const normalized = typeof value === 'string' ? [value] : value
  const values = normalized ?? ['']
  return hooks.filter((hook) => {
    const { matcher } = hook
    return (
      hook.event === event &&
      (matcher === undefined || values.some((name) => isMatch(matcher, name, warn, timeoutMs)))
    )
  })
}

/**
 * Both spark-hooks.json files (M91): the user's beside Muse Code's settings
 * file, which is the settingsPath (`<config>/muse/settings.json`), and the
 * project's under `.muse`.
 */
export function sparkHooksFiles(deps: Pick<HookLoadDeps, 'settingsPath' | 'workspaceRoot'>): {
  readonly user: string
  readonly project: string
} {
  return {
    user: path.join(path.dirname(deps.settingsPath), SPARK_HOOKS_SEGMENTS.user[1]),
    project: path.join(deps.workspaceRoot, ...SPARK_HOOKS_SEGMENTS.project),
  }
}

/** Muse Code matcher aliases for the Model API backend's built-in tools. */
export function toolMatcherNames(name: string): readonly string[] {
  switch (name) {
    case MODEL_API_TOOLS.bash:
    case MODEL_API_TOOLS.powershell: {
      return [name, 'Bash', 'shell']
    }
    case MODEL_API_TOOLS.readFile: {
      return [name, 'Read']
    }
    case MODEL_API_TOOLS.writeFile: {
      return [name, 'Write']
    }
    // A rename (M67) edits files as edit_file does: an `Edit` hook sees it too.
    case MODEL_API_TOOLS.editFile:
    case CODE_INTEL_TOOLS.renameSymbol: {
      return [name, 'Edit']
    }
    case MODEL_API_TOOLS.search: {
      return [name, 'Grep']
    }
    default: {
      return [name]
    }
  }
}

/** A hook's answer; an imported hook's may carry a documented replacement (M91 lane W). */
export type HookAnswer = TypedHookAnswer & {
  /** A foreign adapter's documented output replacement (never a native answer's). */
  readonly replacement?: HookReplacement | undefined
}

export interface HookDispatch {
  readonly blockedReason: string | undefined
  readonly contexts: readonly string[]
  readonly messages: readonly string[]
  readonly updatedInput: Record<string, unknown> | undefined
  readonly forceApproval: boolean
  readonly stopReason: string | undefined
  readonly approvalDecision: 'allow' | 'deny' | undefined
  /** The last replacement a foreign hook asked for; the caller applies it before packing. */
  readonly replacement?: HookReplacement | undefined
}

interface HookWaiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: () => void
}

const commandState = { running: 0 }
const commandWaiters: HookWaiter[] = []

function releaseCommand(): void {
  const next = commandWaiters.shift()
  if (next === undefined) {
    commandState.running -= 1
    return
  }
  next.signal?.removeEventListener('abort', next.onAbort)
  next.resolve()
}

/** One extension-host-wide cap: several sessions cannot spawn unlimited hooks. */
async function acquireCommand(signal: AbortSignal | undefined): Promise<() => void> {
  if (signal?.aborted === true) {
    throw new Error('hook command cancelled')
  }
  if (commandState.running < HOOK_MAX_RUNNING_COMMANDS) {
    commandState.running += 1
    return releaseCommand
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = commandWaiters.findIndex((candidate) => candidate.onAbort === onAbort)
      if (index !== -1) {
        commandWaiters.splice(index, 1)
      }
      reject(new Error('hook command cancelled'))
    }
    const waiter: HookWaiter = { resolve, reject, signal, onAbort }
    commandWaiters.push(waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) {
      onAbort()
    }
  })
  return releaseCommand
}

async function runBoundedHook(
  hook: HookDefinition,
  serialized: string,
  cwd: string,
  runner: NonNullable<ToolIo['runHook']>,
  signal: AbortSignal | undefined,
): Promise<ShellResult> {
  const release = await acquireCommand(signal)
  try {
    return await runner(
      hook.command,
      serialized,
      cwd,
      hook.timeoutSeconds * MILLISECONDS_PER_SECOND,
      signal,
      hook.extraEnvNames,
    )
  } finally {
    release()
  }
}

/** One typed handler through hookHandlers.ts, with the hook's timeout and onFailure. */
async function runTypedHook(
  hook: HookDefinition,
  event: HookEvent,
  serialized: string,
  cwd: string,
  runner: NonNullable<ToolIo['runHook']> | undefined,
  typed: TypedHookHandlers | undefined,
  signal: AbortSignal | undefined,
  warn: (message: string) => void,
): Promise<HookAnswer | undefined> {
  const type = hook.type ?? 'command'
  if (type === 'command') {
    throw new Error('a command handler never reaches the typed runner')
  }
  // The runners load with the hook runtime (dist/hookRuntime.js, M91); the
  // host lends them. Without them the handler is skipped, as without a runner.
  const run = typed?.runTyped
  if (run === undefined) {
    warn(`${event}: ${type} hook runner is unavailable`)
    return undefined
  }
  const timeout = AbortSignal.timeout(hook.timeoutSeconds * MILLISECONDS_PER_SECOND)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const runFallback = (): Promise<HookAnswer | undefined> =>
    runner === undefined || hook.onFailure === undefined
      ? Promise.resolve(undefined)
      : runHandler(hook.onFailure, event, serialized, cwd, runner, signal, warn)
  let answer: HookAnswer | undefined
  try {
    combined.throwIfAborted()
    answer = await unlessAborted(
      run(
        {
          type,
          event,
          source: hook.source,
          ...(hook.httpUrl !== undefined && { httpUrl: hook.httpUrl }),
          ...(hook.mcpServer !== undefined && { mcpServer: hook.mcpServer }),
          ...(hook.mcpTool !== undefined && { mcpTool: hook.mcpTool }),
          ...(hook.modelPrompt !== undefined && { modelPrompt: hook.modelPrompt }),
        },
        serialized,
        typed,
        combined,
        warn,
        (_eventName, exitCode, stdout, stderr) => {
          const answer = parseHookAnswer(event, exitCode, stdout, stderr)
          return {
            ...answer,
            approvalDecision:
              answer.approvalDecision === 'allow' ? undefined : answer.approvalDecision,
            permissionDecision:
              answer.permissionDecision === 'allow' ? undefined : answer.permissionDecision,
          }
        },
      ),
      combined,
    )
  } catch {
    if (signal?.aborted === true) {
      return undefined
    }
    warn(`${event}: ${hook.source} hook failed`)
    return await runFallback()
  }
  if (timeout.aborted && signal?.aborted !== true) {
    warn(`${event}: ${hook.source} hook timed out`)
    return await runFallback()
  }
  if (answer === undefined) {
    return undefined
  }
  if (answer.status === 'failed') {
    warn(`${event}: ${hook.source} hook failed`)
    return await runFallback()
  }
  return answer
}

async function runHandler(
  hook: HookDefinition,
  event: HookEvent,
  serialized: string,
  cwd: string,
  runner: NonNullable<ToolIo['runHook']>,
  signal: AbortSignal | undefined,
  warn: (message: string) => void,
): Promise<HookAnswer | undefined> {
  if ((hook.type ?? 'command') !== 'command') {
    throw new Error('a typed handler never reaches the command runner')
  }
  let result: ShellResult
  try {
    result = await runBoundedHook(hook, serialized, cwd, runner, signal)
  } catch {
    if (signal?.aborted === true) {
      return undefined
    }
    // Spawn errors can echo a command line. Never put hook source or stderr
    // into the extension log: a configured command may contain a credential.
    warn(`${event}: ${hook.source} hook could not start`)
    return hook.onFailure === undefined
      ? undefined
      : await runHandler(hook.onFailure, event, serialized, cwd, runner, signal, warn)
  }
  if (result.isCancelled) {
    return undefined
  }
  if (result.isTimedOut || result.isOutputTooLarge === true) {
    warn(
      `${event}: ${hook.source} hook ${result.isTimedOut ? 'timed out' : 'exceeded output limit'}`,
    )
    return hook.onFailure === undefined
      ? undefined
      : await runHandler(hook.onFailure, event, serialized, cwd, runner, signal, warn)
  }
  const answer = parseHookAnswer(event, result.exitCode, result.stdout, result.stderr)
  if (answer.status === 'failed') {
    warn(`${event}: ${hook.source} hook failed (exit ${String(result.exitCode)})`)
    return result.exitCode !== 0 && hook.onFailure !== undefined
      ? await runHandler(hook.onFailure, event, serialized, cwd, runner, signal, warn)
      : undefined
  }
  return answer
}

/** A foreign answer's grant, if it ever carried one, removed: no hook grants (M51, D70). */
function withoutGrant(answer: HookAnswer): HookAnswer {
  return {
    ...answer,
    permissionDecision:
      answer.permissionDecision === 'allow' ? undefined : answer.permissionDecision,
    approvalDecision: answer.approvalDecision === 'allow' ? undefined : answer.approvalDecision,
  }
}

/**
 * A plugin hook (M91b) under the same host-wide cap as every hook process;
 * its answer goes through the same judge, so no grant survives and a
 * failure never becomes feedback. A cancelled call answers nothing.
 */
async function runPluginHandler(
  run: (signal: AbortSignal | undefined) => Promise<HookAnswer>,
  signal: AbortSignal | undefined,
  judgeAnswer: (answer: HookAnswer) => HookAnswer | undefined,
  onUnstarted: () => void,
): Promise<HookAnswer | undefined> {
  let release: () => void
  try {
    release = await acquireCommand(signal)
  } catch {
    return undefined
  }
  try {
    const answer = await run(signal)
    return signal?.aborted === true ? undefined : judgeAnswer(answer)
  } catch {
    if (signal?.aborted === true) {
      return undefined
    }
    onUnstarted()
    return judgeAnswer({ status: 'failed', reason: 'the plugin could not start' })
  } finally {
    release()
  }
}

/**
 * One imported hook (M91 lane W): its adapter builds the stdin its source
 * agent would send, the process runs under the same cap, environment and
 * kill as a native hook, and the adapter reads the ending by that source's
 * rules. A timeout is told apart from a crash, since Copilot lets a timed-out
 * guard through and Cursor's failClosed blocks on either. A failure never
 * becomes feedback, and an answer is never a grant.
 */
async function runForeignHandler(
  hook: HookDefinition,
  spec: ForeignHookSpec,
  event: HookEvent,
  payload: Readonly<Record<string, unknown>>,
  runner: NonNullable<ToolIo['runHook']>,
  signal: AbortSignal | undefined,
  adapter: ForeignHookAdapter,
  context: ForeignDispatchContext | undefined,
  warn: (message: string) => void,
): Promise<HookAnswer | undefined> {
  const label = `${event}: ${spec.format}-format ${hook.source} hook`
  const judgeAnswer = (given: HookAnswer): HookAnswer | undefined => {
    const answer = withoutGrant(given)
    if (answer.status !== 'failed') {
      return answer
    }
    warn(`${label} failed`)
    return answer.systemMessage === undefined
      ? undefined
      : { status: 'completed', systemMessage: answer.systemMessage }
  }
  const judge = (result: ForeignRunResult): HookAnswer | undefined =>
    judgeAnswer(adapter.answer(hook, spec, event, result, payload))
  let prepared: ForeignPreparation
  try {
    prepared = await adapter.prepare(hook, spec, event, payload, context)
  } catch {
    prepared = { outcome: 'refused', reason: 'its input could not be prepared' }
  }
  if (prepared.outcome === 'skip') {
    return undefined
  }
  if (prepared.outcome === 'refused') {
    warn(`${label} was not started: ${prepared.reason}`)
    return judge({
      kind: 'refused',
      reason: prepared.reason,
      ...(prepared.blockOperation === true && { blockOperation: true }),
    })
  }
  if (prepared.outcome === 'plugin') {
    return await runPluginHandler(prepared.run, signal, judgeAnswer, () => {
      warn(`${label} could not start`)
    })
  }
  if (Buffer.byteLength(prepared.stdin) > HOOK_STDIN_MAX_BYTES) {
    warn(`${label} input exceeds limit; it was not started`)
    return judge({ kind: 'refused', reason: 'hook input exceeds limit' })
  }
  let result: ShellResult
  try {
    const run = prepared.command === undefined ? hook : { ...hook, command: prepared.command }
    result = await runBoundedHook(run, prepared.stdin, prepared.cwd, runner, signal)
  } catch {
    if (signal?.aborted === true) {
      return undefined
    }
    warn(`${label} could not start`)
    return judge({ kind: 'crash' })
  }
  if (result.isCancelled) {
    return undefined
  }
  if (result.isTimedOut) {
    warn(`${label} timed out`)
    return judge({ kind: 'timeout' })
  }
  if (result.isOutputTooLarge === true) {
    warn(`${label} exceeded output limit`)
    return judge({ kind: 'crash' })
  }
  return judge({
    kind: 'exit',
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

/**
 * Execute matching handlers. No hook can grant a tool permission or paid use.
 * Imported hooks run only through `adapter`; without one they are skipped.
 */
export async function dispatchHooks(
  hooks: readonly HookDefinition[],
  event: HookEvent,
  payload: Readonly<Record<string, unknown>>,
  matcherValue: string | readonly string[] | undefined,
  io: Pick<ToolIo, 'runHook'>,
  signal: AbortSignal | undefined,
  warn: (message: string) => void,
  typed?: TypedHookHandlers,
  adapter?: ForeignHookAdapter,
  context?: ForeignDispatchContext,
  trackAsync?: (execution: Promise<unknown>) => void,
): Promise<HookDispatch> {
  const selected = matchingHooks(hooks, event, matcherValue, warn)
  const serialized = JSON.stringify(payload)
  if (Buffer.byteLength(serialized) > HOOK_STDIN_MAX_BYTES) {
    warn(`${event}: hook input exceeds limit; no hook was started`)
    return {
      blockedReason: undefined,
      contexts: [],
      messages: [],
      updatedInput: undefined,
      forceApproval: false,
      stopReason: undefined,
      approvalDecision: undefined,
    }
  }
  const runner = io.runHook
  if (runner === undefined && selected.some((hook) => (hook.type ?? 'command') === 'command')) {
    warn(`${event}: hook runner is unavailable`)
  }
  const contexts: string[] = []
  const messages: string[] = []
  let blockedReason: string | undefined
  let updatedInput: Record<string, unknown> | undefined
  let isForceApproval = false
  let stopReason: string | undefined
  let approvalDecision: 'allow' | 'deny' | undefined
  let replacement: HookReplacement | undefined
  const executions =
    signal?.aborted === true
      ? []
      : selected.map(async (hook) => {
          const { foreign } = hook
          if (foreign !== undefined) {
            if (adapter === undefined || runner === undefined) {
              warn(`${event}: ${foreign.format}-format hook skipped: no adapter here`)
              return
            }
            return await runForeignHandler(
              hook,
              foreign,
              event,
              payload,
              runner,
              signal,
              adapter,
              context,
              warn,
            )
          }
          if ((hook.type ?? 'command') === 'command') {
            return runner === undefined
              ? undefined
              : await runHandler(
                  hook,
                  event,
                  serialized,
                  String(payload['cwd']),
                  runner,
                  signal,
                  warn,
                )
          }
          return await runTypedHook(
            hook,
            event,
            serialized,
            String(payload['cwd']),
            runner,
            typed,
            signal,
            warn,
          )
        })
  for (const [index, execution] of executions.entries()) {
    const hook = selected[index]
    if (hook?.isAsync === true) {
      trackAsync?.(execution)
      void execution.catch(() => {
        warn(`${event}: asynchronous hook failed`)
      })
      continue
    }
    const answer = await execution
    if (answer === undefined) {
      continue
    }
    if (answer.context !== undefined) {
      contexts.push(answer.context)
    }
    if (answer.systemMessage !== undefined) {
      messages.push(answer.systemMessage)
    }
    // Muse applies continue:false before any decision from that handler.
    if (answer.stopReason !== undefined) {
      stopReason ??= answer.stopReason
      // Only an imported hook stops at PreToolUse (Muse's parser refuses
      // continue there): Amp's tool.call `error` ends the thread, so the
      // call it guarded never runs either (M91b).
      if (event === 'PreToolUse' && answer.status === 'blocked') {
        blockedReason ??= answer.reason ?? answer.stopReason
      }
      continue
    }
    if (
      answer.status === 'blocked' ||
      (FEEDBACK_EVENTS.has(event) && answer.reason !== undefined)
    ) {
      blockedReason ??= answer.reason ?? 'blocked by hook'
    }
    if (answer.updatedInput !== undefined) {
      updatedInput = answer.updatedInput
    }
    if (answer.replacement !== undefined) {
      replacement = answer.replacement
    }
    if (answer.permissionDecision === 'ask') {
      isForceApproval = true
    }
    if (answer.approvalDecision === undefined) {
      continue
    }

    approvalDecision = answer.approvalDecision
    if (answer.approvalDecision === 'deny') {
      blockedReason ??= answer.reason ?? 'approval denied by hook'
    }
  }
  return {
    blockedReason,
    contexts,
    messages,
    updatedInput,
    forceApproval: isForceApproval,
    stopReason,
    approvalDecision,
    ...(replacement !== undefined && { replacement }),
  }
}

const outputShape = z.object({
  systemMessage: z.optional(z.string()),
  suppressOutput: z.optional(z.boolean()),
  continue: z.optional(z.boolean()),
  stopReason: z.optional(z.string()),
  decision: z.optional(
    z.union([
      z.literal('block'),
      z.object({ behavior: z.enum(['allow', 'deny']), message: z.optional(z.string()) }),
    ]),
  ),
  reason: z.optional(z.string()),
  hookSpecificOutput: z.optional(
    z.object({
      hookEventName: z.string(),
      additionalContext: z.optional(z.string()),
      permissionDecision: z.optional(z.enum(['deny', 'ask', 'allow'])),
      permissionDecisionReason: z.optional(z.string()),
      updatedInput: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
      decision: z.optional(
        z.object({ behavior: z.enum(['allow', 'deny']), message: z.optional(z.string()) }),
      ),
    }),
  ),
})
const OUTPUT_FIELDS = new Set([
  'systemMessage',
  'suppressOutput',
  'continue',
  'stopReason',
  'decision',
  'reason',
  'hookSpecificOutput',
])
const SPECIFIC_FIELDS = new Set([
  'hookEventName',
  'additionalContext',
  'permissionDecision',
  'permissionDecisionReason',
  'updatedInput',
  'decision',
])
const APPROVAL_FIELDS = new Set(['behavior', 'message'])

function hasExtraFields(value: unknown, allowed: ReadonlySet<string>): boolean {
  return isRecord(value) && Object.keys(value).some((key) => !allowed.has(key))
}

const BLOCKABLE_EVENTS = new Set<HookEvent>([
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PreLLMCall',
  'PostLLMCall',
  'SubagentStop',
  'Stop',
])
const FEEDBACK_EVENTS = new Set<HookEvent>(['PostToolUse', 'PostToolUseFailure'])
const CONTEXT_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'SubagentStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PreLLMCall',
  'PostLLMCall',
])
const PLAIN_CONTEXT_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
])
const CONTINUE_FORBIDDEN_EVENTS = new Set<HookEvent>([
  'PreToolUse',
  'PermissionRequest',
  'Notification',
])
const STOP_EFFECT_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PreCompact',
  'SubagentStop',
  'Stop',
])

/** Parse one command answer. Invalid JSON never grants a permission. */
export function parseHookAnswer(
  event: HookEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): HookAnswer {
  if (exitCode === 2 && BLOCKABLE_EVENTS.has(event) && stderr.trim() !== '') {
    return {
      status: event === 'PostToolUseFailure' ? 'completed' : 'blocked',
      reason: stderr.trim(),
    }
  }
  if (exitCode !== 0) {
    return { status: 'failed', reason: stderr.trim() || `hook exited ${String(exitCode)}` }
  }
  const trimmed = stdout.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return {
      status: 'completed',
      ...(trimmed !== '' && PLAIN_CONTEXT_EVENTS.has(event) && { context: stdout }),
    }
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return { status: 'failed', reason: 'hook output is not valid JSON' }
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !OUTPUT_FIELDS.has(key))) {
    return { status: 'failed', reason: 'hook output has unsupported fields' }
  }
  if (
    hasExtraFields(value.hookSpecificOutput, SPECIFIC_FIELDS) ||
    hasExtraFields(value.decision, APPROVAL_FIELDS) ||
    (isRecord(value.hookSpecificOutput) &&
      hasExtraFields(value.hookSpecificOutput.decision, APPROVAL_FIELDS))
  ) {
    return { status: 'failed', reason: 'hook output has unsupported nested fields' }
  }
  const parsed = outputShape.safeParse(value)
  if (!parsed.success) {
    return { status: 'failed', reason: 'hook output has invalid fields' }
  }
  const result = parsed.data
  const specific = result.hookSpecificOutput
  if (specific !== undefined && specific.hookEventName !== event) {
    return { status: 'failed', reason: 'hookEventName does not match event' }
  }
  if (event !== 'PreToolUse' && specific?.permissionDecision !== undefined) {
    return { status: 'failed', reason: 'permissionDecision is not valid on this event' }
  }
  // The 1.4.0 changelog lets a PostToolUseFailure hook return updatedInput: a
  // corrected call to the same tool, re-run through the full path (M91 lane
  // R). Every other event still refuses it.
  if (
    event !== 'PreToolUse' &&
    event !== 'PostToolUseFailure' &&
    specific?.updatedInput !== undefined
  ) {
    return { status: 'failed', reason: 'updatedInput is not valid on this event' }
  }
  if (specific?.permissionDecision === 'deny' && !specific.permissionDecisionReason?.trim()) {
    return { status: 'failed', reason: 'deny needs permissionDecisionReason' }
  }
  if (
    specific?.permissionDecision === 'allow' &&
    (specific.updatedInput === undefined || specific.updatedInput === null)
  ) {
    return { status: 'failed', reason: 'allow needs updatedInput' }
  }
  if (
    specific?.permissionDecision === undefined &&
    specific?.permissionDecisionReason !== undefined
  ) {
    return { status: 'failed', reason: 'permissionDecisionReason needs permissionDecision' }
  }
  if (specific?.additionalContext !== undefined && !CONTEXT_EVENTS.has(event)) {
    return { status: 'failed', reason: `${event} cannot add model context` }
  }
  if (result.continue !== undefined && CONTINUE_FORBIDDEN_EVENTS.has(event)) {
    return { status: 'failed', reason: `${event} cannot stop the turn` }
  }
  const approval = typeof result.decision === 'object' ? result.decision : specific?.decision
  if (approval !== undefined && event !== 'PermissionRequest') {
    return { status: 'failed', reason: 'permission decision is only valid on PermissionRequest' }
  }
  if (result.decision === 'block' && !BLOCKABLE_EVENTS.has(event)) {
    return { status: 'failed', reason: `${event} cannot block` }
  }
  if (result.reason !== undefined && result.decision !== 'block') {
    return { status: 'failed', reason: 'reason needs a block decision' }
  }
  if (result.stopReason !== undefined && result.continue === undefined) {
    return { status: 'failed', reason: 'stopReason needs continue' }
  }
  const isBlock = result.decision === 'block' && BLOCKABLE_EVENTS.has(event)
  if (isBlock && !result.reason?.trim()) {
    return { status: 'failed', reason: 'block needs a reason' }
  }
  return {
    status:
      (isBlock && event !== 'PostToolUseFailure') ||
      specific?.permissionDecision === 'deny' ||
      approval?.behavior === 'deny'
        ? 'blocked'
        : 'completed',
    reason: isBlock ? result.reason : (specific?.permissionDecisionReason ?? approval?.message),
    context: specific?.additionalContext,
    systemMessage:
      result.systemMessage === undefined
        ? undefined
        : Array.from(result.systemMessage, (character) => {
            const code = character.codePointAt(0) ?? HOOK_CONTROL_CODE_LIMIT
            return code === HOOK_DELETE_CODE ||
              (code !== HOOK_NEWLINE_CODE && code < HOOK_CONTROL_CODE_LIMIT)
              ? ' '
              : character
          })
            .join('')
            .slice(0, HOOK_SYSTEM_MESSAGE_MAX_CHARS),
    permissionDecision: specific?.permissionDecision,
    updatedInput: specific?.updatedInput ?? undefined,
    stopReason:
      result.continue === false && STOP_EFFECT_EVENTS.has(event)
        ? (result.stopReason ?? 'stopped by hook')
        : undefined,
    approvalDecision: approval?.behavior,
  }
}
