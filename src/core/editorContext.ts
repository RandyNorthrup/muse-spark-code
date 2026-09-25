// The active editor as context for a message (Claude Code's "active file
// chip"): the text the model receives, in the wording Claude Code's own IDE
// reminders use (`<ide_selection>` with the selected lines,
// `<ide_opened_file>` for a bare open file). The chip label lives in
// src/shared/editorContext.ts so the webview can build it too. Pure.

import { IDE_CONTEXT_TAGS, MODEL_TEXT, SELECTION_TEXT_MAX_CHARS } from '../shared/constants'
import type { EditorContextSummary } from '../shared/protocol'

export interface EditorContext extends EditorContextSummary {
  /**
   * The highlighted text, or undefined when the file's content must not be
   * shared (excluded from the workspace index, as Claude Code treats
   * `files.exclude` / gitignored files: path only).
   */
  readonly selectedText: string | undefined
}

export function editorContextSummary(context: EditorContext): EditorContextSummary {
  const { relativePath, startLine, endLine, isEmpty } = context
  return { relativePath, startLine, endLine, isEmpty }
}

function clipped(text: string): string {
  return text.length > SELECTION_TEXT_MAX_CHARS
    ? `${text.slice(0, SELECTION_TEXT_MAX_CHARS)}\n${MODEL_TEXT.selectionClipped}`
    : text
}

/** The context part appended to the turn's prompt (never shown as typed text). */
export function editorContextText(context: EditorContext): string {
  const { relativePath, startLine, endLine, isEmpty, selectedText } = context
  if (isEmpty) {
    return `<${IDE_CONTEXT_TAGS.openedFile}>The user opened the file ${relativePath} in the IDE. This may or may not be related to the current task.</${IDE_CONTEXT_TAGS.openedFile}>`
  }
  const lines = `the lines ${String(startLine)} to ${String(endLine)} from ${relativePath}`
  const body =
    selectedText === undefined
      ? `${lines}. ${MODEL_TEXT.selectionNotShared}`
      : `${lines}:\n${clipped(selectedText)}\n`
  return `<${IDE_CONTEXT_TAGS.selection}>The user selected ${body}</${IDE_CONTEXT_TAGS.selection}>`
}
