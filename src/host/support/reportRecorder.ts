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
// recording sequence): what a transcript row's "Report This" hands over,
// never the row's text.

import {
  REPORT_RECORD_LIMIT,
  REPORT_RECORD_WINDOW_MS,
  type ReportEventKind,
} from '../../shared/constants'
import type { FastPathAudit } from '../../shared/fastPathAudit'
import type { BackendKind, ReportEventRef, ReportWebviewError } from '../../shared/protocol'
import type { PackageFrame } from '../../shared/stackFrames'
import type { ReportJournalSource } from '../conversation/reportProblemHandler'
import { withReportTimeout } from './reportTimeout'

/** One failure on its way to the journal: facts, or a thrown error the journal reads for its class and frames. */
export type PendingRecord =
  | {
      readonly kind: ReportEventKind
      readonly code: string
      readonly backend?: BackendKind
      readonly frames?: readonly PackageFrame[]
      readonly count?: number
      readonly audit?: FastPathAudit
    }
  | { readonly kind: ReportEventKind; readonly error: unknown; readonly backend?: BackendKind }

/** What dist/recorder.js gives: the window's journal (createWindowJournal). */
export interface WindowJournal {
  /** Sets this activation's marker and prunes; true when a crash should be offered. */
  startup(): Promise<boolean>
  /** Clears this activation's marker at once when the editor asks it to stop. */
  clearMarker(): Promise<void>
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
  private recentAudits: readonly number[] = []
  private journal: Promise<WindowJournal | undefined> | undefined
  /** Writes queued but not yet landed: "Report This" waits for these, bounded. */
  private readonly pending = new Set<Promise<unknown>>()
  /**
  Failures the minute's budget dropped (lane REPORTFLOW R2): counted in
  the draft beside what the builder left out. Cumulative since activation.
  */
  private rateLimited = 0

  public constructor(private readonly options: ReportRecorderOptions) {}

  /** Whether another failure fits this minute's budget; counts it when it does. */
  private admit(): boolean {
    const at = this.options.now()
    this.recent = this.recent.filter((recorded) => at - recorded < REPORT_RECORD_WINDOW_MS)
    if (this.recent.length >= REPORT_RECORD_LIMIT) {
      this.rateLimited += 1
      return false
    }
    this.recent = [...this.recent, at]
    return true
  }

  /**
  Whether another audit fits its own minute's budget; counts it when it
  does. Audits (routine fast-path allows) spend a separate bucket from
  failures at the same cap, so a skip flood neither starves a failure
  nor becomes a disk write per frame.
  */
  private admitAudit(): boolean {
    const at = this.options.now()
    this.recentAudits = this.recentAudits.filter(
      (recorded) => at - recorded < REPORT_RECORD_WINDOW_MS,
    )
    if (this.recentAudits.length >= REPORT_RECORD_LIMIT) {
      return false
    }
    this.recentAudits = [...this.recentAudits, at]
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
    const write = (async (): Promise<unknown> => {
      const journal = await this.open()
      return await journal?.record(input)
    })()
    this.pending.add(write)
    // The journal owns a failed write (it disables itself and says so); the
    // pending set only forgets a settled one, and a write that rejects
    // anyway reaches the process's unhandled-rejection record, as before.
    void write.finally(() => {
      this.pending.delete(write)
    })
    const ref: ReportEventRef = { kind: input.kind, entryIndex: this.sequence }
    this.sequence += 1
    return ref
  }

  /**
  Waits for queued writes to land, up to `timeoutMs` (lane REPORTFLOW R2):
  the reported event is in the journal before the draft is built. Past
  the bound it rejects and the draft builds from whatever the journal
  holds; a settled queue resolves at once.
  */
  public async flushWrites(timeoutMs: number): Promise<void> {
    const queued = [...this.pending]
    if (queued.length === 0) {
      return
    }
    await withReportTimeout(settlePromises(queued), timeoutMs)
  }

  /** Loads the journal, sets this activation's marker and prunes; true when a crash should be offered. */
  public async start(): Promise<boolean> {
    const journal = await this.open()
    return (await journal?.startup()) ?? false
  }

  /** The editor asked for this stop: the marker goes first, if the journal ever loaded. */
  public async markOrderlyStop(): Promise<void> {
    const journal = await this.journal
    await journal?.clearMarker()
  }

  /** Clears this activation's marker, if the journal ever loaded (deactivate). */
  public async shutdown(): Promise<void> {
    const journal = await this.journal
    await journal?.shutdown()
  }

  /**
  Records one failure as facts and answers its sanitized reference, or
  undefined when this minute's budget is spent (nothing is written then).
  The journal scrubs and validates again before anything reaches the disk.
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

  /**
  Records a fast-path allow's audit facts (M125, D107 §9.6): the fixed
  audit kind and code with the excluded count, from the audit's own
  minute budget. The journal scrubs and validates again before
  anything reaches the disk.
  */
  public recordAudit(audit: FastPathAudit): void {
    if (!this.admitAudit()) return
    void this.open().then((journal) =>
      journal?.record({
        kind: 'judgeFastSkip',
        code: 'fast-path-allow',
        count: audit.excluded,
        audit,
      }),
    )
  }

  /** Records the webview's own scrubbed failure (its frames are checked again by the journal). */
  public recordWebviewError(error: ReportWebviewError): void {
    this.send({ kind: error.kind, code: error.code, frames: error.frames })
  }

  /** The retained records as the report dialog reads them. */
  public async readJournal(): Promise<ReportJournalSource> {
    // The reason recording is unavailable is `unknown` until the capture
    // side provides its code (lane REPORTFLOW R2); the minute's budget
    // drops ride along for the draft's count.
    const drops = this.rateLimited > 0 ? { rateLimitedDrops: this.rateLimited } : {}
    const journal = await this.open()
    return journal === undefined
      ? { entries: [], recordingUnavailable: true, unavailableReason: 'unknown', ...drops }
      : { ...(await journal.readJournal()), ...drops }
  }
}

/** Everything queued settles, kept as one boundable wait (lane REPORTFLOW R2). */
async function settlePromises(queued: readonly Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(queued)
}
