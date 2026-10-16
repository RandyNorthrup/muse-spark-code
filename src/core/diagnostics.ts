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
function clipMessage(message: string, offset = 0, next?: (offset: number) => string): string {
  const start = HIGH_SURROGATE.test(message.slice(0, offset)) ? Math.max(offset - 1, 0) : offset
  if (message.length - start <= DIAGNOSTIC_MESSAGE_MAX_CHARS) {
    return message.slice(start)
  }
  let kept = message.slice(start, start + DIAGNOSTIC_MESSAGE_MAX_CHARS)
  if (HIGH_SURROGATE.test(kept)) {
    kept = kept.slice(0, -1)
  }
  const end = start + kept.length
  return `${kept}… [${String(message.length - end)} characters clipped${next === undefined ? '' : `; ${next(end)}`}]`
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

function formatEntry(
  entry: WorkspaceDiagnostic,
  messageOffset = 0,
  next?: (offset: number) => string,
): string {
  const source = entry.source === undefined ? '' : ` [${entry.source}]`
  return `${entry.path}:${String(entry.line)}:${String(entry.column)}: ${entry.severity}: ${clipMessage(entry.message, messageOffset, next)}${source}`
}

/**
 * B6 (limits-output): worst-first order (severity, then path, then line).
 * Shared with the verify report so its overflow names come from the same
 * sorted snapshot the page shows, not input order.
 */
export function sortWorkspaceDiagnostics(
  entries: readonly WorkspaceDiagnostic[],
): WorkspaceDiagnostic[] {
  return entries.toSorted(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  )
}

/**
 * B6 (limits-output): one page of the tool's text for `entries`, worst
 * first. `offset` skips that many sorted entries first, so entries past the
 * first page are pageable, not dropped. `nextPage` names the fetch for the
 * rest and is appended to the overflow note; every product path passes one.
 */
export function formatDiagnostics(
  entries: readonly WorkspaceDiagnostic[],
  max: number = DIAGNOSTICS_MAX_ENTRIES,
  offset = 0,
  nextPage?: string,
  messageOffset = 0,
  messagePage?: (entryOffset: number, messageOffset: number) => string,
): string {
  if (entries.length === 0) {
    return NO_DIAGNOSTICS
  }
  const sorted = sortWorkspaceDiagnostics(entries)
  const skip = Math.max(Math.floor(offset), 0)
  if (skip >= sorted.length) {
    throw new RangeError(
      `offset ${String(skip)} is past the last of ${String(sorted.length)} diagnostics; use an offset from 0 to ${String(sorted.length - 1)}`,
    )
  }
  const messageLength = sorted[skip]?.message.length ?? 1
  if (
    messageOffset !== 0 &&
    (messageOffset < 0 || messageOffset >= messageLength || !Number.isSafeInteger(messageOffset))
  )
    throw new RangeError('messageOffset is past the diagnostic message')
  const shown = sorted
    .slice(skip, skip + max)
    .map((entry, index) =>
      formatEntry(
        entry,
        index === 0 ? messageOffset : 0,
        messagePage === undefined ? undefined : (next) => messagePage(skip + index, next),
      ),
    )
  const rest = sorted.length - skip - shown.length
  if (rest > 0) {
    shown.push(
      nextPage === undefined
        ? `… ${String(rest)} more not shown`
        : `[diagnostics ${String(skip + 1)}-${String(skip + shown.length)} of ${String(sorted.length)}; ${nextPage}]`,
    )
  }
  return shown.join('\n')
}

/** `offset` as a page start: a number floors at zero, anything else starts over. */
function readOffset(args: Readonly<Record<string, unknown>>): number {
  const offset = args['offset']
  return typeof offset === 'number' ? Math.max(Math.floor(offset), 0) : 0
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
      "Language-server diagnostics: the errors and warnings in VS Code's Problems panel for the files in the workspace, worst first. Optionally scoped to one file, which is then shown in an editor so its language server reports on it. Long lists are pages: the note names the offset that fetches the rest.",
    inputSchema: {
      type: 'object',
      properties: {
        [URI_ARGUMENT]: {
          type: 'string',
          description: 'A file:// URI or workspace-relative path; omit for the whole workspace.',
        },
        offset: {
          type: 'integer',
          description: 'Skip this many diagnostics before returning entries.',
        },
        messageOffset: {
          type: 'integer',
          description:
            'Characters to skip in the first diagnostic message; its clip note gives the next offset.',
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
      const offset = readOffset(args)
      const messageOffset = typeof args['messageOffset'] === 'number' ? args['messageOffset'] : 0
      // B6 (limits-output): every page names the offset that fetches the rest.
      const page = (list: readonly WorkspaceDiagnostic[]): string => {
        const next = offset + Math.min(DIAGNOSTICS_MAX_ENTRIES, Math.max(list.length - offset, 0))
        return formatDiagnostics(
          list,
          DIAGNOSTICS_MAX_ENTRIES,
          offset,
          `call ${IDE_MCP_TOOL_DIAGNOSTICS} again with offset ${String(next)}${typeof uri === 'string' ? ` and uri ${JSON.stringify(uri)}` : ''} for the rest`,
          messageOffset,
          (entryOffset, nextMessageOffset) =>
            `call ${IDE_MCP_TOOL_DIAGNOSTICS} with offset ${String(entryOffset)} and messageOffset ${String(nextMessageOffset)}${typeof uri === 'string' ? ` and uri ${JSON.stringify(uri)}` : ''} for the rest`,
        )
      }
      const inWorkspace = () => deps.getDiagnostics().filter((entry) => isInWorkspace(entry))
      if (typeof uri !== 'string' || uri === '') {
        return page(inWorkspace())
      }
      const request = requestedPath(uri, deps)
      if (!request.ok) {
        throw new Error(request.reason)
      }
      const read = await deps.settleFile?.(request.fsPath, signal)
      if (read !== undefined) {
        return page(read.map((entry) => ({ ...entry, path: request.path })))
      }
      const wanted = pathKey(request.path, platform)
      const found = inWorkspace().filter((entry) => pathKey(entry.path, platform) === wanted)
      // A file its server never reported on is not checked, never clean (M68).
      return deps.settleFile !== undefined && found.length === 0
        ? fill(MODEL_TEXT.diagnosticsNotSettled, { path: request.path })
        : page(found)
    },
  }
}
