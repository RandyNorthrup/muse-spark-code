// The `getDiagnostics` IDE tool: the errors and warnings in VS Code's Problems
// panel as text for the model, optionally scoped to one file (the Claude Code
// `mcp__ide__getDiagnostics` contract). Only files under the workspace root
// (the first folder) are reported, by their relative path, so no absolute
// path of another folder or of the user's other files reaches the model; a
// message is clipped at `DIAGNOSTIC_MESSAGE_MAX_CHARS`; a requested file is
// matched by its exact workspace-relative path, and a request that names no
// file in the workspace is an error result, never a crash (PLAN.md D27).
// Pure; the host supplies the entries.

import { fileURLToPath } from 'node:url'
import {
  DIAGNOSTIC_MESSAGE_MAX_CHARS,
  DIAGNOSTICS_MAX_ENTRIES,
  IDE_MCP_TOOL_DIAGNOSTICS,
  MODEL_TEXT,
  MCP_ANNOTATIONS_READ_ONLY,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { McpTool } from './mcp'
import { resolveAgainstRoot } from './workspaceRoot'

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

/** VS Code's `DiagnosticSeverity` values, in order: `Error` is 0, `Hint` is 3. */
export const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = [
  'error',
  'warning',
  'information',
  'hint',
]

export interface DiagnosticEntry {
  /**
   * Relative to the root with forward slashes (`rootRelativePath`);
   * undefined for a resource outside it, which is never reported.
   */
  readonly path: string | undefined
  readonly severity: DiagnosticSeverity
  /** 1-based. */
  readonly line: number
  readonly column: number
  readonly message: string
  readonly source: string | undefined
}

/** An entry for a file in the workspace. */
export interface WorkspaceDiagnostic extends DiagnosticEntry {
  readonly path: string
}

const SEVERITY_ORDER: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
}

const NO_DIAGNOSTICS = 'No diagnostics.'
const URI_ARGUMENT = 'uri'
const FILE_URI = /^file:/i
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInWorkspace(entry: DiagnosticEntry): entry is WorkspaceDiagnostic {
  return entry.path !== undefined
}

/** At most `DIAGNOSTIC_MESSAGE_MAX_CHARS`, never splitting a surrogate pair, with the rest counted. */
function clipMessage(message: string): string {
  if (message.length <= DIAGNOSTIC_MESSAGE_MAX_CHARS) {
    return message
  }
  let kept = message.slice(0, DIAGNOSTIC_MESSAGE_MAX_CHARS)
  if (HIGH_SURROGATE.test(kept)) {
    kept = kept.slice(0, -1)
  }
  return `${kept}… [${String(message.length - kept.length)} characters clipped]`
}

type PathRequest =
  | { readonly ok: true; readonly path: string; readonly fsPath: string }
  | { readonly ok: false; readonly reason: string }

/**
 * The workspace-relative path a request names: a `file:` URI (as VS Code
 * writes one, `file:///c%3A/…`), an absolute path, or a path relative to the
 * root. A malformed URI (bad percent-encoding throws in the decoder) or a
 * path that names no file in the workspace comes back with the reason.
 */
function requestedPath(given: string, deps: DiagnosticsToolDeps): PathRequest {
  let fsPath: string
  try {
    fsPath = FILE_URI.test(given)
      ? fileURLToPath(given, { windows: deps.platform === 'win32' })
      : resolveAgainstRoot(given, deps.workspaceRoot, deps.platform)
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `${given} cannot be read as a file URI or path: ${describe(error)}`,
    }
  }
  const relative = deps.relativeInRoot(fsPath)
  return relative === undefined
    ? { ok: false, reason: `${given} does not name a file in the workspace` }
    : { ok: true, path: relative, fsPath }
}

function formatEntry(entry: WorkspaceDiagnostic): string {
  const source = entry.source === undefined ? '' : ` [${entry.source}]`
  return `${entry.path}:${String(entry.line)}:${String(entry.column)}: ${entry.severity}: ${clipMessage(entry.message)}${source}`
}

/**
 * The tool's text for `entries`, worst first, capped at `max` with a count
 * (the verify loop sends fewer than the tool, M68).
 */
export function formatDiagnostics(
  entries: readonly WorkspaceDiagnostic[],
  max: number = DIAGNOSTICS_MAX_ENTRIES,
): string {
  if (entries.length === 0) {
    return NO_DIAGNOSTICS
  }
  const sorted = entries.toSorted(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  )
  const shown = sorted.slice(0, max).map((entry) => formatEntry(entry))
  if (sorted.length > max) {
    shown.push(`… ${String(sorted.length - max)} more not shown`)
  }
  return shown.join('\n')
}

export interface DiagnosticsToolDeps {
  readonly getDiagnostics: () => readonly DiagnosticEntry[]
  /** The first folder's path, which a relative request is resolved against. */
  readonly workspaceRoot: string | undefined
  readonly platform: NodeJS.Platform
  /** An absolute path relative to the root, undefined outside it (`rootRelativePath`). */
  readonly relativeInRoot: (absolutePath: string) => string | undefined
  /**
   * Shows a file the request names, waits for its language server and reads
   * its diagnostics while it shows (M68): the servers report only on files
   * an editor shows, and may clear them when its tab closes. Undefined when
   * none were read; absent, the tool reads what VS Code holds now.
   */
  readonly settleFile?: (
    absolutePath: string,
    signal: AbortSignal | undefined,
  ) => Promise<readonly DiagnosticEntry[] | undefined>
}

/** Paths compare as the platform's file system does: case-insensitively on Windows. */
function pathKey(relativePath: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? relativePath.toLowerCase() : relativePath
}

export function diagnosticsTool(deps: DiagnosticsToolDeps): McpTool {
  return {
    name: IDE_MCP_TOOL_DIAGNOSTICS,
    description:
      "Language-server diagnostics: the errors and warnings in VS Code's Problems panel for the files in the workspace, worst first. Optionally scoped to one file, which is then shown in an editor so its language server reports on it.",
    inputSchema: {
      type: 'object',
      properties: {
        [URI_ARGUMENT]: {
          type: 'string',
          description: 'A file:// URI or workspace-relative path; omit for the whole workspace.',
        },
      },
    },
    // It only reads the Problems panel (D49's rule for tools on `ide`, M67).
    annotations: MCP_ANNOTATIONS_READ_ONLY,
    // A request that names no workspace file rejects, so the server answers
    // with an error result the model can read.
    call: async (args, signal) => {
      const uri = args[URI_ARGUMENT]
      const { platform } = deps
      const inWorkspace = () => deps.getDiagnostics().filter((entry) => isInWorkspace(entry))
      if (typeof uri !== 'string' || uri === '') {
        return formatDiagnostics(inWorkspace())
      }
      const request = requestedPath(uri, deps)
      if (!request.ok) {
        throw new Error(request.reason)
      }
      const read = await deps.settleFile?.(request.fsPath, signal)
      if (read !== undefined) {
        return formatDiagnostics(read.map((entry) => ({ ...entry, path: request.path })))
      }
      const wanted = pathKey(request.path, platform)
      const found = inWorkspace().filter((entry) => pathKey(entry.path, platform) === wanted)
      // A file its server never reported on is not checked, never clean (M68).
      return deps.settleFile !== undefined && found.length === 0
        ? fill(MODEL_TEXT.diagnosticsNotSettled, { path: request.path })
        : formatDiagnostics(found)
    },
  }
}
