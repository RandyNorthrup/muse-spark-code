// The extension's own hook events (M91 lane E, PLAN.md D70): the 21 names in
// `EXTENSION_HOOK_EVENTS` that Muse Code never reads, configured in
// `spark-hooks.json` (project `.muse/spark-hooks.json`, user
// `<config>/muse/spark-hooks.json` via `SPARK_HOOKS_SEGMENTS`).
//
// Payloads follow Claude Code's documented hook fields
// (https://code.claude.com/docs/en/hooks): the envelope carries
// `hook_event_name`, `session_id`, `cwd`, `transcript_path` and
// `permission_mode`, and each event adds its documented fields. Fields this
// runtime adds (`turn_id`, `model`, `model_provider`, the per-event extras)
// are marked below. Answers follow the same contract: exit 0 parses stdout
// as JSON, exit 2 with stderr is a refusal on the events that can refuse,
// any other non-zero exit fails the hook.
//
// Turn-bound events run on the Model API backend only; FileChanged,
// ConfigChange, Setup, Manual and DirectoryAdded run on both backends from
// the host side. `hooks.ts` stays the Muse Code backend's file: this module
// never touches it, it only borrows the shared tunables from lane 0.

import * as z from 'zod/mini'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import {
  EXTENSION_HOOK_EVENTS,
  HOOK_CONFIG_MAX_BYTES,
  HOOK_CONTROL_CODE_LIMIT,
  HOOK_DELETE_CODE,
  HOOK_DISPLAY_MESSAGE_MAX_CHARS,
  HOOK_EXPANSION_MAX_CHARS,
  HOOK_FILE_CHANGED_DEBOUNCE_MS,
  HOOK_FILE_CHANGED_MAX_PER_MINUTE,
  HOOK_MATCHER_MAX_CHARS,
  HOOK_MATCHER_VALUE_MAX_CHARS,
  HOOK_NEWLINE_CODE,
  HOOK_ON_FAILURE_MAX_DEPTH,
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_SOURCE_MAX_HANDLERS,
  HOOK_STDIN_MAX_BYTES,
  HOOK_SYSTEM_MESSAGE_MAX_CHARS,
  HOOK_TASK_DESCRIPTION_MAX_CHARS,
  HOOK_TASK_SUBJECT_MAX_CHARS,
  HOOK_THOUGHT_MAX_CHARS,
  HOOK_TOTAL_MAX_HANDLERS,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '../../../shared/constants'
import {
  HOOK_EVENTS,
  parseHookConfig,
  type HookDefinition,
  type HookLoadDeps,
  type HookSource,
  sparkHooksFiles,
} from './hooks'
import { compileGlob } from './globLimits'
import { boundedHookText } from './toolHookPayload'
import type { ContextIo } from '../../context/contextFiles'
import { decodeContextText } from '../../context/contextFiles'
import { confineWorkspacePath } from '../../workspacePath'
import type { ShellResult } from '../../shellResult'
import { NO_EXTENSION_HOOK_DISPATCH } from '../../agent/agentBackend'

export type ExtensionHookEvent = (typeof EXTENSION_HOOK_EVENTS)[number]
const EXTENSION_EVENT_NAMES: ReadonlySet<string> = new Set(EXTENSION_HOOK_EVENTS)
const MUSE_EVENT_NAMES: ReadonlySet<string> = new Set(HOOK_EVENTS)

function isExtensionEvent(name: string): name is ExtensionHookEvent {
  return EXTENSION_EVENT_NAMES.has(name)
}

/** The events whose hook may refuse the operation, with the reason shown. */
const REFUSABLE_EVENTS: ReadonlySet<ExtensionHookEvent> = new Set([
  'UserPromptExpansion',
  'PreModelSwitch',
  'TaskCreated',
  'TaskCompleted',
])
/** Elicitation and TeammateIdle decide too, with their own meaning. */
const DECISION_EVENTS: ReadonlySet<ExtensionHookEvent> = new Set([
  ...REFUSABLE_EVENTS,
  'Elicitation',
  'TeammateIdle',
])
/**
 * The turn-bound events whose `additionalContext` is appended at the tail of
 * the turn (SoL-Pi rule 2). Anywhere else a hook sends context, the answer is
 * refused: outside a turn it has nowhere to go.
 */
const CONTEXT_EVENTS: ReadonlySet<ExtensionHookEvent> = new Set([
  'InstructionsLoaded',
  'UserPromptExpansion',
  'PermissionDenied',
  'PreModelSwitch',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'BeforeToolSelection',
  'AfterAgentThought',
])

export type ExtensionHookMatcher =
  | { readonly kind: 'exact'; readonly names: ReadonlySet<string> }
  | { readonly kind: 'glob'; readonly patterns: readonly string[] }

/** Events whose matcher selects workspace-relative paths (glob or exact). */
const PATH_MATCHED_EVENTS: ReadonlySet<ExtensionHookEvent> = new Set([
  'InstructionsLoaded',
  'FileChanged',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'DirectoryAdded',
])
/** Events whose matcher selects names (a skill, a tool, a task subject…). */
const NAME_MATCHED_EVENTS: ReadonlySet<ExtensionHookEvent> = new Set([
  'UserPromptExpansion',
  'PermissionDenied',
  'TaskCreated',
  'TaskCompleted',
  'Setup',
  'Elicitation',
  'TeammateIdle',
])

export interface ExtensionHookDefinition {
  readonly event: ExtensionHookEvent
  readonly source: HookSource
  readonly command: string
  readonly timeoutSeconds: number
  readonly matcher: ExtensionHookMatcher | undefined
  readonly isAsync: boolean
  /** The group's own words, for the Run Hook pick (M91 lane E). */
  readonly description?: string | undefined
  readonly onFailure?: ExtensionHookDefinition | undefined
}

const MATCH_EXACT = /^[A-Za-z0-9_|]+$/
const MATCH_EVERYTHING = new Set(['', '*'])
const SETUP_TRIGGERS = new Set(['init', 'maintenance'])
export type SetupTrigger = 'init' | 'maintenance'

function matcherFor(
  event: ExtensionHookEvent,
  value: unknown,
): ExtensionHookMatcher | undefined | string {
  if (value === undefined || value === '') {
    return event === 'FileChanged'
      ? 'FileChanged needs a matcher: an empty matcher watches nothing'
      : undefined
  }
  if (typeof value !== 'string') {
    return 'matcher must be a string'
  }
  if (MATCH_EVERYTHING.has(value)) {
    return undefined
  }
  if (value.length > HOOK_MATCHER_MAX_CHARS) {
    return 'matcher is too long'
  }
  if (event === 'Setup') {
    const names = value.split('|')
    return names.every((name) => SETUP_TRIGGERS.has(name))
      ? { kind: 'exact', names: new Set(names) }
      : 'Setup matcher must be init or maintenance'
  }
  if (PATH_MATCHED_EVENTS.has(event)) {
    return MATCH_EXACT.test(value)
      ? { kind: 'exact', names: new Set(value.split('|')) }
      : { kind: 'glob', patterns: [value] }
  }
  if (NAME_MATCHED_EVENTS.has(event)) {
    return MATCH_EXACT.test(value)
      ? { kind: 'exact', names: new Set(value.split('|')) }
      : 'matcher must be a name or names'
  }
  return `matcher is not valid for ${event}`
}

function isExtensionMatch(
  matcher: ExtensionHookMatcher | undefined,
  value: string | undefined,
  warn: (message: string) => void,
): boolean {
  if (matcher === undefined) {
    return true
  }
  if (value === undefined) {
    return false
  }
  if (matcher.kind === 'exact') {
    return matcher.names.has(value)
  }
  if (value.length > HOOK_MATCHER_VALUE_MAX_CHARS) {
    warn('hook matcher value is too long')
    return false
  }
  return matcher.patterns.some((pattern) => {
    try {
      return compileGlob(pattern)(value)
    } catch {
      warn(`hook matcher glob ${pattern} is invalid`)
      return false
    }
  })
}

/** Known fields stay `unknown` until each boundary check accepts their shape. */
interface SparkHookRecord extends Record<string, unknown> {
  readonly hooks?: unknown
  readonly type?: unknown
  readonly timeout?: unknown
  readonly async?: unknown
  readonly commandWindows?: unknown
  readonly command_windows?: unknown
  readonly command?: unknown
  readonly onFailure?: unknown
  readonly matcher?: unknown
}

function isRecord(value: unknown): value is SparkHookRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SPARK_HANDLER_FIELDS = new Set([
  'type',
  'command',
  'commandWindows',
  'command_windows',
  'timeout',
  'async',
  'onFailure',
])
const SPARK_GROUP_FIELDS = new Set(['matcher', 'hooks', 'description'])

function sparkHandler(
  value: unknown,
  event: ExtensionHookEvent,
  source: HookSource,
  platform: NodeJS.Platform,
  matcher: ExtensionHookMatcher | undefined,
  depth = 0,
): ExtensionHookDefinition | string {
  if (!isRecord(value)) {
    return 'handler must be an object'
  }
  const unknownField = Object.keys(value).find((key) => !SPARK_HANDLER_FIELDS.has(key))
  if (unknownField !== undefined) {
    return `unsupported handler field ${unknownField}`
  }
  if (depth > 0 && value.async === true) {
    return 'onFailure cannot be asynchronous'
  }
  // Lane H's typed handlers run on the five Muse Code events Claude Code
  // allows them on; an extension event takes a command (M91 lane W).
  if (value.type !== 'command') {
    return 'handler type must be command'
  }
  if (value.onFailure !== undefined) {
    if (depth >= HOOK_ON_FAILURE_MAX_DEPTH) {
      return 'onFailure exceeds three levels'
    }
    const nested = sparkHandler(value.onFailure, event, source, platform, undefined, depth + 1)
    if (typeof nested === 'string') {
      return `onFailure: ${nested}`
    }
  }
  // Reuse M51's handler validation. PreToolUse is a parse-only envelope:
  // the definition is relabelled, never dispatched as a Muse Code event.
  const checked = parseHookConfig(
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [value] }] } }),
    source,
    platform,
  )
  const definition = checked.hooks[0]
  const diagnostic = checked.warnings[0]?.replace(`${source} hooks: PreToolUse: `, '')
  return definition === undefined
    ? (diagnostic ?? 'invalid command handler')
    : extensionDefinition(definition, event, matcher)
}

function extensionDefinition(
  hook: HookDefinition,
  event: ExtensionHookEvent,
  matcher: ExtensionHookMatcher | undefined,
): ExtensionHookDefinition {
  const { onFailure, ...common } = hook
  return {
    ...common,
    event,
    matcher,
    ...(onFailure !== undefined && { onFailure: extensionDefinition(onFailure, event, undefined) }),
  }
}

const sparkDocumentSchema = z.object({ hooks: z.record(z.string(), z.unknown()) })

export interface SparkHookConfigResult {
  readonly hooks: readonly ExtensionHookDefinition[]
  readonly warnings: readonly string[]
}

/**
 * Parse one spark-hooks.json file. A Muse Code event name is refused with a
 * warning (it belongs in `.muse/hooks.json`, where it runs once); an unknown
 * name warns and is skipped while the rest of the file stays in effect.
 */
export function parseSparkHooksConfig(
  text: string | undefined,
  source: Extract<HookSource, 'user' | 'project'>,
  platform: NodeJS.Platform,
): SparkHookConfigResult {
  if (text === undefined) {
    return { hooks: [], warnings: [] }
  }
  let document: z.infer<typeof sparkDocumentSchema>
  try {
    document = sparkDocumentSchema.parse(JSON.parse(text))
  } catch (error: unknown) {
    const reason = error instanceof SyntaxError ? 'invalid JSON' : 'missing hooks object'
    return { hooks: [], warnings: [`${source} spark-hooks.json: ${reason}`] }
  }
  const warnings: string[] = []
  const hooks: ExtensionHookDefinition[] = []
  for (const [name, groups] of Object.entries(document.hooks)) {
    if (MUSE_EVENT_NAMES.has(name)) {
      warnings.push(
        `${source} spark-hooks.json: ${name} is a Muse Code event: configure it in .muse/hooks.json, so it runs once`,
      )
      continue
    }
    if (!isExtensionEvent(name)) {
      warnings.push(`${source} spark-hooks.json: unsupported event ${name}`)
      continue
    }
    if (!Array.isArray(groups)) {
      return { hooks: [], warnings: [`${source} spark-hooks.json: ${name} must be an array`] }
    }
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        return { hooks: [], warnings: [`${source} spark-hooks.json: ${name} has an invalid group`] }
      }
      const extraGroupField = Object.keys(group).find((key) => !SPARK_GROUP_FIELDS.has(key))
      if (extraGroupField !== undefined) {
        warnings.push(
          `${source} spark-hooks.json: ${name} has unsupported group field ${extraGroupField}`,
        )
        continue
      }
      const matcher = matcherFor(name, group.matcher)
      if (typeof matcher === 'string') {
        warnings.push(`${source} spark-hooks.json: ${name}: ${matcher}`)
        continue
      }
      for (const entry of group.hooks) {
        const parsed = sparkHandler(entry, name, source, platform, matcher)
        if (typeof parsed === 'string') {
          if (
            parsed.includes('must be a non-negative integer') ||
            parsed.includes('must be a boolean')
          ) {
            return { hooks: [], warnings: [`${source} spark-hooks.json: ${name}: ${parsed}`] }
          }
          warnings.push(`${source} spark-hooks.json: ${name}: ${parsed}`)
        } else {
          if (hooks.length >= HOOK_SOURCE_MAX_HANDLERS) {
            return { hooks: [], warnings: [`${source} spark-hooks.json exceeds the handler limit`] }
          }
          const description = group['description']
          hooks.push(
            typeof description === 'string' && description.trim() !== ''
              ? { ...parsed, description: description.trim() }
              : parsed,
          )
        }
      }
    }
  }
  return { hooks, warnings }
}

async function readSparkText(
  io: ContextIo,
  file: string,
  confinedTo: string | undefined,
  platform: NodeJS.Platform,
  warn: (message: string) => void,
): Promise<string | undefined> {
  try {
    if (confinedTo !== undefined) {
      const resolution = await confineWorkspacePath(confinedTo, file, platform, io)
      if (!resolution.ok) {
        warn(`${path.basename(file)}: ${resolution.reason}`)
        return undefined
      }
    }
    const bytes = await io.readFile(file)
    if (bytes === undefined) {
      return undefined
    }
    if (bytes.length > HOOK_CONFIG_MAX_BYTES) {
      warn(`${path.basename(file)}: hook configuration is too large`)
      return undefined
    }
    const decoded = decodeContextText(bytes)
    if (!decoded.ok) {
      warn(`${path.basename(file)}: ${decoded.reason}`)
      return undefined
    }
    return decoded.text
  } catch (error: unknown) {
    warn(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Load spark-hooks.json beside Muse Code's sources: the user's file next to
 * Muse Code's settings.json, then the project's inside the workspace. The
 * same gates as M51 hold: an untrusted workspace loads nothing, and the
 * caller keeps the per-session snapshot (this function reads the files, it
 * does not watch them).
 */
export async function loadSparkHookDefinitions(
  deps: HookLoadDeps,
): Promise<readonly ExtensionHookDefinition[]> {
  if (!deps.isWorkspaceTrusted()) {
    return []
  }
  const files = sparkHooksFiles(deps)
  const sources = [
    {
      source: 'user',
      text: await readSparkText(deps.io, files.user, undefined, deps.platform, deps.warn),
    },
    {
      source: 'project',
      text: await readSparkText(
        deps.io,
        files.project,
        deps.workspaceRoot,
        deps.platform,
        deps.warn,
      ),
    },
  ] as const
  const hooks: ExtensionHookDefinition[] = []
  for (const { source, text } of sources) {
    const parsed = parseSparkHooksConfig(text, source, deps.platform)
    for (const warning of parsed.warnings) {
      deps.warn(warning)
    }
    hooks.push(...parsed.hooks)
    if (hooks.length > HOOK_TOTAL_MAX_HANDLERS) {
      deps.warn('spark-hooks.json exceeds the session handler limit; no extension hooks loaded')
      return []
    }
  }
  return hooks
}

// --- Payloads ---

/**
 * What every extension hook receives: Claude Code's documented envelope
 * (`hook_event_name`, `session_id`, `cwd`, `transcript_path`,
 * `permission_mode`), plus this runtime's additions: `turn_id` on a
 * turn-bound event, and `model` with `model_provider`, so a hook sees which
 * model it advises.
 */
export interface ExtensionHookContext {
  readonly sessionId: string
  readonly workspaceRoot: string
  readonly modelId?: string | undefined
  readonly permissionMode?: string | undefined
  readonly turnId?: string | undefined
}

export function extensionHookPayload(
  event: ExtensionHookEvent,
  context: ExtensionHookContext,
  fields: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    hook_event_name: event,
    session_id: context.sessionId,
    ...(context.turnId !== undefined && { turn_id: context.turnId }),
    cwd: context.workspaceRoot,
    transcript_path: null,
    ...(context.modelId !== undefined && { model: context.modelId, model_provider: 'meta' }),
    ...(context.permissionMode !== undefined && { permission_mode: context.permissionMode }),
    ...fields,
  }
}

/** Why instructions entered the context: the touched path's rules, a skill, or the rules read. */
export type InstructionsLoadedReason = 'touched-path' | 'skill' | 'rules'

export function instructionsLoadedFields(
  relativePath: string,
  reason: InstructionsLoadedReason,
): Readonly<Record<string, unknown>> {
  return { path: relativePath, reason }
}

export function userPromptExpansionFields(options: {
  readonly trigger: 'slash' | 'skill'
  readonly name: string
  readonly expanded: string
}): Readonly<Record<string, unknown>> {
  return {
    trigger: options.trigger,
    name: options.name,
    expanded: boundedHookText(options.expanded, HOOK_EXPANSION_MAX_CHARS),
  }
}

/** A refusal names the tool when one was refused; a mode or reviewer refusal carries no tool. */
export function permissionDeniedFields(options: {
  readonly toolName?: string | undefined
  readonly reason: string
}): Readonly<Record<string, unknown>> {
  return {
    ...(options.toolName !== undefined && { tool_name: options.toolName }),
    reason: boundedHookText(options.reason, HOOK_TASK_DESCRIPTION_MAX_CHARS),
  }
}

/** Model switches send model ids only, never prompts or keys. */
export function modelSwitchFields(options: {
  readonly oldModel: string
  readonly newModel: string
}): Readonly<Record<string, unknown>> {
  return { old_model: options.oldModel, new_model: options.newModel }
}

/** A todo item sends its subject and description, bounded. */
export function taskFields(options: {
  readonly subject: string
  readonly description: string
}): Readonly<Record<string, unknown>> {
  return {
    subject: boundedHookText(options.subject, HOOK_TASK_SUBJECT_MAX_CHARS),
    description: boundedHookText(options.description, HOOK_TASK_DESCRIPTION_MAX_CHARS),
  }
}

/** Why the file changed: an edit the session saw, or the workspace watcher. */
export type FileChangedReason = 'external-edit' | 'watcher'

export function fileChangedFields(
  relativePath: string,
  reason: FileChangedReason,
): Readonly<Record<string, unknown>> {
  return { path: relativePath, reason }
}

/** Which configuration changed: the settings, Muse Code's hooks, or the extension's own. */
export type ConfigChangeReason = 'settings' | 'hooks' | 'spark-hooks'

export function configChangeFields(
  relativePath: string,
  reason: ConfigChangeReason,
): Readonly<Record<string, unknown>> {
  return { path: relativePath, reason }
}

export function setupFields(trigger: SetupTrigger): Readonly<Record<string, unknown>> {
  return { trigger }
}

export function manualFields(name: string): Readonly<Record<string, unknown>> {
  return { name }
}

export function directoryAddedFields(relativePath: string): Readonly<Record<string, unknown>> {
  return { path: relativePath }
}

/**
 * What the user answered. A project hook sees the action and the field
 * names only; `values` are passed for user-scope hooks alone (the caller
 * decides the scope; lane M validates the answer against the schema).
 */
export function elicitationResultFields(options: {
  readonly server: string
  readonly action: 'accept' | 'decline' | 'cancel'
  readonly fieldNames: readonly string[]
  readonly values?: Readonly<Record<string, unknown>> | undefined
}): Readonly<Record<string, unknown>> {
  return {
    server: options.server,
    action: options.action,
    fields: [...options.fieldNames],
    ...(options.values !== undefined && { values: options.values }),
  }
}

export function teammateIdleFields(options: {
  readonly name: string
  readonly siblingsRunning: number
}): Readonly<Record<string, unknown>> {
  return { name: options.name, siblings_running: options.siblingsRunning }
}

export function messageDisplayFields(message: string): Readonly<Record<string, unknown>> {
  return { message: boundedHookText(message, HOOK_DISPLAY_MESSAGE_MAX_CHARS) }
}

export function beforeToolSelectionFields(
  tools: readonly string[],
): Readonly<Record<string, unknown>> {
  return { tools: [...tools] }
}

/** A finished reasoning block, bounded and scrubbed like every hook preview. */
export function afterAgentThoughtFields(thought: string): Readonly<Record<string, unknown>> {
  return { thought: boundedHookText(thought, HOOK_THOUGHT_MAX_CHARS) }
}

// --- Answers ---

export type ExtensionHookAnswerStatus =
  'completed' | 'refused' | 'failed' | 'keepWorking' | 'attemptFailed'

export interface ExtensionHookAnswer {
  readonly status: ExtensionHookAnswerStatus
  readonly reason?: string | undefined
  readonly message?: string | undefined
  readonly context?: string | undefined
  readonly displayText?: string | undefined
  readonly allowedTools?: readonly string[] | undefined
  /** An Elicitation hook's answer, passed through for the caller to validate. */
  readonly answer?: unknown
  readonly hasAnswer: boolean
  /** The hook's bounded stdout, shown for Setup and Manual runs. */
  readonly output: string
}

function scrubSystemMessage(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? HOOK_CONTROL_CODE_LIMIT
    return code === HOOK_DELETE_CODE ||
      (code !== HOOK_NEWLINE_CODE && code < HOOK_CONTROL_CODE_LIMIT)
      ? ' '
      : character
  })
    .join('')
    .slice(0, HOOK_SYSTEM_MESSAGE_MAX_CHARS)
}

function completedAnswer(output: string): ExtensionHookAnswer {
  return { status: 'completed', hasAnswer: false, output }
}

const ANSWER_FIELDS = new Set([
  'systemMessage',
  'additionalContext',
  'displayText',
  'allowedTools',
  'answer',
  'decision',
  'continue',
  'stopReason',
])

const extensionAnswerShape = z.object({
  systemMessage: z.optional(z.string()),
  additionalContext: z.optional(z.string()),
  displayText: z.optional(z.string()),
  allowedTools: z.optional(z.array(z.string())),
  answer: z.optional(z.unknown()),
  decision: z.optional(
    z.object({ behavior: z.enum(['allow', 'deny']), message: z.optional(z.string()) }),
  ),
  continue: z.optional(z.boolean()),
  stopReason: z.optional(z.string()),
})

function isAnswerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse one command answer. Anything outside the closed per-event schema
 * fails the hook, never the operation: an observation hook cannot block, and
 * a refusal carries the hook's own reason.
 */
export function parseExtensionHookAnswer(
  event: ExtensionHookEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): ExtensionHookAnswer {
  const output = stdout.slice(0, HOOK_OUTPUT_MAX_BYTES)
  // A non-zero WorktreeCreate exit fails that attempt, whatever it says.
  if (event === 'WorktreeCreate' && exitCode !== 0) {
    return {
      status: 'attemptFailed',
      reason: stderr.trim() || `hook exited ${String(exitCode)}`,
      hasAnswer: false,
      output,
    }
  }
  if (exitCode === 2 && stderr.trim() !== '') {
    const reason = stderr.trim()
    if (REFUSABLE_EVENTS.has(event)) {
      return { status: 'refused', reason, hasAnswer: false, output }
    }
    if (event === 'TeammateIdle') {
      return { status: 'keepWorking', reason, hasAnswer: false, output }
    }
    return {
      status: event === 'Elicitation' ? 'refused' : 'failed',
      reason,
      hasAnswer: false,
      output,
    }
  }
  if (exitCode !== 0) {
    return {
      status: 'failed',
      reason: stderr.trim() || `hook exited ${String(exitCode)}`,
      hasAnswer: false,
      output,
    }
  }
  const trimmed = stdout.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return completedAnswer(output)
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return { status: 'failed', reason: 'hook output is not valid JSON', hasAnswer: false, output }
  }
  if (!isAnswerRecord(value) || Object.keys(value).some((key) => !ANSWER_FIELDS.has(key))) {
    return {
      status: 'failed',
      reason: 'hook output has unsupported fields',
      hasAnswer: false,
      output,
    }
  }
  const parsed = extensionAnswerShape.safeParse(value)
  if (!parsed.success) {
    return { status: 'failed', reason: 'hook output has invalid fields', hasAnswer: false, output }
  }
  const result = parsed.data
  if (event !== 'MessageDisplay' && result.displayText !== undefined) {
    return {
      status: 'failed',
      reason: 'displayText is only valid on MessageDisplay',
      hasAnswer: false,
      output,
    }
  }
  if (event !== 'BeforeToolSelection' && result.allowedTools !== undefined) {
    return {
      status: 'failed',
      reason: 'allowedTools is only valid on BeforeToolSelection',
      hasAnswer: false,
      output,
    }
  }
  if (event !== 'Elicitation' && result.answer !== undefined) {
    return {
      status: 'failed',
      reason: 'answer is only valid on Elicitation',
      hasAnswer: false,
      output,
    }
  }
  if (result.additionalContext !== undefined && !CONTEXT_EVENTS.has(event)) {
    return {
      status: 'failed',
      reason: `${event} cannot add model context`,
      hasAnswer: false,
      output,
    }
  }
  const { decision } = result
  if (decision !== undefined) {
    if (!DECISION_EVENTS.has(event)) {
      return {
        status: 'failed',
        reason: 'decision is only valid on events that can refuse',
        hasAnswer: false,
        output,
      }
    }
    if (decision.behavior === 'deny') {
      const reason =
        decision.message !== undefined && decision.message.trim() !== ''
          ? decision.message
          : 'denied by hook'
      return {
        status: event === 'TeammateIdle' ? 'keepWorking' : 'refused',
        reason,
        hasAnswer: false,
        output,
      }
    }
  }
  if (event !== 'TeammateIdle' && result.continue !== undefined) {
    return { status: 'failed', reason: `${event} cannot stop the turn`, hasAnswer: false, output }
  }
  if (result.continue === false) {
    const reason =
      result.stopReason !== undefined && result.stopReason.trim() !== ''
        ? result.stopReason
        : 'kept working by hook'
    return { status: 'keepWorking', reason, hasAnswer: false, output }
  }
  if (result.stopReason !== undefined) {
    return { status: 'failed', reason: 'stopReason needs continue', hasAnswer: false, output }
  }
  const hasAnswer = result.answer !== undefined
  return {
    status: 'completed',
    ...(result.systemMessage !== undefined && {
      message: scrubSystemMessage(result.systemMessage),
    }),
    ...(result.additionalContext !== undefined && { context: result.additionalContext }),
    ...(result.displayText !== undefined && { displayText: result.displayText }),
    ...(result.allowedTools !== undefined && { allowedTools: result.allowedTools }),
    ...(hasAnswer && { answer: result.answer }),
    hasAnswer,
    output,
  }
}

// --- Dispatch ---

export interface ExtensionHookRunIo {
  readonly runHook?: (
    command: string,
    payload: string,
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
    extraEnvNames?: readonly string[],
  ) => Promise<ShellResult>
}

export interface ExtensionHookDispatch {
  readonly refusedReason: string | undefined
  /** The first hook failure's reason: user-started runs report it (M91 lane E). */
  readonly failedReason: string | undefined
  readonly messages: readonly string[]
  readonly contexts: readonly string[]
  readonly displayText: string | undefined
  readonly allowedTools: readonly string[] | undefined
  readonly answer: unknown
  readonly hasAnswer: boolean
  readonly output: string
  readonly keepWorking: boolean
  readonly keepReason: string | undefined
  readonly attemptFailed: string | undefined
}

interface ExtensionFoldState {
  refusedReason: string | undefined
  displayText: string | undefined
  allowedTools: readonly string[] | undefined
  answer: unknown
  hasAnswer: boolean
  isKeepWorking: boolean
  keepReason: string | undefined
  attemptFailed: string | undefined
  failedReason: string | undefined
}

/** Fold one answer: first refusal wins, rewrites and narrowings take the last. */
function foldExtensionAnswer(state: ExtensionFoldState, result: ExtensionHookAnswer): void {
  switch (result.status) {
    case 'refused': {
      state.refusedReason ??= result.reason ?? 'refused by hook'
      break
    }
    case 'keepWorking': {
      state.isKeepWorking = true
      state.keepReason ??= result.reason
      break
    }
    case 'attemptFailed': {
      state.attemptFailed ??= result.reason ?? 'hook failed the attempt'
      break
    }
    case 'completed': {
      break
    }
    case 'failed': {
      state.failedReason ??= result.reason ?? 'hook failed'
      break
    }
  }
  state.displayText = result.displayText ?? state.displayText
  const nextTools = result.allowedTools
  if (nextTools !== undefined) {
    state.allowedTools =
      state.allowedTools === undefined
        ? nextTools
        : state.allowedTools.filter((name) => nextTools.includes(name))
  }
  state.answer = result.hasAnswer ? result.answer : state.answer
  state.hasAnswer ||= result.hasAnswer
}

/** No hook ran, so the operation proceeds as before (M91 lane E). */
export function emptyExtensionDispatch(): ExtensionHookDispatch {
  return NO_EXTENSION_HOOK_DISPATCH
}

async function runExtensionHandler(
  hook: ExtensionHookDefinition,
  event: ExtensionHookEvent,
  serialized: string,
  cwd: string,
  runner: NonNullable<ExtensionHookRunIo['runHook']>,
  signal: AbortSignal | undefined,
  warn: (message: string) => void,
  depth = 0,
): Promise<ExtensionHookAnswer | undefined> {
  let result: ShellResult
  try {
    result = await runner(
      hook.command,
      serialized,
      cwd,
      hook.timeoutSeconds * MILLISECONDS_PER_SECOND,
      signal,
      undefined,
    )
  } catch {
    if (signal?.aborted === true) {
      return undefined
    }
    // Spawn errors can echo a command line. Never put hook source or stderr
    // into the extension log: a configured command may contain a credential.
    warn(`${event}: extension hook could not start`)
    return hook.onFailure === undefined || depth >= HOOK_ON_FAILURE_MAX_DEPTH
      ? parseExtensionHookAnswer(event, 1, '', 'extension hook could not start')
      : await runExtensionHandler(
          hook.onFailure,
          event,
          serialized,
          cwd,
          runner,
          signal,
          warn,
          depth + 1,
        )
  }
  if (result.isCancelled) {
    return undefined
  }
  if (result.isTimedOut || result.isOutputTooLarge === true) {
    warn(`${event}: extension hook ${result.isTimedOut ? 'timed out' : 'exceeded output limit'}`)
    return hook.onFailure === undefined || depth >= HOOK_ON_FAILURE_MAX_DEPTH
      ? parseExtensionHookAnswer(event, 1, '', 'extension hook exceeded its limit')
      : await runExtensionHandler(
          hook.onFailure,
          event,
          serialized,
          cwd,
          runner,
          signal,
          warn,
          depth + 1,
        )
  }
  const answer = parseExtensionHookAnswer(event, result.exitCode, result.stdout, result.stderr)
  if (answer.status === 'failed') {
    warn(`${event}: extension hook failed (${answer.reason ?? `exit ${String(result.exitCode)}`})`)
    return result.exitCode !== 0 &&
      hook.onFailure !== undefined &&
      depth < HOOK_ON_FAILURE_MAX_DEPTH
      ? await runExtensionHandler(
          hook.onFailure,
          event,
          serialized,
          cwd,
          runner,
          signal,
          warn,
          depth + 1,
        )
      : answer
  }
  return answer
}

/**
 * Execute the matching extension hooks, one at a time: extension events are
 * rare, and sequential runs never exceed the host-wide hook cap from `hooks.ts`.
 * An async hook runs without waiting and its output is dropped. A refused
 * operation keeps the first reason; display text and tool narrowings take the
 * last answer, like `updatedInput` does.
 */
export async function dispatchExtensionHooks(options: {
  readonly hooks: readonly ExtensionHookDefinition[]
  readonly event: ExtensionHookEvent
  readonly payload: Readonly<Record<string, unknown>>
  readonly matcherValue?: string | undefined
  readonly io: ExtensionHookRunIo
  readonly cwd: string
  readonly signal?: AbortSignal | undefined
  readonly warn: (message: string) => void
  readonly isAllowed?: () => boolean
}): Promise<ExtensionHookDispatch> {
  const { hooks, event, payload, matcherValue, io, cwd, signal, warn } = options
  const selected = hooks.filter(
    (hook) => hook.event === event && isExtensionMatch(hook.matcher, matcherValue, warn),
  )
  const serialized = JSON.stringify(payload)
  if (Buffer.byteLength(serialized) > HOOK_STDIN_MAX_BYTES) {
    warn(`${event}: hook input exceeds limit; no hook was started`)
    return emptyExtensionDispatch()
  }
  const runner = io.runHook
  if (runner === undefined && selected.length > 0) {
    warn(`${event}: hook runner is unavailable`)
  }
  const state: ExtensionFoldState = {
    refusedReason: undefined,
    displayText: undefined,
    allowedTools: undefined,
    answer: undefined,
    hasAnswer: false,
    isKeepWorking: false,
    keepReason: undefined,
    attemptFailed: undefined,
    failedReason: undefined,
  }
  const messages: string[] = []
  const contexts: string[] = []
  const outputs: string[] = []
  for (const hook of selected) {
    if (runner === undefined || signal?.aborted === true || options.isAllowed?.() === false) {
      break
    }
    const execution = runExtensionHandler(hook, event, serialized, cwd, runner, signal, warn)
    if (hook.isAsync) {
      void execution.catch(() => {
        warn(`${event}: asynchronous hook failed`)
      })
      continue
    }
    const result = await execution
    if (options.isAllowed?.() === false) break
    if (result === undefined) {
      continue
    }
    if (result.message !== undefined) {
      messages.push(result.message)
    }
    if (result.context !== undefined) {
      contexts.push(result.context)
    }
    if (result.output !== '') {
      outputs.push(result.output)
    }
    foldExtensionAnswer(state, result)
  }
  return {
    refusedReason: state.refusedReason,
    failedReason: state.failedReason,
    messages,
    contexts,
    displayText: state.displayText,
    allowedTools: state.allowedTools,
    answer: state.answer,
    hasAnswer: state.hasAnswer,
    output: outputs.join('\n'),
    keepWorking: state.isKeepWorking,
    keepReason: state.keepReason,
    attemptFailed: state.attemptFailed,
  }
}

/** Only matched paths consume FileChanged's process budget. */
export function isFileChangedWatched(
  hooks: readonly ExtensionHookDefinition[],
  file: string,
): boolean {
  return hooks.some(
    (hook) =>
      hook.event === 'FileChanged' &&
      hook.matcher !== undefined &&
      isExtensionMatch(hook.matcher, file, () => {
        // An invalid matcher is a nonmatch; the parser already reports it.
      }),
  )
}

/** BeforeToolSelection narrows at admission; the declared tool list never changes. */
export function isToolAllowedBySelection(
  toolName: string,
  allowed: readonly string[] | undefined,
): boolean {
  return allowed === undefined || allowed.includes(toolName)
}

// --- FileChanged throttle ---

export type FileChangedVerdict = 'fire' | 'debounced' | 'capped'

export interface FileChangedThrottle {
  check(relativePath: string, nowMs: number): FileChangedVerdict
}

/**
 * One FileChanged run per path per quiet window, at most
 * `HOOK_FILE_CHANGED_MAX_PER_MINUTE` runs a minute; the rest report
 * `capped` so the caller drops and counts them in the log. Pure time comes
 * from the caller, so tests drive it with a fake clock.
 */
export function createFileChangedThrottle(): FileChangedThrottle {
  const minuteMs = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
  let windowStart = 0
  let windowCount = 0
  let pauseUntil = 0
  const lastFire = new Map<string, number>()
  return {
    check(relativePath, nowMs) {
      if (nowMs < pauseUntil) {
        return 'capped'
      }
      if (nowMs - windowStart >= minuteMs) {
        windowStart = nowMs
        windowCount = 0
      }
      const last = lastFire.get(relativePath)
      if (last !== undefined && nowMs - last < HOOK_FILE_CHANGED_DEBOUNCE_MS) {
        return 'debounced'
      }
      if (windowCount >= HOOK_FILE_CHANGED_MAX_PER_MINUTE) {
        pauseUntil = nowMs + minuteMs
        return 'capped'
      }
      windowCount += 1
      lastFire.set(relativePath, nowMs)
      return 'fire'
    },
  }
}

// --- Setup and Manual selection ---

/** A Setup hook runs for its matcher trigger; one without a matcher runs for both. */
export function isSetupTriggerMatch(hook: ExtensionHookDefinition, trigger: SetupTrigger): boolean {
  return (
    hook.event === 'Setup' &&
    (hook.matcher === undefined || hook.matcher.kind === 'glob' || hook.matcher.names.has(trigger))
  )
}

/** The Manual hooks a Run Hook pick lists; the user starts one by its command. */
export function manualHooks(
  hooks: readonly ExtensionHookDefinition[],
): readonly ExtensionHookDefinition[] {
  return hooks.filter((hook) => hook.event === 'Manual')
}
