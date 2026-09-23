// Builds the `@path#start-end` reference the Alt+K keybinding inserts into the
// composer, mirroring the Claude Code extension's mention syntax
// (`@app.ts#5-10`; a single line is `@app.ts#5`; no selection is `@app.ts`),
// with a path that holds a space, `#` or `"` quoted (`@"my app.ts"#5-10`,
// PLAN.md D27; `src/shared/mentions.ts` has the syntax). Pure; no `vscode`
// import.

import { formatMention } from '../shared/mentions'

export interface MentionSource {
  /** Workspace-relative with forward slashes, or absolute for a file outside the root. */
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
  return formatMention(
    path,
    source.isEmpty ? undefined : { startLine: source.startLine, endLine: source.endLine },
  )
}
