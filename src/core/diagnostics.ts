// The `getDiagnostics` IDE tool: the errors and warnings in VS Code's Problems
// panel as text for the model, optionally scoped to one file (the Claude Code
// `mcp__ide__getDiagnostics` contract). Pure; the host supplies the entries.

import { DIAGNOSTICS_MAX_ENTRIES, IDE_MCP_TOOL_DIAGNOSTICS } from '../shared/constants'
import type { McpTool } from './mcp'

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface DiagnosticEntry {
  /** Workspace-relative with forward slashes, or the absolute path outside it. */
  readonly path: string
  readonly severity: DiagnosticSeverity
  /** 1-based. */
  readonly line: number
  readonly column: number
  readonly message: string
  readonly source: string | undefined
}

const SEVERITY_ORDER: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
}

const NO_DIAGNOSTICS = 'No diagnostics.'
const URI_ARGUMENT = 'uri'
const FILE_SCHEME = 'file://'

/** Strips a `file://` scheme and normalises separators so paths compare. */
export function normaliseDiagnosticPath(value: string): string {
  const stripped = value.startsWith(FILE_SCHEME)
    ? decodeURIComponent(value.slice(FILE_SCHEME.length))
    : value
  // `file:///c:/x` keeps a leading slash before the drive letter.
  const withoutLeadingSlash = /^\/[a-zA-Z]:/.test(stripped) ? stripped.slice(1) : stripped
  return withoutLeadingSlash.replaceAll('\\', '/').toLowerCase()
}

function isUriMatch(
  entry: DiagnosticEntry,
  uri: string,
  workspaceRoot: string | undefined,
): boolean {
  const wanted = normaliseDiagnosticPath(uri)
  const entryPath = normaliseDiagnosticPath(entry.path)
  return (
    entryPath === wanted ||
    wanted.endsWith(`/${entryPath}`) ||
    (workspaceRoot !== undefined &&
      normaliseDiagnosticPath(`${workspaceRoot}/${entry.path}`) === wanted)
  )
}

function formatEntry(entry: DiagnosticEntry): string {
  const source = entry.source === undefined ? '' : ` [${entry.source}]`
  return `${entry.path}:${String(entry.line)}:${String(entry.column)}: ${entry.severity}: ${entry.message}${source}`
}

/** The tool's text for `entries`, worst first, capped with a count. */
export function formatDiagnostics(entries: readonly DiagnosticEntry[]): string {
  if (entries.length === 0) {
    return NO_DIAGNOSTICS
  }
  const sorted = entries.toSorted(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  )
  const shown = sorted.slice(0, DIAGNOSTICS_MAX_ENTRIES).map((entry) => formatEntry(entry))
  if (sorted.length > DIAGNOSTICS_MAX_ENTRIES) {
    shown.push(`… ${String(sorted.length - DIAGNOSTICS_MAX_ENTRIES)} more not shown`)
  }
  return shown.join('\n')
}

export interface DiagnosticsToolDeps {
  readonly getDiagnostics: () => readonly DiagnosticEntry[]
  readonly workspaceRoot: string | undefined
}

export function diagnosticsTool(deps: DiagnosticsToolDeps): McpTool {
  return {
    name: IDE_MCP_TOOL_DIAGNOSTICS,
    description:
      "Language-server diagnostics: the errors and warnings in VS Code's Problems panel, worst first. Optionally scoped to one file.",
    inputSchema: {
      type: 'object',
      properties: {
        [URI_ARGUMENT]: {
          type: 'string',
          description: 'A file:// URI or workspace-relative path; omit for the whole workspace.',
        },
      },
    },
    call: (args) => {
      const uri = args[URI_ARGUMENT]
      const entries = deps.getDiagnostics()
      const scoped =
        typeof uri === 'string' && uri !== ''
          ? entries.filter((entry) => isUriMatch(entry, uri, deps.workspaceRoot))
          : entries
      return Promise.resolve(formatDiagnostics(scoped))
    },
  }
}
