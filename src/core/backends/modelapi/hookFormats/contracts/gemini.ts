// Gemini CLI hook contract, CAPTURED: Gemini CLI 0.62.0 on a rig sent the stdin
// under test/fixtures/hookFormats/captured/gemini/ and answered the BeforeTool
// probes recorded in its manifest.json (outputContract). Docs: hooks-parity/
// gemini/hooks-reference.md (GR, tag v0.62.0). Where the run contradicts GR
// (exit >= 2 blocks; plain stdout is a warning), the observed behaviour wins.
import * as z from 'zod/mini'
import {
  type AdapterOptions,
  type CustomResult,
  type EventRow,
  type FieldSpec,
  type ResultRule,
  type ResultSpec,
  type VendorContract,
} from '../contract'
import { isRecord, splitMcpName } from '../core'

const DOC = 'gemini/hooks-reference.md'
const LABEL = 'gemini hook'

// GR:79-90 and the captures: run_shell_command, read_file, grep_search,
// list_directory (BeforeTool.*.json); edits are `replace`; MCP tools prefixed.
const TOOL_NAMES = {
  bash: 'run_shell_command',
  powershell: 'run_shell_command',
  edit_file: 'replace',
  search: 'grep_search',
  list_files: 'list_directory',
  $mcp: 'mcp_{server}_{tool}',
}

const OBSERVE: readonly ResultRule[] = [
  { kind: 'message', field: 'systemMessage' },
  { kind: 'context', field: 'hookSpecificOutput.additionalContext' },
]
// GR:62-75: decision deny (alias block) vetoes; continue:false stops.
const VETO: readonly ResultRule[] = [
  {
    kind: 'veto',
    match: { continue: false },
    reason: ['stopReason'],
    fallback: 'gemini hook stopped the agent',
    stop: true,
  },
  {
    kind: 'veto',
    match: { decision: ['deny', 'block'] },
    reason: ['reason'],
    fallback: 'gemini hook blocked the operation',
  },
]

/**
 * GR:62-75 common output. Exit codes as CAPTURED (manifest outputContract):
 * exit 2 AND exit 3 blocked BeforeTool, reason = stdout || stderr; exit-0
 * plain text was allowed with a system message. GR:10-15 says "Other" only
 * warns; the run and hookRunner say exit >= 2 denies, so >= 2 blocks here.
 * Exit 1 warns (failed). Request/response modifiers are in no schema, so they
 * are refused; a simultaneous veto still wins (engine pre-scan).
 */
function gemini(
  event: string,
  isBlocking: boolean,
  specific: Readonly<Record<string, z.ZodMiniType>>,
  rules: readonly ResultRule[],
): ResultSpec {
  return {
    blockCodes: [],
    ...(isBlocking && { blockFrom: 2, blockScansStdout: true, stdoutFirst: true }),
    textIsMessage: true,
    otherExit: 'fail',
    stdout: 'json',
    invalid: 'fail',
    label: LABEL,
    schema: z.strictObject({
      // GR:250-258,267-270,282-285,294-297: advisory rows accept but ignore
      // controls; they must not invalidate the independent observations.
      continue: z.optional(z.boolean()),
      stopReason: z.optional(z.string()),
      decision: z.optional(z.enum(['allow', 'deny', 'block'])),
      reason: z.optional(z.string()),
      systemMessage: z.optional(z.string()),
      suppressOutput: z.optional(z.boolean()),
      hookSpecificOutput: z.optional(
        z.strictObject({
          hookEventName: z.optional(z.literal(event)),
          additionalContext: z.optional(z.string()),
          ...specific,
        }),
      ),
    }),
    rules: [...(isBlocking ? VETO : []), ...OBSERVE, ...rules],
  }
}

/**
 * R:64 BeforeToolSelection: toolConfig mode AUTO/ANY/NONE and
 * allowedFunctionNames. Vendor code: it returns an admission restriction in
 * Gemini names (NONE admits nothing); ANY never forces a call here. Its
 * whitelist still narrows admission; without one, veto the operation. The
 * declared tool list is never changed (SoL-Pi invariant).
 */
function toolSelection(output: Readonly<Record<string, unknown>>): CustomResult {
  const specific = output['hookSpecificOutput']
  const config = isRecord(specific) ? specific['toolConfig'] : undefined
  if (!isRecord(config)) return { ok: true, answer: {} }
  if (config['mode'] === 'NONE') return { ok: true, answer: { allowedToolNames: [] } }
  const names = config['allowedFunctionNames']
  if (config['mode'] === 'ANY' && !Array.isArray(names))
    return {
      ok: true,
      answer: {
        status: 'blocked',
        reason: 'forcing tool selection is refused',
        allowedToolNames: [],
      },
    }
  return {
    ok: true,
    answer: Array.isArray(names)
      ? { allowedToolNames: names.filter((name) => typeof name === 'string') }
      : {},
  }
}

const SELECTION: ResultSpec = {
  blockCodes: [],
  textIsMessage: true,
  otherExit: 'fail',
  stdout: 'json',
  // An untranslatable restriction must not restore the unrestricted tool set.
  invalid: 'block',
  label: LABEL,
  schema: z.strictObject({
    hookSpecificOutput: z.optional(
      z.strictObject({
        hookEventName: z.optional(z.literal('BeforeToolSelection')),
        toolConfig: z.optional(
          z.strictObject({
            mode: z.optional(z.enum(['AUTO', 'ANY', 'NONE'])),
            allowedFunctionNames: z.optional(z.array(z.string())),
          }),
        ),
      }),
    ),
  }),
  rules: [{ kind: 'custom', name: 'toolSelection', apply: toolSelection }],
}

const TOOL: readonly FieldSpec[] = [
  { to: 'tool_name', transform: 'toolName', required: true },
  { to: 'tool_input', transform: 'geminiToolInput', required: true },
]
// The model events need Gemini's own request/response objects. Muse's bounded
// summaries (modelCallHooks.ts) are not one, so these rows refuse until lane W
// supplies a source-shaped translation; nothing is fabricated (RVM91P2 #6).
// BeforeModel.json / BeforeToolSelection.json and AfterModel*.json, from the
// manifest's Kubuntu capture (37 attempted model calls, 16 successful).
// GR:305-333 corroborates the stable shape. Loose objects retain future fields;
// empty candidates/parts are real streamed chunks, not missing responses.
const LLM_REQUEST: FieldSpec = {
  to: 'llm_request',
  required: true,
  schema: z.looseObject({
    model: z.string().check(z.minLength(1)),
    messages: z.array(
      z.looseObject({
        role: z.enum(['user', 'model', 'system']),
        content: z.string(),
      }),
    ),
    config: z.looseObject({
      temperature: z.optional(z.number()),
      topP: z.optional(z.number()),
      topK: z.optional(z.number()),
    }),
  }),
}
const LLM_RESPONSE: FieldSpec = {
  to: 'llm_response',
  required: true,
  schema: z.looseObject({
    candidates: z.array(
      z.looseObject({
        content: z.looseObject({ role: z.literal('model'), parts: z.array(z.string()) }),
        finishReason: z.optional(z.string()),
        index: z.optional(z.int().check(z.nonnegative())),
      }),
    ),
    text: z.optional(z.string()),
    usageMetadata: z.optional(
      z.looseObject({
        totalTokenCount: z.number().check(z.nonnegative()),
        promptTokenCount: z.optional(z.number().check(z.nonnegative())),
        candidatesTokenCount: z.optional(z.number().check(z.nonnegative())),
      }),
    ),
  }),
}

const PATCH_KEYS: Readonly<Record<string, readonly string[]>> = {
  bash: ['command', 'description'],
  powershell: ['command', 'description'],
  read_file: ['file_path'],
  write_file: ['file_path', 'content'],
  search: ['pattern'],
}

/** GR:108-109: patches merge against full execution arguments, never a preview. */
function mergeToolInput(
  output: Readonly<Record<string, unknown>>,
  options: AdapterOptions | undefined,
): CustomResult {
  const specific = output['hookSpecificOutput']
  const patch = isRecord(specific) ? specific['tool_input'] : undefined
  if (!isRecord(patch)) return { ok: true, answer: {} }
  const input = options?.input
  const original = input?.['tool_input']
  const tool = input?.['tool_name']
  if (typeof tool !== 'string' || !isRecord(original))
    return {
      ok: true,
      answer: { status: 'blocked', reason: 'tool_input patch needs original execution arguments' },
    }
  if (splitMcpName(tool) !== undefined)
    return { ok: true, answer: { updatedInput: { ...original, ...patch } } }
  const keys = PATCH_KEYS[tool] ?? []
  const required = keys.filter((key) => key !== 'description')
  // Range patches require a fuller source-default contract than these captures
  // establish. Refuse rather than silently reinterpret start_line/end_line.
  if (
    keys.length === 0 ||
    required.some((key) => typeof original[key === 'file_path' ? 'path' : key] !== 'string') ||
    Object.entries(patch).some(([key, item]) => typeof item !== 'string' || !keys.includes(key))
  )
    return {
      ok: true,
      answer: { status: 'blocked', reason: 'unsupported Gemini tool_input patch' },
    }
  const updated = { ...original }
  for (const [key, item] of Object.entries(patch))
    updated[key === 'file_path' ? 'path' : key] = item
  return { ok: true, answer: { updatedInput: updated } }
}

function row(
  muse: EventRow['muse'],
  vendor: string,
  fields: readonly FieldSpec[],
  result: ResultSpec,
  line: string,
): EventRow {
  return {
    muse,
    vendor,
    selection: 'default',
    toolNames: TOOL_NAMES,
    fields,
    result,
    cite: { input: `${DOC}:46-60,${line}`, output: `${DOC}:6-15,62-75,${line}` },
  }
}

export const GEMINI_CONTRACT: VendorContract = {
  vendor: 'gemini',
  // R:70 common stdin: session_id, transcript_path, cwd, hook_event_name, timestamp.
  common: [
    { to: 'hook_event_name', from: '@event' },
    { to: 'session_id', transform: 'text' },
    { to: 'transcript_path', transform: 'text' },
    { to: 'cwd', transform: 'absolutePath' },
    { to: 'timestamp', transform: 'isoTime' },
  ],
  rows: [
    row(
      'SessionStart',
      'SessionStart',
      [{ to: 'source', transform: 'text' }],
      gemini('SessionStart', false, {}, []),
      '245-259',
    ),
    row(
      'SessionEnd',
      'SessionEnd',
      [{ to: 'reason', transform: 'text' }],
      gemini('SessionEnd', false, {}, []),
      '260-271',
    ),
    row(
      'UserPromptSubmit',
      'BeforeAgent',
      [{ to: 'prompt', transform: 'text', required: true }],
      gemini('BeforeAgent', true, {}, []),
      '145-162',
    ),
    row(
      'Stop',
      'AfterAgent',
      [
        { to: 'prompt', transform: 'text' },
        {
          to: 'prompt_response',
          from: ['prompt_response', 'last_assistant_message'],
          transform: 'text',
        },
        { to: 'stop_hook_active' },
      ],
      gemini('AfterAgent', true, {}, []),
      '163-184',
    ),
    row('PreLLMCall', 'BeforeModel', [LLM_REQUEST], gemini('BeforeModel', true, {}, []), '187-203'),
    row(
      'PostLLMCall',
      'AfterModel',
      [LLM_REQUEST, LLM_RESPONSE],
      gemini('AfterModel', true, {}, []),
      '221-242',
    ),
    row('BeforeToolSelection', 'BeforeToolSelection', [LLM_REQUEST], SELECTION, '204-220'),
    row(
      'PreToolUse',
      'BeforeTool',
      TOOL,
      gemini('BeforeTool', true, { tool_input: z.optional(z.record(z.string(), z.unknown())) }, [
        { kind: 'custom', name: 'mergeToolInput', apply: mergeToolInput },
      ]),
      '92-113',
    ),
    row(
      'PostToolUse',
      'AfterTool',
      // AfterTool.*.json: tool_response is {llmContent, returnDisplay}; the
      // bounded preview is what the model saw (llmContent). returnDisplay is
      // the vendor's UI text, which Muse does not have: omitted, not invented.
      [
        ...TOOL,
        {
          to: 'tool_response.llmContent',
          from: 'tool_response',
          transform: 'text',
          required: true,
        },
      ],
      gemini('AfterTool', true, {}, []),
      '114-142',
    ),
    row(
      'PreCompact',
      'PreCompress',
      [{ to: 'trigger', transform: 'text' }],
      gemini('PreCompress', false, {}, []),
      '287-300',
    ),
    row(
      'Notification',
      'Notification',
      [
        { to: 'message', transform: 'text' },
        { to: 'notification_type', transform: 'text' },
        { to: 'details', schema: z.record(z.string(), z.unknown()) },
      ],
      gemini('Notification', false, {}, []),
      '272-286',
    ),
  ],
}
