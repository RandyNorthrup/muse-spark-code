// How a tool call is described in its row: the label (Edit / Bash / …), the
// monospace summary beside it (path or command description), the change line
// under it (Added N lines / Removed N lines / Modified) and which body to
// render. Pure; the wire shapes are the ones captured live on 2026-09-21.

import { FILE_EDIT_TOOLS, FILE_READ_TOOLS, SHELL_TOOLS, UI_TEXT } from '../shared/constants'
import { plural } from '../shared/l10n/text'
import type { PatchSummary } from './state/transcriptEntries'

export type ToolBody = 'shell' | 'edit' | 'read' | 'question' | 'generic'

export interface ToolPresentation {
  readonly label: string
  /** Path, command description or nothing. */
  readonly summary: string
  readonly body: ToolBody
  /** Shell tools: the command text for the IN box. */
  readonly command: string | undefined
}

interface ParsedArgs {
  readonly path: string | undefined
  readonly command: string | undefined
  readonly description: string | undefined
  readonly content: string | undefined
  /** The `search` tool's regular expression (live 2026-09-22). */
  readonly pattern: string | undefined
}

const NO_ARGS: ParsedArgs = {
  path: undefined,
  command: undefined,
  description: undefined,
  content: undefined,
  pattern: undefined,
}

function parseArgs(args: string): ParsedArgs {
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed !== 'object' || parsed === null) {
      return NO_ARGS
    }
    const record = parsed as Record<string, unknown>
    const pick = (key: string) => (typeof record[key] === 'string' ? record[key] : undefined)
    return {
      path: pick('path'),
      command: pick('command'),
      description: pick('description'),
      content: pick('content'),
      pattern: pick('pattern'),
    }
  } catch {
    return NO_ARGS
  }
}

/**
 * The row label the table gives a wire tool name; undefined for a tool it
 * does not name (only the table's own keys, never `Object.prototype`'s).
 */
export function toolLabel(tool: string): string | undefined {
  const labels: Readonly<Record<string, string>> = UI_TEXT.toolLabels
  return Object.hasOwn(labels, tool) ? labels[tool] : undefined
}

export function describeTool(tool: string, args: string): ToolPresentation {
  const parsed = parseArgs(args)
  const label = toolLabel(tool) ?? tool
  if (SHELL_TOOLS.has(tool)) {
    return {
      label,
      summary: parsed.description ?? parsed.command ?? '',
      body: 'shell',
      command: parsed.command,
    }
  }
  if (FILE_EDIT_TOOLS.has(tool)) {
    return { label, summary: parsed.path ?? '', body: 'edit', command: undefined }
  }
  if (FILE_READ_TOOLS.has(tool)) {
    return { label, summary: parsed.path ?? '', body: 'read', command: undefined }
  }
  if (tool === 'request_user_input') {
    return { label, summary: '', body: 'question', command: undefined }
  }
  return {
    label,
    summary: parsed.path ?? parsed.pattern ?? parsed.description ?? '',
    body: 'generic',
    command: undefined,
  }
}

/** "Added 82 lines" / "Removed 6 lines" / "Modified", as the Claude Code row. */
export function changeSummary(summary: PatchSummary | undefined): string | undefined {
  if (summary === undefined) {
    return undefined
  }
  if (summary.added > 0 && summary.removed === 0) {
    return plural(UI_TEXT.addedLines, summary.added)
  }
  return summary.removed > 0 && summary.added === 0
    ? plural(UI_TEXT.removedLines, summary.removed)
    : UI_TEXT.modified
}

/** The written file's content for a Write row without a fetched patch. */
export function writtenContent(args: string): string | undefined {
  return parseArgs(args).content
}
