// The window's flight recorder as the extension uses it (M93, PLAN.md D72):
// ReportJournal (one journal and one activation marker per window) behind
// the few ways in that observe failures. It is in the activation bundle on
// purpose: it records from the first moment, without waiting for the report
// dialog's bundle. Every way in records facts only (a fixed kind, a known
// code, frames inside the shipped package) and is total: nothing here throws
// into the extension or delays what it observes.
//
// A window records at most REPORT_RECORD_LIMIT failures a minute, so a
// render or reconnect loop cannot become a disk write per frame. Each
// recorded failure gets a sanitized reference (its kind and this window's
// recording sequence): what a transcript row's "Report this" hands over,
// never the row's text.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportEventsOf } from '../../core/support/journalEvents'
import {
  REPORT_PACKAGE_FRAME_PATHS,
  REPORT_RECORD_LIMIT,
  REPORT_RECORD_WINDOW_MS,
  type ReportEventKind,
} from '../../shared/constants'
import type { BackendKind, ReportEventRef, ReportWebviewError } from '../../shared/protocol'
import { packageFramesOf, reportCodeOf, stackOf, type PackageFrame } from '../../shared/stackFrames'
import type { ReportJournalSource } from '../conversation/reportProblemHandler'
import type { ReportJournal } from './reportJournal'

const FILE_URL_PREFIX = 'file://'

/**
 * A host stack frame's file as the package names it: a file under the
 * installed extension's root, one of REPORT_PACKAGE_FRAME_PATHS, with `/`
 * separators. Anything else (Node's own frames, other extensions, the user's
 * files) is undefined and dropped.
 */
export function hostPackagePath(location: string, extensionRoot: string): string | undefined {
  let file = location
  if (file.startsWith(FILE_URL_PREFIX)) {
    try {
      file = fileURLToPath(file)
    } catch {
      return undefined
    }
  }
  if (!path.isAbsolute(file)) {
    return undefined
  }
  const relative = path.relative(extensionRoot, file)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }
  const packaged = relative.split(path.sep).join('/')
  return REPORT_PACKAGE_FRAME_PATHS.has(packaged) ? packaged : undefined
}

/** A failure's frames inside the installed extension, most recent first. */
export function hostFramesOf(error: unknown, extensionRoot: string): readonly PackageFrame[] {
  return packageFramesOf(stackOf(error), (location) => hostPackagePath(location, extensionRoot))
}

export interface ReportRecorderOptions {
  readonly journal: ReportJournal
  /** The installed extension's folder (`ExtensionContext.extensionPath`). */
  readonly extensionRoot: string
  readonly now: () => number
}

/** One window's flight recorder: the journal behind facts-only, rate-limited ways in. */
export class ReportRecorder {
  private sequence = 0
  private recent: readonly number[] = []

  public constructor(private readonly options: ReportRecorderOptions) {}

  /** Whether another failure fits this minute's budget; counts it when it does. */
  private admit(): boolean {
    const at = this.options.now()
    this.recent = this.recent.filter((recorded) => at - recorded < REPORT_RECORD_WINDOW_MS)
    if (this.recent.length >= REPORT_RECORD_LIMIT) {
      return false
    }
    this.recent = [...this.recent, at]
    return true
  }

  /** Sets this activation's marker and prunes; true when a crash should be offered. */
  public async startup(): Promise<boolean> {
    const { offerReport } = await this.options.journal.startup()
    return offerReport
  }

  /** Clears only this activation's marker (deactivate). */
  public async shutdown(): Promise<void> {
    await this.options.journal.shutdown()
  }

  /**
   * Records one failure as facts and answers its sanitized reference, or
   * undefined when this minute's budget is spent (nothing is written then).
   * The journal scrubs and validates again before anything reaches the disk.
   */
  public record(
    kind: ReportEventKind,
    code: string,
    detail: { readonly backend?: BackendKind; readonly frames?: readonly PackageFrame[] } = {},
  ): ReportEventRef | undefined {
    if (!this.admit()) {
      return undefined
    }
    void this.options.journal.record({
      kind,
      code,
      ...(detail.backend !== undefined && { backend: detail.backend }),
      ...(detail.frames !== undefined && { frames: detail.frames }),
    })
    const ref: ReportEventRef = { kind, entryIndex: this.sequence }
    this.sequence += 1
    return ref
  }

  /** Records a thrown failure by its class and its frames inside the package. */
  public recordError(
    kind: ReportEventKind,
    error: unknown,
    backend?: BackendKind,
  ): ReportEventRef | undefined {
    return this.record(kind, reportCodeOf(error), {
      frames: hostFramesOf(error, this.options.extensionRoot),
      ...(backend !== undefined && { backend }),
    })
  }

  /** Records the webview's own scrubbed failure (its frames are checked again by the journal). */
  public recordWebviewError(error: ReportWebviewError): void {
    this.record(error.kind, error.code, { frames: error.frames })
  }

  /** The retained records as the report dialog reads them, at `nowMs`. */
  public async readJournal(): Promise<ReportJournalSource> {
    const merged = await this.options.journal.readMerged()
    return {
      entries: reportEventsOf(merged.entries, this.options.now()),
      recordingUnavailable: !this.options.journal.isAvailable,
    }
  }
}
