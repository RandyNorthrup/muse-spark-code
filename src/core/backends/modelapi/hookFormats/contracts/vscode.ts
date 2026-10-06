// VS Code "Local" agent hooks: the Copilot `vscode` flavor.
// Source: hooks-parity/vsc/hooks-reference.md (V). Doc-derived, not captured.
// Local tool names are VS Code's own and undocumented (V:145, vsc/hooks.md:282),
// so Muse tool names pass unchanged; tool_input is the Muse call's arguments.
import * as z from 'zod/mini'
import { type EventRow, type FieldSpec, type ResultRule, type ResultSpec } from '../contract'

const DOC = 'vsc/hooks-reference.md'

// V:69-77 common input: timestamp is ISO 8601; cwd/session/transcript optional.
const COMMON: readonly FieldSpec[] = [
  { to: 'hook_event_name', from: '@event' },
  { to: 'timestamp', transform: 'isoTime' },
  { to: 'cwd', transform: 'containedCwd' },
  { to: 'session_id', transform: 'text' },
  { to: 'transcript_path', transform: 'text' },
]

/**
 * V:84-121 common output (continue/stopReason/systemMessage on every event;
 * continue:false wins over any permission) and V:106-110 exit codes: 0 parses
 * stdout, 2 blocks with stderr to the model, others warn and continue.
 */
function local(
  event: string,
  specific: Readonly<Record<string, z.ZodMiniType>>,
  top: Readonly<Record<string, z.ZodMiniType>>,
  rules: readonly ResultRule[],
): ResultSpec {
  return {
    blockCodes: [2],
    stderrOnly: true,
    otherExit: 'fail',
    stdout: 'json',
    invalid: 'fail',
    label: 'vscode hook',
    schema: z.strictObject({
      continue: z.optional(z.boolean()),
      stopReason: z.optional(z.string()),
      systemMessage: z.optional(z.string()),
      ...top,
      hookSpecificOutput: z.optional(
        z.strictObject({ hookEventName: z.optional(z.literal(event)), ...specific }),
      ),
    }),
    rules: [
      {
        kind: 'veto',
        match: { continue: false },
        reason: ['stopReason'],
        fallback: 'vscode hook stopped the agent',
        stop: true,
      },
      { kind: 'message', field: 'systemMessage' },
      ...rules,
    ],
  }
}

const CONTEXT = { additionalContext: z.optional(z.string()) }
const NESTED_CONTEXT: ResultRule = {
  kind: 'context',
  field: 'hookSpecificOutput.additionalContext',
}
const BLOCK_TOP = { decision: z.optional(z.literal('block')), reason: z.optional(z.string()) }

function row(
  muse: EventRow['muse'],
  fields: readonly FieldSpec[],
  result: ResultSpec,
  cite: EventRow['cite'],
): EventRow {
  return {
    muse,
    vendor: muse,
    flavor: 'vscode',
    selection: 'default',
    fields: [...COMMON, ...fields],
    result,
    cite,
  }
}

const TOOL: readonly FieldSpec[] = [
  { to: 'tool_name', transform: 'text', required: true },
  { to: 'tool_input', required: true },
  { to: 'tool_use_id', transform: 'text' },
]

export const VSCODE_ROWS: readonly EventRow[] = [
  row(
    'PreToolUse',
    TOOL,
    local(
      'PreToolUse',
      {
        permissionDecision: z.optional(z.enum(['allow', 'deny', 'ask'])),
        permissionDecisionReason: z.optional(z.string()),
        updatedInput: z.optional(z.record(z.string(), z.unknown())),
        ...CONTEXT,
      },
      {},
      [
        {
          kind: 'veto',
          match: { 'hookSpecificOutput.permissionDecision': 'deny' },
          reason: ['hookSpecificOutput.permissionDecisionReason'],
          fallback: 'vscode hook denied the call',
        },
        { kind: 'ask', match: { 'hookSpecificOutput.permissionDecision': 'ask' } },
        { kind: 'updatedInput', field: 'hookSpecificOutput.updatedInput' },
        NESTED_CONTEXT,
      ],
    ),
    { input: `${DOC}:127-145`, output: `${DOC}:147-176` },
  ),
  row(
    'PostToolUse',
    [...TOOL, { to: 'tool_response', transform: 'text', required: true }],
    local('PostToolUse', CONTEXT, BLOCK_TOP, [
      {
        kind: 'veto',
        match: { decision: 'block' },
        reason: ['reason'],
        fallback: 'vscode hook blocked the operation',
      },
      NESTED_CONTEXT,
    ]),
    { input: `${DOC}:182-200`, output: `${DOC}:202-222` },
  ),
  row(
    'UserPromptSubmit',
    [{ to: 'prompt', transform: 'text' }],
    local('UserPromptSubmit', {}, {}, []),
    { input: `${DOC}:228-240`, output: `${DOC}:242` },
  ),
  row(
    'SessionStart',
    [{ to: 'source', transform: 'text' }],
    local('SessionStart', CONTEXT, {}, [NESTED_CONTEXT]),
    { input: `${DOC}:248-260`, output: `${DOC}:262-278` },
  ),
  row(
    'Stop',
    [{ to: 'stop_hook_active' }],
    // V:304-318: Stop's block decision is nested, unlike SubagentStop's.
    local(
      'Stop',
      { decision: z.optional(z.literal('block')), reason: z.optional(z.string()) },
      {},
      [
        {
          kind: 'veto',
          match: { 'hookSpecificOutput.decision': 'block' },
          reason: ['hookSpecificOutput.reason'],
          fallback: 'vscode hook requested continuation',
        },
      ],
    ),
    { input: `${DOC}:286-298`, output: `${DOC}:300-318` },
  ),
  row(
    'SubagentStart',
    [
      { to: 'agent_id', transform: 'text' },
      { to: 'agent_type', transform: 'text' },
    ],
    local('SubagentStart', CONTEXT, {}, [NESTED_CONTEXT]),
    { input: `${DOC}:327-341`, output: `${DOC}:343-359` },
  ),
  row(
    'SubagentStop',
    [
      { to: 'agent_id', transform: 'text' },
      { to: 'agent_type', transform: 'text' },
      { to: 'stop_hook_active' },
    ],
    local('SubagentStop', {}, BLOCK_TOP, [
      {
        kind: 'veto',
        match: { decision: 'block' },
        reason: ['reason'],
        fallback: 'vscode hook requested continuation',
      },
    ]),
    { input: `${DOC}:365-381`, output: `${DOC}:383-397` },
  ),
  row('PreCompact', [{ to: 'trigger', transform: 'text' }], local('PreCompact', {}, {}, []), {
    input: `${DOC}:403-415`,
    output: `${DOC}:417`,
  }),
]
