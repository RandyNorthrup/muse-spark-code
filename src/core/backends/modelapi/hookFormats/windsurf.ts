// Cascade contract: hooks-parity/docs_devin_ai_desktop_cascade_hooks_md.out:135-445.
import { type HookAnswer } from '../hooks'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  blockReason,
  copyFields,
  failed,
  fileOf,
  isShellTool,
  recordField,
  resultPreview,
  run,
  splitMcpName,
  textField,
  toolInputOf,
} from './core'

function eventName(event: AdapterEvent, tool: string | undefined): string | undefined {
  if (event === 'UserPromptSubmit') return 'pre_user_prompt'
  if (event === 'Stop') return 'post_cascade_response'
  if (event === 'WorktreeCreate') return 'post_setup_worktree'
  if (event !== 'PreToolUse' && event !== 'PostToolUse') return undefined
  const prefix = event === 'PreToolUse' ? 'pre_' : 'post_'
  if (tool === 'read_file') return `${prefix}read_code`
  if (tool === 'edit_file' || tool === 'write_file') return `${prefix}write_code`
  if (tool !== undefined && isShellTool(tool)) return `${prefix}run_command`
  return tool !== undefined && splitMcpName(tool) !== undefined
    ? `${prefix}mcp_tool_use`
    : undefined
}

export function buildWindsurfStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
): ForeignStdinResult {
  const tool = textField(payload, 'tool_name')
  const name = eventName(event, tool)
  if (name === undefined)
    return { outcome: 'refused', reason: `windsurf: ${event} has no supported event/tool` }
  if (event === 'PostToolUse' && splitMcpName(tool ?? '') === undefined) {
    // The file/shell post-event docs provide no result field. Dropping the
    // preview or adding an invented output_snippet would lie to a checker.
    return {
      outcome: 'refused',
      reason: 'windsurf: this post-tool contract cannot represent the result preview',
    }
  }
  const info: Record<string, unknown> = {}
  const input = toolInputOf(payload)
  if (name.endsWith('read_code') || name.endsWith('write_code')) {
    const file = fileOf(input)
    if (file === undefined)
      return { outcome: 'refused', reason: 'windsurf: file event needs a path' }
    info['file_path'] = file
    if (name.endsWith('write_code')) {
      const old = textField(input, 'find') ?? textField(input, 'old_string')
      const replacement = textField(input, 'replace') ?? textField(input, 'new_string')
      if (old === undefined || replacement === undefined)
        return { outcome: 'refused', reason: 'windsurf: write event needs documented edits' }
      info['edits'] = [{ old_string: old, new_string: replacement }]
    }
  } else if (name.endsWith('run_command')) {
    const command = textField(input, 'command')
    const cwd = textField(input, 'cwd') ?? textField(payload, 'cwd')
    if (command === undefined || cwd === undefined)
      return { outcome: 'refused', reason: 'windsurf: command event needs command and cwd' }
    info['command_line'] = command
    info['cwd'] = cwd
  } else if (name.endsWith('mcp_tool_use')) {
    const mcp = splitMcpName(tool ?? '')
    if (mcp === undefined)
      return { outcome: 'refused', reason: 'windsurf: MCP event needs a server and tool' }
    info['mcp_server_name'] = mcp.server
    info['mcp_tool_name'] = mcp.tool
    info['mcp_tool_arguments'] = recordField(input, 'arguments') ?? input
    if (event === 'PostToolUse') {
      const response = resultPreview(payload)
      if (response === undefined)
        return {
          outcome: 'refused',
          reason: 'windsurf: MCP post event needs a string result preview',
        }
      info['mcp_result'] = response
    }
  } else if (name === 'pre_user_prompt') {
    const prompt = textField(payload, 'prompt')
    if (prompt === undefined)
      return { outcome: 'refused', reason: 'windsurf: prompt event needs a prompt' }
    info['user_prompt'] = prompt
  } else if (name === 'post_cascade_response') {
    const response = textField(payload, 'response')
    if (response === undefined)
      return { outcome: 'refused', reason: 'windsurf: response event needs a response' }
    info['response'] = response
  } else {
    const worktree = textField(payload, 'worktree_path')
    const root = textField(payload, 'root_workspace_path') ?? textField(payload, 'cwd')
    if (worktree === undefined || root === undefined)
      return { outcome: 'refused', reason: 'windsurf: worktree event needs both paths' }
    info['worktree_path'] = worktree
    info['root_workspace_path'] = root
  }
  const stdin: Record<string, unknown> = { agent_action_name: name, tool_info: info }
  copyFields(stdin, payload, ['timestamp'])
  const session = textField(payload, 'session_id')
  const turn = textField(payload, 'turn_id')
  const model = textField(payload, 'model')
  if (session !== undefined) stdin['trajectory_id'] = session
  if (turn !== undefined) stdin['execution_id'] = turn
  if (model !== undefined) stdin['model_name'] = model
  return run(stdin)
}

export function parseWindsurfResult(
  event: AdapterEvent,
  exitCode: number | null,
  _stdout: string,
  stderr: string,
): HookAnswer {
  if (exitCode === 0) return { status: 'completed' }
  if (
    event === 'WorktreeCreate' ||
    (exitCode === 2 && (event === 'PreToolUse' || event === 'UserPromptSubmit'))
  ) {
    return {
      status: 'blocked',
      reason: blockReason(stderr, '', 'windsurf hook blocked the operation'),
    }
  }
  return failed(stderr.trim() || `windsurf: hook exited ${String(exitCode)}`)
}
