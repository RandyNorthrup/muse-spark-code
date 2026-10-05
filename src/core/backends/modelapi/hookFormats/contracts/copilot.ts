// GitHub Copilot CLI hook contract, both payload formats (C:259-262): camelCase
// event names get camelCase fields; PascalCase names get snake_case fields with
// Claude tool names. The `vscode` flavor (VS Code Local) lives in vscode.ts.
// Source: hooks-parity/gh/copilot_reference_hooks-configuration.md (C) and
// gh/copilot_tutorials_copilot-cli-hooks.md (CT). Doc-derived, not captured:
// the owner's account has no Copilot CLI entitlement checked in this lane.
import * as z from 'zod/mini'
import { type EventRow, type FieldSpec, type ResultSpec, type VendorContract } from '../contract'
import { VSCODE_ROWS } from './vscode'

const DOC = 'gh/copilot_reference_hooks-configuration.md'
const LABEL = 'copilot hook'

// C:832-843 native tool names (camelCase payloads keep runtime names).
const NATIVE_TOOLS = {
  bash: 'bash',
  powershell: 'powershell',
  read_file: 'view',
  write_file: 'create',
  edit_file: 'edit',
  search: 'grep',
  web_fetch: 'web_fetch',
  ask_user: 'ask_user',
  todo_write: 'update_todo',
}
// C:432-448 PascalCase PreToolUse reports the Claude name of the runtime tool;
// C:761 PermissionRequest uses the same table. Others keep runtime names.
const CLAUDE_TOOLS = {
  bash: 'Bash',
  powershell: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  search: 'Grep',
  web_fetch: 'WebFetch',
  ask_user: 'AskUserQuestion',
  todo_write: 'TodoWrite',
}

// C:264-272 camelCase common input: epoch-ms timestamp; the agent cwd is
// absolute (C example use-hooks.md:185 "cwd":"/tmp") and workspace-confined.
const CAMEL: readonly FieldSpec[] = [
  { to: 'sessionId', from: 'session_id', transform: 'text' },
  { to: 'timestamp', transform: 'epochMs' },
  { to: 'cwd', transform: 'containedCwd' },
]
// C:278-288 VS Code compatible (PascalCase) common input: ISO timestamp.
const SNAKE: readonly FieldSpec[] = [
  { to: 'hook_event_name', from: '@event' },
  { to: 'session_id', transform: 'text' },
  { to: 'timestamp', transform: 'isoTime' },
  { to: 'cwd', transform: 'containedCwd' },
]

/** C:154-159 stdout: progress lines stripped; unparseable output is no output. */
function cli(
  schema: z.ZodMiniType | undefined,
  rules: ResultSpec['rules'],
  extra: Partial<ResultSpec> = {},
): ResultSpec {
  return {
    blockCodes: [],
    otherExit: 'fail',
    stdout: schema === undefined ? 'ignore' : 'json',
    unparseableIsEmpty: true,
    progressLines: true,
    invalid: 'fail',
    label: LABEL,
    rules,
    ...(schema !== undefined && { schema }),
    ...extra,
  }
}

const CONTEXT = cli(z.strictObject({ additionalContext: z.optional(z.string()) }), [
  { kind: 'context', field: 'additionalContext' },
])
const NO_OUTPUT = cli(undefined, [])

// C:684-692 decision control; C:845/852-853 exit 2 merges a deny into stdout
// JSON and any other non-timeout failure denies (fail-closed). A schema error
// in a parseable answer is also treated as a hook error here (AMBIGUOUS: C is
// silent; the event is fail-closed). Timeouts are lane W's (fail open, C:854).
const PRE_TOOL = cli(
  z.strictObject({
    permissionDecision: z.optional(z.enum(['allow', 'deny', 'ask'])),
    permissionDecisionReason: z.optional(z.string()),
    modifiedArgs: z.optional(z.record(z.string(), z.unknown())),
  }),
  [
    {
      kind: 'veto',
      match: { permissionDecision: 'deny' },
      reason: ['permissionDecisionReason'],
      fallback: 'Denied by preToolUse hook',
    },
    { kind: 'ask', match: { permissionDecision: 'ask' } },
    { kind: 'updatedInput', field: 'modifiedArgs' },
  ],
  {
    blockCodes: [2],
    blockMerge: { permissionDecision: 'deny' },
    otherExit: 'block',
    invalid: 'block',
  },
)

// C:763-771: behavior/message/interrupt; exit 2 merges {"behavior":"deny"} and
// ignores stderr; other failures fail open (C:853 names only preToolUse).
const PERMISSION = cli(
  z.strictObject({
    behavior: z.optional(z.enum(['allow', 'deny'])),
    message: z.optional(z.string()),
    interrupt: z.optional(z.boolean()),
  }),
  [
    {
      kind: 'veto',
      match: { behavior: 'deny' },
      reason: ['message'],
      fallback: 'copilot hook denied the call',
      approval: 'deny',
      interrupt: 'interrupt',
    },
  ],
  { blockCodes: [2], blockMerge: { behavior: 'deny' }, ignoreStderr: true },
)

// C:696-708: decision block continues with reason; subagentStop may replace
// the response it returns, and a block wins over that rewrite (C:706).
function stop(isSubagent: boolean): ResultSpec {
  return cli(
    z.strictObject({
      decision: z.optional(z.enum(['block', 'allow'])),
      reason: z.optional(z.string()),
      ...(isSubagent && { modifiedResponse: z.optional(z.string()) }),
    }),
    [
      {
        kind: 'veto',
        match: { decision: 'block' },
        reason: ['reason'],
        fallback: 'copilot hook requested continuation',
      },
      ...(isSubagent
        ? [
            {
              kind: 'replacement' as const,
              field: 'modifiedResponse',
              target: 'subagentResponse' as const,
            },
          ]
        : []),
    ],
  )
}

// C:713-735: modifiedResult replaces the result (success only); context appended.
const POST_TOOL = cli(
  z.strictObject({
    modifiedResult: z.optional(
      z.strictObject({ resultType: z.literal('success'), textResultForLlm: z.string() }),
    ),
    additionalContext: z.optional(z.string()),
  }),
  [
    { kind: 'context', field: 'additionalContext' },
    {
      kind: 'replacement',
      field: 'modifiedResult',
      textPath: 'textResultForLlm',
      target: 'toolResult',
    },
  ],
)

// C:852: postToolUseFailure exit 2 appends stdout to the failure as context.
const POST_FAILURE = cli(undefined, [], { contextCodes: [2] })

type CliRow = (
  muse: EventRow['muse'],
  vendor: string,
  fields: readonly FieldSpec[],
  result: ResultSpec,
  cite: EventRow['cite'],
  toolNames?: Readonly<Record<string, string>>,
) => EventRow

/** camelCase rows are the default; PascalCase rows only when the import names them. */
function cliRow(isPascal: boolean): CliRow {
  return (muse, vendor, fields, result, cite, toolNames) => ({
    muse,
    vendor,
    flavor: 'copilot',
    selection: isPascal ? 'explicit' : 'default',
    fields: [...(isPascal ? SNAKE : CAMEL), ...fields],
    result,
    cite,
    ...(toolNames !== undefined && { toolNames }),
  })
}
const camel = cliRow(false)
const pascal = cliRow(true)

const TOOL_NAME: FieldSpec = {
  to: 'toolName',
  from: 'tool_name',
  transform: 'toolName',
  required: true,
}
// CT:322-324 "toolArgs: A JSON string containing that tool's arguments".
const TOOL_ARGS: FieldSpec = {
  to: 'toolArgs',
  from: 'tool_input',
  transform: 'json',
  required: true,
}
const SNAKE_TOOL: readonly FieldSpec[] = [
  { to: 'tool_name', transform: 'toolName', required: true },
  // C:422 "parsed from JSON string when possible": an object.
  { to: 'tool_input', required: true },
]
const PREVIEW = 'tool_response'
const TRANSCRIPT = { to: 'transcriptPath', from: 'transcript_path', transform: 'text' } as const
const SNAKE_TRANSCRIPT = { to: 'transcript_path', transform: 'text' } as const

const CLI_ROWS: readonly EventRow[] = [
  camel(
    'SessionStart',
    'sessionStart',
    [
      { to: 'source', transform: 'text' },
      { to: 'initialPrompt', from: 'initial_prompt', transform: 'text' },
    ],
    CONTEXT,
    { input: `${DOC}:264-276`, output: `${DOC}:291-299` },
  ),
  pascal(
    'SessionStart',
    'SessionStart',
    [
      { to: 'source', transform: 'text' },
      { to: 'initial_prompt', transform: 'text' },
    ],
    CONTEXT,
    { input: `${DOC}:278-289`, output: `${DOC}:291-299` },
  ),
  camel('SessionEnd', 'sessionEnd', [{ to: 'reason', transform: 'text' }], NO_OUTPUT, {
    input: `${DOC}:308-317`,
    output: `${DOC}:303-329 (no output)`,
  }),
  pascal('SessionEnd', 'SessionEnd', [{ to: 'reason', transform: 'text' }], NO_OUTPUT, {
    input: `${DOC}:319-329`,
    output: `${DOC}:303-329 (no output)`,
  }),
  // C:368 command-hook userPromptSubmitted output is dropped.
  camel(
    'UserPromptSubmit',
    'userPromptSubmitted',
    [{ to: 'prompt', transform: 'text' }],
    NO_OUTPUT,
    {
      input: `${DOC}:333-342`,
      output: `${DOC}:356-369`,
    },
  ),
  pascal('UserPromptSubmit', 'UserPromptSubmit', [{ to: 'prompt', transform: 'text' }], NO_OUTPUT, {
    input: `${DOC}:344-354`,
    output: `${DOC}:356-369`,
  }),
  camel(
    'PreToolUse',
    'preToolUse',
    [TOOL_NAME, TOOL_ARGS],
    PRE_TOOL,
    { input: `${DOC}:399-409`, output: `${DOC}:684-692,845-856` },
    NATIVE_TOOLS,
  ),
  pascal(
    'PreToolUse',
    'PreToolUse',
    SNAKE_TOOL,
    PRE_TOOL,
    { input: `${DOC}:411-448`, output: `${DOC}:684-692,845-856` },
    CLAUDE_TOOLS,
  ),
  // C:756 names toolInput; the permissionRequest input is otherwise undocumented.
  camel(
    'PermissionRequest',
    'permissionRequest',
    [TOOL_NAME, { to: 'toolInput', from: 'tool_input', required: true }],
    PERMISSION,
    { input: `${DOC}:752-758 (partial)`, output: `${DOC}:763-771` },
    NATIVE_TOOLS,
  ),
  pascal(
    'PermissionRequest',
    'PermissionRequest',
    SNAKE_TOOL,
    PERMISSION,
    { input: `${DOC}:761 (partial)`, output: `${DOC}:763-771` },
    CLAUDE_TOOLS,
  ),
  camel(
    'PostToolUse',
    'postToolUse',
    [
      TOOL_NAME,
      TOOL_ARGS,
      { to: 'toolResult.resultType', value: 'success' },
      { to: 'toolResult.textResultForLlm', from: PREVIEW, transform: 'text', required: true },
    ],
    POST_TOOL,
    { input: `${DOC}:455-469`, output: `${DOC}:713-735` },
    NATIVE_TOOLS,
  ),
  // AMBIGUOUS (C:432 names only PreToolUse): PascalCase post events keep runtime names.
  pascal(
    'PostToolUse',
    'PostToolUse',
    [
      ...SNAKE_TOOL,
      { to: 'tool_result.result_type', value: 'success' },
      { to: 'tool_result.text_result_for_llm', from: PREVIEW, transform: 'text', required: true },
    ],
    POST_TOOL,
    { input: `${DOC}:471-486`, output: `${DOC}:713-735` },
    NATIVE_TOOLS,
  ),
  camel(
    'PostToolUseFailure',
    'postToolUseFailure',
    [TOOL_NAME, TOOL_ARGS, { to: 'error', transform: 'text' }],
    POST_FAILURE,
    { input: `${DOC}:490-501`, output: `${DOC}:852` },
    NATIVE_TOOLS,
  ),
  pascal(
    'PostToolUseFailure',
    'PostToolUseFailure',
    [...SNAKE_TOOL, { to: 'error', transform: 'text' }],
    POST_FAILURE,
    { input: `${DOC}:503-515`, output: `${DOC}:852` },
    NATIVE_TOOLS,
  ),
  camel(
    'Stop',
    'agentStop',
    [
      TRANSCRIPT,
      { to: 'stopReason', from: 'stop_reason', transform: 'text' },
      { to: 'stop_hook_active' },
    ],
    stop(false),
    { input: `${DOC}:519-530`, output: `${DOC}:696-711` },
  ),
  pascal(
    'Stop',
    'Stop',
    [SNAKE_TRANSCRIPT, { to: 'stop_reason', transform: 'text' }, { to: 'stop_hook_active' }],
    stop(false),
    { input: `${DOC}:532-544`, output: `${DOC}:696-711` },
  ),
  camel(
    'SubagentStart',
    'subagentStart',
    [
      TRANSCRIPT,
      { to: 'agentName', from: 'agent_name', transform: 'text' },
      { to: 'agentDisplayName', from: 'agent_display_name', transform: 'text' },
      { to: 'agentDescription', from: 'agent_description', transform: 'text' },
    ],
    CONTEXT,
    { input: `${DOC}:551-563`, output: `${DOC}:565-573` },
  ),
  camel(
    'SubagentStop',
    'subagentStop',
    [
      TRANSCRIPT,
      { to: 'agentId', from: 'agent_id', transform: 'text' },
      { to: 'agentType', from: 'agent_type', transform: 'text' },
      { to: 'agentName', from: 'agent_name', transform: 'text' },
      { to: 'agentDisplayName', from: 'agent_display_name', transform: 'text' },
      { to: 'response', from: 'last_assistant_message', transform: 'text' },
      { to: 'stopReason', from: 'stop_reason', transform: 'text' },
    ],
    stop(true),
    { input: `${DOC}:583-598`, output: `${DOC}:696-711` },
  ),
  pascal(
    'SubagentStop',
    'SubagentStop',
    [
      SNAKE_TRANSCRIPT,
      ...['agent_id', 'agent_type', 'agent_name', 'agent_display_name'].map((key): FieldSpec => ({
        to: key,
        transform: 'text',
      })),
      { to: 'last_assistant_message', transform: 'text' },
      { to: 'stop_reason', transform: 'text' },
    ],
    stop(true),
    { input: `${DOC}:600-616`, output: `${DOC}:696-711` },
  ),
  camel(
    'StopFailure',
    'errorOccurred',
    [
      { to: 'error' },
      { to: 'errorContext', from: 'error_context', transform: 'text' },
      { to: 'recoverable' },
    ],
    NO_OUTPUT,
    { input: `${DOC}:620-635`, output: `${DOC}:618-653 (no output)` },
  ),
  pascal(
    'StopFailure',
    'ErrorOccurred',
    [{ to: 'error' }, { to: 'error_context', transform: 'text' }, { to: 'recoverable' }],
    NO_OUTPUT,
    { input: `${DOC}:637-653`, output: `${DOC}:618-653 (no output)` },
  ),
  camel(
    'PreCompact',
    'preCompact',
    [
      TRANSCRIPT,
      { to: 'trigger', transform: 'text' },
      { to: 'customInstructions', from: 'custom_instructions', transform: 'text' },
    ],
    NO_OUTPUT,
    { input: `${DOC}:657-668`, output: `${DOC}:655-682 (no output)` },
  ),
  pascal(
    'PreCompact',
    'PreCompact',
    [
      SNAKE_TRANSCRIPT,
      { to: 'trigger', transform: 'text' },
      { to: 'custom_instructions', transform: 'text' },
    ],
    NO_OUTPUT,
    { input: `${DOC}:670-682`, output: `${DOC}:655-682 (no output)` },
  ),
  camel(
    'Notification',
    'notification',
    [
      { to: 'hook_event_name', value: 'Notification' },
      { to: 'message', transform: 'text' },
      { to: 'title', transform: 'text' },
      { to: 'notification_type', transform: 'text' },
    ],
    CONTEXT,
    { input: `${DOC}:780-792`, output: `${DOC}:805-813` },
  ),
]

export const COPILOT_CONTRACT: VendorContract = {
  vendor: 'copilot',
  defaultFlavor: 'copilot',
  // Lane-common round 2 P: env stays refused (secret risk).
  refusedPayloadKeys: ['env', 'environment'],
  common: [],
  rows: [...CLI_ROWS, ...VSCODE_ROWS],
}
