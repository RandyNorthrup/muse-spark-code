// The active-editor chip's label, shared by the composer, the user card and
// the host (M5). No `vscode`, Node or DOM imports.

import { UI_TEXT } from './constants'
import type { EditorContextSummary } from './protocol'

function baseName(relativePath: string): string {
  return relativePath.split('/').at(-1) ?? relativePath
}

/** "PLAN.md", "PLAN.md L5" or "PLAN.md L5-10", as the Claude Code chip reads. */
export function editorContextLabel(summary: EditorContextSummary): string {
  const name = baseName(summary.relativePath)
  if (summary.isEmpty) {
    return name
  }
  const start = String(summary.startLine)
  const range =
    summary.startLine === summary.endLine ? start : `${start}-${String(summary.endLine)}`
  return `${name} ${UI_TEXT.linePrefix}${range}`
}
