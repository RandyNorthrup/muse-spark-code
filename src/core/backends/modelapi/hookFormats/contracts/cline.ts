// Cline v1 per-event script contract. Source: the last full hooks doc,
// cline/cline docs/customization/hooks.mdx @901d1b5c97 (2026-04-24), saved as
// test/fixtures/hookFormats/docs/cline-hooks-901d1b5c97.md (DOC below;
// renamed for the cite gate, content byte-identical).
// Doc-derived, not captured. Cite lines point into that file.
// The newer SDK/CLI file-hook contract (a different hookName/output shape)
// is refused: there is no row for it and no translator.
// Platform discovery (Windows <HookName>.ps1 only, Unix extensionless
// executable <HookName> only), the 30 s timeout and the fail-open
// non-zero-exit rule come from the extension sources summarised in
// hooks-parity/raw-copilot-cline.md:24-26; discovery itself is
// clineDiscover.ts, which cites those lines.
import * as z from 'zod/mini'
import { CLINE_CONTEXT_MODIFICATION_MAX_CHARS } from '../../../../../shared/constants'
import {
  type CustomResult,
  type EventRow,
  type FieldSpec,
  type ResultRule,
  type ResultSpec,
  type VendorContract,
} from '../contract'

const DOC = 'test/fixtures/hookFormats/docs/cline-hooks-901d1b5c97.md'
const SUMMARY = 'raw-copilot-cline.md'
const LABEL = 'cline hook'

// DOC:28,336,374: read_file, write_to_file, execute_command, search_files.
// Cline edits go through write_to_file; anything else keeps its runtime name
// (the toolName transform's default), never a guessed mapping.
const TOOL_NAMES = {
  bash: 'execute_command',
  powershell: 'execute_command',
  read_file: 'read_file',
  write_file: 'write_to_file',
  edit_file: 'write_to_file',
}

// DOC:203-250: every script gets JSON on stdin with hookName plus common
// fields; the hook-specific field is camelCase. Only the keys Muse can fill
// are sent: the session id as taskId, the workspace root as workspaceRoots,
// and the tool payload for tool hooks. Muse's model/provider shape is not
// Cline's, so model is never sent (nothing is fabricated).
const COMMON: readonly FieldSpec[] = [
  { to: 'hookName', from: '@event' },
  { to: 'taskId', from: 'session_id', transform: 'text' },
  { to: 'workspaceRoots', from: 'cwd', transform: 'wrapArray' },
]

const TOOL: readonly FieldSpec[] = [
  { to: 'tool_name', transform: 'toolName', required: true },
  { to: 'tool_input', required: true },
]

/**
 * DOC:253-267 plus cline/cline#13554 (SUMMARY:27): `cancel: true` stops the
 * operation with `errorMessage` as its reason; `contextModification` is
 * injected as context, capped at 50,000 chars (SUMMARY:25). Upstream discards
 * the context of a cancelling TaskStart/UserPromptSubmit hook; the engine
 * scans the veto before validation, so ours does the same: a veto carries
 * the error message only. An errorMessage without cancel is shown to nobody,
 * as documented. Vendor code: the cap cannot be a `context` rule (the
 * engine does not truncate), so it is this named function.
 */
function cappedContext(output: Readonly<Record<string, unknown>>): CustomResult {
  const found = output['contextModification']
  if (typeof found !== 'string' || found.trim() === '') return { ok: true, answer: {} }
  return {
    ok: true,
    answer: { context: found.slice(0, CLINE_CONTEXT_MODIFICATION_MAX_CHARS) },
  }
}

const CONTEXT: ResultRule = { kind: 'custom', name: 'cappedContext', apply: cappedContext }

// DOC:265: cancel stops the operation. Scanned before strict validation, so
// an unsupported sibling field never erases the veto.
const VETO: ResultRule = {
  kind: 'veto',
  match: { cancel: true },
  reason: ['errorMessage'],
  fallback: 'cline hook cancelled the operation',
}

// SUMMARY:25: a non-zero exit without JSON does not block. Exit-0 output is
// strict JSON (DOC:507: valid JSON on a single line); anything else fails
// open (failed, never blocked): there is no failClosed row in this contract.
function result(canCancel: boolean): ResultSpec {
  return {
    blockCodes: [],
    otherExit: 'fail',
    stdout: 'json',
    invalid: 'fail',
    label: LABEL,
    schema: z.strictObject({
      cancel: z.optional(z.boolean()),
      contextModification: z.optional(z.string()),
      errorMessage: z.optional(z.string()),
    }),
    rules: [...(canCancel ? [VETO] : []), CONTEXT],
  }
}

// Shared result objects: every cancelling row parses identically, and every
// observing row does too.
const BLOCKING = result(true)
const OBSERVING = result(false)

function row(
  muse: EventRow['muse'],
  vendor: string,
  fields: readonly FieldSpec[],
  spec: ResultSpec,
  cite: EventRow['cite'],
): EventRow {
  return { muse, vendor, selection: 'default', toolNames: TOOL_NAMES, fields, result: spec, cite }
}

// DOC:246-247: preToolUse is { toolName, parameters }; postToolUse adds
// result/success/executionTimeMs. success has no Muse source, so it is never
// sent; the bounded preview stands in for result, labelled as such.
const PRE_TOOL: readonly FieldSpec[] = [
  ...COMMON,
  { to: 'preToolUse.toolName', from: 'tool_name', transform: 'toolName', required: true },
  { to: 'preToolUse.parameters', from: 'tool_input' },
]
const POST_TOOL: readonly FieldSpec[] = [
  ...COMMON,
  { to: 'postToolUse.toolName', from: 'tool_name', transform: 'toolName', required: true },
  { to: 'postToolUse.parameters', from: 'tool_input' },
  { to: 'postToolUse.result', from: 'tool_response', transform: 'text' },
]

export const CLINE_CONTRACT: VendorContract = {
  vendor: 'cline',
  common: [],
  rows: [
    // DOC:22-26,84-96: TaskStart opens a task; a resumed task fires
    // TaskResume instead. Both start the session here. TaskResume is
    // explicit (chosen only when the import names it, as Kiro's file
    // triggers): with no source event SessionStart builds TaskStart, so a
    // parse without the tool never depends on an ambiguous pick.
    row('SessionStart', 'TaskStart', [...COMMON], BLOCKING, {
      input: `${DOC}:203-250`,
      output: `${DOC}:253-267`,
    }),
    {
      ...row('SessionStart', 'TaskResume', [...COMMON], BLOCKING, {
        input: `${DOC}:22-26`,
        output: `${DOC}:253-267`,
      }),
      selection: 'explicit',
    },
    // DOC:306-311: TaskCancel runs after the user cancelled; cancel has
    // nothing left to block, so the row observes (context still kept).
    row('SessionEnd', 'TaskCancel', [...COMMON], OBSERVING, {
      input: `${DOC}:203-250`,
      output: `${DOC}:306-311`,
    }),
    // DOC:313-320: TaskComplete runs when a task finishes; cancel stops the
    // task, which here continues the turn with the error message as reason.
    row('Stop', 'TaskComplete', [...COMMON], BLOCKING, {
      input: `${DOC}:203-250`,
      output: `${DOC}:253-267`,
    }),
    // DOC:322-360 (the write_to_file/.js guard is the documented veto).
    row('PreToolUse', 'PreToolUse', PRE_TOOL, BLOCKING, {
      input: `${DOC}:246,330-340`,
      output: `${DOC}:253-267,343-360`,
    }),
    // DOC:362-384: PostToolUse cancel stops the task but cannot undo the
    // tool run; here that is a block with the error message as its reason.
    row('PostToolUse', 'PostToolUse', POST_TOOL, BLOCKING, {
      input: `${DOC}:247,370-379`,
      output: `${DOC}:253-267,382-384`,
    }),
    // DOC:388-394.
    row(
      'UserPromptSubmit',
      'UserPromptSubmit',
      [...COMMON, { to: 'userPromptSubmit.prompt', from: 'prompt', transform: 'text' }],
      BLOCKING,
      { input: `${DOC}:248`, output: `${DOC}:253-267` },
    ),
    // DOC:396-417 (input metrics have no Muse source and are never sent).
    row('PreCompact', 'PreCompact', [...COMMON], BLOCKING, {
      input: `${DOC}:249,401-417`,
      output: `${DOC}:253-267`,
    }),
    // In VALID_HOOK_TYPES but in no docs page (SUMMARY:24): observation
    // only, context kept, cancel ignored.
    row('Notification', 'Notification', [...COMMON], OBSERVING, {
      input: `${SUMMARY}:24 (undocumented)`,
      output: `${DOC}:253-267`,
    }),
  ],
}
