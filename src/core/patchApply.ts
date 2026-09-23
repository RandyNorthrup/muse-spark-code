// Rebuilds a file's pre-edit text from the stored patch document: the hunks
// are applied in reverse to the file as it is now (added lines must be there
// and are taken out, removed lines are put back). The match is exact; when the
// file no longer carries the hunks' "new" side the caller is told so rather
// than handed a guess. Pure; the host reads and writes the files.

import { ADD_MARKER, type PatchHunk, REMOVE_MARKER } from '../shared/patchDocument'

export type RevertResult =
  | { readonly ok: true; readonly content: string; readonly isCreatedFile: boolean }
  | { readonly ok: false; readonly reason: string }

const LINE_BREAK = /\r?\n/
const CRLF = '\r\n'
const LF = '\n'

/** The line break the text uses, so the rebuilt text keeps it. */
function lineBreakOf(text: string): string {
  return text.includes(CRLF) ? CRLF : LF
}

/** Splits into lines, remembering whether the text ended with a line break. */
function splitLines(text: string): { lines: string[]; hasTrailingBreak: boolean } {
  if (text === '') {
    return { lines: [], hasTrailingBreak: false }
  }
  const lines = text.split(LINE_BREAK)
  const hasTrailingBreak = lines.at(-1) === ''
  if (hasTrailingBreak) {
    lines.pop()
  }
  return { lines, hasTrailingBreak }
}

/** The hunk's "new" side (context + added), the lines the file must hold now. */
function newSide(hunk: PatchHunk): readonly string[] {
  return hunk.lines.filter((line) => !line.startsWith(REMOVE_MARKER)).map((line) => line.slice(1))
}

/** The hunk's "old" side (context + removed), the lines to restore. */
function oldSide(hunk: PatchHunk): readonly string[] {
  return hunk.lines.filter((line) => !line.startsWith(ADD_MARKER)).map((line) => line.slice(1))
}

function isMatchAt(lines: readonly string[], offset: number, expected: readonly string[]): boolean {
  return expected.every((line, index) => lines[offset + index] === line)
}

/** A single hunk that adds every line of a file that had none: how Muse Code records a new file. */
function isWholeFileAdd(hunks: readonly PatchHunk[]): boolean {
  return (
    hunks.length === 1 &&
    hunks.every(
      (hunk) =>
        hunk.oldStart === 0 &&
        (hunk.oldLines ?? 0) === 0 &&
        hunk.lines.every((line) => line.startsWith(ADD_MARKER)),
    )
  )
}

/**
 * Reverse-applies `hunks` (ordered, non-overlapping, as the CLI stores them)
 * to `currentText`. `newStart` is 1-based; a hunk with `newStart` 0 and no
 * "new" side means the file was deleted, which is not an edit this handles.
 *
 * `isCreated` is the patch's own word that the edit created the file (the
 * Model API's tools give it); without it a whole-file add stands in (Muse
 * Code's documents). Either way the file counts as created only when
 * nothing is left once the edit is taken out (PLAN.md D27): lines the user
 * added since are written back, never trashed with it.
 */
export function revertHunks(
  currentText: string,
  hunks: readonly PatchHunk[],
  isCreated?: boolean,
): RevertResult {
  const { lines, hasTrailingBreak } = splitLines(currentText)
  const lineBreak = lineBreakOf(currentText)
  const output: string[] = []
  let cursor = 0
  for (const [index, hunk] of hunks.entries()) {
    const expected = newSide(hunk)
    const start = Math.max(hunk.newStart - 1, 0)
    if (start < cursor) {
      return { ok: false, reason: `hunk ${String(index + 1)} overlaps the previous one` }
    }
    if (!isMatchAt(lines, start, expected)) {
      return {
        ok: false,
        reason: `hunk ${String(index + 1)} no longer matches the file at line ${String(start + 1)}`,
      }
    }
    output.push(...lines.slice(cursor, start), ...oldSide(hunk))
    cursor = start + expected.length
  }
  output.push(...lines.slice(cursor))
  const isCreatedFile = (isCreated ?? isWholeFileAdd(hunks)) && output.length === 0
  if (output.length === 0) {
    return { ok: true, content: '', isCreatedFile }
  }
  return {
    ok: true,
    content: output.join(lineBreak) + (hasTrailingBreak ? lineBreak : ''),
    isCreatedFile,
  }
}
