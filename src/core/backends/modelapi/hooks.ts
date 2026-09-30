// Muse Code's settings-level hook shape, used by Model API sessions (M51).
// The config, matcher and result contracts are documented by Muse Code SDK
// 1.3.0: https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/
// and https://meta-models.github.io/muse-code-sdk/next/guides/plugins/reference/hook-events/.

import * as z from 'zod/mini'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { createContext, Script } from 'node:vm'
import {
  HOOK_CONFIG_MAX_BYTES,
  HOOK_DEFAULT_TIMEOUT_SECONDS,
  HOOK_FORBIDDEN_ENV_NAMES,
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
  PROJECT_HOOKS_SEGMENTS,
} from '../../../shared/constants'
import { type ContextIo, decodeContextText } from '../../context/contextFiles'
import { confineWorkspacePath } from '../../workspacePath'
import type { ShellResult, ToolIo } from './tools'

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
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]
export type HookSource = 'managed' | 'user' | 'project'
const HOOK_EVENT_NAMES: ReadonlySet<string> = new Set(HOOK_EVENTS)

export interface HookDefinition {
  readonly event: HookEvent
  readonly source: HookSource
  readonly command: string
  readonly timeoutSeconds: number
  readonly matcher: HookMatcher | undefined
  readonly extraEnvNames?: readonly string[]
  readonly isAsync: boolean
  readonly onFailure?: HookDefinition
}

type HookMatcher =
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
  'timeout',
  'statusMessage',
  'async',
  'onFailure',
  'outputCapabilities',
  'silent',
  'if',
])
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
  if (event === 'PostToolBatch') {
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

function isMatch(matcher: HookMatcher, name: string, warn: (message: string) => void): boolean {
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
    const matched: unknown = MATCH_SCRIPT.runInContext(MATCH_CONTEXT, {
      timeout: HOOK_MATCHER_TIMEOUT_MS,
    })
    return matched === true
  } catch {
    warn('hook regular-expression matcher timed out or failed')
    return false
  }
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
  if (value.type !== 'command') {
    return 'handler type must be command'
  }
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
  if (value.statusMessage !== undefined && typeof value.statusMessage !== 'string') {
    return 'handler statusMessage must be a string'
  }
  if (value.outputCapabilities !== undefined || value.if !== undefined) {
    // A selector we do not evaluate must not widen execution.
    return 'handler uses an unsupported selector or output capability'
  }
  const platformCommand =
    platform === 'win32'
      ? (value.commandWindows ?? value.command_windows ?? value.command)
      : value.command
  if (typeof platformCommand !== 'string' || platformCommand.trim() === '') {
    return 'handler command is empty or unavailable on this platform'
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
    onFailure = nested
  }
  return {
    event,
    source,
    command: platformCommand,
    timeoutSeconds: Math.max(
      typeof value.timeout === 'number' ? value.timeout : HOOK_DEFAULT_TIMEOUT_SECONDS,
      1,
    ),
    matcher,
    isAsync: value.async === true,
    ...(onFailure !== undefined && { onFailure }),
  }
}

/** Invalid typed fields reject one whole source; unknown entries warn and skip. */
export function parseHookConfig(
  text: string | undefined,
  source: HookSource,
  platform: NodeJS.Platform,
): HookConfigResult {
  if (text === undefined) {
    return { hooks: [], warnings: [] }
  }
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return { hooks: [], warnings: [`${source} hooks: invalid JSON`] }
  }
  if (!isRecord(document) || !isRecord(document.hooks)) {
    return { hooks: [], warnings: [`${source} hooks: missing hooks object`] }
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

/** Matcher grammar is from Muse Code 1.3.0; tool aliases are resolved by caller. */
export function matchingHooks(
  hooks: readonly HookDefinition[],
  event: HookEvent,
  value: string | readonly string[] | undefined,
  warn: (message: string) => void = () => {
    // A caller without a diagnostic sink still gets safe nonmatches.
  },
): readonly HookDefinition[] {
  const normalized = typeof value === 'string' ? [value] : value
  const values = normalized ?? ['']
  return hooks.filter((hook) => {
    const { matcher } = hook
    return (
      hook.event === event &&
      (matcher === undefined || values.some((name) => isMatch(matcher, name, warn)))
    )
  })
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

export interface HookAnswer {
  readonly status: 'completed' | 'blocked' | 'failed'
  readonly reason?: string | undefined
  readonly context?: string | undefined
  readonly systemMessage?: string | undefined
  readonly permissionDecision?: 'deny' | 'ask' | 'allow' | undefined
  readonly updatedInput?: Record<string, unknown> | undefined
  readonly stopReason?: string | undefined
  readonly approvalDecision?: 'allow' | 'deny' | undefined
}

export interface HookDispatch {
  readonly blockedReason: string | undefined
  readonly contexts: readonly string[]
  readonly messages: readonly string[]
  readonly updatedInput: Record<string, unknown> | undefined
  readonly forceApproval: boolean
  readonly stopReason: string | undefined
  readonly approvalDecision: 'allow' | 'deny' | undefined
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

async function runHandler(
  hook: HookDefinition,
  event: HookEvent,
  serialized: string,
  cwd: string,
  runner: NonNullable<ToolIo['runHook']>,
  signal: AbortSignal | undefined,
  warn: (message: string) => void,
): Promise<HookAnswer | undefined> {
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

/** Execute matching commands. No hook can grant a tool permission or paid use. */
export async function dispatchHooks(
  hooks: readonly HookDefinition[],
  event: HookEvent,
  payload: Readonly<Record<string, unknown>>,
  matcherValue: string | readonly string[] | undefined,
  io: Pick<ToolIo, 'runHook'>,
  signal: AbortSignal | undefined,
  warn: (message: string) => void,
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
  if (runner === undefined && selected.length > 0) {
    warn(`${event}: hook runner is unavailable`)
  }
  const contexts: string[] = []
  const messages: string[] = []
  let blockedReason: string | undefined
  let updatedInput: Record<string, unknown> | undefined
  let isForceApproval = false
  let stopReason: string | undefined
  let approvalDecision: 'allow' | 'deny' | undefined
  const executions =
    runner === undefined || signal?.aborted === true
      ? []
      : selected.map((hook) =>
          runHandler(hook, event, serialized, String(payload['cwd']), runner, signal, warn),
        )
  for (const [index, execution] of executions.entries()) {
    const hook = selected[index]
    if (hook?.isAsync === true) {
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
  if (event !== 'PreToolUse' && specific?.updatedInput !== undefined) {
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
