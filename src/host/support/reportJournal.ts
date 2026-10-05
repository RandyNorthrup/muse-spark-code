// The flight recorder's journal and marker files (M93 lane R, PLAN.md D72):
// one journal file per window instance under
// ExtensionContext.globalStorageUri (never Settings Sync or workspace
// storage), one activation marker per window, and a reader that merges every
// window's journal. The policy — what a record may hold, write-time
// scrubbing, parsing, pruning and crash ownership — lives in the portable
// core module; this adapter only moves bytes. Storage failures (read-only,
// full disk, permission) make recording a no-op with one logged warning:
// nothing here throws into the extension, and the failure itself is never
// recorded back into the journal.

import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildFlightRecord,
  buildMarkerText,
  isStaleMarker,
  isTempName,
  journalNameFor,
  markerNameFor,
  parseJournalName,
  parseJournalText,
  parseMarkerName,
  parseMarkerText,
  pruneFlightEntries,
  serializeFlightRecord,
  type FlightEventInput,
  type FlightRecord,
} from '../../core/support/flightRecorder'
import {
  REPORT_JOURNAL_MAX_BYTES,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_STORAGE_DIR,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import type { Logger } from '../logger'

/** One directory entry: links and unexpected types never enter the journal. */
export interface ReportDirEntry {
  readonly name: string
  readonly isFile: boolean
  readonly isSymbolicLink: boolean
}

/** The file operations the journal needs, injectable for storage-failure tests. */
export interface ReportJournalFs {
  mkdir(dir: string): Promise<void>
  readDir(dir: string): Promise<readonly ReportDirEntry[]>
  readFile(file: string): Promise<string>
  appendFile(file: string, data: string): Promise<void>
  writeTempAndRename(file: string, data: string): Promise<void>
  remove(file: string): Promise<void>
}

/** The real file system: appends land in place, rewrites go through a crash-left-safe rename. */
export const nodeReportJournalFs: ReportJournalFs = {
  async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true })
  },
  async readDir(dir: string): Promise<readonly ReportDirEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }))
  },
  async readFile(file: string): Promise<string> {
    return await readFile(file, 'utf8')
  },
  async appendFile(file: string, data: string): Promise<void> {
    await appendFile(file, data)
  },
  async writeTempAndRename(file: string, data: string): Promise<void> {
    const stage = `${file}.tmp-${process.pid}`
    await writeFile(stage, data)
    await rename(stage, file)
  },
  async remove(file: string): Promise<void> {
    await unlink(file)
  },
}

export interface ReportJournalOptions {
  /** `ExtensionContext.globalStorageUri.fsPath`: the only root this touches. */
  readonly globalStorageDir: string
  /** This window's instance (`crypto.randomUUID()`): one journal and marker. */
  readonly instance: string
  /** The extension's own version, recorded with every event. */
  readonly ext: string
  /** The host's version, recorded with every event. */
  readonly host: string
  /** This extension host's process id, recorded in this window's marker. */
  readonly pid: number
  readonly log: Logger
  readonly now?: () => number
  /** Whether a process id is still running; a dead marker owner means a crash. */
  readonly isAlive: (pid: number) => boolean
  readonly fs?: ReportJournalFs
}

/** Every window's valid entries merged, newest last, with what was not trusted. */
export interface MergedJournal {
  readonly entries: readonly FlightRecord[]
  readonly total: number
  readonly skipped: number
}

/**
 * One failure to record: the kind, code, backend, count and frames. The
 * extension and host versions come from the adapter itself, so every record
 * a window writes carries that window's versions.
 */
export type ReportEventInput = Omit<FlightEventInput, 'ext' | 'host'>

/** An errno-shaped word for the log, or nothing: paths never reach the log. */
function errorCodeForLog(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return /^[A-Za-z0-9_.-]{1,16}$/.test(error.code) ? ` (${error.code})` : ''
  }
  return ''
}

/**
 * This window's flight recorder. All file work runs through one queue, so an
 * append never interleaves with a prune rewrite, and no window corrupts
 * another window's file: every window writes only its own journal and
 * marker. Every method is total: storage failures disable recording with one
 * warning instead of throwing.
 */
export class ReportJournal {
  private readonly dir: string
  private readonly ownJournal: string
  private readonly ownMarker: string
  private readonly store: ReportJournalFs
  private readonly clock: () => number
  private readonly ext: string
  private readonly host: string
  private readonly pid: number
  private readonly instance: string
  private readonly isAlive: (pid: number) => boolean
  private readonly log: Logger
  private tail: Promise<void> = Promise.resolve()
  private disabled = false
  private warned = false
  private ownBytes = 0

  public constructor(options: ReportJournalOptions) {
    const journal = journalNameFor(options.instance)
    const marker = markerNameFor(options.instance)
    if (journal === undefined || marker === undefined) {
      throw new Error('ReportJournal needs a file-safe window instance')
    }
    this.dir = path.join(options.globalStorageDir, REPORT_STORAGE_DIR)
    this.ownJournal = path.join(this.dir, journal)
    this.ownMarker = path.join(this.dir, marker)
    this.store = options.fs ?? nodeReportJournalFs
    this.clock = options.now ?? (() => Date.now())
    this.ext = options.ext
    this.host = options.host
    this.pid = options.pid
    this.instance = options.instance
    this.isAlive = options.isAlive
    this.log = options.log
  }

  /** False after a storage failure: recording is a no-op from then on. */
  public get isAvailable(): boolean {
    return !this.disabled
  }

  private disable(error: unknown): void {
    this.disabled = true
    if (!this.warned) {
      this.warned = true
      this.log.warn(`Flight recorder storage failed${errorCodeForLog(error)}; event recording is off`)
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Prune one journal file's entries, rewriting or deleting it when pruning changed anything. */
  private async pruneFile(file: string, now: number): Promise<readonly FlightRecord[]> {
    let text: string
    try {
      text = await this.store.readFile(file)
    } catch (error: unknown) {
      if (isMissingPath(error)) return []
      throw error
    }
    const parsed = parseJournalText(text)
    const pruned = pruneFlightEntries(parsed.entries, now)
    if (pruned.length !== parsed.entries.length) {
      if (pruned.length === 0) {
        await this.store.remove(file)
      } else {
        await this.store.writeTempAndRename(file, pruned.map(serializeFlightRecord).join(''))
      }
    }
    return pruned
  }

  /**
   * Prune every journal at startup, sweep crash-left stages, set this
   * activation's marker, and consume stale markers. Returns whether the next
   * start should offer a crash report: true only when a consumed marker
   * belonged to an instance whose process is gone. Dismissal is remembered
   * because the marker is consumed; a new abnormal exit leaves a new one.
   */
  public startup(): Promise<{ readonly offerReport: boolean }> {
    return this.enqueue(async () => {
      try {
        await this.store.mkdir(this.dir)
      } catch (error: unknown) {
        this.disable(error)
        return { offerReport: false }
      }
      const markerText = buildMarkerText(this.instance, this.pid, this.clock())
      if (markerText === undefined) {
        this.disable(undefined)
        return { offerReport: false }
      }
      try {
        await this.store.writeTempAndRename(this.ownMarker, markerText)
      } catch (error: unknown) {
        this.disable(error)
        return { offerReport: false }
      }
      let entries: readonly string[]
      try {
        entries = (await this.store.readDir(this.dir)).map((entry) => entry.name)
      } catch (error: unknown) {
        this.disable(error)
        return { offerReport: false }
      }
      const now = this.clock()
      let offerReport = false
      for (const name of [...entries].sort()) {
        const file = path.join(this.dir, name)
        try {
          if (isTempName(name)) {
            await this.store.remove(file)
          } else if (parseJournalName(name) !== undefined) {
            const pruned = await this.pruneFile(file, now)
            if (file === this.ownJournal) {
              this.ownBytes = pruned.map((entry) => Buffer.byteLength(serializeFlightRecord(entry), 'utf8')).reduce((a, b) => a + b, 0)
            }
          } else if (parseMarkerName(name) !== undefined) {
            if (file === this.ownMarker) continue
            try {
              const marker = parseMarkerText(name, await this.store.readFile(file))
              if (marker === undefined) {
                // Garbage under our name: consume it silently, never an offer.
                await this.store.remove(file)
                continue
              }
              // A live window's marker stays: only a consumed stale marker
              // produces an offer, so a second live window is never a crash.
              if (!isStaleMarker(marker, this.instance, this.isAlive)) continue
              await this.store.remove(file)
              offerReport = true
            } catch {
              // A marker a peer just consumed races as missing: consumed
              // elsewhere, so no offer from here. Anything else stays for
              // the next start rather than producing an offer from garbage.
              continue
            }
          }
        } catch {
          // One unreadable file never stops startup: it stays for the next
          // start (or its window), and recording continues. A dead store
          // shows itself on the next write instead.
          continue
        }
      }
      return { offerReport }
    })
  }

  /**
   * Record one failure as it happens, without relying on deactivate. Refused
   * records (untrusted versions, oversize entries) never reach the file, and
   * a dead store disables recording with one warning instead of throwing.
   */
  public record(input: ReportEventInput): Promise<void> {
    return this.enqueue(async () => {
      if (this.disabled) return
      const built = buildFlightRecord({ ...input, ext: this.ext, host: this.host }, this.clock())
      if (!built.ok) return
      const line = serializeFlightRecord(built.record)
      try {
        await this.store.appendFile(this.ownJournal, line)
      } catch (error: unknown) {
        if (isMissingPath(error)) {
          try {
            await this.store.mkdir(this.dir)
            await this.store.appendFile(this.ownJournal, line)
          } catch (retryError: unknown) {
            this.disable(retryError)
            return
          }
        } else {
          this.disable(error)
          return
        }
      }
      this.ownBytes += Buffer.byteLength(line, 'utf8')
      if (this.ownBytes > REPORT_JOURNAL_MAX_BYTES) {
        try {
          const pruned = await this.pruneFile(this.ownJournal, this.clock())
          this.ownBytes = pruned.map((entry) => Buffer.byteLength(serializeFlightRecord(entry), 'utf8')).reduce((a, b) => a + b, 0)
        } catch (error: unknown) {
          if (!isMissingPath(error)) this.disable(error)
          else this.ownBytes = 0
        }
      }
    }).then(
      () => undefined,
      (error: unknown) => {
        this.disable(error)
      },
    )
  }

  /**
   * Merge every window's journal, newest last, pruned to the retention caps:
   * report reads prune too, so a closed editor's files still expire on next
   * use. Truncated and tampered records are skipped and counted, never
   * trusted, and no window's file is corrupted by another's.
   */
  public readMerged(limit: number = REPORT_RECENT_EVENT_COUNT): Promise<MergedJournal> {
    return this.enqueue(async (): Promise<MergedJournal> => {
      const empty: MergedJournal = { entries: [], total: 0, skipped: 0 }
      if (this.disabled) return empty
      let dirEntries: readonly ReportDirEntry[]
      try {
        dirEntries = await this.store.readDir(this.dir)
      } catch (error: unknown) {
        this.disable(error)
        return empty
      }
      const names = dirEntries
        .filter((entry) => entry.isFile && !entry.isSymbolicLink && parseJournalName(entry.name) !== undefined)
        .map((entry) => entry.name)
        .sort()
      const now = this.clock()
      const merged: { readonly record: FlightRecord; readonly name: string; readonly index: number }[] = []
      let skipped = 0
      for (const name of names) {
        const file = path.join(this.dir, name)
        let text: string
        try {
          text = await this.store.readFile(file)
        } catch {
          continue
        }
        const parsed = parseJournalText(text)
        skipped += parsed.skipped + (parsed.torn ? 1 : 0)
        const pruned = pruneFlightEntries(parsed.entries, now)
        if (pruned.length !== parsed.entries.length) {
          try {
            if (pruned.length === 0) {
              await this.store.remove(file)
            } else {
              await this.store.writeTempAndRename(file, pruned.map(serializeFlightRecord).join(''))
            }
          } catch (error: unknown) {
            if (!isMissingPath(error)) {
              this.disable(error)
              return {
                entries: merged.map((held) => held.record),
                total: merged.length,
                skipped,
              }
            }
          }
        }
        for (const [index, record] of pruned.entries()) {
          merged.push({ record, name, index })
        }
      }
      merged.sort((left, right) => left.record.at - right.record.at || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) || left.index - right.index)
      const records = merged.map((held) => held.record)
      return {
        entries: records.slice(Math.max(0, records.length - Math.max(0, Math.floor(limit)))),
        total: records.length,
        skipped,
      }
    })
  }

  /** Clear only this activation's marker on deactivate. Never throws. */
  public shutdown(): Promise<void> {
    return this.enqueue(async () => {
      if (this.disabled) return
      try {
        await this.store.remove(this.ownMarker)
      } catch (error: unknown) {
        if (!isMissingPath(error)) this.disable(error)
      }
    }).then(
      () => undefined,
      (error: unknown) => {
        this.disable(error)
      },
    )
  }
}
