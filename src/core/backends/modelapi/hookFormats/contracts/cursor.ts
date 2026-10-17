// Cursor hook contract. Source: hooks-parity/cursor_com_docs_hooks_md.out (CH).
// Doc-derived, not captured: no Cursor install or account was available.
import * as z from 'zod/mini'
import { type FieldSpec, type ResultSpec, type VendorContract } from '../contract'

const DOC = 'cursor_com_docs_hooks_md.out'
const LABEL = 'cursor hook'

// CH:745 matcher tool names; CH:848 generic tool types; Edit is Write (third-party:231-241).
const TOOL_NAMES = {
  bash: 'Shell',
  powershell: 'Shell',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Write',
  search: 'Grep',
  $mcp: 'MCP:{tool}',
}

// CH:194 permission hooks block on invalid JSON or schema; CH:195 exit 2
// denies; CH:196 other exits fail open; CH:707 failClosed blocks crashes,
// timeouts, non-zero exits and no output.
function permission(schema: z.ZodMiniType, canAsk: boolean): ResultSpec {
  return {
    blockCodes: [2],
    // third-party:160 shows exit 2 with a JSON deny; its messages are kept.
    blockScansStdout: true,
    otherExit: 'fail',
    failClosed: true,
    stdout: 'json',
    emptyIsInvalid: true,
    invalid: 'block',
    schema,
    label: LABEL,
    rules: [
      {
        kind: 'veto',
        match: { permission: 'deny' },
        reason: ['agent_message', 'user_message'],
        fallback: 'cursor hook denied the operation',
      },
      { kind: 'message', field: 'user_message' },
      // CH:878 preToolUse "ask" is accepted but not enforced by Cursor; asking
      // the user here is stricter than proceeding, never a grant.
      ...(canAsk ? [{ kind: 'ask' as const, match: { permission: 'ask' } }] : []),
      { kind: 'updatedInput', field: 'updated_input' },
    ],
  }
}

// CH:1067-1072 specialized hooks; `continue` appears in the doc's own
// beforeShell example (CH:345). preToolUse adds updated_input (CH:866-881).
const permissionFields = {
  permission: z.enum(['allow', 'deny', 'ask']),
  continue: z.optional(z.boolean()),
  user_message: z.optional(z.string()),
  agent_message: z.optional(z.string()),
}
const preToolUseShape = z.strictObject({
  ...permissionFields,
  updated_input: z.optional(z.record(z.string(), z.unknown())),
})
const beforeExecShape = z.strictObject(permissionFields)
// CH:1162-1166 + 1175-1178: allow or deny only.
const readShape = z.strictObject({
  permission: z.enum(['allow', 'deny']),
  user_message: z.optional(z.string()),
})

function observation(schema: z.ZodMiniType, rules: ResultSpec['rules']): ResultSpec {
  return {
    blockCodes: [],
    otherExit: 'fail',
    stdout: 'json',
    invalid: 'fail',
    schema,
    rules,
    label: LABEL,
  }
}

const IGNORED: ResultSpec = {
  blockCodes: [],
  otherExit: 'fail',
  stdout: 'ignore',
  invalid: 'ignore',
  rules: [],
  label: LABEL,
}

// CH:1312-1320 stop / CH:1036-1040 subagentStop: a non-empty followup_message
// continues; subagentStop consumes it only when status is "completed" (CH:1038).
function followup(isCompletedOnly: boolean): ResultSpec {
  return observation(z.strictObject({ followup_message: z.optional(z.string()) }), [
    {
      kind: 'veto',
      match: {},
      nonEmpty: 'followup_message',
      reason: [],
      fallback: 'cursor hook requested continuation',
      ...(isCompletedOnly && { when: { path: 'status', equals: 'completed' } }),
    },
  ])
}

// CH:1056-1061 + 1113-1116: MCP tool, server, and the "JSON params string"
// (CH:1078): the call's own arguments, never unwrapped.
const MCP_FIELDS: readonly FieldSpec[] = [
  { to: 'tool_name', transform: 'mcpTool', required: true },
  { to: 'tool_input', transform: 'json', required: true },
  { to: 'mcp_server_name', from: 'tool_name', transform: 'mcpServer', required: true },
]

const toolCommon = [
  { to: 'tool_use_id', transform: 'text' },
  { to: 'cwd', transform: 'absolutePath' },
] as const

export const CURSOR_CONTRACT: VendorContract = {
  vendor: 'cursor',
  // CH:814-826 common input; cursor_version and user_email are never invented.
  common: [
    { to: 'hook_event_name', from: '@event' },
    { to: 'conversation_id', from: 'session_id', transform: 'text' },
    { to: 'generation_id', from: 'turn_id', transform: 'text' },
    { to: 'model', transform: 'text' },
    { to: 'model_id', transform: 'text' },
    { to: 'model_params' },
    { to: 'transcript_path' },
    { to: 'workspace_roots', from: 'cwd', transform: 'wrapArray' },
    { to: 'workspace_roots' },
  ],
  rows: [
    {
      muse: 'PreToolUse',
      vendor: 'preToolUse',
      selection: 'default',
      toolNames: TOOL_NAMES,
      fields: [
        { to: 'tool_name', transform: 'toolName', required: true },
        { to: 'tool_input', required: true },
        ...toolCommon,
        { to: 'agent_message', transform: 'text' },
      ],
      result: permission(preToolUseShape, true),
      cite: { input: `${DOC}:846-865`, output: `${DOC}:867-881` },
    },
    {
      muse: 'PreToolUse',
      vendor: 'beforeShellExecution',
      selection: 'explicit',
      tools: ['shell'],
      fields: [
        { to: 'command', from: 'tool_input.command', transform: 'text', required: true },
        { to: 'cwd', from: ['tool_input.cwd', 'cwd'], transform: 'absolutePath' },
        { to: 'sandbox' },
      ],
      result: permission(beforeExecShape, true),
      cite: { input: `${DOC}:1049-1054`, output: `${DOC}:1046,1067-1072` },
    },
    {
      muse: 'PreToolUse',
      vendor: 'beforeMCPExecution',
      selection: 'explicit',
      tools: ['mcp'],
      fields: [
        ...MCP_FIELDS,
        { to: 'url', transform: 'text' },
        { to: 'mcp_server_url', transform: 'text' },
        { to: 'command', transform: 'text' },
      ],
      result: permission(beforeExecShape, true),
      cite: { input: `${DOC}:1056-1065,1075-1082`, output: `${DOC}:1046,1067-1072` },
    },
    {
      muse: 'PreToolUse',
      vendor: 'beforeReadFile',
      selection: 'explicit',
      tools: ['read'],
      fields: [
        // CH:1171 "Absolute path to the file being read".
        {
          to: 'file_path',
          from: ['tool_input.file_path', 'tool_input.path'],
          transform: 'absolutePath',
          required: true,
        },
        { to: 'content', transform: 'text', required: true },
        { to: 'attachments', transform: 'absoluteAttachments' },
      ],
      result: permission(readShape, false),
      cite: { input: `${DOC}:1150-1160,1169-1173`, output: `${DOC}:1147,1162-1178` },
    },
    {
      muse: 'PostToolUse',
      vendor: 'postToolUse',
      selection: 'default',
      toolNames: TOOL_NAMES,
      fields: [
        { to: 'tool_name', transform: 'toolName', required: true },
        { to: 'tool_input', required: true },
        // CH:915 JSON-stringified result payload: the runtime's bounded preview.
        { to: 'tool_output', from: 'tool_response', transform: 'json', required: true },
        ...toolCommon,
        { to: 'duration' },
      ],
      result: observation(
        z.strictObject({
          updated_mcp_tool_output: z.optional(z.record(z.string(), z.unknown())),
          additional_context: z.optional(z.string()),
        }),
        [
          { kind: 'context', field: 'additional_context' },
          // CH:919 "For MCP tools only: replaces the tool output seen by the model".
          {
            kind: 'replacement',
            field: 'updated_mcp_tool_output',
            target: 'toolResult',
            when: { toolClass: 'mcp' },
          },
        ],
      ),
      cite: { input: `${DOC}:887-903,912-915`, output: `${DOC}:905-920` },
    },
    {
      muse: 'PostToolUse',
      vendor: 'afterShellExecution',
      selection: 'explicit',
      tools: ['shell'],
      fields: [
        { to: 'command', from: 'tool_input.command', transform: 'text', required: true },
        { to: 'output', from: 'tool_response', transform: 'text', required: true },
        { to: 'duration' },
        { to: 'sandbox' },
      ],
      result: IGNORED,
      cite: { input: `${DOC}:1090-1105`, output: `${DOC}:1086-1098 (no output)` },
    },
    {
      muse: 'PostToolUse',
      vendor: 'afterMCPExecution',
      selection: 'explicit',
      tools: ['mcp'],
      fields: [
        ...MCP_FIELDS,
        { to: 'mcp_server_url', transform: 'text' },
        { to: 'result_json', from: 'tool_response', transform: 'json', required: true },
        { to: 'duration' },
      ],
      result: IGNORED,
      cite: { input: `${DOC}:1111-1129`, output: `${DOC}:1107-1120 (no output)` },
    },
    {
      muse: 'PostToolUse',
      vendor: 'afterFileEdit',
      selection: 'explicit',
      tools: ['edit'],
      fields: [
        {
          to: 'file_path',
          from: ['tool_input.file_path', 'tool_input.path'],
          transform: 'absolutePath',
          required: true,
        },
        { to: 'edits', from: 'tool_input', transform: 'editsArray', required: true },
      ],
      result: IGNORED,
      cite: { input: `${DOC}:1135-1141`, output: `${DOC}:1131-1141 (no output)` },
    },
    {
      muse: 'PostToolUseFailure',
      vendor: 'postToolUseFailure',
      selection: 'default',
      toolNames: TOOL_NAMES,
      fields: [
        { to: 'tool_name', transform: 'toolName', required: true },
        { to: 'tool_input', required: true },
        ...toolCommon,
        { to: 'error_message', transform: 'text' },
        { to: 'failure_type', transform: 'text' },
        { to: 'duration' },
        { to: 'is_interrupt' },
      ],
      result: observation(z.strictObject({ additional_context: z.optional(z.string()) }), [
        { kind: 'context', field: 'additional_context' },
      ]),
      cite: { input: `${DOC}:926-950`, output: `${DOC}:939-954` },
    },
    {
      muse: 'SubagentStop',
      vendor: 'subagentStop',
      selection: 'default',
      fields: [
        'subagent_type',
        'status',
        'task',
        'description',
        'summary',
        'duration_ms',
        'message_count',
        'tool_call_count',
        'loop_count',
        'modified_files',
        'agent_transcript_path',
      ].map((key) => ({ to: key })),
      result: followup(true),
      cite: { input: `${DOC}:1000-1034`, output: `${DOC}:1016-1040` },
    },
    {
      muse: 'UserPromptSubmit',
      vendor: 'beforeSubmitPrompt',
      selection: 'default',
      fields: [
        { to: 'prompt', transform: 'text' },
        { to: 'attachments', transform: 'absoluteAttachments' },
      ],
      // CH:1241 "Can prevent submission"; CH:707 failClosed covers this blocking hook.
      result: {
        blockCodes: [2],
        blockScansStdout: true,
        otherExit: 'fail',
        failClosed: true,
        stdout: 'json',
        invalid: 'fail',
        schema: z.strictObject({ continue: z.boolean(), user_message: z.optional(z.string()) }),
        label: LABEL,
        rules: [
          {
            kind: 'veto',
            match: { continue: false },
            reason: ['user_message'],
            fallback: 'cursor hook blocked the prompt',
          },
          { kind: 'message', field: 'user_message' },
        ],
      },
      cite: { input: `${DOC}:1243-1253`, output: `${DOC}:1255-1265` },
    },
    {
      muse: 'PreCompact',
      vendor: 'preCompact',
      selection: 'default',
      fields: [
        'trigger',
        'context_usage_percent',
        'context_tokens',
        'context_window_size',
        'message_count',
        'messages_to_compact',
        'is_first_compaction',
      ].map((key) => ({ to: key })),
      // CH:1390 observational: cannot block or modify compaction.
      result: observation(z.strictObject({ user_message: z.optional(z.string()) }), [
        { kind: 'message', field: 'user_message' },
      ]),
      cite: { input: `${DOC}:1392-1420`, output: `${DOC}:1405-1424` },
    },
    {
      muse: 'Stop',
      vendor: 'stop',
      selection: 'default',
      fields: [{ to: 'status' }, { to: 'loop_count' }],
      result: followup(false),
      cite: { input: `${DOC}:1304-1310`, output: `${DOC}:1312-1320` },
    },
    {
      muse: 'SessionStart',
      vendor: 'sessionStart',
      selection: 'default',
      fields: [{ to: 'session_id' }, { to: 'is_background_agent' }, { to: 'composer_mode' }],
      // CH:1324 fire-and-forget; CH:1354 continue/user_message accepted, not
      // enforced; env would leak into later hooks, so it is refused.
      result: observation(
        z.strictObject({
          env: z.optional(z.never()),
          additional_context: z.optional(z.string()),
          continue: z.optional(z.boolean()),
          user_message: z.optional(z.string()),
        }),
        [{ kind: 'context', field: 'additional_context' }],
      ),
      cite: { input: `${DOC}:1326-1347`, output: `${DOC}:1335-1354` },
    },
    {
      muse: 'SessionEnd',
      vendor: 'sessionEnd',
      selection: 'default',
      fields: [
        'session_id',
        'reason',
        'duration_ms',
        'is_background_agent',
        'final_status',
        'error_message',
      ].map((key) => ({ to: key })),
      // CH:1358 "The response is logged but not used."
      result: IGNORED,
      cite: { input: `${DOC}:1360-1386`, output: `${DOC}:1358,1372-1377` },
    },
    {
      muse: 'PostLLMCall',
      vendor: 'afterAgentResponse',
      selection: 'default',
      fields: [{ to: 'text', from: ['text', 'response'], transform: 'text', required: true }],
      result: IGNORED,
      cite: { input: `${DOC}:1271-1276`, output: `${DOC}:1267-1276 (no output)` },
    },
    {
      muse: 'AfterAgentThought',
      vendor: 'afterAgentThought',
      selection: 'default',
      fields: [{ to: 'text', transform: 'text', required: true }, { to: 'duration_ms' }],
      result: IGNORED,
      cite: { input: `${DOC}:1282-1298`, output: `${DOC}:1289-1292` },
    },
    {
      muse: 'DirectoryAdded',
      vendor: 'workspaceOpen',
      selection: 'default',
      fields: [],
      // CH:1439-1447 pluginPaths would load plugins: refused, not ignored.
      result: observation(z.strictObject({ pluginPaths: z.optional(z.never()) }), []),
      cite: { input: `${DOC}:842,1430-1437`, output: `${DOC}:1439-1447` },
    },
  ],
}
