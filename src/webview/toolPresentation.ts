// How a tool call is described in its row: the label (Edit / Bash / …), the
// monospace summary beside it (path, command description, goal, prompt or
// query), the change line under it (Added N lines / Removed N lines /
// Modified), which body to render and the picture it shows. Pure; the wire
// shapes are the ones captured live on 2026-09-21 and, for Muse Code's own
// tools, 2026-09-25 (M43).

import {
  FILE_EDIT_TOOLS,
  FILE_READ_TOOLS,
  GOAL_TOOLS,
  IMAGE_EXTENSIONS,
  IMAGE_MAKING_TOOLS,
  IMAGE_PREVIEW_TOOLS,
  MEMORY_TOOLS,
  MODEL_API_WEB_SEARCH_TOOL,
  SCHEDULE_TOOLS,
  SHELL_TOOLS,
  UI_TEXT,
} from '../shared/constants'
import { fill, plural } from '../shared/l10n/text'
import type { PatchSummary } from './state/transcriptEntries'

export type ToolBody =
  | 'shell'
  | 'edit'
  | 'read'
  | 'question'
  | 'memory'
  | 'goal'
  | 'schedule'
  | 'web'
  | 'image'
  | 'generic'

export interface ToolPresentation {
  readonly label: string
  /** Path, command description, goal, prompt, query or nothing. */
  readonly summary: string
  readonly body: ToolBody
  /** Shell tools: the command text for the IN box. */
  readonly command: string | undefined
  /** The picture the call read or made, when its path names one (M43). */
  readonly imagePath: string | undefined
}

interface ParsedArgs {
  readonly path: string | undefined
  readonly command: string | undefined
  readonly description: string | undefined
  readonly content: string | undefined
  /** The `search` tool's regular expression (live 2026-09-22). */
  readonly pattern: string | undefined
  /** A web search's queries (M33), or the page it opened. */
  readonly query: string | undefined
  readonly url: string | undefined
  /** `create_goal`'s objective, `cron_create`'s prompt (M43). */
  readonly objective: string | undefined
  readonly prompt: string | undefined
  /** `update_goal`'s new status; `report_progress`'s current work (M43). */
  readonly status: string | undefined
  readonly currentWork: string | undefined
  /** `cron_delete`'s job id (M43). */
  readonly id: string | undefined
}

const NO_ARGS: ParsedArgs = {
  path: undefined,
  command: undefined,
  description: undefined,
  content: undefined,
  pattern: undefined,
  query: undefined,
  url: undefined,
  objective: undefined,
  prompt: undefined,
  status: undefined,
  currentWork: undefined,
  id: undefined,
}

// `mcp__<server>__<tool>`: the name Muse Code gives an MCP server's tool.
const MCP_TOOL = /^mcp__(.+?)__(.+)$/
// A path's extension, for the picture check.
const EXTENSION = /\.[^./\\]+$/

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
      query: pick('query'),
      url: pick('url'),
      objective: pick('objective'),
      prompt: pick('prompt'),
      status: pick('status'),
      currentWork: pick('current_work'),
      id: pick('id'),
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

/** An MCP server's tool the table does not name: "tool (server)" (M43). */
function mcpLabel(tool: string): string | undefined {
  const match = MCP_TOOL.exec(tool)
  return match === null
    ? undefined
    : fill(UI_TEXT.mcpToolLabel, { server: match[1] ?? '', tool: match[2] ?? '' })
}

/** A goal status in words; one Muse Code adds later shows as it came (M43). */
export function goalStatusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = UI_TEXT.goalStatuses
  return Object.hasOwn(labels, status) ? (labels[status] ?? status) : status
}

/** Whether a path names a picture the panel can show. */
function isImagePath(path: string): boolean {
  const extension = EXTENSION.exec(path)?.[0].toLowerCase()
  return extension !== undefined && Object.hasOwn(IMAGE_EXTENSIONS, extension)
}

function goalSummary(tool: string, parsed: ParsedArgs): string {
  switch (tool) {
    case 'create_goal': {
      return parsed.objective ?? ''
    }
    case 'update_goal': {
      return parsed.status === undefined ? '' : goalStatusLabel(parsed.status)
    }
    case 'report_progress': {
      return parsed.currentWork ?? ''
    }
    default: {
      return ''
    }
  }
}

/** The body and summary of a tool that is neither a shell, a file edit nor a read. */
function otherPresentation(
  tool: string,
  parsed: ParsedArgs,
): Pick<ToolPresentation, 'summary' | 'body'> {
  if (tool === 'request_user_input') {
    return { summary: '', body: 'question' }
  }
  if (MEMORY_TOOLS.has(tool)) {
    return { summary: parsed.path ?? '', body: 'memory' }
  }
  if (GOAL_TOOLS.has(tool)) {
    return { summary: goalSummary(tool, parsed), body: 'goal' }
  }
  if (SCHEDULE_TOOLS.has(tool)) {
    return { summary: parsed.prompt ?? parsed.id ?? '', body: 'schedule' }
  }
  if (tool === MODEL_API_WEB_SEARCH_TOOL) {
    return { summary: parsed.query ?? parsed.url ?? '', body: 'web' }
  }
  if (IMAGE_MAKING_TOOLS.has(tool)) {
    return { summary: parsed.path ?? '', body: 'image' }
  }
  return {
    summary:
      parsed.path ??
      parsed.pattern ??
      parsed.query ??
      parsed.url ??
      parsed.objective ??
      parsed.prompt ??
      parsed.description ??
      '',
    body: 'generic',
  }
}

export function describeTool(tool: string, args: string): ToolPresentation {
  const parsed = parseArgs(args)
  const label = toolLabel(tool) ?? mcpLabel(tool) ?? tool
  const imagePath =
    IMAGE_PREVIEW_TOOLS.has(tool) && parsed.path !== undefined && isImagePath(parsed.path)
      ? parsed.path
      : undefined
  if (SHELL_TOOLS.has(tool)) {
    return {
      label,
      summary: parsed.description ?? parsed.command ?? '',
      body: 'shell',
      command: parsed.command,
      imagePath,
    }
  }
  if (FILE_EDIT_TOOLS.has(tool)) {
    return { label, summary: parsed.path ?? '', body: 'edit', command: undefined, imagePath }
  }
  return FILE_READ_TOOLS.has(tool)
    ? { label, summary: parsed.path ?? '', body: 'read', command: undefined, imagePath }
    : { label, ...otherPresentation(tool, parsed), command: undefined, imagePath }
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
