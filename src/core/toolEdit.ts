// File-tool execution shared by the Model API backend and its deferred
// byte-range helpers: outcome builders, edit matching, and the text shapes
// reads and edits agree on. Both dist/modelApi.js and dist/modelApiTools.js
// carry their own copy (the tools chunk cannot import the backend's module
// scope without dragging it whole); type-only imports back stay erased.

import { setImmediate as yieldToHost } from 'node:timers/promises'
import { ADD_MARKER, type PatchFile, REMOVE_MARKER } from '../shared/patchDocument'
import {
  EDIT_MATCH_YIELD_LINES,
  FILE_REFUSAL_MODEL_TEXT,
  MODEL_API_MODEL_TEXT,
  UI_TEXT,
} from '../shared/constants'
import { changeHunk } from './codeIntel/codeText'
import type {
  FormatTarget,
  ToolContext,
  ToolOutcome,
  TouchedFiles,
} from './backends/modelapi/tools'

export function failure(reason: string, visibleReason = reason): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: visibleReason, failureReason: visibleReason }
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

/** One find/replace resolved to character offsets with its replacement. */
export interface EditMatch {
  readonly start: number
  readonly end: number
  readonly replace: string
}

/** Every CRLF as LF. */
export function toLf(text: string): string {
  return text.split(CRLF).join(LF)
}

/** The text as the model reads it: no BOM, and LF breaks where the file is all CRLF. */
export function modelText(raw: string, shape: TextShape): string {
  const body = shape.hasBom ? raw.slice(BOM.length) : raw
  return shape.isCrlf ? toLf(body) : body
}

/** The model's text (either break) as the file holds text: its BOM and its line breaks. */
export function fileText(text: string, shape: TextShape): string {
  const body = shape.isCrlf ? toLf(text).split(LF).join(CRLF) : text
  return shape.hasBom ? `${BOM}${body}` : body
}

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
 * The character range a `find` uniquely matches, exact first, then the
 * normalised line fallback (M101): at most one run of normalised lines may
 * match, and the untouched lines are copied back from the original, so only
 * the matched range changes. Undefined with the refusal when it does not.
 */
async function matchRange(
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

/**
 * Every entry matched against the original text first (M101): overlaps are
 * refused and one write applies all of them, so either all land or none
 * does. `refuse` words the miss for the caller's scope: a whole-file edit
 * names the file, a range edit names the window.
 */
export async function matchSingles(
  current: string,
  isCrlf: boolean,
  singles: readonly { readonly find: string; readonly replace: string }[],
  signal: AbortSignal | undefined,
  refuse: (index: number, kind: 'notFound' | 'ambiguous') => ToolOutcome,
): Promise<{ readonly matches: readonly EditMatch[] } | { readonly outcome: ToolOutcome }> {
  const ranges: EditMatch[] = []
  for (const [index, entry] of singles.entries()) {
    const find = isCrlf ? toLf(entry.find) : entry.find
    const matched = await matchRange(current, find, signal)
    if ('refusal' in matched) {
      return { outcome: refuse(index, matched.refusal) }
    }
    ranges.push({
      start: matched.start,
      end: matched.end,
      replace: isCrlf ? toLf(entry.replace) : entry.replace,
    })
  }
  const ordered = ranges.toSorted((a, b) => a.start - b.start)
  for (const [index, range] of ordered.entries()) {
    const previous = ordered[index - 1]
    if (previous !== undefined && range.start < previous.end) {
      return { outcome: failure(MODEL_API_MODEL_TEXT.editOverlap, UI_TEXT.toolEditOverlap) }
    }
  }
  return { matches: ordered }
}

/** The matched replacements applied to the text they were resolved against. */
export function applyMatches(current: string, matches: readonly EditMatch[]): string {
  let updated = ''
  let at = 0
  for (const range of matches) {
    updated += `${current.slice(at, range.start)}${range.replace}`
    at = range.end
  }
  return updated + current.slice(at)
}

/**
 * An edit's row and patch. The hunk is the changed lines (common prefix and
 * suffix trimmed) with their context, in unified-diff numbering (PLAN.md
 * D27, `changeHunk`, shared with M67's rename): an insertion's `oldStart` is
 * the line it follows, never a marker of a created file, and a Revert checks
 * the context, so it refuses a file that has moved on.
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

/** A file an edit wrote, as the dispatcher's fence judges it (M78). */
export function touchedBy(file: {
  readonly relative: string
  readonly canonical: string
}): TouchedFiles {
  return { names: [file.relative, file.canonical], complete: true }
}

/** Why an edit must not touch this file now, or undefined (D27). */
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
