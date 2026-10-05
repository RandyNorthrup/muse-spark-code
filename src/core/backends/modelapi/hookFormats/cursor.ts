// Cursor contracts: hooks-parity/cursor_com_docs_hooks_md.out:808-1447.
import * as z from 'zod/mini'
import { type HookAnswer } from '../hooks'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  blockReason,
  cleanReason,
  copyFields,
  failed,
  fileOf,
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
  SessionStart: 'sessionStart',
  SessionEnd: 'sessionEnd',
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  PostToolUseFailure: 'postToolUseFailure',
  SubagentStop: 'subagentStop',
  UserPromptSubmit: 'beforeSubmitPrompt',
  PreCompact: 'preCompact',
  Stop: 'stop',
  PostLLMCall: 'afterAgentResponse',
  AfterAgentThought: 'afterAgentThought',
  DirectoryAdded: 'workspaceOpen',
}
const SPECIAL_PRE = new Set(['beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile'])
const SPECIAL_POST = new Set(['afterShellExecution', 'afterMCPExecution', 'afterFileEdit'])
export interface CursorAdapterOptions {
  readonly failClosed?: boolean | undefined
  /** Preserve the imported event; generic hooks must not be relabeled by tool. */
  readonly sourceEvent?: string | undefined
}
function sourceName(
  event: AdapterEvent,
  options: CursorAdapterOptions | undefined,
): string | undefined {
  const selected = options?.sourceEvent ?? EVENTS[event]
  return selected === EVENTS[event] ||
    (event === 'PreToolUse' && selected !== undefined && SPECIAL_PRE.has(selected)) ||
    (event === 'PostToolUse' && selected !== undefined && SPECIAL_POST.has(selected))
    ? selected
    : undefined
}
function toolName(tool: string): string {
  if (isShellTool(tool)) return 'Shell'
  if (tool === 'read_file') return 'Read'
  if (tool === 'write_file' || tool === 'edit_file') return 'Write'
  if (tool === 'search') return 'Grep'
  const mcp = splitMcpName(tool)
  return mcp === undefined ? tool : `MCP:${mcp.tool}`
}

export function buildCursorStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: CursorAdapterOptions,
): ForeignStdinResult {
  const name = sourceName(event, options)
  if (name === undefined)
    return { outcome: 'refused', reason: `cursor: unsupported source event for ${event}` }
  const stdin: Record<string, unknown> = { hook_event_name: name }
  copyFields(stdin, payload, [
    'model',
    'model_id',
    'model_params',
    'transcript_path',
    'workspace_roots',
  ])
  const session = textField(payload, 'session_id')
  const turn = textField(payload, 'turn_id')
  if (session !== undefined) stdin['conversation_id'] = session
  if (turn !== undefined) stdin['generation_id'] = turn
  if (stdin['workspace_roots'] === undefined && typeof payload['cwd'] === 'string')
    stdin['workspace_roots'] = [payload['cwd']]
  const tool = textField(payload, 'tool_name')
  const input = recordField(payload, 'tool_input')
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event)) {
    if (tool === undefined || input === undefined)
      return { outcome: 'refused', reason: 'cursor: tool event needs a name and input' }
    copyFields(stdin, payload, ['tool_use_id', 'cwd', 'duration'])
    if (name.endsWith('ShellExecution')) {
      const command = textField(input, 'command')
      if (command === undefined || !isShellTool(tool))
        return { outcome: 'refused', reason: 'cursor: shell event needs a shell command' }
      stdin['command'] = command
      copyFields(stdin, payload, ['sandbox'])
    } else if (name.endsWith('MCPExecution')) {
      const mcp = splitMcpName(tool)
      if (mcp === undefined)
        return { outcome: 'refused', reason: 'cursor: MCP event needs a server and tool' }
      stdin['tool_name'] = mcp.tool
      stdin['mcp_server_name'] = mcp.server
      stdin['tool_input'] = JSON.stringify(recordField(input, 'arguments') ?? input)
      copyFields(stdin, payload, ['command', 'url', 'mcp_server_url'])
    } else if (name === 'beforeReadFile') {
      const file = fileOf(input)
      const content = textField(payload, 'content')
      if (tool !== 'read_file' || file === undefined || content === undefined)
        return { outcome: 'refused', reason: 'cursor: read event needs a path and content' }
      stdin['file_path'] = file
      stdin['content'] = content
      copyFields(stdin, payload, ['attachments'])
    } else if (name === 'afterFileEdit') {
      return {
        outcome: 'refused',
        reason: 'cursor: afterFileEdit cannot represent the result preview',
      }
    } else {
      stdin['tool_name'] = toolName(tool)
      stdin['tool_input'] = input
      copyFields(stdin, payload, ['agent_message', 'error_message', 'failure_type', 'is_interrupt'])
    }
    if (event === 'PostToolUse') {
      const response = resultPreview(payload)
      if (response === undefined)
        return {
          outcome: 'refused',
          reason: 'cursor: post-tool event needs a string result preview',
        }
      if (name === 'afterShellExecution') stdin['output'] = response
      else
        stdin[name === 'afterMCPExecution' ? 'result_json' : 'tool_output'] =
          JSON.stringify(response)
    }
  } else
    switch (name) {
      case 'beforeSubmitPrompt': {
        copyFields(stdin, payload, ['prompt', 'attachments'])
        break
      }
      case 'afterAgentResponse':
      case 'afterAgentThought': {
        const text = textField(payload, 'text') ?? textField(payload, 'response')
        if (text === undefined)
          return { outcome: 'refused', reason: 'cursor: response event needs text' }
        stdin['text'] = text
        copyFields(stdin, payload, ['duration_ms'])

        break
      }
      case 'stop':
      case 'subagentStop': {
        copyFields(stdin, payload, [
          'status',
          'loop_count',
          'subagent_type',
          'task',
          'description',
          'summary',
          'duration_ms',
          'message_count',
          'tool_call_count',
          'modified_files',
          'agent_transcript_path',
        ])

        break
      }
      case 'sessionStart': {
        copyFields(stdin, payload, ['session_id', 'is_background_agent', 'composer_mode'])

        break
      }
      case 'sessionEnd': {
        copyFields(stdin, payload, [
          'session_id',
          'reason',
          'duration_ms',
          'is_background_agent',
          'final_status',
          'error_message',
        ])
        break
      }
      case 'preCompact': {
        {
          copyFields(stdin, payload, [
            'trigger',
            'context_usage_percent',
            'context_tokens',
            'context_window_size',
            'message_count',
            'messages_to_compact',
            'is_first_compaction',
          ])
          // No default
        }
        break
      }
    }
  return run(stdin)
}

const permissionShape = z.strictObject({
  permission: z.enum(['allow', 'deny', 'ask']),
  continue: z.optional(z.boolean()),
  user_message: z.optional(z.string()),
  agent_message: z.optional(z.string()),
  updated_input: z.optional(z.record(z.string(), z.unknown())),
})
const compactShape = z.strictObject({ user_message: z.optional(z.string()) })
const readPermissionShape = z.strictObject({
  permission: z.enum(['allow', 'deny']),
  user_message: z.optional(z.string()),
  updated_input: z.optional(z.never()),
})
const promptShape = z.strictObject({ continue: z.boolean(), user_message: z.optional(z.string()) })
const contextShape = z.strictObject({ additional_context: z.optional(z.string()) })
const followupShape = z.strictObject({ followup_message: z.optional(z.string()) })
const sessionShape = z.strictObject({
  continue: z.optional(z.boolean()),
  user_message: z.optional(z.string()),
  additional_context: z.optional(z.string()),
  env: z.optional(z.unknown()),
})
const controlShape = z.object({
  permission: z.optional(z.string()),
  continue: z.optional(z.boolean()),
})

export function parseCursorResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: CursorAdapterOptions,
): HookAnswer {
  const name = sourceName(event, options)
  if (name === undefined) return failed('cursor: unsupported source event')
  const isPermission = event === 'PreToolUse'
  const isPrompt = event === 'UserPromptSubmit'
  if (exitCode === 2 && (isPermission || isPrompt))
    return {
      status: 'blocked',
      reason: blockReason(stderr, stdout, 'cursor hook denied the operation'),
    }
  if (exitCode !== 0)
    return isPermission && options?.failClosed === true
      ? { status: 'blocked', reason: blockReason(stderr, stdout, 'cursor hook failed closed') }
      : failed(stderr.trim() || `cursor: hook exited ${String(exitCode)}`)
  const value = jsonOutput(stdout)
  const control = controlShape.safeParse(value)
  if (
    control.success &&
    isRecord(value) &&
    ((isPermission && control.data.permission === 'deny') ||
      (isPrompt && control.data.continue === false))
  ) {
    return {
      status: 'blocked',
      reason: cleanReason(
        textField(value, 'agent_message') ?? textField(value, 'user_message'),
        'cursor hook denied the operation',
      ),
      systemMessage: textField(value, 'user_message'),
    }
  }
  if (isPermission) {
    // Cursor explicitly blocks syntax, schema and verdict errors, independent
    // of failClosed. That setting governs crashes/timeouts, not invalid answers.
    const parsed =
      name === 'beforeReadFile'
        ? readPermissionShape.safeParse(value)
        : permissionShape.safeParse(value)
    if (!parsed.success) return { status: 'blocked', reason: 'cursor: invalid permission response' }
    const output = parsed.data
    if (name !== 'preToolUse' && output.updated_input !== undefined)
      return { status: 'blocked', reason: 'cursor: updated_input is only valid on preToolUse' }
    if (output.permission === 'ask')
      return { status: 'completed', permissionDecision: 'ask', systemMessage: output.user_message }
    return {
      status: 'completed',
      ...(output.updated_input !== undefined && { updatedInput: output.updated_input }),
    }
  }
  if (stdout.trim() === '') return { status: 'completed' }
  if (isPrompt) {
    return promptShape.safeParse(value).success
      ? { status: 'completed' }
      : failed('cursor: invalid prompt response')
  }
  if (event === 'Stop' || event === 'SubagentStop') {
    const parsed = followupShape.safeParse(value)
    if (!parsed.success) return failed('cursor: invalid followup response')
    const message = parsed.data.followup_message?.trim()
    return message === undefined || message === ''
      ? { status: 'completed' }
      : { status: 'blocked', reason: message }
  }
  if (event === 'SessionStart') {
    const parsed = sessionShape.safeParse(value)
    if (!parsed.success || parsed.data.env !== undefined)
      return failed('cursor: invalid session output or env refused')
    // Cursor documents continue/user_message here as accepted but unenforced.
    return { status: 'completed', context: parsed.data.additional_context }
  }
  if (event === 'PreCompact') {
    const parsed = compactShape.safeParse(value)
    return parsed.success
      ? { status: 'completed', systemMessage: parsed.data.user_message }
      : failed('cursor: invalid preCompact observation')
  }
  const parsed = contextShape.safeParse(value)
  return parsed.success
    ? { status: 'completed', context: parsed.data.additional_context }
    : failed('cursor: unsupported event output')
}
