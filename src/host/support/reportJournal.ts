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

import { randomUUID } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import path from 'node:path'
import {
  buildFlightRecord,
  buildMarkerText,
  isStaleMarker,
  isTempName,
  tempOwnerPid,
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
  REPORT_ERROR_CODES,
  REPORT_JOURNAL_MAX_BYTES,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_STORAGE_DIR,
  REPORT_STORAGE_FILE_MODE,
  REPORT_STORAGE_LINK_COUNT,
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

/** Reject redirects and unexpected storage types before opening or mutating bytes. */
async function assertStorageDirectory(dir: string): Promise<void> {
  const root = path.dirname(dir)
  const rootInfo = await lstat(root)
  const info = await lstat(dir)
  if (
    path.basename(dir) !== REPORT_STORAGE_DIR ||
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(dir)) !== path.join(await realpath(root), REPORT_STORAGE_DIR)
  )
    throw Object.assign(new Error('Unconfined report storage'), { code: 'EACCES' })
}

async function assertStorageFile(file: string): Promise<void> {
  await assertStorageDirectory(path.dirname(file))
  const name = path.basename(file)
  if (
    parseJournalName(name) === undefined &&
    parseMarkerName(name) === undefined &&
    !isTempName(name)
  ) {
    throw Object.assign(new Error('Unexpected report file'), { code: 'EACCES' })
  }
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw Object.assign(new Error('Redirected report file'), { code: 'EACCES' })
    }
  } catch (error: unknown) {
    if (!isMissingPath(error)) throw error
  }
}

/** One identity/type check shared by native reads, appends and staging. */
async function checkedStorageHandle(file: string, handle: FileHandle): Promise<BigIntStats> {
  const info = await handleIdentity(handle)
  if (
    !info.isFile() ||
    info.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT) ||
    !sameFile(info, await lstatIdentity(file))
  )
    throw new Error('Report file changed')
  await assertStorageDirectory(path.dirname(file))
  return info
}

/** Native storage refuses links, opens without following a leaf, and stages exclusively. */
export const nodeReportJournalFs: ReportJournalFs = {
  async mkdir(dir): Promise<void> {
    if (path.basename(dir) !== REPORT_STORAGE_DIR) throw new Error('Unexpected report directory')
    await mkdir(path.dirname(dir), { recursive: true })
    try {
      await mkdir(dir)
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error
    }
    await assertStorageDirectory(dir)
  },
  async readDir(dir): Promise<readonly ReportDirEntry[]> {
    await assertStorageDirectory(dir)
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }))
  },
  async readFile(file): Promise<string> {
    await assertStorageFile(file)
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const info = await checkedStorageHandle(file, handle)
      // Read at most one cap from the tail. Drop a cut first line rather than
      // materializing an unbounded corrupt file; complete newest records survive.
      const size = Number(info.size)
      const readCap = REPORT_JOURNAL_MAX_BYTES - 2
      const start = Math.max(0, size - readCap)
      const bytes = Buffer.alloc(Math.min(size, readCap))
      let read = 0
      while (read < bytes.length) {
        const result = await handle.read(bytes, read, bytes.length - read, start + read)
        if (result.bytesRead === 0) break
        read += result.bytesRead
      }
      const held = bytes.subarray(0, read)
      const cut = start === 0 ? -1 : held.indexOf('\n')
      const text = cut === -1 && start > 0 ? '' : held.subarray(cut + 1).toString('utf8')
      // A fixed invalid line makes pruning repair the physical oversized file.
      return start > 0 ? `0\n${text}` : text
    } finally {
      await handle.close()
    }
  },
  async appendFile(file, data): Promise<void> {
    await assertStorageFile(file)
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      REPORT_STORAGE_FILE_MODE,
    )
    try {
      await checkedStorageHandle(file, handle)
      await handle.writeFile(data, 'utf8')
    } finally {
      await handle.close()
    }
  },
  async writeTempAndRename(file, data): Promise<void> {
    await assertStorageFile(file)
    const stage = `${file}.tmp-${String(process.pid)}-${randomUUID()}`
    const handle = await open(stage, 'wx', REPORT_STORAGE_FILE_MODE)
    let identity: BigIntStats
    try {
      identity = await checkedStorageHandle(stage, handle)
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await assertStorageFile(file)
    if (!sameFile(identity, await lstatIdentity(stage))) throw new Error('Report stage changed')
    await rename(stage, file)
  },
  async remove(file): Promise<void> {
    await assertStorageFile(file)
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
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return REPORT_ERROR_CODES.has(error.code) ? ` (${error.code})` : ''
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
  private stopped = false

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

  private disable(error: unknown): void {
    this.disabled = true
    if (this.warned) {
      return
    }

    this.warned = true
    this.log.warn(`Flight recorder storage failed${errorCodeForLog(error)}; event recording is off`)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    // The async body captures the preceding tail before the next one is assigned.
    const run = (async () => {
      await this.tail
      return await work()
    })()
    this.tail = (async () => {
      try {
        await run
      } catch {
        // The calling method reports failure. Keep later cleanup in the queue.
      }
    })()
    return run
  }

  /** A peer can write only while its activation marker exists. Never mutate a live peer. */
  private async mayPrune(file: string): Promise<boolean> {
    if (file === this.ownJournal) return true
    const instance = parseJournalName(path.basename(file))
    if (instance === undefined) return false
    const name = markerNameFor(instance)
    if (name === undefined) return false
    try {
      const marker = parseMarkerText(name, await this.store.readFile(path.join(this.dir, name)))
      // An unreadable or malformed ownership record cannot authorize a rewrite.
      return marker !== undefined && !this.isAlive(marker.pid)
    } catch (error: unknown) {
      if (isMissingPath(error)) return true
      throw error
    }
  }

  /** Repair malformed/torn bytes and expire entries in our own or a closed journal. */
  private async pruneFile(
    file: string,
    now: number,
  ): Promise<{ readonly entries: readonly FlightRecord[]; readonly skipped: number }> {
    let text: string
    try {
      text = await this.store.readFile(file)
    } catch (error: unknown) {
      if (isMissingPath(error)) return { entries: [], skipped: 0 }
      throw error
    }
    const parsed = parseJournalText(text)
    const entries = pruneFlightEntries(parsed.entries, now)
    const clean = entries.map((entry) => serializeFlightRecord(entry)).join('')
    // Zero valid entries also removes an empty or over-cap invalid-only file.
    if ((clean !== text || entries.length === 0) && (await this.mayPrune(file))) {
      if (entries.length === 0) await this.store.remove(file)
      else await this.store.writeTempAndRename(file, clean)
    }
    return { entries, skipped: parsed.skipped + (parsed.torn ? 1 : 0) }
  }

  /**
   * Prune every journal at startup, sweep crash-left stages, set this
   * activation's marker, and consume stale markers. Returns whether the next
   * start should offer a crash report: true only when a consumed marker
   * belonged to an instance whose process is gone. Dismissal is remembered
   * because the marker is consumed; a new abnormal exit leaves a new one.
   */
  /** False after a storage failure: callers can disclose unavailable evidence. */
  public get isAvailable(): boolean {
    return !this.disabled
  }

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
      let entries: readonly ReportDirEntry[]
      try {
        entries = await this.store.readDir(this.dir)
      } catch (error: unknown) {
        this.disable(error)
        return { offerReport: false }
      }
      const now = this.clock()
      let isOfferReport = false
      const sorted = entries.toSorted((left, right) => left.name.localeCompare(right.name))
      for (const entry of sorted) {
        if (!entry.isFile || entry.isSymbolicLink) continue
        const name = entry.name
        const file = path.join(this.dir, name)
        try {
          if (isTempName(name)) {
            const owner = tempOwnerPid(name)
            if (owner !== undefined && !this.isAlive(owner)) await this.store.remove(file)
          } else if (parseJournalName(name) !== undefined) {
            await this.pruneFile(file, now)
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
              isOfferReport = true
            } catch (error: unknown) {
              if (!isMissingPath(error)) this.disable(error)
              // A marker a peer just consumed races as missing: consumed
              // elsewhere, so no offer from here. Anything else stays for
              // the next start rather than producing an offer from garbage.
              continue
            }
          }
        } catch (error: unknown) {
          if (!isMissingPath(error)) this.disable(error)
        }
      }
      return { offerReport: isOfferReport }
    })
  }

  /**
   * Record one failure as it happens, without relying on deactivate. Refused
   * records (untrusted versions, oversize entries) never reach the file, and
   * a dead store disables recording with one warning instead of throwing.
   */
  public async record(input: ReportEventInput): Promise<void> {
    try {
      await this.enqueue(async () => {
        if (this.disabled || this.stopped) return
        const built = buildFlightRecord({ ...input, ext: this.ext, host: this.host }, this.clock())
        if (!built.ok) return
        const line = serializeFlightRecord(built.record)
        try {
          // Recover a torn tail before appending; otherwise it swallows the new event.
          await this.pruneFile(this.ownJournal, this.clock())
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
        try {
          await this.pruneFile(this.ownJournal, this.clock())
        } catch (error: unknown) {
          if (!isMissingPath(error)) this.disable(error)
        }
      })
    } catch (error: unknown) {
      this.disable(error)
    }
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
        .filter(
          (entry) =>
            entry.isFile && !entry.isSymbolicLink && parseJournalName(entry.name) !== undefined,
        )
        .map((entry) => entry.name)
        .toSorted((left, right) => left.localeCompare(right))
      const now = this.clock()
      const merged: {
        readonly record: FlightRecord
        readonly name: string
        readonly index: number
      }[] = []
      let skipped = 0
      for (const name of names) {
        const file = path.join(this.dir, name)
        try {
          const parsed = await this.pruneFile(file, now)
          skipped += parsed.skipped
          for (const [index, record] of parsed.entries.entries())
            merged.push({ record, name, index })
        } catch (error: unknown) {
          if (!isMissingPath(error)) {
            this.disable(error)
            return empty
          }
        }
      }
      const sorted = merged.toSorted((left, right) => {
        if (left.record.at !== right.record.at) return left.record.at - right.record.at
        if (left.name !== right.name) return left.name < right.name ? -1 : 1
        return left.index - right.index
      })
      const records = pruneFlightEntries(
        sorted.map((held) => held.record),
        now,
      )
      return {
        entries: records.slice(Math.max(0, records.length - Math.max(0, Math.floor(limit)))),
        total: records.length,
        skipped,
      }
    })
  }

  /** Clear only this activation's marker on deactivate. Never throws. */
  public async shutdown(): Promise<void> {
    try {
      await this.enqueue(async () => {
        this.stopped = true
        try {
          await this.store.remove(this.ownMarker)
        } catch (error: unknown) {
          if (!isMissingPath(error)) this.disable(error)
        }
      })
    } catch (error: unknown) {
      this.disable(error)
    }
  }
}
