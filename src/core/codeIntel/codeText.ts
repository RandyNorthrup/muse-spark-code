// Text work for the code intelligence tools (M67): positions to offsets as
// VS Code counts them, a whole-word search for a symbol's name, a
// language service's edits applied to a file's text, and the hunks of the
// patch a rename leaves (the Model API's row, Edit Review and rewind) or
// hands back as a diff (the `ide` tool). Pure.

import { PATCH_CONTEXT_LINES } from '../../shared/constants'
import {
  ADD_MARKER,
  CONTEXT_MARKER,
  type PatchHunk,
  REMOVE_MARKER,
} from '../../shared/patchDocument'
import type { CodePosition, TextEdit } from './languageService'

export const BOM = '\u{FEFF}'
const CR = '\r'
const LF = '\n'
const CRLF = '\r\n'
// Edit Review and rewind split a file this way (src/core/patchApply.ts), so
// the hunks must too.
const PATCH_LINE_BREAK = /\r?\n/
// What continues a name: a letter, a digit, `_` or `$` (JavaScript's, and
// most languages' identifiers).
const NAME_CHARACTER = /[\p{L}\p{N}_$]/u

/** The text without its UTF-8 byte-order mark, as VS Code's documents hold it. */
export function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

/** Where each line starts, VS Code's line breaks counted. */
function lineStarts(text: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === CR && text[index + 1] === LF) {
      index += 1
      starts.push(index + 1)
    } else if (character === CR || character === LF) {
      starts.push(index + 1)
    }
  }
  return starts
}

/** Where a line's text ends, its line break left out. */
function lineEnd(text: string, starts: readonly number[], line: number): number {
  const next = starts[line + 1]
  if (next === undefined) {
    return text.length
  }
  return next - (text.slice(next - CRLF.length, next) === CRLF ? CRLF.length : 1)
}

/** The offset of a position; undefined past the end of its line or of the text. */
function offsetOf(text: string, starts: readonly number[], at: CodePosition): number | undefined {
  const start = starts[at.line]
  if (start === undefined || at.character < 0) {
    return undefined
  }
  const offset = start + at.character
  return offset <= lineEnd(text, starts, at.line) ? offset : undefined
}

/** The position of an offset. */
function positionOf(starts: readonly number[], offset: number): CodePosition {
  let line = 0
  while (line + 1 < starts.length && (starts[line + 1] ?? 0) <= offset) {
    line += 1
  }
  return { line, character: offset - (starts[line] ?? 0) }
}

/**
 * The first whole-word occurrence of `name` at or after `from`, and no
 * later than line `lastLine` when given, as a position; undefined when there
 * is none (or `from` is not in the text). The name is matched literally,
 * never as a pattern.
 */
export function findName(
  text: string,
  name: string,
  from: CodePosition,
  lastLine?: number,
): CodePosition | undefined {
  const starts = lineStarts(text)
  const begin = offsetOf(text, starts, from)
  if (begin === undefined || name === '') {
    return undefined
  }
  const end = lastLine === undefined ? text.length : lineEnd(text, starts, lastLine)
  for (let at = text.indexOf(name, begin); at !== -1; at = text.indexOf(name, at + 1)) {
    if (at + name.length > end) {
      return undefined
    }
    const before = text.slice(Math.max(at - 1, 0), at)
    const after = text.slice(at + name.length, at + name.length + 1)
    if (!NAME_CHARACTER.test(before) && !NAME_CHARACTER.test(after)) {
      return positionOf(starts, at)
    }
  }
  return undefined
}

/** The text a range covers; undefined when the range is not inside the text. */
export function textIn(text: string, start: CodePosition, end: CodePosition): string | undefined {
  const starts = lineStarts(text)
  const from = offsetOf(text, starts, start)
  const to = offsetOf(text, starts, end)
  return from === undefined || to === undefined || to < from ? undefined : text.slice(from, to)
}

/**
 * The text with the edits applied, positions read against the text as it
 * was; undefined when an edit falls outside it or two edits overlap.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string | undefined {
  const starts = lineStarts(text)
  const spans: { readonly from: number; readonly to: number; readonly newText: string }[] = []
  for (const edit of edits) {
    const from = offsetOf(text, starts, edit.range.start)
    const to = offsetOf(text, starts, edit.range.end)
    if (from === undefined || to === undefined || to < from) {
      return undefined
    }
    spans.push({ from, to, newText: edit.newText })
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to)
  let result = ''
  let cursor = 0
  for (const span of spans) {
    if (span.from < cursor) {
      return undefined
    }
    result += `${text.slice(cursor, span.from)}${span.newText}`
    cursor = span.to
  }
  return `${result}${text.slice(cursor)}`
}

function patchLines(text: string): readonly string[] {
  const lines = text.split(PATCH_LINE_BREAK)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** A hunk over `old[oldFrom, oldTo)` and `updated[newFrom, newTo)`, unified numbering. */
function hunkOf(
  lines: readonly string[],
  oldFrom: number,
  oldLines: number,
  newFrom: number,
  newLines: number,
): PatchHunk {
  return {
    // A side with no lines starts at the line before it (unified numbering).
    oldStart: oldLines === 0 ? oldFrom : oldFrom + 1,
    oldLines,
    newStart: newLines === 0 ? newFrom : newFrom + 1,
    newLines,
    lines: [...lines],
  }
}

/** One hunk around everything that changed; undefined when no line did. */
function spanningHunk(old: readonly string[], updated: readonly string[]): PatchHunk | undefined {
  let start = 0
  while (start < old.length && start < updated.length && old[start] === updated[start]) {
    start += 1
  }
  let oldEnd = old.length
  let newEnd = updated.length
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === updated[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  if (oldEnd === start && newEnd === start) {
    return undefined
  }
  const from = Math.max(start - PATCH_CONTEXT_LINES, 0)
  const trailing = old.slice(oldEnd, oldEnd + PATCH_CONTEXT_LINES)
  const leading = old.slice(from, start)
  const lines = [
    ...leading.map((line) => `${CONTEXT_MARKER}${line}`),
    ...old.slice(start, oldEnd).map((line) => `${REMOVE_MARKER}${line}`),
    ...updated.slice(start, newEnd).map((line) => `${ADD_MARKER}${line}`),
    ...trailing.map((line) => `${CONTEXT_MARKER}${line}`),
  ]
  const context = leading.length + trailing.length
  return hunkOf(lines, from, context + oldEnd - start, from, context + newEnd - start)
}

/**
 * The one hunk around everything that changed between two texts, with
 * three lines of context each side, in unified numbering (PLAN.md D27: an
 * insertion's `oldStart` is the line it follows); undefined when no line
 * changed. The file tools' patch (`write_file`, `edit_file`).
 */
export function changeHunk(before: string, after: string): PatchHunk | undefined {
  return spanningHunk(patchLines(before), patchLines(after))
}

/** The hunk for lines `[from, to]` of two texts of equal length: runs of changes, context between. */
function alignedHunk(
  old: readonly string[],
  updated: readonly string[],
  from: number,
  to: number,
): PatchHunk {
  const lines: string[] = []
  let index = from
  while (index <= to) {
    if (old[index] === updated[index]) {
      lines.push(`${CONTEXT_MARKER}${old[index] ?? ''}`)
      index += 1
      continue
    }
    let runEnd = index
    while (runEnd <= to && old[runEnd] !== updated[runEnd]) {
      runEnd += 1
    }
    lines.push(
      ...old.slice(index, runEnd).map((line) => `${REMOVE_MARKER}${line}`),
      ...updated.slice(index, runEnd).map((line) => `${ADD_MARKER}${line}`),
    )
    index = runEnd
  }
  const count = to - from + 1
  return hunkOf(lines, from, count, from, count)
}

/**
 * The hunks between two texts (BOMs left out, as Edit Review matches them):
 * one per group of changed lines when the line count is unchanged (a rename
 * changes names within lines), else one around everything that changed.
 */
export function patchHunks(before: string, after: string): readonly PatchHunk[] {
  const old = patchLines(withoutBom(before))
  const updated = patchLines(withoutBom(after))
  if (old.length !== updated.length) {
    const hunk = spanningHunk(old, updated)
    return hunk === undefined ? [] : [hunk]
  }
  const changed = old.flatMap((line, index) => (line === updated[index] ? [] : [index]))
  const hunks: PatchHunk[] = []
  let group: { first: number; last: number } | undefined
  const close = (closing: { first: number; last: number }) => {
    hunks.push(
      alignedHunk(
        old,
        updated,
        Math.max(closing.first - PATCH_CONTEXT_LINES, 0),
        Math.min(closing.last + PATCH_CONTEXT_LINES, old.length - 1),
      ),
    )
  }
  for (const index of changed) {
    if (group !== undefined && index - group.last <= PATCH_CONTEXT_LINES * 2) {
      group.last = index
      continue
    }
    if (group !== undefined) {
      close(group)
    }
    group = { first: index, last: index }
  }
  if (group !== undefined) {
    close(group)
  }
  return hunks
}

/** A file's hunks as a unified diff, for a model to apply with its own edit tool. */
export function unifiedDiff(path: string, hunks: readonly PatchHunk[]): string {
  const body = hunks.flatMap((hunk) => [
    `@@ -${String(hunk.oldStart)},${String(hunk.oldLines ?? 0)} +${String(hunk.newStart)},${String(hunk.newLines ?? 0)} @@`,
    ...hunk.lines,
  ])
  return [`--- a/${path}`, `+++ b/${path}`, ...body].join(LF)
}
