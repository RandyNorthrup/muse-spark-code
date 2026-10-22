// File-tool execution shared by the Model API backend and its deferred
// byte-range helpers: outcome builders, edit matching, and the text shapes
// reads and edits agree on. Every Node bundle reads this module from
// dist/modelApiBoundaries.js (its entry re-exports it; the build points the
// import there), so the backend and the deferred chunks carry one copy;
// type-only imports back stay erased. The caller's own model words arrive
// as arguments (overlap, policy denial): the boundary carries no
// MODEL_API_MODEL_TEXT block of its own.

import { setImmediate as yieldToHost } from 'node:timers/promises'
import { ADD_MARKER, type PatchFile, REMOVE_MARKER } from '../shared/patchDocument'
import {
  EDIT_MATCH_YIELD_LINES,
  FILE_REFUSAL_MODEL_TEXT,
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_ELIDED_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
} from '../shared/constants'
import { changeHunk } from './codeIntel/codeText'
import { UI_TEXT } from '../shared/l10n/text'
import { confineWorkspacePath } from './workspacePath'
import type {
  FormatTarget,
  ToolContext,
  ToolOutcome,
  TouchedFiles,
} from './backends/modelapi/tools'

/** Shared with the deferred byte-range execution through dist/modelApiBoundaries.js. */
export function failure(reason: string, visibleReason = reason): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: visibleReason, failureReason: visibleReason }
}

/** A caught failure's message for the model: its own message, never its shape. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const BOM = '\u{FEFF}'
export const CRLF = '\r\n'
export const LF = '\n'

/** How a file's text is laid out, so an edit writes it back the same way (PLAN.md D27). */
export interface TextShape {
  readonly hasBom: boolean
  /** Every line break is CRLF; a file that mixes them is edited as it is. */
  readonly isCrlf: boolean
  readonly hasTrailingBreak: boolean
}

/** Every CRLF as LF. Shared with the deferred byte-range execution. */
export function toLf(text: string): string {
  return text.split(CRLF).join(LF)
}

/** The text as the model reads it: no BOM, and LF breaks where the file is all CRLF. Shared with the deferred byte-range execution. */
export function modelText(raw: string, shape: TextShape): string {
  const body = shape.hasBom ? raw.slice(BOM.length) : raw
  return shape.isCrlf ? toLf(body) : body
}

/** The model's text (either break) as the file holds text: its BOM and its line breaks. Shared with the deferred byte-range execution. */
export function fileText(text: string, shape: TextShape): string {
  const body = shape.isCrlf ? toLf(text).split(LF).join(CRLF) : text
  return shape.hasBom ? `${BOM}${body}` : body
}

/**
One line for fuzzy matching (M101, Pi's edit-diff): NFKC, Unicode spaces
as spaces, curly quotes and dashes as their plain forms, no trailing
whitespace.
*/
function fuzzyLine(line: string): string {
  return line
    .normalize('NFKC')
    .replaceAll(/[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' ')
    .replaceAll(/[\u{2018}\u{2019}\u{201A}\u{201B}]/gu, "'")
    .replaceAll(/[\u{201C}\u{201D}\u{201E}\u{201F}]/gu, '"')
    .replaceAll(/[\u{2013}\u{2014}\u{2212}]/gu, '-')
    .trimEnd()
}

/**
The character range a `find` uniquely matches, exact first, then the
normalised line fallback (M101): at most one run of normalised lines may
match, and the untouched lines are copied back from the original, so only
the matched range changes. Undefined with the refusal when it does not.
Exported (not private like the shape helpers' matcher upstream) because the
whole-file edit path matches the same way.
*/
export async function matchRange(
  current: string,
  find: string,
  signal: AbortSignal | undefined,
): Promise<
  { readonly start: number; readonly end: number } | { readonly refusal: 'notFound' | 'ambiguous' }
> {
  const first = current.indexOf(find)
  if (first !== -1) {
    // Several exact matches stay refused: the model adds context. The
    // normalised fallback is only for formatting the exact text missed.
    return current.includes(find, first + 1)
      ? {
          refusal: 'ambiguous',
        }
      : { start: first, end: first + find.length }
  }
  const lines = current.split('\n')
  const starts: number[] = []
  const normalized: string[] = []
  for (const [index, line] of lines.entries()) {
    if (index % EDIT_MATCH_YIELD_LINES === 0) {
      await yieldToHost(undefined, { signal })
    }
    starts.push(index === 0 ? 0 : (starts[index - 1] ?? 0) + (lines[index - 1]?.length ?? 0) + 1)
    normalized.push(fuzzyLine(line))
  }
  const want = find.split('\n').map((line) => fuzzyLine(line))
  const hasTrailingBreak = find.endsWith('\n')
  if (hasTrailingBreak) want.pop()
  // KMP prefix lengths: each normalized line is compared a bounded number
  // of times, including repeated-line near misses (M101 review finding 4).
  const prefixLengths: number[] = [0]
  for (let index = 1, matched = 0; index < want.length; index += 1) {
    while (matched > 0 && want[index] !== want[matched]) matched = prefixLengths[matched - 1] ?? 0
    if (want[index] === want[matched]) matched += 1
    prefixLengths.push(matched)
  }
  const matches: number[] = []
  if (want.some((line) => line !== '')) {
    for (let index = 0, matched = 0; index < normalized.length; index += 1) {
      if (index % EDIT_MATCH_YIELD_LINES === 0) await yieldToHost(undefined, { signal })
      while (matched > 0 && normalized[index] !== want[matched])
        matched = prefixLengths[matched - 1] ?? 0
      if (normalized[index] === want[matched]) matched += 1
      if (matched !== want.length) {
        continue
      }

      if (!hasTrailingBreak || index + 1 < lines.length) matches.push(index - want.length + 1)
      if (matches.length > 1) break
      matched = prefixLengths[matched - 1] ?? 0
    }
  }
  if (matches.length === 1) {
    const at = matches[0] ?? 0
    const end = at + want.length
    return {
      start: starts[at] ?? 0,
      end:
        end < lines.length
          ? (starts[end] ?? current.length) - (hasTrailingBreak ? 0 : 1)
          : current.length,
    }
  }
  return {
    refusal: matches.length === 0 ? 'notFound' : 'ambiguous',
  }
}

/** One resolved single: where it lands and what it writes. */
export interface EditRange {
  readonly start: number
  readonly end: number
  readonly replace: string
}

/**
Every single resolved against the text first (M101): overlaps are refused
and the ordered ranges come back together, so either all land or none
does. A miss, repeat or overlap refuses through the caller's own words:
the whole file names its path, a byte window names its window. Shared
with the deferred byte-range execution through dist/modelApiBoundaries.js.
*/
export async function resolveEditRanges(
  current: string,
  shape: TextShape,
  singles: readonly { readonly find: string; readonly replace: string }[],
  hasEdits: boolean,
  signal: AbortSignal | undefined,
  miss: (prefix: string, isRepeated: boolean) => ToolOutcome,
  overlapModelText: string,
): Promise<{ ok: true; ranges: EditRange[] } | { ok: false; outcome: ToolOutcome }> {
  const ranges: EditRange[] = []
  for (const [index, entry] of singles.entries()) {
    const prefix = hasEdits ? `edits[${String(index)}]: ` : ''
    const matched = await matchRange(current, shape.isCrlf ? toLf(entry.find) : entry.find, signal)
    if ('refusal' in matched) {
      return { ok: false, outcome: miss(prefix, matched.refusal !== 'notFound') }
    }
    ranges.push({
      start: matched.start,
      end: matched.end,
      replace: shape.isCrlf ? toLf(entry.replace) : entry.replace,
    })
  }
  const ordered = ranges.toSorted((a, b) => a.start - b.start)
  for (const [index, range] of ordered.entries()) {
    const previous = ordered[index - 1]
    if (previous !== undefined && range.start < previous.end) {
      return {
        ok: false,
        outcome: failure(overlapModelText, UI_TEXT.toolEditOverlap),
      }
    }
  }
  return { ok: true, ranges: ordered }
}

/**
An edit's row and patch. The hunk is the changed lines (common prefix and
suffix trimmed) with their context, in unified-diff numbering (PLAN.md
D27, `changeHunk`, shared with M67's rename): an insertion's `oldStart` is
the line it follows, never a marker of a created file, and a Revert checks
the context, so it refuses a file that has moved on. Shared with the
deferred byte-range execution through dist/modelApiBoundaries.js.
*/
export function patchOutcome(
  relativePath: string,
  before: string | undefined,
  after: string,
  visibleOutput: string,
  output: string,
): ToolOutcome {
  const hunk = changeHunk(before ?? '', after)
  const hunks = hunk === undefined ? [] : [hunk]
  // Said outright (D27): a Revert trashes only a file this edit created.
  const file: PatchFile = { path: relativePath, hunks, created: before === undefined }
  const lines = hunk?.lines ?? []
  const added = lines.filter((line) => line.startsWith(ADD_MARKER)).length
  const removed = lines.filter((line) => line.startsWith(REMOVE_MARKER)).length
  const diff =
    hunk === undefined ? '' : `\n--- original\n+++ updated\n@@\n${hunk.lines.join('\n')}\n`
  return {
    output,
    visibleOutput: `${visibleOutput}${diff}`,
    patch: { document: JSON.stringify({ files: [file] }), summary: { files: 1, added, removed } },
  }
}

/** A file an edit wrote, as the dispatcher's fence judges it (M78). Shared with the deferred byte-range execution. */
export function touchedBy(file: {
  readonly relative: string
  readonly canonical: string
}): TouchedFiles {
  return { names: [file.relative, file.canonical], complete: true }
}

/** Why an edit must not touch this file now, or undefined (D27). Shared with the deferred byte-range execution. */
export function editRefusal(
  file: { readonly relative: string; readonly absolute: string; readonly checkedAbsolute: string },
  context: ToolContext,
): ToolOutcome | undefined {
  // Writing under an editor's unsaved changes makes VS Code ask which to keep.
  return context.io.hasUnsavedChanges(file.absolute) ||
    context.io.hasUnsavedChanges(file.checkedAbsolute)
    ? failure(`${file.relative} ${FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges}`)
    : undefined
}

/** Whether the confined path is denied by the files policy. Shared with the deferred byte-range execution. */
export function isDenied(
  resolved: { readonly relative: string; readonly canonical: string },
  context: ToolContext,
): boolean {
  return context.files?.isDenied([resolved.relative, resolved.canonical]) === true
}

/**
A path confined, policy-checked and approval-checked, without reading the
file: range reads and edits work from here, and the whole-file execution
reads from here too, so files of any size stay reachable without loading
them whole. The policy denial refuses through the caller's own model
words, like an overlap does.
*/
export async function locateHead(
  given: string,
  context: ToolContext,
  deniedModelText: string,
): Promise<
  | {
      readonly ok: true
      readonly relative: string
      readonly canonical: string
      readonly absolute: string
      readonly checkedAbsolute: string
    }
  | { readonly ok: false; readonly outcome: ToolOutcome }
> {
  const resolved = await confineWorkspacePath(
    context.workspaceRoot,
    given,
    context.platform,
    context.io,
  )
  if (!resolved.ok) {
    return { ok: false, outcome: failure(resolved.reason) }
  }
  if (isDenied(resolved, context)) {
    return {
      ok: false,
      outcome: failure(`${resolved.relative} ${deniedModelText}`),
    }
  }
  if (
    context.approvedTarget !== undefined &&
    (resolved.absolute !== context.approvedTarget.absolute ||
      resolved.checkedAbsolute !== context.approvedTarget.checkedAbsolute)
  ) {
    return { ok: false, outcome: failure(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval) }
  }
  return {
    ok: true,
    relative: resolved.relative,
    canonical: resolved.canonical,
    absolute: resolved.absolute,
    checkedAbsolute: resolved.checkedAbsolute,
  }
}

/** Shared with the deferred byte-range execution through dist/modelApiBoundaries.js. */
export function clip(text: string): string {
  // Cut on a code point boundary, so the clip never splits a surrogate pair (M101).
  return text.length > TOOL_OUTPUT_MAX_CHARS
    ? `${text.slice(0, codePointBoundary(text, TOOL_OUTPUT_MAX_CHARS))}${TOOL_OUTPUT_CLIP_MARKER}`
    : text
}

const LAST_BMP_CODE_POINT = 0xff_ff

/** `index` moved back off the middle of a surrogate pair, so no character is split. */
export function codePointBoundary(text: string, index: number): number {
  // A code point past the Basic Multilingual Plane starts at `index - 1` and
  // ends after `index`: cutting at `index` would split it.
  return (text.codePointAt(index - 1) ?? 0) > LAST_BMP_CODE_POINT ? index - 1 : index
}

/** The text's beginning and end within `max` characters, the elision marked between (D27). */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  const keep = Math.max(max - TOOL_OUTPUT_ELIDED_MARKER.length, 0)
  const headEnd = codePointBoundary(text, Math.ceil(keep / 2))
  const tailStart = codePointBoundary(text, text.length - Math.floor(keep / 2))
  return `${text.slice(0, headEnd)}${TOOL_OUTPUT_ELIDED_MARKER}${text.slice(tailStart)}`
}

export function writeAdmission(target: FormatTarget, context: ToolContext): () => void {
  return () => {
    context.signal?.throwIfAborted()
    if (
      context.io.hasUnsavedChanges(target.absolute) ||
      context.io.hasUnsavedChanges(target.checkedAbsolute)
    )
      throw new Error(`${target.relative} ${FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges}`)
    context.assertCanWrite?.(target)
  }
}
