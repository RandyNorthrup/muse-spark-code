// Windsurf / Devin Desktop Cascade hook contract.
// Source: hooks-parity/docs_devin_ai_desktop_cascade_hooks_md.out (W).
// Doc-derived, not captured. Cascade reads exit codes only, never stdout
// (W:432-446), so every row ignores stdout.
import { type EventRow, type FieldSpec, type ResultSpec, type VendorContract } from '../contract'

const DOC = 'docs_devin_ai_desktop_cascade_hooks_md.out'

// W:436-443: exit 2 blocks pre-hooks with stderr to the agent; others proceed.
const PRE: ResultSpec = {
  blockCodes: [2],
  stderrOnly: true,
  otherExit: 'fail',
  stdout: 'ignore',
  invalid: 'ignore',
  rules: [],
  label: 'windsurf hook',
}
// W:443 "Post-hooks cannot block since the action has already occurred."
const POST: ResultSpec = { ...PRE, blockCodes: [] }
// PLAN.md M91 hook table: our WorktreeCreate fails the attempt on any non-zero
// exit. Stricter than W:440 (post hooks proceed); Muse semantics own this row.
const WORKTREE: ResultSpec = { ...PRE, blockCodes: [], otherExit: 'block' }

// The common examples show absolute paths (W:162, 247); Muse paths are made
// absolute against the workspace root, never sent relative.
const FILE: FieldSpec = {
  to: 'tool_info.file_path',
  from: ['tool_input.file_path', 'tool_input.path'],
  transform: 'absolutePath',
  required: true,
}
const EDITS: FieldSpec = {
  to: 'tool_info.edits',
  from: 'tool_input',
  transform: 'editsArray',
  required: true,
}
const COMMAND: readonly FieldSpec[] = [
  { to: 'tool_info.command_line', from: 'tool_input.command', transform: 'text', required: true },
  {
    to: 'tool_info.cwd',
    from: ['tool_input.cwd', 'cwd'],
    transform: 'absolutePath',
    required: true,
  },
]
// W:283-288 mcp_tool_arguments is the tool's own argument object, as given.
const MCP: readonly FieldSpec[] = [
  { to: 'tool_info.mcp_server_name', from: 'tool_name', transform: 'mcpServer', required: true },
  { to: 'tool_info.mcp_tool_name', from: 'tool_name', transform: 'mcpTool', required: true },
  { to: 'tool_info.mcp_tool_arguments', from: 'tool_input', required: true },
]

function row(
  muse: EventRow['muse'],
  vendor: string,
  tools: EventRow['tools'],
  fields: readonly FieldSpec[],
  result: ResultSpec,
  lines: string,
): EventRow {
  return {
    muse,
    vendor,
    selection: 'default',
    ...(tools !== undefined && { tools }),
    fields,
    result,
    cite: { input: `${DOC}:${lines}`, output: `${DOC}:432-446` },
  }
}

export const WINDSURF_CONTRACT: VendorContract = {
  vendor: 'windsurf',
  // W:137-146 common input; agent_action_name carries the event name.
  common: [
    { to: 'agent_action_name', from: '@event' },
    { to: 'trajectory_id', from: 'session_id', transform: 'text' },
    { to: 'execution_id', from: 'turn_id', transform: 'text' },
    { to: 'timestamp', transform: 'isoTime' },
    { to: 'model_name', from: 'model', transform: 'text' },
  ],
  rows: [
    row('PreToolUse', 'pre_read_code', ['read'], [FILE], PRE, '150-167'),
    row('PostToolUse', 'post_read_code', ['read'], [FILE], POST, '169-186'),
    row('PreToolUse', 'pre_write_code', ['edit', 'write'], [FILE, EDITS], PRE, '188-209'),
    row('PostToolUse', 'post_write_code', ['edit', 'write'], [FILE, EDITS], POST, '211-232'),
    row('PreToolUse', 'pre_run_command', ['shell'], COMMAND, PRE, '234-250'),
    row('PostToolUse', 'post_run_command', ['shell'], COMMAND, POST, '252-268'),
    row('PreToolUse', 'pre_mcp_tool_use', ['mcp'], MCP, PRE, '270-292'),
    row(
      'PostToolUse',
      'post_mcp_tool_use',
      ['mcp'],
      [
        ...MCP,
        { to: 'tool_info.mcp_result', from: 'tool_response', transform: 'text', required: true },
      ],
      POST,
      '294-317',
    ),
    row(
      'UserPromptSubmit',
      'pre_user_prompt',
      undefined,
      [{ to: 'tool_info.user_prompt', from: 'prompt', transform: 'text', required: true }],
      PRE,
      '319-336',
    ),
    row(
      'Stop',
      'post_cascade_response',
      undefined,
      [
        {
          to: 'tool_info.response',
          from: ['last_assistant_message', 'response'],
          transform: 'text',
          required: true,
        },
      ],
      POST,
      '338-357',
    ),
    row(
      'WorktreeCreate',
      'post_setup_worktree',
      undefined,
      [
        {
          to: 'tool_info.worktree_path',
          from: 'worktree_path',
          transform: 'absolutePath',
          required: true,
        },
        {
          to: 'tool_info.root_workspace_path',
          from: ['root_workspace_path', 'cwd'],
          transform: 'absolutePath',
          required: true,
        },
      ],
      WORKTREE,
      '408-430',
    ),
  ],
}
