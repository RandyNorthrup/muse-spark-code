// The edited files' errors and warnings after a round of edits (M68, PLAN.md
// D49): each file's counts, with what changed since the previous check of
// that file, then the entries themselves, worst first and capped. A
// diagnostic is matched across rounds by its severity, source and message,
// never its line, since an edit moves lines. Information and hints are left
// out: they are not what an edit breaks.
//
// A file whose diagnostics were not read (no report arrived, it could not be
// shown, …) is "not checked" with the reason, never "no errors" (the M68
// review), and leaves its history alone. The history moves only when the
// caller commits the report, once the model has it. Pure.

import {
  MODEL_TEXT,
  TOOL_OUTPUT_CLIP_MARKER,
  type UncheckedReason,
  VERIFY_DIAGNOSTICS_MAX_ENTRIES,
  VERIFY_SHOWN_FILES_MAX,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type DiagnosticEntry, formatDiagnostics, type WorkspaceDiagnostic } from '../diagnostics'

/**
 * A file an edit tool wrote, as confinement found it at the edit (links and
 * junctions resolved), so nothing done to it later follows a link retargeted
 * since (the Codex review of PR #54).
 */
export interface EditedFile {
  /** Workspace-relative, forward slashes, links resolved (the canonical name). */
  readonly relative: string
  /** Its real path at the edit. */
  readonly absolute: string
  /** SHA-256 of what the edit left (after format on edit); absent for a file an edit did not write. */
  readonly fingerprint?: string
}

/** What the language servers hold for one edited file once they settled. */
export interface FileDiagnostics {
  readonly file: EditedFile
  readonly entries: readonly DiagnosticEntry[]
  /** Set when the entries were not read; they are then empty and mean nothing. */
  readonly unchecked?: UncheckedReason
}

export interface DiagnosticsReport {
  /** For the model and the row's body. */
  readonly text: string
  /** Of the files read; absent when none could be read. */
  readonly errors?: number
  readonly warnings?: number
  /** The files not read. */
  readonly unchecked?: number
}

export interface ReportOptions {
  /** The report's share of the note's budget, in characters. */
  readonly maxChars: number
  /** The code-loading file the turn wrote, for the `codeLoading` reason. */
  readonly codeFile?: string
}

const KEY_SEPARATOR = '\u{0}'
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/

function isReported(entry: DiagnosticEntry): boolean {
  return entry.severity === 'error' || entry.severity === 'warning'
}

function keyOf(entry: DiagnosticEntry): string {
  return [entry.severity, entry.source ?? '', entry.message].join(KEY_SEPARATOR)
}

function counted(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** How many entries are new, and how many of the previous ones are gone. */
function changes(
  previous: readonly string[],
  current: readonly string[],
): { readonly added: number; readonly fixed: number } {
  const before = counted(previous)
  const after = counted(current)
  let added = 0
  let fixed = 0
  for (const [key, count] of after) {
    added += Math.max(count - (before.get(key) ?? 0), 0)
  }
  for (const [key, count] of before) {
    fixed += Math.max(count - (after.get(key) ?? 0), 0)
  }
  return { added, fixed }
}

/** At most `max` characters, the cut marked, never splitting a surrogate pair. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  let kept = text.slice(0, Math.max(max - TOOL_OUTPUT_CLIP_MARKER.length, 0))
  if (HIGH_SURROGATE.test(kept)) {
    kept = kept.slice(0, -1)
  }
  return `${kept}${TOOL_OUTPUT_CLIP_MARKER}`
}

function uncheckedReason(reason: UncheckedReason, codeFile: string | undefined): string {
  switch (reason) {
    case 'noReport': {
      return MODEL_TEXT.verifyUncheckedNoReport
    }
    case 'notShown': {
      return MODEL_TEXT.verifyUncheckedNotShown
    }
    case 'unsaved': {
      return MODEL_TEXT.verifyUncheckedUnsaved
    }
    case 'codeLoading': {
      return fill(MODEL_TEXT.verifyUncheckedCodeLoading, { file: codeFile ?? '' })
    }
    case 'tooMany': {
      return fill(MODEL_TEXT.verifyUncheckedTooMany, { count: String(VERIFY_SHOWN_FILES_MAX) })
    }
    case 'stopped': {
      return MODEL_TEXT.verifyUncheckedStopped
    }
    case 'changed': {
      return MODEL_TEXT.verifyUncheckedChanged
    }
  }
}

/** A report, and what makes its reads the baseline of the next one. */
export interface PendingReport {
  readonly report: DiagnosticsReport
  /** Called once the model has the report (its note is in the conversation). */
  readonly commit: () => void
}

/** The previous check of each file a session edited, to say what changed. */
export class DiagnosticsHistory {
  private readonly previous = new Map<string, readonly string[]>()

  public report(files: readonly FileDiagnostics[], options: ReportOptions): PendingReport {
    const lines: string[] = [MODEL_TEXT.verifyDiagnosticsHeading]
    const listed: WorkspaceDiagnostic[] = []
    const reads = new Map<string, readonly string[]>()
    let errors = 0
    let warnings = 0
    let unchecked = 0
    for (const { file, entries, unchecked: reason } of files) {
      if (reason !== undefined) {
        unchecked += 1
        lines.push(
          fill(MODEL_TEXT.verifyFileUnchecked, {
            path: file.relative,
            reason: uncheckedReason(reason, options.codeFile),
          }),
        )
        continue
      }
      const reported = entries.filter((entry) => isReported(entry))
      const fileErrors = reported.filter((entry) => entry.severity === 'error').length
      errors += fileErrors
      warnings += reported.length - fileErrors
      const keys = reported.map((entry) => keyOf(entry))
      const before = this.previous.get(file.relative)
      reads.set(file.relative, keys)
      const summary =
        reported.length === 0
          ? fill(MODEL_TEXT.verifyFileClean, { path: file.relative })
          : fill(MODEL_TEXT.verifyFileCounts, {
              path: file.relative,
              errors: String(fileErrors),
              warnings: String(reported.length - fileErrors),
            })
      const delta = before === undefined ? undefined : changes(before, keys)
      lines.push(
        delta === undefined || (delta.added === 0 && delta.fixed === 0)
          ? summary
          : `${summary} ${fill(MODEL_TEXT.verifyFileChanges, {
              added: String(delta.added),
              fixed: String(delta.fixed),
            })}`,
      )
      listed.push(...reported.map((entry) => ({ ...entry, path: file.relative })))
    }
    if (listed.length > 0) {
      lines.push(formatDiagnostics(listed, VERIFY_DIAGNOSTICS_MAX_ENTRIES))
    }
    const isAnyRead = reads.size > 0
    return {
      report: {
        text: clipText(lines.join('\n'), options.maxChars),
        ...(isAnyRead && { errors, warnings }),
        ...(unchecked > 0 && { unchecked }),
      },
      commit: () => {
        for (const [path, keys] of reads) {
          this.previous.set(path, keys)
        }
      },
    }
  }
}
