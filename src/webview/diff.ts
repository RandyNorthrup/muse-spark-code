// Diff rows for the Edit / Write tool bodies. Two sources, both verified on
// the wire (2026-09-21): the stored `tool_patch` JSON document fetched with
// `item/readOutput` (unified hunks with line numbers), and the edit tool's
// `visibleOutput`, a headerless unified diff used until the document arrives.

import { ADD_MARKER, parsePatchFiles, REMOVE_MARKER } from '../shared/patchDocument'

export interface DiffRow {
  readonly kind: 'context' | 'add' | 'remove' | 'hunk'
  readonly oldLine: number | undefined
  readonly newLine: number | undefined
  readonly text: string
}

export interface FileDiff {
  readonly path: string
  readonly rows: readonly DiffRow[]
}

const HUNK_SEPARATOR: DiffRow = { kind: 'hunk', oldLine: undefined, newLine: undefined, text: '' }
const HUNK_HEADER = '@@'
const OLD_FILE_HEADER = '--- '
const NEW_FILE_HEADER = '+++ '

function kindOf(marker: string): DiffRow['kind'] {
  if (marker === ADD_MARKER) {
    return 'add'
  }
  return marker === REMOVE_MARKER ? 'remove' : 'context'
}

function rowsOfHunk(lines: readonly string[], oldStart: number, newStart: number): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = oldStart
  let newLine = newStart
  for (const line of lines) {
    const kind = kindOf(line.charAt(0))
    const text = line.slice(1)
    rows.push({
      kind,
      oldLine: kind === 'add' ? undefined : oldLine,
      newLine: kind === 'remove' ? undefined : newLine,
      text,
    })
    if (kind !== 'add') {
      oldLine += 1
    }
    if (kind !== 'remove') {
      newLine += 1
    }
  }
  return rows
}

/** The stored patch document as file diffs; undefined when it is not one. */
export function parsePatchDocument(json: string): readonly FileDiff[] | undefined {
  const files = parsePatchFiles(json)
  if (files === undefined) {
    return undefined
  }
  return files.map((file) => ({
    path: file.path,
    rows: file.hunks.flatMap((hunk, index) => [
      ...(index === 0 ? [] : [HUNK_SEPARATOR]),
      ...rowsOfHunk(hunk.lines, hunk.oldStart, hunk.newStart),
    ]),
  }))
}

/**
 * Rows from the edit tool's visible output: everything from the first `@@`
 * on, without line numbers. Undefined when there is no hunk at all.
 */
export function parseUnifiedText(text: string): readonly DiffRow[] | undefined {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith(HUNK_HEADER))
  if (start === -1) {
    return undefined
  }
  const rows: DiffRow[] = []
  for (const line of lines.slice(start)) {
    if (line === '' || line.startsWith(OLD_FILE_HEADER) || line.startsWith(NEW_FILE_HEADER)) {
      continue
    }
    if (line.startsWith(HUNK_HEADER)) {
      if (rows.length > 0) {
        rows.push(HUNK_SEPARATOR)
      }
      continue
    }
    rows.push({
      kind: kindOf(line.charAt(0)),
      oldLine: undefined,
      newLine: undefined,
      text: line.slice(1),
    })
  }
  return rows
}
