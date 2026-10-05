import * as z from 'zod/mini'
// Kiro v1 contract: hooks-parity/raw/kiro_hooks_types.md and lead decision I.
import {
  HOOK_MATCHER_VALUE_MAX_CHARS,
  HOOK_MATCHER_MAX_CHARS,
  HOOK_TOOL_OUTPUT_PREVIEW_CHARS,
} from '../../../../shared/constants'
import { matchingHooks, type HookAnswer, type HookDefinition } from '../hooks'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  fileOf,
  toolNameOf,
  recordField,
  textField,
  copyText,
  blockReason,
  failed,
  resultPreview,
  splitMcpName,
  cleanReason,
  jsonOutput,
} from './core'

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
  const mcp = splitMcpName(tool)
  if (mcp !== undefined) return `@${mcp.server}/${mcp.tool}`
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
  if (
    trigger !== undefined &&
    trigger !== KIRO_EVENT_NAMES[event] &&
    !(
      event === 'PostToolUse' &&
      ['PostFileCreate', 'PostFileSave', 'PostFileDelete'].includes(trigger)
    )
  ) {
    return { outcome: 'refused', reason: 'kiro: trigger does not match the event' }
  }
  const pattern = options?.pathPattern
  if (pattern !== undefined) {
    const file = kiroFileOf(payload)
    if (file === undefined) {
      return { outcome: 'skip', reason: 'kiro: file trigger has no file path' }
    }
    if (file.length > HOOK_MATCHER_VALUE_MAX_CHARS) {
      return { outcome: 'refused', reason: 'kiro: file path is too long to match' }
    }
    // Reuse M51's bounded V8 matcher. Both compilation and execution stay
    // behind that matcher's existing deadlines; untrusted regex never runs here.
    if (pattern.length > HOOK_MATCHER_MAX_CHARS)
      return { outcome: 'refused', reason: 'kiro: path pattern is too long' }
    let warning: string | undefined
    // matchingHooks only reads event/matcher. No command is dispatched by
    // this scope check; empty command is deliberately never an executable.
    const scoped: HookDefinition = {
      event: 'PostToolUse',
      source: 'project',
      command: '',
      timeoutSeconds: 0,
      isAsync: false,
      matcher: { kind: 'regex', pattern },
    }
    const matches = matchingHooks([scoped], 'PostToolUse', file, (message) => {
      warning = message
    })
    if (warning !== undefined) return { outcome: 'refused', reason: warning }
    if (matches.length === 0) {
      return { outcome: 'skip', reason: 'kiro: file path is outside the trigger scope' }
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
    case 'PreToolUse':
    case 'PostToolUse': {
      const tool = toolNameOf(payload)
      const input = recordField(payload, 'tool_input')
      if (tool === undefined || input === undefined)
        return { outcome: 'refused', reason: 'kiro: tool event needs a name and input' }
      stdin['tool_name'] = kiroToolName(tool)
      stdin['tool_input'] = input
      if (event === 'PostToolUse') {
        const response = resultPreview(payload)
        if (response === undefined)
          return { outcome: 'refused', reason: 'kiro: PostToolUse needs a string result preview' }
        stdin['tool_response'] = response
      }
      break
    }
    case 'Stop': {
      copyText(stdin, payload, 'assistant_response')
      break
    }
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

const stopShape = z.object({ decision: z.literal('block'), reason: z.optional(z.string()) })

export function parseKiroResult(
  event: AdapterEvent,
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
  if (event === 'Stop') {
    const output = stopShape.safeParse(jsonOutput(stdout))
    if (output.success)
      return {
        status: 'blocked',
        reason: cleanReason(output.data.reason, 'kiro hook requested continuation'),
      }
  }
  // A success injects stdout as context.
  return { status: 'completed', context: trimmed.slice(0, HOOK_TOOL_OUTPUT_PREVIEW_CHARS) }
}
