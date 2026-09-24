// Rebuilds a file's pre-edit text from the stored patch document: the hunks
// are applied in reverse to the file as it is now (added lines must be there
// and are taken out, removed lines are put back). The match is exact; when the
// file no longer carries the hunks' "new" side the caller is told so rather
// than handed a guess. Pure; the host reads and writes the files.
//
// A hunk's lines are looked for where the edit left them first. When lines
// were added or removed above them since (a hand edit, say), the same lines,
// matched character for character, are looked for anywhere after the
// previous hunk, and taken only where they occur exactly once (M36, PLAN.md
// D31): `git apply`'s offset rule without its fuzz. Where they occur nowhere,
// or in more than one place, the edit is refused with the reason.

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

type HunkPlace =
  { readonly ok: true; readonly start: number } | { readonly ok: false; readonly reason: string }

/**
 * Where the hunk's "new" side is in `lines`, `predicted` being at or after
 * `cursor`: at `predicted` when it is there, else at its one exact
 * occurrence at or after `cursor`. A side with no lines (a deletion with no
 * context) matches at `predicted` by definition, so it is never searched for.
 */
function placeOf(
  lines: readonly string[],
  expected: readonly string[],
  predicted: number,
  cursor: number,
  hunkNumber: number,
): HunkPlace {
  if (isMatchAt(lines, predicted, expected)) {
    return { ok: true, start: predicted }
  }
  const label = `hunk ${String(hunkNumber)}`
  const found: number[] = []
  for (let offset = cursor; offset + expected.length <= lines.length; offset += 1) {
    if (isMatchAt(lines, offset, expected)) {
      found.push(offset)
    }
  }
  const [only] = found
  if (only !== undefined && found.length === 1) {
    return { ok: true, start: only }
  }
  const reason =
    found.length === 0
      ? `no longer matches the file at line ${String(predicted + 1)}, or anywhere else`
      : `matches ${String(found.length)} places in the file, so which one is not certain`
  return { ok: false, reason: `${label} ${reason}` }
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
  // How far the file has moved since the edit, as the last hunk found showed:
  // the next hunk is looked for that much further on first.
  let shift = 0
  for (const [index, hunk] of hunks.entries()) {
    const expected = newSide(hunk)
    const recorded = Math.max(hunk.newStart - 1, 0)
    // Hunks are stored in order and never overlap, so in a sound patch the
    // next one cannot be expected before the previous one ends.
    if (recorded + shift < cursor) {
      return { ok: false, reason: `hunk ${String(index + 1)} overlaps the previous one` }
    }
    const place = placeOf(lines, expected, recorded + shift, cursor, index + 1)
    if (!place.ok) {
      return place
    }
    output.push(...lines.slice(cursor, place.start), ...oldSide(hunk))
    cursor = place.start + expected.length
    shift = place.start - recorded
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
