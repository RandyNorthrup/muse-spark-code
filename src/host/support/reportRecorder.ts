// The window's flight recorder as the activation bundle sees it (M93,
// PLAN.md D6, D72): a small front that answers every failure at once and
// hands it to the journal, which loads from dist/recorder.js just after
// activation (or at the first failure). Every way in records facts only (a
// fixed kind, a known code, frames inside the shipped package) and is total:
// nothing here throws into the extension or delays what it observes.
//
// A window records at most REPORT_RECORD_LIMIT failures a minute, so a
// render or reconnect loop cannot become a disk write per frame. Each
// recorded failure gets a sanitized reference (its kind and this window's
// recording sequence): what a transcript row's "Report this" hands over,
// never the row's text.

import {
  REPORT_RECORD_LIMIT,
  REPORT_RECORD_WINDOW_MS,
  type ReportEventKind,
} from '../../shared/constants'
import type { BackendKind, ReportEventRef, ReportWebviewError } from '../../shared/protocol'
import type { PackageFrame } from '../../shared/stackFrames'
import type { ReportJournalSource } from '../conversation/reportProblemHandler'

/** One failure on its way to the journal: facts, or a thrown error the journal reads for its class and frames. */
export type PendingRecord =
  | {
      readonly kind: ReportEventKind
      readonly code: string
      readonly backend?: BackendKind
      readonly frames?: readonly PackageFrame[]
    }
  | { readonly kind: ReportEventKind; readonly error: unknown; readonly backend?: BackendKind }

/** What dist/recorder.js gives: the window's journal (createWindowJournal). */
export interface WindowJournal {
  /** Sets this activation's marker and prunes; true when a crash should be offered. */
  startup(): Promise<boolean>
  /** Clears only this activation's marker (deactivate). */
  shutdown(): Promise<void>
  record(input: PendingRecord): Promise<void>
  readJournal(): Promise<ReportJournalSource>
}

export interface ReportRecorderOptions {
  /** Loads the journal (dist/recorder.js) the first time it is needed. */
  readonly load: () => Promise<WindowJournal>
  readonly now: () => number
  /** Says a journal that could not load, once; recording is then off. */
  readonly onUnavailable: (error: unknown) => void
}

/** One window's flight recorder: rate-limited, facts-only ways in to a journal loaded on demand. */
export class ReportRecorder {
  private sequence = 0
  private recent: readonly number[] = []
  private journal: Promise<WindowJournal | undefined> | undefined

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

  /** The journal, loaded once; undefined when it could not load (recording is off). */
  private open(): Promise<WindowJournal | undefined> {
    this.journal ??= this.loadOnce()
    return this.journal
  }

  private async loadOnce(): Promise<WindowJournal | undefined> {
    try {
      return await this.options.load()
    } catch (error: unknown) {
      this.options.onUnavailable(error)
      return undefined
    }
  }

  /** Hands one record to the journal; the answer is already given. */
  private send(input: PendingRecord): ReportEventRef | undefined {
    if (!this.admit()) {
      return undefined
    }
    void this.open().then((journal) => journal?.record(input))
    const ref: ReportEventRef = { kind: input.kind, entryIndex: this.sequence }
    this.sequence += 1
    return ref
  }

  /** Loads the journal, sets this activation's marker and prunes; true when a crash should be offered. */
  public async start(): Promise<boolean> {
    const journal = await this.open()
    return (await journal?.startup()) ?? false
  }

  /** Clears this activation's marker, if the journal ever loaded (deactivate). */
  public async shutdown(): Promise<void> {
    const journal = await this.journal
    await journal?.shutdown()
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
    return this.send({ kind, code, ...detail })
  }

  /** Records a thrown failure by its class and its frames inside the package. */
  public recordError(
    kind: ReportEventKind,
    error: unknown,
    backend?: BackendKind,
  ): ReportEventRef | undefined {
    return this.send({ kind, error, ...(backend !== undefined && { backend }) })
  }

  /** Records the webview's own scrubbed failure (its frames are checked again by the journal). */
  public recordWebviewError(error: ReportWebviewError): void {
    this.send({ kind: error.kind, code: error.code, frames: error.frames })
  }

  /** The retained records as the report dialog reads them. */
  public async readJournal(): Promise<ReportJournalSource> {
    const journal = await this.open()
    return journal === undefined
      ? { entries: [], recordingUnavailable: true }
      : await journal.readJournal()
  }
}
