// A formatter's edits applied to a file's text (M68, format on edit): the
// document's ranges as offsets into the text the edit tool wrote. Edits at
// the same offset keep their order, as VS Code applies them. Pure.

export interface OffsetEdit {
  readonly start: number
  readonly end: number
  readonly newText: string
}

/** The text with the edits applied, or undefined when they overlap or fall outside it. */
export function applyOffsetEdits(text: string, edits: readonly OffsetEdit[]): string | undefined {
  // Last first, so each edit's offsets still hold when it is applied; of two
  // at one offset, the later one first, so the earlier ends up in front.
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .toSorted((a, b) => b.edit.start - a.edit.start || b.index - a.index)
  let result = text
  let limit = text.length
  for (const { edit } of ordered) {
    if (edit.start < 0 || edit.start > edit.end || edit.end > limit) {
      return undefined
    }
    result = `${result.slice(0, edit.start)}${edit.newText}${result.slice(edit.end)}`
    limit = edit.start
  }
  return result
}
