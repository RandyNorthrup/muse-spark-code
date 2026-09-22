// Builds the `@path#start-end` reference the Alt+K keybinding inserts into the
// composer, mirroring the Claude Code extension's mention syntax
// (`@app.ts#5-10`; a single line is `@app.ts#5`; no selection is `@app.ts`).
// Pure; no `vscode` import.

export interface MentionSource {
  /** Workspace-relative path with forward slashes. */
  readonly relativePath: string
  /** 1-based, inclusive. */
  readonly startLine: number
  /** 1-based, inclusive. */
  readonly endLine: number
  /** True when the selection is a bare cursor (nothing highlighted). */
  readonly isEmpty: boolean
}

export function formatMentionReference(source: MentionSource): string {
  const path = source.relativePath.replaceAll('\\', '/')
  if (source.isEmpty) {
    return `@${path}`
  }
  const start = String(source.startLine)
  return source.startLine === source.endLine
    ? `@${path}#${start}`
    : `@${path}#${start}-${String(source.endLine)}`
}
