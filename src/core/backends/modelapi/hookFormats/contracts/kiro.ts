// Kiro v1 hook contract. Sources under hooks-parity/raw/: kiro_hooks_types.md
// (T), its HTML copy kiro_hooks_types.html (TH, the .md export blanks tabbed
// JSON), and kiro_hooks_actions.md (A). Doc-derived, not captured.
// Exit codes follow A:32-34 (the lane's assigned contract): exit 0 stdout is
// context only for SessionStart/UserPromptSubmit; exit 2 blocks only
// PreToolUse, UserPromptSubmit and PreTaskExec; others warn. A:26 (IDE text)
// says any non-zero blocks PreToolUse/Prompt Submit: an open lead decision.
import {
  HOOK_MATCHER_MAX_CHARS,
  HOOK_MATCHER_VALUE_MAX_CHARS,
} from '../../../../../shared/constants'
import { matchingHooks, type HookDefinition } from '../../hooks'
import {
  type AdapterOptions,
  type EventRow,
  type FieldSpec,
  type ResultSpec,
  type VendorContract,
} from '../contract'
import { fileOf, recordField, textField } from '../core'

const TYPES = 'raw/kiro_hooks_types.md'
const HTML = 'raw/kiro_hooks_types.html'
const ACTIONS = 'raw/kiro_hooks_actions.md'
const LABEL = 'kiro hook'

// TH:143 preToolUse sample uses "read"; T:155-167 aliases read/write/shell;
// T:279-293 MCP tools are @server/tool.
const TOOL_NAMES = {
  bash: 'shell',
  powershell: 'shell',
  read_file: 'read',
  write_file: 'write',
  edit_file: 'write',
  $mcp: '@{server}/{tool}',
}

function result(isBlocking: boolean, stdout: ResultSpec['stdout']): ResultSpec {
  return {
    blockCodes: isBlocking ? [2] : [],
    stderrOnly: true,
    otherExit: 'fail',
    stdout,
    invalid: 'ignore',
    rules: [],
    label: LABEL,
  }
}

// T:72-81: Stop continues on {"decision":"block","reason"}; other stdout ignored.
const STOP: ResultSpec = {
  ...result(false, 'json'),
  rules: [
    {
      kind: 'veto',
      match: { decision: 'block' },
      reason: ['reason'],
      fallback: 'kiro hook requested continuation',
    },
  ],
}

const TOOL: readonly FieldSpec[] = [
  { to: 'tool_name', transform: 'toolName', required: true },
  { to: 'tool_input', required: true },
]
// TH:143 postToolUse sample: tool_response is {success, result:[...]}; the
// runtime's bounded preview is the one result entry.
const RESPONSE: readonly FieldSpec[] = [
  { to: 'tool_response.success', value: true },
  { to: 'tool_response.result', from: 'tool_response', transform: 'wrapArray', required: true },
]

function row(
  muse: EventRow['muse'],
  vendor: string,
  stdinName: string,
  fields: readonly FieldSpec[],
  resultSpec: ResultSpec,
  cite: EventRow['cite'],
  extra: Partial<EventRow> = {},
): EventRow {
  return {
    muse,
    vendor,
    selection: 'default',
    toolNames: TOOL_NAMES,
    fields: [{ to: 'hook_event_name', value: stdinName }, ...fields],
    result: resultSpec,
    cite,
    ...extra,
  }
}

// Kiro file triggers (PostFileCreate/Save/Delete) and SessionEnd/task triggers
// document no stdin (T, A): the trigger name and the post-tool shape are sent
// as the closest documented form, labelled undocumented in the certification.
const FILE_TRIGGERS = ['PostFileCreate', 'PostFileSave', 'PostFileDelete'].map((trigger) =>
  row(
    'PostToolUse',
    trigger,
    trigger,
    [...TOOL, ...RESPONSE],
    result(false, 'ignore'),
    { input: `${TYPES}:24-26 (stdin undocumented)`, output: `${ACTIONS}:32-34` },
    { selection: 'explicit', tools: ['write', 'edit'] },
  ),
)

/**
 * Kiro applies a file trigger's path regex before the hook runs (lead decision
 * I). Vendor code: it reuses M51's bounded V8 matcher, so an untrusted pattern
 * never runs as a raw RegExp here; misses skip, errors refuse.
 */
function pathScope(
  payload: Readonly<Record<string, unknown>>,
  options: AdapterOptions | undefined,
): { readonly outcome: 'skip' | 'refused'; readonly reason: string } | undefined {
  const pattern = options?.pathPattern
  if (pattern === undefined) return undefined
  const input = recordField(payload, 'tool_input')
  const file =
    (input === undefined ? undefined : fileOf(input)) ??
    textField(payload, 'file_path') ??
    textField(payload, 'path')
  if (file === undefined) return { outcome: 'skip', reason: 'kiro: file trigger has no file path' }
  if (file.length > HOOK_MATCHER_VALUE_MAX_CHARS)
    return { outcome: 'refused', reason: 'kiro: file path is too long to match' }
  if (pattern.length > HOOK_MATCHER_MAX_CHARS)
    return { outcome: 'refused', reason: 'kiro: path pattern is too long' }
  let warning: string | undefined
  // matchingHooks reads only event and matcher; this scope-only definition is
  // never dispatched, and an empty command is never executable.
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
  return matches.length === 0
    ? { outcome: 'skip', reason: 'kiro: file path is outside the trigger scope' }
    : undefined
}

const COMMON_CITE = `${HTML}:143`

export const KIRO_CONTRACT: VendorContract = {
  vendor: 'kiro',
  common: [
    { to: 'cwd', transform: 'text' },
    { to: 'session_id', transform: 'text' },
  ],
  gate: pathScope,
  rows: [
    // T:102-116 agentSpawn sample is the documented session-start stdin.
    row(
      'SessionStart',
      'SessionStart',
      'agentSpawn',
      [],
      result(false, 'text'),
      {
        input: `${TYPES}:104-111`,
        output: `${TYPES}:114-116; ${ACTIONS}:32`,
      },
      { aliases: ['AgentSpawn', 'agentSpawn'] },
    ),
    row('SessionEnd', 'SessionEnd', 'SessionEnd', [], result(false, 'ignore'), {
      input: `${TYPES}:123-125 (stdin undocumented)`,
      output: `${ACTIONS}:32-34`,
    }),
    row(
      'UserPromptSubmit',
      'UserPromptSubmit',
      'userPromptSubmit',
      [{ to: 'prompt', transform: 'text' }],
      result(true, 'text'),
      { input: COMMON_CITE, output: `${ACTIONS}:32-34` },
      { aliases: ['promptSubmit', 'userPromptSubmit'] },
    ),
    row(
      'PreToolUse',
      'PreToolUse',
      'preToolUse',
      TOOL,
      result(true, 'ignore'),
      {
        input: `${COMMON_CITE}; ${TYPES}:282-290`,
        output: `${TYPES}:178-181; ${ACTIONS}:32-34`,
      },
      { aliases: ['preToolUse'] },
    ),
    row(
      'PostToolUse',
      'PostToolUse',
      'postToolUse',
      [...TOOL, ...RESPONSE],
      result(false, 'ignore'),
      {
        input: COMMON_CITE,
        output: `${TYPES}:209-211; ${ACTIONS}:32-34`,
      },
      { aliases: ['postToolUse'] },
    ),
    ...FILE_TRIGGERS,
    row(
      'Stop',
      'Stop',
      'stop',
      [
        {
          to: 'assistant_response',
          from: ['assistant_response', 'last_assistant_message'],
          transform: 'text',
        },
      ],
      STOP,
      { input: COMMON_CITE, output: `${TYPES}:71-81` },
      { aliases: ['agentStop', 'stop'] },
    ),
    row(
      'TaskCreated',
      'PreTaskExec',
      'PreTaskExec',
      [],
      result(true, 'ignore'),
      {
        input: `${TYPES}:27 (stdin undocumented)`,
        output: `${ACTIONS}:33`,
      },
      { aliases: ['preTaskExecution'] },
    ),
    row(
      'TaskCompleted',
      'PostTaskExec',
      'PostTaskExec',
      [],
      result(false, 'ignore'),
      {
        input: `${TYPES}:28 (stdin undocumented)`,
        output: `${ACTIONS}:32-34`,
      },
      { aliases: ['postTaskExecution'] },
    ),
    // M91 lane W: Kiro's on-demand hook (T:267-269), which runs here only when
    // the user starts it (Run Hook…, `/hook run`). Its stdin is undocumented:
    // the common fields and the trigger name, as for the task triggers.
    row('Manual', 'Manual', 'Manual', [], result(false, 'text'), {
      input: `${TYPES}:267-269 (stdin undocumented)`,
      output: `${ACTIONS}:32-34`,
    }),
  ],
}
