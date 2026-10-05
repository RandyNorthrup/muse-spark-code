// Gemini CLI contract: hooks-parity/raw-codex-gemini.md:52-73.
import * as z from 'zod/mini'
import { HOOK_MAX_TIMEOUT_SECONDS, MILLISECONDS_PER_SECOND } from '../../../../shared/constants'
import { type HookAnswer } from '../hooks'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  blockReason,
  cleanReason,
  copyFields,
  failed,
  hasExtraFields,
  isRecord,
  isShellTool,
  jsonOutput,
  recordField,
  resultPreview,
  run,
  splitMcpName,
  textField,
} from './core'

const EVENTS: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  UserPromptSubmit: 'BeforeAgent',
  Stop: 'AfterAgent',
  PreLLMCall: 'BeforeModel',
  PostLLMCall: 'AfterModel',
  BeforeToolSelection: 'BeforeToolSelection',
  PreToolUse: 'BeforeTool',
  PostToolUse: 'AfterTool',
  PreCompact: 'PreCompress',
  Notification: 'Notification',
}
const BLOCKING = new Set<AdapterEvent>([
  'UserPromptSubmit',
  'Stop',
  'PreLLMCall',
  'PostLLMCall',
  'PreToolUse',
  'PostToolUse',
])

function toolName(tool: string): string {
  if (isShellTool(tool)) return 'run_shell_command'
  if (tool === 'edit_file') return 'replace'
  const mcp = splitMcpName(tool)
  return mcp === undefined ? tool : `mcp_${mcp.server}_${mcp.tool}`
}

export function buildGeminiStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
): ForeignStdinResult {
  const name = EVENTS[event]
  if (name === undefined)
    return { outcome: 'refused', reason: `gemini: ${event} has no Gemini event` }
  const stdin: Record<string, unknown> = { hook_event_name: name }
  copyFields(stdin, payload, ['session_id', 'transcript_path', 'cwd', 'timestamp'])
  switch (event) {
    case 'UserPromptSubmit': {
      copyFields(stdin, payload, ['prompt'])
      break
    }
    case 'Stop': {
      copyFields(stdin, payload, ['prompt', 'prompt_response', 'stop_hook_active'])
      break
    }
    case 'SessionStart': {
      copyFields(stdin, payload, ['source'])
      break
    }
    case 'SessionEnd': {
      copyFields(stdin, payload, ['reason'])
      break
    }
    case 'PreCompact': {
      copyFields(stdin, payload, ['trigger'])
      break
    }
    case 'Notification': {
      copyFields(stdin, payload, ['message', 'notification_type'])
      break
    }
    case 'PreLLMCall':
    case 'PostLLMCall':
    case 'BeforeToolSelection': {
      // Only documented Gemini fields, when supplied by the integration layer.
      // Never pretend Muse's bounded summaries are a Gemini request or response.
      copyFields(stdin, payload, ['llm_request'])
      if (event === 'PostLLMCall') copyFields(stdin, payload, ['llm_response'])
      break
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const tool = textField(payload, 'tool_name')
      const input = recordField(payload, 'tool_input')
      if (tool === undefined || input === undefined)
        return { outcome: 'refused', reason: 'gemini: tool event needs a name and input' }
      stdin['tool_name'] = toolName(tool)
      stdin['tool_input'] = input
      if (event === 'PostToolUse') {
        const response = resultPreview(payload)
        if (response === undefined)
          return { outcome: 'refused', reason: 'gemini: AfterTool needs a string result preview' }
        stdin['tool_response'] = response
      }
      break
    }
  }
  return run(stdin)
}

export function geminiTimeoutMsToSeconds(value: unknown): number | undefined {
  return typeof value !== 'number' || !Number.isFinite(value) || value < 0
    ? undefined
    : Math.min(Math.max(Math.ceil(value / MILLISECONDS_PER_SECOND), 1), HOOK_MAX_TIMEOUT_SECONDS)
}

/** Gemini tool names; lane W compares translated calls at admission. Never mutate the tool list. */
export interface GeminiHookAnswer extends HookAnswer {
  readonly allowedToolNames?: readonly string[] | undefined
}
const controlShape = z.object({
  decision: z.optional(z.string()),
  continue: z.optional(z.boolean()),
})
const specificShape = z.strictObject({
  hookEventName: z.optional(z.string()),
  additionalContext: z.optional(z.string()),
  tool_input: z.optional(z.record(z.string(), z.unknown())),
  toolConfig: z.optional(
    z.strictObject({
      mode: z.optional(z.enum(['AUTO', 'ANY', 'NONE'])),
      allowedFunctionNames: z.optional(z.array(z.string())),
    }),
  ),
})
const outputShape = z.strictObject({
  decision: z.optional(z.enum(['allow', 'deny', 'block'])),
  reason: z.optional(z.string()),
  continue: z.optional(z.boolean()),
  stopReason: z.optional(z.string()),
  systemMessage: z.optional(z.string()),
  suppressOutput: z.optional(z.boolean()),
  hookSpecificOutput: z.optional(specificShape),
})

export function parseGeminiResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): GeminiHookAnswer {
  if (exitCode === 2)
    return BLOCKING.has(event)
      ? {
          status: 'blocked',
          reason: blockReason(stderr, stdout, 'gemini hook blocked the operation'),
        }
      : failed(`gemini: ${event} is observation only`)
  if (exitCode !== 0) return failed(stderr.trim() || `gemini: hook exited ${String(exitCode)}`)
  if (stdout.trim() === '') return { status: 'completed' }
  const value = jsonOutput(stdout)
  // Preserve a valid veto even when the same answer attempts an unsupported
  // request/response rewrite. Refusing the rewrite must not erase the veto.
  const control = controlShape.safeParse(value)
  if (control.success && BLOCKING.has(event)) {
    if (control.data.continue === false) {
      const reason = cleanReason(
        isRecord(value) ? textField(value, 'stopReason') : undefined,
        'gemini hook stopped the agent',
      )
      return { status: 'blocked', reason, stopReason: reason }
    }
    if (control.data.decision === 'deny' || control.data.decision === 'block') {
      return {
        status: 'blocked',
        reason: cleanReason(
          isRecord(value) ? textField(value, 'reason') : undefined,
          'gemini hook blocked the operation',
        ),
      }
    }
  }
  const parsed = outputShape.safeParse(value)
  if (!parsed.success)
    return failed('gemini: invalid output or unsupported request/response modifiers')
  const output = parsed.data
  const specific = output.hookSpecificOutput
  if (specific?.hookEventName !== undefined && specific.hookEventName !== EVENTS[event])
    return failed('gemini: output event does not match input')
  if (output.decision !== undefined && !BLOCKING.has(event))
    return failed('gemini: decision is not supported on this event')
  if (event !== 'PreToolUse' && specific?.tool_input !== undefined)
    return failed('gemini: tool_input is only supported on BeforeTool')
  if (event !== 'BeforeToolSelection' && specific?.toolConfig !== undefined)
    return failed('gemini: toolConfig is only supported on BeforeToolSelection')
  if (event === 'BeforeToolSelection') {
    if (
      hasExtraFields(value, new Set(['hookSpecificOutput'])) ||
      (specific !== undefined && hasExtraFields(specific, new Set(['toolConfig', 'hookEventName'])))
    ) {
      return failed('gemini: BeforeToolSelection accepts only toolConfig')
    }
    const config = specific?.toolConfig
    if (config?.mode === 'ANY') return failed('gemini: forcing tool selection is refused')
    const allowedToolNames = config?.mode === 'NONE' ? [] : config?.allowedFunctionNames
    return { status: 'completed', ...(allowedToolNames !== undefined && { allowedToolNames }) }
  }
  return {
    status: 'completed',
    context: specific?.additionalContext,
    systemMessage: output.systemMessage,
    ...(specific?.tool_input !== undefined && { updatedInput: specific.tool_input }),
  }
}
