// Turn checkpoints (M72, PLAN.md D51): a snapshot of the workspace's files
// at each turn's start and end, in a shadow repository in the extension's
// storage (shadowGit.ts), never in the workspace's `.git`.
//
// - A capture holds every file outside the ignore rules, untracked ones
//   included, byte for byte. A file over CHECKPOINT_FILE_MAX_BYTES, a link,
//   a folder reached through a link or junction (everything below it) and a
//   folder that is a repository of its own are left out and named. A
//   private index keeps the files' stat data, so a capture hashes only what
//   changed since the last one; a capture waiting for its turn is pinned by
//   a ref of its own until it is recorded or let go.
// - Ignored files are not copied wholesale: a bounded scan records their
//   size and time at each end of a turn (ignoredScan.ts), and a file the
//   extension itself is about to write (the Model API's tools, the image
//   tools) is copied first (`beforeToolWrite`). A restore deletes ignored
//   files the turn created, puts back the ones it copied first, and lists
//   the rest as not restorable.
// - A restore undoes the conversation's turns from the chosen one on, file
//   by file (restorePlan.ts). A file changed outside those turns (between
//   them, after them, by another conversation's overlapping turn), with
//   unsaved editor changes, or changed while the restore runs is refused and
//   listed. The redo record is saved before the first file changes and cut
//   to what was done at the end, so a restore that stops part way still
//   says what it changed and keeps its Redo. A partial redo keeps what it
//   could not do for another try.
// - Two windows on the same folder share the store with no lock. Each
//   record is its own ref, created only if absent and changed or deleted
//   only from the value it was read at (recordRefs.ts); each window has its
//   own index; prune spares objects younger than a grace period, so another
//   window's objects in flight survive. A turn (or a message about to start
//   one) is published as running in the window's presence file before it may
//   edit a file (windowPresence.ts), and stays published until its end is
//   recorded; a tool's copy of a file goes to the window's own staging
//   folder and is kept until the turn's end has it; an archive is a file of
//   its own, written before the archive returns (checkpointArchives.ts).
//   Within a window, one operation runs at a time.
// - No restore or redo runs while any turn runs, in this window or in
//   another live one.
// - Git trees hold no empty folder, so a capture before a turn also records
//   the folders it holds no file of: a restore removes only the folders the
//   turns made.

import type { Buffer } from 'node:buffer'
import type { BackendKind } from '../../core/agent/agentBackend'
import { turnKey } from '../../core/checkpoints/turnKey'
import { createHash } from 'node:crypto'
import { rmSync, type Stats } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  type BlobRef,
  parseBatchCheck,
  parseCatFileBatch,
  parseDiffTree,
  parseStatusListing,
  splitNul,
  type TreeChange,
} from '../../core/checkpoints/gitListings'
import {
  type Coverage,
  type Expectation,
  type FileStat,
  type IgnoredChange,
  planRestore,
  type Refusal,
  type RefusalReason,
  type RestoreStep,
} from '../../core/checkpoints/restorePlan'
import { isSamePath } from '../../core/paths'
import {
  CHECKPOINT_BLOB_BATCH_MAX_BYTES,
  CHECKPOINT_CAPTURE_MAX_BYTES,
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_FOLDERS_MAX,
  CHECKPOINT_FORGOTTEN_KEEP_MS,
  CHECKPOINT_GIT_TIMEOUT_MS,
  CHECKPOINT_HEARTBEAT_MS,
  CHECKPOINT_IGNORED_CHANGES_MAX,
  CHECKPOINT_MAX_FILES,
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_NATIVE_WINDOW,
  CHECKPOINT_ACTIVITY_PREFIX,
  CHECKPOINT_PRUNE_GRACE_MS,
  CHECKPOINT_PRUNE_INTERVAL_MS,
  CHECKPOINT_PUBLISH_RETRY_MS,
  CHECKPOINT_STALE_LOCK_MS,
  CHECKPOINT_STORAGE_MODE,
  GIT_MISSING_OBJECT,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { isGitExitError, isGitMissingError, type GitProcess } from '../git'
import type { Logger } from '../logger'
import {
  type ArchiveFile,
  isArchived,
  readArchives,
  removeArchive,
  writeArchive,
} from './checkpointArchives'
import {
  applyFileStep,
  type FileStep,
  linkedFolders,
  lstatOrUndefined,
  mapInBatches,
  repositoryTop,
  type RestoreTarget,
  type StepResult,
  userExclude,
} from './checkpointFiles'
import {
  type CheckpointRecord,
  type CheckpointRecords,
  parseRecord,
  type RestoreEntry,
  type RestoreRecord,
} from './checkpointRecords'
import { retainRecords } from './checkpointRetention'
import { type IgnoredInventory, ignoredChanges, regularFileStat, scanIgnored } from './ignoredScan'
import {
  deleteRecords,
  didWriteRef,
  type KeptObjects,
  type ListedRecord,
  listRecords,
  keepTree,
  refValue,
  writeRecord,
} from './recordRefs'
import {
  indexFileInstance,
  isInShadowRepository,
  isWithinFolder,
  ShadowGit,
  ShadowPathTooLongError,
  ShadowStorageInWorkspaceError,
  withoutGitVariables,
} from './shadowGit'
import { WindowPresence } from './windowPresence'

export { turnKey } from '../../core/checkpoints/turnKey'

/** A capture's result, before it is recorded against a turn. */
export interface Snapshot {
  readonly tree: string
  readonly coverage: Coverage
  readonly inventory: IgnoredInventory
  readonly createdAt: number
  /** The ref that keeps the capture from pruning until it is recorded or let go. */
  readonly pin: string | undefined
  /** The folders it holds no file of (a capture before a turn); undefined when unknown. */
  readonly folders: readonly string[] | undefined
}

/** Why no capture: the limits, no git, a path git cannot use, or a failure. */
export type CaptureRefusal = 'tooManyFiles' | 'tooLarge' | 'noGit' | 'pathTooLong' | 'failed'

export type CaptureResult =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly reason: CaptureRefusal; readonly detail: string }

/** What a failed step of a capture is called: no git, a path git cannot use, or a failure. */
function captureFailure(error: unknown): Extract<CaptureResult, { ok: false }> {
  if (error instanceof ShadowPathTooLongError) {
    return { ok: false, reason: 'pathTooLong', detail: error.message }
  }
  return {
    ok: false,
    reason: isGitMissingError(error) ? 'noGit' : 'failed',
    detail: failureForLog(error),
  }
}

/**
 * Why a restore or a redo did nothing: no checkpoint (any more); a turn is
 * running in the window, or in another window on the folder; the capture it
 * starts with was refused; the redo record is gone; checkpoints are not
 * available here.
 */
export type RestoreFailure =
  | 'noCheckpoint'
  | 'turnRunning'
  | 'turnElsewhere'
  | 'captureFailed'
  | 'redoGone'
  | 'unavailable'
  | 'backendUnsupported'
  | 'nativeUnsafe'

export type RestoreOutcome =
  | {
      readonly ok: true
      /** What a redo takes; undefined when nothing changed. */
      readonly restoreId: string | undefined
      readonly changed: readonly string[]
      readonly refused: readonly Refusal[]
      /** Restored paths a turn with no recorded end may not have changed itself. */
      readonly unsure: readonly string[]
      /** Some turn's ignored files were not fully tracked (a reload mid-turn, the scan's limit). */
      readonly isIgnoredIncomplete: boolean
      /** A redo: whether its record is spent (false: what it could not do can be tried again). */
      readonly isRedoSpent: boolean
    }
  | {
      readonly ok: false
      readonly reason: RestoreFailure
      readonly captureRefusal?: CaptureRefusal
      readonly detail?: string
    }

export interface RestoreRequest {
  /** Server-owned actual attached backend, read again after awaits; absent is unsafe. */
  readonly backend?: () => BackendKind | undefined
  readonly sessionId: string
  readonly turnId: string
  /** Files open with unsaved changes, absolute, asked again before each file changes. */
  readonly unsavedPaths: () => readonly string[]
}

export interface RedoRequest {
  readonly backend?: () => BackendKind | undefined
  readonly restoreId: string
  readonly unsavedPaths: () => readonly string[]
}

export interface CheckpointStoreDeps {
  readonly workspaceRoot: string
  /** The original first-folder spelling, only for conservative unsaved-editor matching. */
  readonly displayRoot?: string | undefined
  /** `<workspace storage>/checkpoints`: the shadow repository and its records. */
  readonly storageDir: string
  readonly platform: NodeJS.Platform
  readonly git: GitProcess
  /** The extension host's environment (PATH, HOME); `GIT_*` never reaches the shadow. */
  readonly env: NodeJS.ProcessEnv
  /** `museSpark.cleanupPeriodDays`: records older than this go; 0 keeps them by age. */
  readonly retentionDays: () => number
  readonly now: () => number
  readonly newId: () => string
  /** This extension host's process, and whether another window's still runs. */
  readonly pid: number
  readonly isProcessAlive: (pid: number) => boolean
  /** How often the window's presence is written again; CHECKPOINT_HEARTBEAT_MS unless a test shortens it. */
  readonly heartbeatMs?: number
  /** The longest path git takes: the platform's own unless a test lowers it to reach the limits. */
  readonly gitPathMax?: number
  /**
   * The folder that holds every window's checkpoint storage (the extension's
   * `checkpoints` folder): no tool writes below it. This store's own folder by default.
   */
  readonly storageRoot?: string
  readonly log: Logger
}

/** A copy of a file taken, with no lock, just before the extension wrote it. */
interface JournalEntry {
  readonly at: number
  /** The staged copy; null: there was no file; undefined: none taken (over the limit, a link). */
  readonly staged: string | null | undefined
  readonly isExecutable: boolean
  readonly stat: FileStat | null
}

/** A tool copy a turn took, with the file's state when the turn ended. */
interface TurnCopy {
  readonly entry: JournalEntry
  readonly endStat: FileStat | null
}

/**
 * A recorded turn of this window not yet ended: its record and start scan.
 * It stays until its end is recorded, so its tool copies stay too.
 */
interface OpenTurn {
  readonly id: string
  readonly createdAt: number
  readonly inventory: IgnoredInventory
}

/** A completed end capture whose ref write can be retried without recapturing later user edits. */
interface PendingEnd {
  readonly record: CheckpointRecord
  readonly kept: KeptObjects
  readonly previous: string
  readonly pin: string
  readonly copies: ReadonlyMap<string, TurnCopy>
}

/** The shadow repository and the workspace's place in its work tree, set up once. */
interface Opened {
  readonly shadow: ShadowGit
  readonly top: string
  readonly prefix: string
}

/**
 * One operation's view, read afresh: this workspace's records (archived
 * ones left out) and the tree each ref names, everything listed (for
 * cleanup), the archives, and each live window's running turns.
 */
interface Setup extends Opened {
  readonly records: CheckpointRecords
  readonly keeps: ReadonlyMap<string, string>
  readonly listed: readonly ListedRecord[]
  readonly archives: readonly ArchiveFile[]
  readonly live: ReadonlyMap<string, readonly string[]>
}

/** A step of a restore or a redo, with what it replaces (for the redo record). */
interface PlannedStep extends FileStep {
  readonly before: BlobRef | null
  readonly isIgnoreChecked: boolean
}

interface Applied {
  readonly entries: readonly RestoreEntry[]
  readonly refused: readonly Refusal[]
}

const SHADOW_HEAD = path.join('shadow.git', 'HEAD')
const REF_ROOT = 'refs/muse-spark/'
const PIN_REF_PREFIX = `${REF_ROOT}pin/`
// Each window's index keeps its copies from pruning under a ref of its own.
const WORK_REF_PREFIX = `${REF_ROOT}work/`
const RESTORE_REF = `${REF_ROOT}restore-active`
// Refs of earlier builds (a records file, one shared index, tool-copy refs).
const LEGACY_REF_PREFIXES = [`${REF_ROOT}keep/`, `${REF_ROOT}journal/`] as const
const LEGACY_INDEX_REF = `${REF_ROOT}index`
const LEGACY_FILES: ReadonlySet<string> = new Set([
  'records.json',
  'records.json.unreadable',
  'forgotten.json',
  'work.index',
])
const STAGING_DIR = 'staging'
const LOCK_SUFFIX = '.lock'
const IGNORE_FILE = '.gitignore'
const CURRENT_PATH_PREFIX = './'
const SEPARATOR = '/'
const NUL = '\0'
const LINE_FEED = '\n'
const SPACE = ' '
const EXECUTABLE_BITS = 0o111
// `git config --get` and `git check-ignore` exit 1 for "none".
const NONE_EXIT = 1
// Where git looks for the global excludes file when core.excludesFile is unset.
const DEFAULT_EXCLUDES = path.join('git', 'ignore')
const CONFIG_HOME = '.config'
const DISPOSED = 'the checkpoint store was closed with the window'

/** A coverage as the records keep it (plain arrays). */
function storedCoverage(coverage: Coverage): { skipped: string[]; repositories: string[] } {
  return { skipped: [...coverage.skipped], repositories: [...coverage.repositories] }
}

function nulInput(values: readonly string[]): string {
  return values.map((value) => `${value}${NUL}`).join('')
}

function byText(left: string, right: string): number {
  return left.localeCompare(right)
}

/** A turn of a conversation, with where its start and end fall among the conversation's turns. */
interface TurnSpan {
  readonly record: CheckpointRecord
  readonly start: number
  /** Undefined: its end was not seen. */
  readonly end: number | undefined
  /** Numbered (`sequence`), or a 0.10.0 candidate's record, which only its clock places. */
  readonly isNumbered: boolean
}

/**
 * A conversation's turns in the order they started. A 0.10.0 candidate's
 * records have no number: those builds wrote them before this one ran, so
 * they come first, in the order of their clock (all they have).
 */
function inTurnOrder(records: readonly CheckpointRecord[]): readonly TurnSpan[] {
  const spans = records.map((record): TurnSpan =>
    record.sequence === undefined
      ? { record, start: record.createdAt, end: record.endedAt, isNumbered: false }
      : { record, start: record.sequence, end: record.endSequence, isNumbered: true },
  )
  return spans.toSorted((left, right) =>
    left.isNumbered === right.isNumbered
      ? left.start - right.start
      : Number(left.isNumbered) - Number(right.isNumbered),
  )
}

/** The number the conversation's next turn start or end takes: one past every one recorded. */
function nextTurnNumber(records: readonly CheckpointRecord[], sessionId: string): number {
  const numbers = records.flatMap((record) =>
    record.sessionId === sessionId
      ? [record.sequence, record.endSequence].filter((value) => value !== undefined)
      : [],
  )
  return Math.max(0, ...numbers) + 1
}

/** The task once the one before it settled, whichever way. */
async function afterSettled<T>(previous: Promise<unknown>, task: () => Promise<T>): Promise<T> {
  try {
    await previous
  } catch {
    // The task before failed for its own caller; this one runs regardless.
  }
  return await task()
}

/** Settles when the promise does, never rejecting. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch {
    // Its caller has the failure.
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** The blobs a redo record names. */
function blobsOfEntries(entries: readonly RestoreEntry[]): readonly BlobRef[] {
  return entries.flatMap((entry) => [entry.before, entry.after].filter((blob) => blob !== null))
}

/** `update-ref --stdin`'s line deleting a ref, whatever it names. */
function deleteLine(ref: string, oid: string): string {
  return `delete ${ref} ${oid}${LINE_FEED}`
}

/** What a step's result means for the file list of the report. */
function refusalFor(result: Exclude<StepResult, 'done'>): RefusalReason {
  const reasons: Readonly<Record<Exclude<StepResult, 'done'>, RefusalReason>> = {
    changed: 'changedAfter',
    linked: 'notInCheckpoint',
    failed: 'failed',
    unsaved: 'unsaved',
  }
  return reasons[result]
}

export class CheckpointStore {
  private queue: Promise<unknown> = Promise.resolve()
  /** The shadow repository's setup: under way, or done. */
  private opening: Promise<Opened> | undefined
  private hasTidied = false
  private place: { readonly top: string; readonly prefix: string } | undefined
  /** Each recorded turn of this window not yet ended, by turn key. */
  private readonly openTurns = new Map<string, OpenTurn>()
  /** Every turn running in the window, and every message about to start one, as published, with when. */
  private readonly runningTurns = new Map<string, number>()
  private readonly journal = new Map<string, JournalEntry[]>()
  private readonly pendingEnds = new Map<string, PendingEnd>()
  private readonly stopping = new AbortController()
  /** Presence outlives cancellation until the final in-flight file/record step has settled. */
  private readonly presenceStopping = new AbortController()
  /** This store's id: its pins, index and staged copies are named by it. */
  private readonly instance: string
  private readonly presence: WindowPresence
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private emptyTree: string | undefined
  private lastPruneAt = 0
  private isPruneDue = false
  private isPeerUnsafe = false

  public constructor(private readonly deps: CheckpointStoreDeps) {
    this.instance = deps.newId()
    this.presence = new WindowPresence({
      storageDir: deps.storageDir,
      instance: this.instance,
      pid: deps.pid,
      isProcessAlive: deps.isProcessAlive,
      sleep: pause,
      signal: this.presenceStopping.signal,
    })
  }

  private publishedTurns(): readonly string[] {
    return [
      CHECKPOINT_FENCED_WINDOW,
      ...new Set([...this.runningTurns.keys(), ...this.openTurns.keys()]),
    ]
  }

  private hasUnprovedLocalWork(): boolean {
    if (this.runningTurns.has(CHECKPOINT_NATIVE_WINDOW)) {
      return true
    }
    for (const key of this.runningTurns.keys()) {
      if (key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) {
        return true
      }
    }
    return false
  }

  private get pinPrefix(): string {
    return `${PIN_REF_PREFIX}${this.instance}${SEPARATOR}`
  }

  private get workRef(): string {
    return `${WORK_REF_PREFIX}${this.instance}`
  }

  private get stagingDir(): string {
    return path.join(this.deps.storageDir, STAGING_DIR, this.instance)
  }

  private get target(): RestoreTarget {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      log: this.deps.log,
      signal: this.stopping.signal,
    }
  }

  private async hasReservedFiles(): Promise<boolean> {
    for (const refPath of [RESTORE_REF, 'packed-refs']) {
      const file = path.join(this.deps.storageDir, 'shadow.git', refPath)
      if ((await lstatOrUndefined(file)) !== undefined) {
        return true
      }
    }
    return false
  }

  /** The window's presence is written again every beat while the store is in use. */
  private startHeartbeat(): void {
    if (this.stopping.signal.aborted) {
      return
    }
    this.heartbeat ??= setInterval(() => {
      void this.presence.beat().catch((error: unknown) => {
        this.deps.log.warn(`The checkpoint store's heartbeat failed: ${failureForLog(error)}`)
      })
    }, this.deps.heartbeatMs ?? CHECKPOINT_HEARTBEAT_MS).unref()
  }

  /** Runs the task after this window's ones before it. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const guarded = async (): Promise<T> => {
      if (this.stopping.signal.aborted) {
        throw new Error(DISPOSED)
      }
      this.startHeartbeat()
      await this.presence.publish(this.publishedTurns())
      await this.finishPendingEnds()
      return await task()
    }
    const run = afterSettled(this.queue, guarded)
    this.queue = settled(run)
    return run
  }

  /** Retries durable end metadata before another operation, keeping its original boundary. */
  private async finishPendingEnds(): Promise<void> {
    if (this.pendingEnds.size === 0) {
      return
    }
    const setup = await this.ready()
    const endings = [...this.pendingEnds]
    for (const [, pending] of endings) {
      if (setup.records.checkpoints.some((record) => record.id === pending.record.id)) {
        await this.persistEnd(setup, pending)
      } else {
        await this.deleteRefs(setup.shadow, [pending.pin])
        this.pendingEnds.delete(pending.record.id)
      }
      for (const [key, open] of this.openTurns) {
        if (open.id === pending.record.id) {
          this.openTurns.delete(key)
        }
      }
    }
    await this.trimJournal()
    await this.presence.publish(this.publishedTurns())
  }

  /** The work tree's top and the workspace's place in it (no git). */
  private async placeOf(): Promise<{ readonly top: string; readonly prefix: string }> {
    if (this.place === undefined) {
      const top = await repositoryTop(this.deps.workspaceRoot)
      const prefix = path.relative(top, this.deps.workspaceRoot).split(path.sep).join(SEPARATOR)
      this.place = { top, prefix }
    }
    return this.place
  }

  /**
   * The shadow repository, set up the first time. A running mark opens it
   * outside the queue, so the first read can be setting it up at that very
   * moment (a window's first message starts both): every caller shares the
   * one setup under way. Two would each `git init` in this window's one
   * initializer folder, and the first to finish moves it away under the
   * other. A setup that failed is not kept: the next caller tries again.
   */
  private async open(): Promise<{ readonly opened: Opened }> {
    this.opening ??= this.setUpOnce()
    return { opened: await this.opening }
  }

  /** `setUp`, forgotten when it fails, before any caller hears of it. */
  private async setUpOnce(): Promise<Opened> {
    try {
      return await this.setUp()
    } catch (error: unknown) {
      this.opening = undefined
      throw error
    }
  }

  private async setUp(): Promise<Opened> {
    const { storageDir, platform } = this.deps
    const { top, prefix } = await this.placeOf()
    const shadow = new ShadowGit(
      {
        storageDir,
        top,
        platform,
        instance: this.instance,
        gitPathMax: this.deps.gitPathMax,
        storageRoot: this.deps.storageRoot,
      },
      { git: this.deps.git, env: this.deps.env, signal: this.stopping.signal },
    )
    shadow.assertFits()
    shadow.assertSeparate()
    await shadow.prepare(await userExclude(top), await this.globalExcludesFile())
    await shadow.clearStaleLocks(this.deps.now(), CHECKPOINT_STALE_LOCK_MS)
    return { shadow, top, prefix }
  }

  /**
   * The shadow repository for a turn's start, or undefined where none can ever
   * exist: a path git cannot use, or storage and workspace holding one another.
   * Every window of that folder meets the same refusal, so no restore can be
   * running elsewhere and the message goes ahead with no checkpoint (a capture
   * says so); any other failure still stops the message.
   */
  private async openIfUsable(): Promise<Opened | undefined> {
    try {
      const { opened } = await this.open()
      return opened
    } catch (error: unknown) {
      if (
        error instanceof ShadowPathTooLongError ||
        error instanceof ShadowStorageInWorkspaceError
      ) {
        return undefined
      }
      throw error
    }
  }

  /**
   * One operation's setup, read afresh (never an earlier copy, which another
   * window may have outdated). The first time, what no one needs any more
   * goes.
   */
  private async ready(): Promise<Setup> {
    const { opened } = await this.open()
    const listed = await listRecords(opened.shadow)
    const archives = await readArchives(this.deps.storageDir)
    const live = await this.presence.liveWindows()
    this.isPeerUnsafe = [...live].some(
      ([instance, running]) =>
        instance !== this.instance &&
        (!running.includes(CHECKPOINT_FENCED_WINDOW) || running.includes(CHECKPOINT_NATIVE_WINDOW)),
    )
    const checkpoints: CheckpointRecord[] = []
    const restores: RestoreRecord[] = []
    const keeps = new Map<string, string>()
    for (const entry of listed) {
      const { record } = entry
      const isHere = record?.top === opened.top && record.prefix === opened.prefix
      if (
        record === undefined ||
        !isHere ||
        isArchived(archives, record.sessionId, record.createdAt)
      ) {
        continue
      }
      keeps.set(entry.id, entry.keep)
      if (record.kind === 'checkpoint') {
        checkpoints.push(record)
      } else {
        restores.push(record)
      }
    }
    const setup: Setup = {
      ...opened,
      records: { checkpoints, restores },
      keeps,
      listed,
      archives,
      live,
    }
    if (!this.hasTidied) {
      await this.tidy(setup, false)
      this.hasTidied = true
      return await this.ready()
    }
    return setup
  }

  /** Whether a ref named by a window's instance belongs to a window that is gone. */
  private isGoneWindowRef(ref: string, prefix: string, setup: Setup): boolean {
    return (
      ref.startsWith(prefix) && !setup.live.has(ref.slice(prefix.length).split(SEPARATOR)[0] ?? '')
    )
  }

  /** The staging folders and index files of windows that are gone, and files of earlier builds. */
  private async dropGoneFiles(): Promise<void> {
    const stagingRoot = path.join(this.deps.storageDir, STAGING_DIR)
    let staged: string[] = []
    try {
      staged = await readdir(stagingRoot)
    } catch (error: unknown) {
      if (!isMissingPath(error)) {
        throw error
      }
    }
    const names = await readdir(this.deps.storageDir)
    // A window publishes before creating these files. Enumerate first,
    // then read presence, so a new window cannot be mistaken for an orphan.
    const live = await this.presence.liveWindows()
    const goneStaging = staged.filter((name) => !live.has(name))
    for (const name of goneStaging) {
      await rm(path.join(stagingRoot, name), { recursive: true, force: true })
    }
    const goneFiles = names.filter((name) => {
      const instance = indexFileInstance(
        name.endsWith(LOCK_SUFFIX) ? name.slice(0, -LOCK_SUFFIX.length) : name,
      )
      return (instance !== undefined && !live.has(instance)) || LEGACY_FILES.has(name)
    })
    for (const name of goneFiles) {
      await rm(path.join(this.deps.storageDir, name), { force: true })
    }
  }

  /**
   * Archive files past their time go, once the records they archived are
   * gone (until then they keep hiding them).
   */
  private async dropOldArchives(setup: Setup, deletedIds: ReadonlySet<string>): Promise<void> {
    const now = this.deps.now()
    for (const entry of setup.archives) {
      if (now - entry.archive.at < CHECKPOINT_FORGOTTEN_KEEP_MS) {
        continue
      }
      const isHiding = setup.listed.some(
        (listed) =>
          !deletedIds.has(listed.id) &&
          listed.record?.sessionId === entry.archive.sessionId &&
          listed.record.createdAt <= entry.archive.at,
      )
      if (!isHiding) {
        await removeArchive(entry)
      }
    }
  }

  private retainedRecords(setup: Setup) {
    const retained = retainRecords(
      setup.records,
      this.deps.now(),
      this.deps.retentionDays(),
      (record) => this.isOpen(setup, record),
    )
    const keptIds = new Set(
      [...retained.checkpoints, ...retained.restores].map((record) => record.id),
    )
    return { retained, keptIds }
  }

  /**
   * Drops what no one needs any more: records of another place, unreadable
   * ones, archived ones and those the retention bounds exclude (each only if
   * unchanged since it was read); the pins, index refs, index files and
   * staging folders of windows that are gone; refs and files of earlier
   * builds; archive files past their time. Unreferenced copies are then
   * pruned when due (or now), sparing objects younger than the grace period.
   */
  private async tidy(setup: Setup, isPruneForced: boolean): Promise<void> {
    if (await this.isRestoreActive(setup)) {
      return
    }
    const { keptIds } = this.retainedRecords(setup)
    const doomed = setup.listed.filter((entry) => !keptIds.has(entry.id))
    const deletedIds = new Set(await deleteRecords(setup.shadow, doomed))
    if (deletedIds.size > 0) {
      this.isPruneDue = true
    }
    const refs = await setup.shadow.text(['for-each-ref', '--format=%(refname)', REF_ROOT])
    // Enumerate refs before refreshing windows: a window publishes its
    // presence before creating any ref this enumeration can see.
    const refreshed = { ...setup, live: await this.presence.liveWindows() }
    const stale = refs
      .split(LINE_FEED)
      .filter(
        (ref) =>
          ref === LEGACY_INDEX_REF ||
          LEGACY_REF_PREFIXES.some((prefix) => ref.startsWith(prefix)) ||
          this.isGoneWindowRef(ref, PIN_REF_PREFIX, refreshed) ||
          this.isGoneWindowRef(ref, WORK_REF_PREFIX, refreshed),
      )
    if (stale.length > 0) {
      await this.deleteRefs(setup.shadow, stale)
      this.isPruneDue = true
    }
    await this.dropGoneFiles()
    await this.dropOldArchives(setup, deletedIds)
    const isIntervalOver = this.deps.now() - this.lastPruneAt > CHECKPOINT_PRUNE_INTERVAL_MS
    if (this.isPruneDue && (isPruneForced || isIntervalOver)) {
      await this.prune(setup.shadow)
    }
  }

  /** Drops what the retention bounds exclude (each only if unchanged); prunes when due. */
  private async retain(setup: Setup): Promise<void> {
    if (await this.isRestoreActive(setup)) {
      return
    }
    const { retained, keptIds } = this.retainedRecords(setup)
    const dropped = retained.dropped.flatMap((record) => {
      const keep = setup.keeps.get(record.id)
      return keep === undefined || keptIds.has(record.id) ? [] : [{ id: record.id, keep }]
    })
    const deleted = await deleteRecords(setup.shadow, dropped)
    if (deleted.length > 0) {
      this.isPruneDue = true
    }
    const isIntervalOver = this.deps.now() - this.lastPruneAt > CHECKPOINT_PRUNE_INTERVAL_MS
    if (isIntervalOver && this.isPruneDue) {
      await this.prune(setup.shadow)
    }
  }

  /** Old source objects stay referenced while a live restore sets up and writes files. */
  private async isRestoreActive(setup: Setup): Promise<boolean> {
    const keep = await refValue(setup.shadow, RESTORE_REF)
    if (keep === undefined) {
      return false
    }
    const lease = parseRecord(await setup.shadow.text(['cat-file', 'blob', `${keep}:record.json`]))
    const live = await this.presence.liveWindows()
    return lease?.owner === undefined || live.has(lease.owner)
  }

  /** Deletes refs no one needs (a ref another window deleted meanwhile is skipped). */
  private async deleteRefs(shadow: ShadowGit, refs: readonly string[]): Promise<void> {
    if (refs.length === 0) {
      return
    }
    const wanted = new Set(refs)
    const listing = await shadow.text([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      REF_ROOT,
    ])
    const listed = listing.split(LINE_FEED).flatMap((line) => {
      const [ref = '', oid = ''] = line.split(SPACE)
      return oid !== '' && wanted.has(ref) ? [{ ref, oid }] : []
    })
    try {
      await shadow.run(['update-ref', '--stdin'], {
        input: listed.map(({ ref, oid }) => deleteLine(ref, oid)).join(''),
      })
      return
    } catch (error: unknown) {
      if (!isGitExitError(error)) {
        throw error
      }
    }
    for (const { ref, oid } of listed) {
      try {
        await shadow.run(['update-ref', '--stdin'], { input: deleteLine(ref, oid) })
      } catch (error: unknown) {
        if (!isGitExitError(error) || (await refValue(shadow, ref)) === oid) {
          throw error
        }
      }
    }
  }

  /** Deletes every copy no ref names, sparing those younger than the grace period. */
  private async prune(shadow: ShadowGit): Promise<void> {
    await shadow.prune(CHECKPOINT_PRUNE_GRACE_MS)
    this.lastPruneAt = this.deps.now()
    this.isPruneDue = false
  }

  /** The user's global excludes file, read by git in any repository; undefined without one. */
  private async globalExcludesFile(): Promise<string | undefined> {
    const env = withoutGitVariables(this.deps.env)
    let configured = ''
    try {
      const answer = await this.deps.git(
        ['config', '--global', '--path', '--get', 'core.excludesFile'],
        {
          cwd: this.deps.workspaceRoot,
          env,
          timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
          signal: this.stopping.signal,
        },
      )
      configured = answer.toString('utf8').trim()
    } catch (error: unknown) {
      if (!isGitExitError(error) || error.exitCode !== NONE_EXIT) {
        throw error
      }
    }
    const home = env['HOME'] ?? env['USERPROFILE']
    const configHome =
      env['XDG_CONFIG_HOME'] ?? (home === undefined ? undefined : path.join(home, CONFIG_HOME))
    const fallback = configHome === undefined ? undefined : path.join(configHome, DEFAULT_EXCLUDES)
    const candidate = configured === '' ? fallback : configured
    if (candidate === undefined) {
      return undefined
    }
    return (await regularFileStat(candidate)) === undefined ? undefined : candidate
  }

  private relativeOf(absolutePath: string): string | undefined {
    for (const root of [this.deps.workspaceRoot, this.deps.displayRoot]) {
      if (root === undefined) {
        continue
      }
      const relative = path.relative(root, absolutePath)
      // A segment, not a prefix: a file named `..cache` is inside the workspace.
      const isOutside =
        relative === '' ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      if (!isOutside) {
        return relative.split(path.sep).join(SEPARATOR)
      }
    }
    return undefined
  }

  private absoluteOf(relative: string): string {
    return path.join(this.deps.workspaceRoot, ...relative.split(SEPARATOR))
  }

  private topOf(setup: Setup, relative: string): string {
    return setup.prefix === '' ? relative : `${setup.prefix}${SEPARATOR}${relative}`
  }

  /** A path git printed relative to the work tree's top, relative to the workspace. */
  private inWorkspace(setup: Setup, topPath: string): string {
    return setup.prefix === '' ? topPath : topPath.slice(setup.prefix.length + SEPARATOR.length)
  }

  private unsavedTest(unsavedPaths: () => readonly string[]): (relative: string) => boolean {
    return (relative) =>
      unsavedPaths().some(
        (unsaved) =>
          isSamePath(unsaved, this.absoluteOf(relative), this.deps.platform) ||
          (this.deps.displayRoot !== undefined &&
            isSamePath(
              unsaved,
              path.join(this.deps.displayRoot, ...relative.split(SEPARATOR)),
              this.deps.platform,
            )),
      )
  }

  private find(setup: Setup, sessionId: string, turnId: string): CheckpointRecord | undefined {
    return setup.records.checkpoints.find(
      (record) => record.sessionId === sessionId && record.turnId === turnId,
    )
  }

  private isAnyTurnRunning(): boolean {
    return this.runningTurns.size > 0 || this.openTurns.size > 0
  }

  /**
   * When each turn of this window began: its record's capture, or the time
   * it (or its message) was published as running. A tool's copy is taken
   * and kept for any of them, even before the turn's record exists.
   */
  private runningSince(): readonly number[] {
    return [
      ...Array.from(this.openTurns.values(), (turn) => turn.createdAt),
      ...Array.from(this.runningTurns, ([key, at]) =>
        key === CHECKPOINT_NATIVE_WINDOW ? Infinity : at,
      ),
      ...Array.from(this.pendingEnds.values(), (pending) => pending.record.createdAt),
    ]
  }

  /** A turn another live window publishes as running. */
  private isRunningElsewhere(setup: Setup, record: CheckpointRecord): boolean {
    const { owner } = record
    const running = owner === this.instance ? undefined : setup.live.get(owner ?? '')
    return running?.includes(turnKey(record.sessionId, record.turnId)) === true
  }

  /** A turn still running here, or in another live window. */
  private isOpen(setup: Setup, record: CheckpointRecord): boolean {
    const open = this.openTurns.get(turnKey(record.sessionId, record.turnId))
    return open?.id === record.id || this.isRunningElsewhere(setup, record)
  }

  /**
   * Why no restore or redo may run now: a turn running here, or a turn (or a
   * message about to start one) another live window publishes.
   */
  private turnBlocking(setup: Setup): RestoreFailure | undefined {
    const isNativeUncertain = [...setup.live].some(
      ([, running]) =>
        !running.includes(CHECKPOINT_FENCED_WINDOW) || running.includes(CHECKPOINT_NATIVE_WINDOW),
    )
    if (isNativeUncertain) {
      return 'nativeUnsafe'
    }
    if (this.isAnyTurnRunning()) {
      return 'turnRunning'
    }
    const isElsewhere = [...setup.live].some(
      ([instance, running]) =>
        instance !== this.instance && running.some((key) => key !== CHECKPOINT_FENCED_WINDOW),
    )
    return isElsewhere ? 'turnElsewhere' : undefined
  }

  /** Drops this window's open turns of a conversation (archived). */
  private dropOpenTurns(sessionId: string): void {
    const prefix = turnKey(sessionId, '')
    for (const key of this.openTurns.keys()) {
      if (key.startsWith(prefix)) {
        this.openTurns.delete(key)
      }
    }
  }

  /** The files `git status` lists outside the ignore rules: kept (with sizes) or left out. */
  private async sortListed(
    relatives: readonly string[],
  ): Promise<{ wanted: Map<string, number>; skipped: string[] }> {
    const wanted = new Map<string, number>()
    const skipped: string[] = []
    const stats = await mapInBatches(relatives, (relative) =>
      lstatOrUndefined(this.absoluteOf(relative)),
    )
    for (const [index, relative] of relatives.entries()) {
      const found = stats[index]
      if (found === undefined) {
        continue
      }
      if (found.isFile() && found.size <= CHECKPOINT_FILE_MAX_BYTES) {
        wanted.set(relative, found.size)
      } else {
        skipped.push(relative)
      }
    }
    return { wanted, skipped }
  }

  /** Brings the private index to the files kept; the capture's tree. */
  private async syncIndex(
    setup: Setup,
    wanted: ReadonlyMap<string, number>,
  ): Promise<{ readonly tree: string } | { readonly bytes: number }> {
    const { shadow } = setup
    const spec = setup.prefix === '' ? [] : ['--', setup.prefix]
    const listedText = await shadow.text(['ls-files', '-z', ...spec])
    const dirtyText = await shadow.text(['ls-files', '-z', '-m', '-d', ...spec])
    const listed = new Set(splitNul(listedText).map((topPath) => this.inWorkspace(setup, topPath)))
    const dirty = new Set(splitNul(dirtyText).map((topPath) => this.inWorkspace(setup, topPath)))
    const stale: string[] = []
    for (const relative of listed) {
      if (!wanted.has(relative)) {
        stale.push(relative)
      }
    }
    const toHash: string[] = []
    for (const relative of wanted.keys()) {
      if (!listed.has(relative) || dirty.has(relative)) {
        toHash.push(relative)
      }
    }
    const bytes = toHash.reduce((total, relative) => total + (wanted.get(relative) ?? 0), 0)
    if (bytes > CHECKPOINT_CAPTURE_MAX_BYTES) {
      return { bytes }
    }
    if (stale.length > 0) {
      await shadow.run(['update-index', '--force-remove', '-z', '--stdin'], {
        input: nulInput(stale.map((relative) => this.topOf(setup, relative))),
      })
    }
    if (toHash.length > 0) {
      await shadow.run(['update-index', '--add', '--remove', '-z', '--stdin'], {
        input: nulInput(toHash.map((relative) => this.topOf(setup, relative))),
      })
    }
    const full = await shadow.text(['write-tree'])
    // The ref keeps the index's copies from pruning. Another window may have
    // moved it since, so it is set every time.
    await shadow.run(['update-ref', this.workRef, full])
    if (wanted.size === 0) {
      return { tree: await this.emptyTreeOf(shadow) }
    }
    return {
      tree:
        setup.prefix === '' ? full : await shadow.text(['rev-parse', `${full}:${setup.prefix}`]),
    }
  }

  /**
   * The folders the private index holds no file of (git lists an untracked
   * folder whole, and an empty one too), with the ignored folders; undefined
   * past CHECKPOINT_FOLDERS_MAX.
   */
  private async foldersWithoutFiles(
    setup: Setup,
    ignoredFolders: readonly string[],
  ): Promise<readonly string[] | undefined> {
    const spec = setup.prefix === '' ? [] : ['--', setup.prefix]
    const answer = await setup.shadow.text([
      'ls-files',
      '--others',
      '--directory',
      '--exclude-standard',
      '-z',
      ...spec,
    ])
    const listed = splitNul(answer)
      .filter((topPath) => topPath.endsWith(SEPARATOR))
      .map((topPath) => this.inWorkspace(setup, topPath.slice(0, -SEPARATOR.length)))
    const folders = [...new Set([...listed, ...ignoredFolders])]
    return folders.length > CHECKPOINT_FOLDERS_MAX ? undefined : folders.toSorted(byText)
  }

  /**
   * The workspace's files now: the private index brought up to date, and
   * the ignored scan. Paths below a link or junction are left out. With
   * `shouldListFolders` (a capture before a turn), the folders it holds no file of.
   */
  private async captureNow(setup: Setup, shouldListFolders: boolean): Promise<CaptureResult> {
    try {
      await setup.shadow.clearStaleLocks(this.deps.now(), CHECKPOINT_STALE_LOCK_MS)
      // Every capture (a turn's start and end, a restore's) goes through here: the
      // user may have changed either excludes file since the repository was opened.
      await setup.shadow.refreshExcludes(
        await userExclude(setup.top),
        await this.globalExcludesFile(),
      )
      const spec = setup.prefix === '' ? [] : ['--', setup.prefix]
      const statusText = await setup.shadow.text(
        [
          'status',
          '--porcelain=v1',
          '-z',
          '--ignored=matching',
          '--untracked-files=all',
          '--no-renames',
          ...spec,
        ],
        { index: 'none' },
      )
      const listing = parseStatusListing(statusText)
      const inWorkspace = (paths: readonly string[]) =>
        paths.map((topPath) => this.inWorkspace(setup, topPath))
      const files = inWorkspace(listing.files)
      const ignoredFiles = inWorkspace(listing.ignoredFiles)
      const ignoredFolders = inWorkspace(listing.ignoredFolders)
      const repositories = inWorkspace(listing.repositories)
      const linked = await linkedFolders(this.deps.workspaceRoot, [
        ...files,
        ...ignoredFiles,
        ...ignoredFolders.map((folder) => `${folder}${SEPARATOR}${CURRENT_PATH_PREFIX}`),
        ...repositories,
      ])
      const isReachable = (relative: string) =>
        linked.every(
          (folder) => relative !== folder && !relative.startsWith(`${folder}${SEPARATOR}`),
        )
      const reachableFiles = files.filter((relative) => isReachable(relative))
      if (reachableFiles.length > CHECKPOINT_MAX_FILES) {
        return {
          ok: false,
          reason: 'tooManyFiles',
          detail: `${String(reachableFiles.length)} files outside the ignore rules`,
        }
      }
      const { wanted, skipped } = await this.sortListed(reachableFiles)
      const synced = await this.syncIndex(setup, wanted)
      if ('bytes' in synced) {
        return {
          ok: false,
          reason: 'tooLarge',
          detail: `${String(synced.bytes)} bytes of changed files to copy`,
        }
      }
      const reachableIgnoredFolders = ignoredFolders.filter((relative) => isReachable(relative))
      const scan = await scanIgnored(
        this.deps.workspaceRoot,
        ignoredFiles.filter((relative) => isReachable(relative)),
        reachableIgnoredFolders,
      )
      const folders = shouldListFolders
        ? await this.foldersWithoutFiles(setup, [...reachableIgnoredFolders, ...linked])
        : undefined
      return {
        ok: true,
        snapshot: {
          tree: synced.tree,
          coverage: {
            skipped: [...skipped, ...linked].toSorted(byText),
            // Git names an untracked repository; one an ignore rule hides, the scan finds.
            repositories: [
              ...repositories.filter((relative) => isReachable(relative)),
              ...scan.repositories,
            ].toSorted(byText),
          },
          inventory: scan.inventory,
          createdAt: this.deps.now(),
          pin: undefined,
          folders,
        },
      }
    } catch (error: unknown) {
      return captureFailure(error)
    }
  }

  private async emptyTreeOf(shadow: ShadowGit): Promise<string> {
    this.emptyTree ??= await shadow.text(['hash-object', '-t', 'tree', '-w', '--stdin'], {
      input: '',
    })
    return this.emptyTree
  }

  /** A copy of the file now; null when absent, undefined when too big or a link. */
  private async copyOf(
    setup: Setup,
    relative: string,
  ): Promise<{ preImage: BlobRef | null | undefined; stat: FileStat | null }> {
    const stats = await lstatOrUndefined(this.absoluteOf(relative))
    if (stats === undefined) {
      return { preImage: null, stat: null }
    }
    const stat = { size: stats.size, mtimeMs: stats.mtimeMs }
    if (!stats.isFile() || stats.size > CHECKPOINT_FILE_MAX_BYTES) {
      return { preImage: undefined, stat }
    }
    const oid = await setup.shadow.text([
      'hash-object',
      '-w',
      '--no-filters',
      '--',
      setup.shadow.fileArgument(this.topOf(setup, relative)),
    ])
    const isExecutable = this.deps.platform !== 'win32' && (stats.mode & EXECUTABLE_BITS) !== 0
    return { preImage: { mode: isExecutable ? GIT_MODE_EXECUTABLE : GIT_MODE_FILE, oid }, stat }
  }

  /**
   * A copy of the file now in this window's staging folder, with no lock
   * and no git; null when absent, undefined when too big or a link.
   */
  private async stage(relative: string): Promise<Omit<JournalEntry, 'at'>> {
    const absolute = this.absoluteOf(relative)
    const stats = await lstatOrUndefined(absolute)
    if (stats === undefined) {
      return { staged: null, isExecutable: false, stat: null }
    }
    const stat = { size: stats.size, mtimeMs: stats.mtimeMs }
    const isExecutable = this.deps.platform !== 'win32' && (stats.mode & EXECUTABLE_BITS) !== 0
    if (!stats.isFile() || stats.size > CHECKPOINT_FILE_MAX_BYTES) {
      return { staged: undefined, isExecutable, stat }
    }
    await mkdir(this.stagingDir, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const staged = path.join(this.stagingDir, this.deps.newId())
    await this.copyInsideWorkspace(absolute, staged, stats)
    return { staged, isExecutable, stat }
  }

  /**
   * Copies a workspace file into staging, and keeps the copy only if it came from
   * the workspace: a parent folder replaced by a link or a junction after the
   * tool's own check would otherwise stage a file from outside it. The parent is
   * resolved first and the copy is taken through that resolved path; afterwards the
   * file and its parent are looked at again, and a copy that cannot be vouched for
   * is deleted at once, so no outside bytes are retained.
   */
  private async copyInsideWorkspace(
    absolute: string,
    staged: string,
    before: Stats,
  ): Promise<void> {
    const parent = await canonicalPath(path.dirname(absolute))
    if (!isWithinFolder(parent, this.deps.workspaceRoot)) {
      throw new Error(UI_TEXT.checkpointFailed)
    }
    await copyFile(path.join(parent, path.basename(absolute)), staged)
    const after = await lstatOrUndefined(absolute)
    const isSame =
      after?.isFile() === true &&
      after.ino === before.ino &&
      after.dev === before.dev &&
      (await canonicalPath(path.dirname(absolute))) === parent
    if (isSame) {
      return
    }
    await rm(staged, { force: true })
    throw new Error(UI_TEXT.checkpointFailed)
  }

  /** The first copy the tools took of each file since the turn began, and each file's state now. */
  private async copiesSince(createdAt: number): Promise<ReadonlyMap<string, TurnCopy>> {
    const copies = new Map<string, TurnCopy>()
    for (const [relative, entries] of this.journal) {
      const entry = entries.find((candidate) => candidate.at >= createdAt)
      if (entry === undefined) {
        continue
      }
      const endStat = (await regularFileStat(this.absoluteOf(relative))) ?? null
      copies.set(relative, { entry, endStat })
    }
    return copies
  }

  /**
   * Adds the copies the tools took during this turn to its ignored changes,
   * their staged bytes brought into the shadow repository.
   */
  private async withToolCopies(
    setup: Setup,
    record: CheckpointRecord,
    scanned: readonly IgnoredChange[],
    copies: ReadonlyMap<string, TurnCopy>,
  ): Promise<readonly IgnoredChange[]> {
    if (copies.size === 0) {
      return scanned
    }
    // A file in the start capture is restored from it; the copies matter for the rest.
    const inStart = await this.presentIn(
      setup.shadow,
      record.start.tree,
      [...copies].map(([relative]) => relative),
    )
    const wanted = [...copies].filter(([relative]) => !inStart.has(relative))
    const staged = wanted.flatMap(([relative, copy]) =>
      typeof copy.entry.staged === 'string' ? [{ relative, copy, file: copy.entry.staged }] : [],
    )
    const hashed =
      staged.length === 0
        ? ''
        : await setup.shadow.text(['hash-object', '-w', '--no-filters', '--stdin-paths'], {
            input: staged.map((entry) => `${entry.file}${LINE_FEED}`).join(''),
          })
    const oids = hashed.split(LINE_FEED)
    const imported = new Map<string, BlobRef>()
    for (const [index, entry] of staged.entries()) {
      const oid = oids[index]
      if (oid === undefined || oid === '') {
        continue
      }
      const mode = entry.copy.entry.isExecutable ? GIT_MODE_EXECUTABLE : GIT_MODE_FILE
      imported.set(entry.relative, { mode, oid })
    }
    const changes = new Map(scanned.map((change) => [change.path, change]))
    for (const [relative, copy] of wanted) {
      const preImage = copy.entry.staged === null ? null : imported.get(relative)
      const scannedChange = changes.get(relative)
      if (scannedChange !== undefined) {
        changes.set(relative, {
          ...scannedChange,
          kind: preImage === null ? 'created' : scannedChange.kind,
          preImage,
        })
        continue
      }
      if (preImage === null && copy.endStat === null) {
        continue
      }
      let kind: IgnoredChange['kind'] = 'changed'
      if (preImage === null) {
        kind = 'created'
      } else if (copy.endStat === null) {
        kind = 'deleted'
      }
      changes.set(relative, {
        path: relative,
        kind,
        ...(preImage !== undefined && { preImage }),
        startStat: copy.entry.stat,
        endStat: copy.endStat,
      })
    }
    return [...changes]
      .map(([, change]) => change)
      .toSorted((left, right) => byText(left.path, right.path))
  }

  /**
   * Staged copies no turn of this window can need any more go: older than
   * every turn still open (its end not yet recorded) and every running mark.
   */
  private async trimJournal(): Promise<void> {
    const oldestOpen = Math.min(Infinity, ...this.runningSince())
    const released: string[] = []
    for (const [relative, entries] of this.journal) {
      const remaining = entries.filter((entry) => entry.at >= oldestOpen)
      for (const entry of entries) {
        if (typeof entry.staged === 'string' && !remaining.includes(entry)) {
          released.push(entry.staged)
        }
      }
      if (remaining.length === 0) {
        this.journal.delete(relative)
      } else {
        this.journal.set(relative, remaining)
      }
    }
    for (const file of released) {
      await rm(file, { force: true })
    }
  }

  /** Which of these workspace paths the tree holds. */
  private async presentIn(
    shadow: ShadowGit,
    tree: string,
    relatives: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const answer = await shadow.text(['cat-file', '--batch-check'], {
      input: relatives.map((relative) => `${tree}:${relative}${LINE_FEED}`).join(''),
    })
    const present = new Set<string>()
    for (const [index, line] of answer.split(LINE_FEED).entries()) {
      const relative = relatives[index]
      if (relative !== undefined && !line.endsWith(` ${GIT_MISSING_OBJECT}`)) {
        present.add(relative)
      }
    }
    return present
  }

  private async diff(shadow: ShadowGit, from: string, to: string): Promise<readonly TreeChange[]> {
    return from === to
      ? []
      : parseDiffTree(await shadow.text(['diff-tree', '-r', '-z', '--no-renames', from, to]))
  }

  /**
   * Paths these turns did not change themselves: in a gap between them and
   * after the last, and every path another conversation's turn changed while
   * one of them ran. Turns that overlap (a subagent's turn that started
   * before its parent's ended) make one stretch, which ends where the last of
   * them to end did; only a gap between stretches is outside them. A turn
   * whose end was not seen counts everything up to the next capture as its
   * own; when it closes a stretch, those paths are `uncertain`.
   */
  private async changedOutside(
    setup: Setup,
    turns: readonly TurnSpan[],
    currentTree: string,
  ): Promise<{ readonly changed: ReadonlySet<string>; readonly uncertain: ReadonlySet<string> }> {
    const changed = new Set<string>()
    const uncertain = new Set<string>()
    const gapAfter = async (closing: CheckpointRecord, nextTree: string) => {
      const found = closing.end === undefined ? uncertain : changed
      const since = await this.diff(setup.shadow, closing.end?.tree ?? closing.start.tree, nextTree)
      for (const change of since) {
        found.add(change.path)
      }
    }
    // The turn whose end closes the stretch so far, and where that end falls.
    let closing: { readonly turn: TurnSpan; readonly end: number } | undefined
    for (const [index, turn] of turns.entries()) {
      // A turn that starts where the stretch ended follows it, and the gap is
      // checked: an equal number means the end was numbered before the start
      // was recorded, and a candidate's equal tick may hide an edit between.
      const isInStretch = closing?.turn.isNumbered === turn.isNumbered && turn.start < closing.end
      if (closing !== undefined && !isInStretch) {
        await gapAfter(closing.turn.record, turn.record.start.tree)
        closing = undefined
      }
      // An end not seen falls, as far as is known, at the next turn's start.
      const next = turns[index + 1]
      const end = turn.end ?? (next?.isNumbered === turn.isNumbered ? next.start : Infinity)
      if (closing === undefined || end > closing.end) {
        closing = { turn, end }
      }
    }
    if (closing !== undefined) {
      await gapAfter(closing.turn.record, currentTree)
    }
    const records = turns.map((turn) => turn.record)
    const now = this.deps.now()
    // A turn's time: from its start capture to its end; to now while it
    // runs; an end an earlier window never saw is taken as its start.
    const windowOf = (record: CheckpointRecord) => ({
      start: record.createdAt,
      end: record.endedAt ?? (this.isOpen(setup, record) ? now : record.createdAt),
    })
    const sessionId = records[0]?.sessionId
    const overlapping = setup.records.checkpoints.filter((other) => {
      if (other.sessionId === sessionId) {
        return false
      }
      const theirs = windowOf(other)
      return records.some((turn) => {
        const ours = windowOf(turn)
        // Turns that touch at one tick count as overlapping: the clock is in
        // milliseconds and two windows' clocks are not exact, so an edit may
        // sit on either side of the shared tick.
        return theirs.start <= ours.end && theirs.end >= ours.start
      })
    })
    for (const other of overlapping) {
      const otherEnd = other.end?.tree ?? currentTree
      const theirChanges = [
        ...(await this.diff(setup.shadow, other.start.tree, otherEnd)),
        ...(other.ignored?.changes ?? []),
      ]
      for (const change of theirChanges) {
        changed.add(change.path)
      }
    }
    return { changed, uncertain }
  }

  /** The blobs' bytes, by object name; a missing one is absent from the map. */
  private async blobsOf(
    shadow: ShadowGit,
    oids: readonly string[],
  ): Promise<ReadonlyMap<string, Buffer>> {
    const unique = [...new Set(oids)]
    if (unique.length === 0) {
      return new Map()
    }
    const output = await shadow.run(['cat-file', '--batch'], {
      input: unique.map((oid) => `${oid}${LINE_FEED}`).join(''),
    })
    const blobs = new Map<string, Buffer>()
    for (const [oid, content] of parseCatFileBatch(output)) {
      if (content !== undefined) {
        blobs.set(oid, content)
      }
    }
    return blobs
  }

  /**
   * The writes in batches whose blobs together stay under
   * CHECKPOINT_BLOB_BATCH_MAX_BYTES (one `cat-file` each), in order.
   */
  private async blobBatches(
    shadow: ShadowGit,
    steps: readonly PlannedStep[],
  ): Promise<readonly (readonly PlannedStep[])[]> {
    const oids = [
      ...new Set(steps.flatMap((step) => (step.target === null ? [] : [step.target.oid]))),
    ]
    if (oids.length === 0) {
      return []
    }
    const answer = await shadow.text(['cat-file', '--batch-check'], {
      input: oids.map((oid) => `${oid}${LINE_FEED}`).join(''),
    })
    const sizes = parseBatchCheck(answer)
    const batches: PlannedStep[][] = []
    let current: PlannedStep[] = []
    let bytes = 0
    for (const step of steps) {
      const size = step.target === null ? 0 : (sizes.get(step.target.oid) ?? 0)
      if (current.length > 0 && bytes + size > CHECKPOINT_BLOB_BATCH_MAX_BYTES) {
        batches.push(current)
        current = []
        bytes = 0
      }
      current.push(step)
      bytes += size
    }
    batches.push(current)
    return batches
  }

  /**
   * Which of these added paths the ignore rules (as restored) name. Each is
   * given as `./path`, so a name that looks like pathspec magic is only a
   * name (`check-ignore` refuses literal pathspecs).
   */
  private async ignoredAmong(
    setup: Setup,
    relatives: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (relatives.length === 0) {
      return new Set()
    }
    try {
      const answer = await setup.shadow.text(['check-ignore', '--no-index', '-z', '--stdin'], {
        index: 'none',
        literalPathspecs: false,
        input: nulInput(
          relatives.map((relative) => `${CURRENT_PATH_PREFIX}${this.topOf(setup, relative)}`),
        ),
      })
      return new Set(
        splitNul(answer).map((topPath) =>
          this.inWorkspace(
            setup,
            topPath.startsWith(CURRENT_PATH_PREFIX)
              ? topPath.slice(CURRENT_PATH_PREFIX.length)
              : topPath,
          ),
        ),
      )
    } catch (error: unknown) {
      if (isGitExitError(error) && error.exitCode === NONE_EXIT) {
        return new Set()
      }
      throw error
    }
  }

  /**
   * Whether a folder was there at the checkpoint: its tree holds a file
   * below it, or the capture listed it (or a folder above it) as holding
   * none. A capture that listed none (over the limit, or an older record)
   * counts every folder as there, so a restore removes none.
   */
  private async wasFolderThere(
    shadow: ShadowGit,
    start: CheckpointRecord['start'],
  ): Promise<(folder: string) => boolean> {
    const { folders } = start
    if (folders === undefined) {
      return () => true
    }
    const answer = await shadow.text(['ls-tree', '-r', '-d', '--name-only', '-z', start.tree])
    const inTree = new Set(splitNul(answer))
    return (folder) =>
      inTree.has(folder) ||
      folders.some((listed) => folder === listed || folder.startsWith(`${listed}${SEPARATOR}`))
  }

  /**
   * One step, if it may still run: not once the window is closing; a file
   * with unsaved editor changes is left as it is, and so is one no longer as
   * the restore expects.
   */
  private async runStep(
    step: PlannedStep,
    content: Buffer | undefined,
    wasFolderThere: ((folder: string) => boolean) | undefined,
    isUnsaved: (relative: string) => boolean,
    isAllowed: () => boolean,
  ): Promise<Refusal | undefined> {
    if (this.stopping.signal.aborted) {
      throw new Error(DISPOSED)
    }
    if (isUnsaved(step.path)) {
      return { path: step.path, reason: 'unsaved' }
    }
    const result = await applyFileStep(
      { ...this.target, isAllowed, isUnsaved },
      step,
      content,
      wasFolderThere,
    )
    return result === 'done' ? undefined : { path: step.path, reason: refusalFor(result) }
  }

  /**
   * Runs the steps: ignore files first (so the rules as restored can judge
   * the added files), then deletions (a case-only rename or a file swapped
   * for a folder of the same name must go before the file comes back), then
   * the other writes, their blobs read in bounded batches. Whatever fails,
   * the entries done and the refusals are returned; a step never begun is
   * refused as failed.
   */
  private async runSteps(
    setup: Setup,
    steps: readonly PlannedStep[],
    wasFolderThere: ((folder: string) => boolean) | undefined,
    isUnsaved: (relative: string) => boolean,
    isAllowed: () => boolean,
  ): Promise<Applied> {
    const entries: RestoreEntry[] = []
    const refused: Refusal[] = []
    const settledPaths = new Set<string>()
    const note = (step: PlannedStep, refusal: Refusal | undefined) => {
      settledPaths.add(step.path)
      if (refusal === undefined) {
        entries.push({ path: step.path, before: step.before, after: step.target })
      } else {
        refused.push(refusal)
      }
    }
    const runWrites = async (writes: readonly PlannedStep[]) => {
      const batches = await this.blobBatches(setup.shadow, writes)
      for (const batch of batches) {
        const blobs = await this.blobsOf(
          setup.shadow,
          batch.flatMap((step) => (step.target === null ? [] : [step.target.oid])),
        )
        for (const step of batch) {
          const content = step.target === null ? undefined : blobs.get(step.target.oid)
          note(step, await this.runStep(step, content, undefined, isUnsaved, isAllowed))
        }
      }
    }
    try {
      const isIgnoreFile = (step: PlannedStep) =>
        step.target !== null && path.posix.basename(step.path) === IGNORE_FILE
      await runWrites(steps.filter((step) => isIgnoreFile(step)))
      const checked = steps.filter((step) => step.isIgnoreChecked).map((step) => step.path)
      const ignoredNow = await this.ignoredAmong(setup, checked)
      const deletes = steps.filter((candidate) => candidate.target === null)
      for (const step of deletes) {
        note(
          step,
          ignoredNow.has(step.path)
            ? { path: step.path, reason: 'notInCheckpoint' }
            : await this.runStep(
                step,
                undefined,
                step.isIgnoreChecked ? wasFolderThere : undefined,
                isUnsaved,
                isAllowed,
              ),
        )
      }
      await runWrites(steps.filter((step) => step.target !== null && !isIgnoreFile(step)))
    } catch (error: unknown) {
      this.deps.log.warn(`A checkpoint restore stopped part way: ${failureForLog(error)}`)
      for (const step of steps) {
        if (!settledPaths.has(step.path)) {
          refused.push({ path: step.path, reason: 'failed' })
        }
      }
    }
    return { entries, refused }
  }

  /**
   * Cuts a redo record to these entries, only if it is still as it was read;
   * deletes it (and so lets its copies go) when none is left. Whether it is
   * still kept.
   */
  private async trimRestore(
    setup: Setup,
    record: RestoreRecord,
    keep: string,
    entries: readonly RestoreEntry[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (entries.length === 0) {
      await deleteRecords(setup.shadow, [{ id: record.id, keep }], signal)
      this.isPruneDue = true
      return false
    }
    const trimmed = await writeRecord(
      setup.shadow,
      { ...record, entries: [...entries] },
      { trees: [], blobs: blobsOfEntries(entries) },
      keep,
      signal,
    )
    return trimmed !== undefined
  }

  /**
   * Saves the redo record of every step (its own ref, created only if
   * absent) before the first file changes, runs them, then cuts the record
   * to what was done: a restore that stops part way keeps its Redo and says
   * what it changed.
   */
  private async runRecorded(
    setup: Setup,
    sessionId: string,
    steps: readonly PlannedStep[],
    wasFolderThere: ((folder: string) => boolean) | undefined,
    isUnsaved: (relative: string) => boolean,
    isAllowed: () => boolean,
  ): Promise<Applied & { readonly restoreId: string | undefined }> {
    if (steps.length === 0) {
      return { entries: [], refused: [], restoreId: undefined }
    }
    const entries = steps.map((step) => ({
      path: step.path,
      before: step.before,
      after: step.target,
    }))
    const pending: RestoreRecord = {
      kind: 'restore',
      top: setup.top,
      prefix: setup.prefix,
      id: this.deps.newId(),
      sessionId,
      createdAt: this.deps.now(),
      entries,
    }
    const keep = await writeRecord(
      setup.shadow,
      pending,
      { trees: [], blobs: blobsOfEntries(entries) },
      undefined,
    )
    if (keep === undefined) {
      throw new Error('the redo record could not be saved')
    }
    const applied = await this.runSteps(setup, steps, wasFolderThere, isUnsaved, isAllowed)
    // Cancellation stops file work; it must still durably say which steps
    // were applied, so Redo never treats an unstarted step as completed.
    const finalizing = new AbortController().signal
    let isKept = true
    try {
      isKept = await this.trimRestore(setup, pending, keep, applied.entries, finalizing)
      if (!this.stopping.signal.aborted) {
        await this.retain(setup)
      }
    } catch (error: unknown) {
      // The original durable record still keeps every preimage. Redo
      // rechecks each entry, including steps that were never applied.
      this.deps.log.warn(
        `A redo record was kept after finalization failed: ${failureForLog(error)}`,
      )
    }
    return { ...applied, restoreId: isKept ? pending.id : undefined }
  }

  /** The restore's steps with what each replaces; a step whose file cannot be kept for Redo is refused. */
  private async plannedSteps(
    setup: Setup,
    steps: readonly RestoreStep[],
    inCurrent: ReadonlyMap<string, BlobRef>,
  ): Promise<{ readonly planned: readonly PlannedStep[]; readonly refused: readonly Refusal[] }> {
    const planned: PlannedStep[] = []
    const refused: Refusal[] = []
    for (const step of steps) {
      const before = await this.beforeOf(setup, step, inCurrent)
      if (before === undefined) {
        refused.push({ path: step.path, reason: 'notInCheckpoint' })
      } else {
        planned.push({ ...step, before })
      }
    }
    return { planned, refused }
  }

  /** What a step replaces: the current capture's blob, nothing, or a copy taken now. */
  private async beforeOf(
    setup: Setup,
    step: RestoreStep,
    inCurrent: ReadonlyMap<string, BlobRef>,
  ): Promise<BlobRef | null | undefined> {
    if (step.expect.kind === 'absent') {
      return null
    }
    if (step.expect.kind === 'blob') {
      return inCurrent.get(step.path)
    }
    const copy = await this.copyOf(setup, step.path)
    return copy.preImage
  }

  /**
   * Records a turn's end: the end capture, the ignored files it changed and
   * the tools' copies, from the record as it was read (only this window
   * ends its turns). A record deleted meanwhile (archived, or dropped by
   * another window's cleanup) is left gone.
   */
  private async finishTurn(
    setup: Setup,
    start: OpenTurn,
    endedAt: number,
    copies: ReadonlyMap<string, TurnCopy>,
  ): Promise<void> {
    const record = setup.records.checkpoints.find((candidate) => candidate.id === start.id)
    const keep = setup.keeps.get(start.id)
    if (record === undefined || keep === undefined || record.endedAt !== undefined) {
      this.pendingEnds.delete(start.id)
      return
    }
    const pending = this.pendingEnds.get(start.id)
    if (pending !== undefined) {
      await this.persistEnd(setup, pending)
      return
    }
    const capture = await this.captureNow(setup, false)
    if (!capture.ok) {
      this.deps.log.warn(`Checkpoint at the end of turn ${record.turnId}: ${capture.detail}`)
    }
    const ended = capture.ok ? capture.snapshot : undefined
    const scanned = ended === undefined ? [] : ignoredChanges(start.inventory, ended.inventory)
    const changes = await this.withToolCopies(setup, record, scanned, copies)
    const kept = changes.slice(0, CHECKPOINT_IGNORED_CHANGES_MAX)
    const preImages = kept.flatMap((change) =>
      change.preImage === undefined || change.preImage === null ? [] : [change.preImage],
    )
    const isScanWhole =
      ended !== undefined && !start.inventory.isPartial && !ended.inventory.isPartial
    const updated: CheckpointRecord = {
      ...record,
      ...(ended !== undefined && {
        end: { tree: ended.tree, coverage: storedCoverage(ended.coverage) },
      }),
      endedAt,
      endSequence: nextTurnNumber(setup.records.checkpoints, record.sessionId),
      ignored: { changes: [...kept], isComplete: isScanWhole && kept.length === changes.length },
    }
    const trees = [
      { name: 'start', tree: record.start.tree },
      ...(ended === undefined ? [] : [{ name: 'end', tree: ended.tree }]),
    ]
    const ending = {
      record: updated,
      kept: { trees, blobs: preImages },
      previous: keep,
      pin: `${this.pinPrefix}end-${start.id}`,
      copies,
    }
    this.pendingEnds.set(start.id, ending)
    await this.persistEnd(setup, ending)
  }

  private async persistEnd(setup: Setup, pending: PendingEnd): Promise<void> {
    // Reimport frozen staged bytes if an earlier pin write itself failed.
    // The record's end time, end tree and stats remain the original boundary.
    await this.withToolCopies(
      setup,
      pending.record,
      pending.record.ignored?.changes ?? [],
      pending.copies,
    )
    const held = await keepTree(setup.shadow, pending.record, pending.kept)
    if (!(await didWriteRef(setup.shadow, pending.pin, held, undefined))) {
      throw new Error(UI_TEXT.checkpointFailed)
    }
    const written = await writeRecord(setup.shadow, pending.record, pending.kept, pending.previous)
    if (written === undefined) {
      throw new Error(UI_TEXT.checkpointFailed)
    }
    await this.deleteRefs(setup.shadow, [pending.pin])
    this.pendingEnds.delete(pending.record.id)
    this.runningTurns.delete(turnKey(pending.record.sessionId, pending.record.turnId))
    await this.retain(setup)
  }

  /** Read afresh across awaits; a closing window can change this during file IO. */
  private isStopped(): boolean {
    return this.stopping.signal.aborted
  }

  /**
   * A single CAS ref admits one restore/redo across independent windows.
   * Captures and record writes remain independent. A crashed owner's
   * reservation is removed only from the value that was read.
   */
  private async withRestore(
    setup: Setup,
    isAllowed: () => boolean,
    task: (fresh: Setup) => Promise<RestoreOutcome>,
  ): Promise<RestoreOutcome> {
    if (!isAllowed()) {
      return { ok: false, reason: 'backendUnsupported' }
    }
    const { shadow } = setup
    const acquire = async () => {
      const keep = await keepTree(
        shadow,
        {
          kind: 'restore',
          top: setup.top,
          prefix: setup.prefix,
          id: this.instance,
          sessionId: '',
          createdAt: this.deps.now(),
          owner: this.instance,
          entries: [],
        },
        {
          trees: [],
          blobs: [],
        },
      )
      return (await didWriteRef(shadow, RESTORE_REF, keep, undefined)) ? keep : undefined
    }
    let keep = await acquire()
    if (keep === undefined) {
      const previous = await refValue(shadow, RESTORE_REF)
      if (previous !== undefined) {
        const lease = parseRecord(
          await shadow.text(['cat-file', 'blob', `${previous}:record.json`]),
        )
        const owner = lease?.owner
        const live = await this.presence.liveWindows()
        // Its own lease while no restore runs here (they are serial) is a leftover
        // of a release that failed; a gone window's lease is taken over as well.
        if (owner !== undefined && (owner === this.instance || !live.has(owner))) {
          try {
            await shadow.run(['update-ref', '-d', RESTORE_REF, previous])
          } catch (error: unknown) {
            if (!isGitExitError(error)) {
              throw error
            }
          }
          keep = await acquire()
        }
      }
    }
    if (keep === undefined) {
      return { ok: false, reason: 'turnElsewhere' }
    }
    try {
      const fresh = await this.ready()
      if (!isAllowed()) {
        return { ok: false, reason: 'backendUnsupported' }
      }
      const blocking = this.turnBlocking(fresh)
      if (blocking !== undefined) {
        return { ok: false, reason: blocking }
      }
      const pinned = await keepTree(
        shadow,
        {
          kind: 'restore',
          top: fresh.top,
          prefix: fresh.prefix,
          id: this.instance,
          sessionId: '',
          createdAt: this.deps.now(),
          owner: this.instance,
          entries: [],
        },
        {
          trees: Array.from(fresh.keeps.values(), (tree, index) => ({
            name: `r${String(index)}`,
            tree,
          })),
          blobs: [],
        },
      )
      if (!(await didWriteRef(shadow, RESTORE_REF, pinned, keep))) {
        throw new Error(UI_TEXT.restoreFailed)
      }
      keep = pinned
      return await task(fresh)
    } finally {
      await this.releaseRestoreLease(shadow, keep)
    }
  }

  /**
   * Lets go of this window's restore lease. It runs after the files were
   * restored, so a failure here (a ref lock held for a moment) must not replace
   * the restore's outcome with a failure and hide its Redo: it is tried once
   * more, then logged. A lease this window still holds is taken over by its next
   * restore (see `withRestore`).
   */
  private async releaseRestoreLease(shadow: ShadowGit, keep: string): Promise<void> {
    const release = () =>
      shadow.run(['update-ref', '-d', RESTORE_REF, keep], { signal: new AbortController().signal })
    try {
      await release()
      return
    } catch {
      // Tried once more below.
    }
    await new Promise<undefined>((resolve) => {
      setTimeout(() => {
        resolve(undefined)
      }, CHECKPOINT_PUBLISH_RETRY_MS)
    })
    try {
      await release()
    } catch (error: unknown) {
      this.deps.log.warn(`The restore lease could not be released: ${failureForLog(error)}`)
    }
  }

  /** Shared serial/backend/CAS admission for both destructive operations. */
  private restoreAdmitted(
    request: RestoreRequest | RedoRequest,
    work: (setup: Setup, isAllowed: () => boolean) => Promise<RestoreOutcome>,
  ): Promise<RestoreOutcome> {
    const isAllowed = () => request.backend?.() === 'modelApi'
    return this.serial(async (): Promise<RestoreOutcome> => {
      if (!isAllowed()) {
        return { ok: false, reason: 'backendUnsupported' }
      }
      const initial = await this.ready()
      return await this.withRestore(
        initial,
        isAllowed,
        async (setup) => await work(setup, isAllowed),
      )
    })
  }

  /** Takes this window's native fence back after a startup that was refused, and says so. */
  private async withdrawNativeFence(): Promise<void> {
    this.runningTurns.delete(CHECKPOINT_NATIVE_WINDOW)
    try {
      await this.presence.publish(this.publishedTurns())
    } catch (error: unknown) {
      this.deps.log.warn(`The native fence could not be withdrawn: ${failureForLog(error)}`)
    }
  }

  /** Native/process uncertainty in this window or a freshly observed peer. */
  public get isNativeUnsafe(): boolean {
    return this.hasUnprovedLocalWork() || this.isPeerUnsafe
  }

  /** A turn of this window has its start recorded and its end not yet: its end takes the tools' copies. */
  public get hasOpenTurn(): boolean {
    return this.openTurns.size > 0
  }

  /** Actual I/O completion did not prove every workspace-capable descendant stopped. */
  public async markUnprovenProcess(): Promise<void> {
    this.runningTurns.set(CHECKPOINT_NATIVE_WINDOW, this.deps.now())
    this.startHeartbeat()
    await this.presence.publish(this.publishedTurns())
  }

  /**
   * Before a workspace-capable native process starts, even with checkpoints off.
   * Presence precedes the reservation check, without invoking Git. A packed
   * ref file is conservatively refused too; this implementation never packs refs.
   */
  public async markNativeBackend(): Promise<void> {
    if (this.stopping.signal.aborted) {
      throw new Error(UI_TEXT.sendMarkFailed)
    }
    // A fence an earlier start set stays: only the one this call sets is withdrawn.
    const isFirstStart = !this.runningTurns.has(CHECKPOINT_NATIVE_WINDOW)
    this.runningTurns.set(CHECKPOINT_NATIVE_WINDOW, this.deps.now())
    this.startHeartbeat()
    try {
      await this.presence.publish(this.publishedTurns())
      if (await this.hasReservedFiles()) {
        throw new Error(UI_TEXT.restoreTurnElsewhere)
      }
    } catch (error: unknown) {
      // A restore that refuses the start is proof nothing started (the callers start
      // nothing after a rejection): leaving the fence would keep this window and its
      // peers `nativeUnsafe`, across restarts, with nothing running. Any other
      // failure (the presence could not be written) stays fenced: fail closed.
      if (error instanceof Error && error.message === UI_TEXT.restoreTurnElsewhere) {
        if (isFirstStart) {
          await this.withdrawNativeFence()
        }
        throw error
      }
      this.deps.log.warn(`Native startup checkpoint admission failed: ${failureForLog(error)}`)
      throw new Error(UI_TEXT.checkpointsNativeUnsafe, { cause: error })
    }
  }

  /** A capture of the workspace now, with the folders it holds no file of, pinned until `record` or `release`. */
  public capture(): Promise<CaptureResult> {
    return this.serial(async (): Promise<CaptureResult> => {
      let setup: Setup
      try {
        setup = await this.ready()
      } catch (error: unknown) {
        return captureFailure(error)
      }
      const result = await this.captureNow(setup, true)
      if (!result.ok) {
        return result
      }
      const pin = `${this.pinPrefix}${this.deps.newId()}`
      await setup.shadow.run(['update-ref', pin, result.snapshot.tree])
      return { ok: true, snapshot: { ...result.snapshot, pin } }
    })
  }

  /** A capture no turn took: its pin goes. */
  public release(snapshot: Snapshot): Promise<void> {
    return this.serial(async () => {
      const { pin } = snapshot
      if (pin === undefined) {
        return
      }
      const { opened } = await this.open()
      await this.deleteRefs(opened.shadow, [pin])
    })
  }

  /**
   * Ties a capture to the turn it precedes (one ref, created only if absent),
   * unless the turn has one already (another window's) or its conversation
   * was archived since the capture. The turn is open here only once its
   * record exists; the capture's pin goes whatever happens.
   */
  public record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void> {
    return this.serial(async () => {
      const { opened } = await this.open()
      try {
        const setup = await this.ready()
        if (
          this.find(setup, sessionId, turnId) !== undefined ||
          isArchived(setup.archives, sessionId, snapshot.createdAt)
        ) {
          return
        }
        const id = `checkpoint-${createHash('sha256')
          .update(JSON.stringify([sessionId, turnId]))
          .digest('hex')}`
        const record: CheckpointRecord = {
          kind: 'checkpoint',
          top: setup.top,
          prefix: setup.prefix,
          id,
          sessionId,
          turnId,
          createdAt: snapshot.createdAt,
          sequence: nextTurnNumber(setup.records.checkpoints, sessionId),
          start: {
            tree: snapshot.tree,
            coverage: storedCoverage(snapshot.coverage),
            ...(snapshot.folders !== undefined && { folders: [...snapshot.folders] }),
          },
          owner: this.instance,
        }
        const keep = await writeRecord(
          setup.shadow,
          record,
          { trees: [{ name: 'start', tree: snapshot.tree }], blobs: [] },
          undefined,
        )
        if (keep === undefined) {
          return
        }
        this.openTurns.set(turnKey(sessionId, turnId), {
          id,
          createdAt: snapshot.createdAt,
          inventory: snapshot.inventory,
        })
        await this.presence.publish(this.publishedTurns())
        await this.retain(setup)
      } finally {
        if (snapshot.pin !== undefined) {
          await this.deleteRefs(opened.shadow, [snapshot.pin])
        }
      }
    })
  }

  /**
   * A turn (or a message about to start one, under its own key) begins or
   * stops running in this window. It is published at once in the window's
   * presence file, with no lock, so another window refuses a restore
   * meanwhile; this resolves once the file says so. A failed write is tried
   * again soon. When a mark ends, tool copies no turn needs any more go.
   */
  public async markTurn(key: string, isRunning: boolean, canRunGit = true): Promise<void> {
    if (key === CHECKPOINT_NATIVE_WINDOW || key === CHECKPOINT_FENCED_WINDOW) {
      throw new Error(UI_TEXT.checkpointsNativeUnsafe)
    }
    if (this.stopping.signal.aborted) {
      throw new Error(UI_TEXT.sendMarkFailed)
    }
    this.runningTurns.delete(key)
    if (isRunning) {
      this.runningTurns.set(key, this.deps.now())
    }
    this.startHeartbeat()
    try {
      await this.presence.publish(this.publishedTurns())
      if (isRunning && canRunGit) {
        const opened = await this.openIfUsable()
        if (opened !== undefined && (await refValue(opened.shadow, RESTORE_REF)) !== undefined) {
          throw new Error(UI_TEXT.restoreTurnElsewhere)
        }
      } else if (isRunning && (await this.hasReservedFiles())) {
        throw new Error(UI_TEXT.restoreTurnElsewhere)
      }
    } catch (error: unknown) {
      setTimeout(() => {
        void this.presence.beat().catch((retryError: unknown) => {
          this.deps.log.warn(`A running turn was not published again: ${failureForLog(retryError)}`)
        })
      }, CHECKPOINT_PUBLISH_RETRY_MS).unref()
      throw error
    }
    if (!isRunning) {
      await this.trimJournal()
    }
  }

  /**
   * The turn ended: its end is recorded (end capture, ignored changes, the
   * tools' copies). The turn stays open here until that is done, so no
   * trim can take a copy its end still needs.
   */
  public async endTurn(sessionId: string, turnId: string): Promise<void> {
    const key = turnKey(sessionId, turnId)
    const start = this.openTurns.get(key)
    if (start === undefined) {
      return
    }
    const endedAt = this.deps.now()
    const copies = await this.copiesSince(start.createdAt)
    await this.serial(async () => {
      await this.finishTurn(await this.ready(), start, endedAt, copies)
    })
    if (this.openTurns.get(key) === start) {
      this.openTurns.delete(key)
    }
    await this.trimJournal()
    await this.presence.publish(this.publishedTurns())
  }

  /** The turns of a conversation that have a checkpoint. */
  public turns(sessionId: string): Promise<readonly string[]> {
    return this.serial(async () => {
      const setup = await this.ready()
      return setup.records.checkpoints
        .filter((record) => record.sessionId === sessionId)
        .map((record) => record.turnId)
    })
  }

  /** Whether a path is in the checkpoint storage of any namespace (tools never write there). */
  public isStoragePath(absolutePath: string): boolean {
    return (
      isInShadowRepository(absolutePath) ||
      isWithinFolder(absolutePath, this.deps.storageDir) ||
      (this.deps.storageRoot !== undefined && isWithinFolder(absolutePath, this.deps.storageRoot))
    )
  }

  /**
   * The extension is about to write `absolutePath` for a running turn (the
   * Model API's tools, the image tools): what is there is copied first, once
   * per turn, into this window's staging folder, with no lock, so a restore
   * can put an ignored file back. A copy that cannot be made fails the
   * write: nothing is written without it.
   */
  public async beforeToolWrite(absolutePath: string): Promise<void> {
    if (this.isStopped()) {
      throw new Error(UI_TEXT.checkpointFailed)
    }
    if (!this.isAnyTurnRunning()) {
      return
    }
    const relative = this.relativeOf(absolutePath)
    if (relative === undefined) {
      return
    }
    const latestStart = Math.max(...this.runningSince())
    const entries = this.journal.get(relative) ?? []
    if ((entries.at(-1)?.at ?? -1) >= latestStart) {
      return
    }
    let copy: Omit<JournalEntry, 'at'>
    try {
      copy = await this.stage(relative)
    } catch (error: unknown) {
      this.deps.log.warn(`A checkpoint copy could not be kept: ${failureForLog(error)}`)
      throw new Error(UI_TEXT.checkpointFailed, { cause: error })
    }
    if (this.isStopped()) {
      if (typeof copy.staged === 'string') {
        await rm(copy.staged, { force: true })
      }
      throw new Error(UI_TEXT.checkpointFailed)
    }
    this.journal.set(relative, [...entries, { at: this.deps.now(), ...copy }])
  }

  /** Puts the workspace's files back as they were before the turn. */
  public restore(request: RestoreRequest): Promise<RestoreOutcome> {
    return this.restoreAdmitted(request, async (setup, isAllowed) => {
      const checkpoint = this.find(setup, request.sessionId, request.turnId)
      if (checkpoint === undefined) {
        return { ok: false, reason: 'noCheckpoint' }
      }
      const blocking = this.turnBlocking(setup)
      if (blocking !== undefined) {
        return { ok: false, reason: blocking }
      }
      // The checkpoint's turn and every turn that started after it, in the
      // conversation's own order: the clock can give an earlier turn the
      // same millisecond, or a later one an earlier time.
      const ordered = inTurnOrder(
        setup.records.checkpoints.filter((record) => record.sessionId === request.sessionId),
      )
      const turns = ordered.slice(ordered.findIndex((turn) => turn.record.id === checkpoint.id))
      const capture = await this.captureNow(setup, false)
      if (!capture.ok) {
        return {
          ok: false,
          reason: 'captureFailed',
          captureRefusal: capture.reason,
          detail: capture.detail,
        }
      }
      const current = capture.snapshot
      const changes = await this.diff(setup.shadow, checkpoint.start.tree, current.tree)
      const outside = await this.changedOutside(setup, turns, current.tree)
      const ignoredTurns = turns.map((turn) => turn.record.ignored?.changes ?? [])
      const currentStat = new Map<string, FileStat | null>()
      for (const change of ignoredTurns.flat()) {
        const stat = await regularFileStat(this.absoluteOf(change.path))
        currentStat.set(change.path, stat ?? null)
      }
      const isUnsaved = this.unsavedTest(request.unsavedPaths)
      const plan = planRestore({
        changes,
        changedOutsideTurns: outside.changed,
        uncertain: outside.uncertain,
        ignoredTurns,
        coverage: { checkpoint: checkpoint.start.coverage, current: current.coverage },
        currentStat,
        isUnsaved,
      })
      const inCurrent = new Map<string, BlobRef>()
      for (const change of changes) {
        if (change.after !== undefined) {
          inCurrent.set(change.path, change.after)
        }
      }
      const { planned, refused } = await this.plannedSteps(setup, plan.steps, inCurrent)
      const wasFolderThere = await this.wasFolderThere(setup.shadow, checkpoint.start)
      const applied = await this.runRecorded(
        setup,
        request.sessionId,
        planned,
        wasFolderThere,
        isUnsaved,
        isAllowed,
      )
      const changed = applied.entries.map((entry) => entry.path)
      return {
        ok: true,
        restoreId: applied.restoreId,
        changed,
        refused: [...plan.refused, ...refused, ...applied.refused],
        unsure: plan.unsure.filter((unsurePath) => changed.includes(unsurePath)),
        isIgnoredIncomplete: turns.some((turn) => turn.record.ignored?.isComplete !== true),
        isRedoSpent: false,
      }
    })
  }

  /**
   * Puts back what a restore (or a redo) replaced, file by file where each
   * is still as the restore left it; the redo can be redone in turn, and
   * what it could not do stays in the record for another try.
   */
  public redo(request: RedoRequest): Promise<RestoreOutcome> {
    return this.restoreAdmitted(request, async (setup, isAllowed) => {
      const record = setup.records.restores.find((candidate) => candidate.id === request.restoreId)
      const keep = setup.keeps.get(request.restoreId)
      if (record === undefined || keep === undefined) {
        return { ok: false, reason: 'redoGone' }
      }
      const blocking = this.turnBlocking(setup)
      if (blocking !== undefined) {
        return { ok: false, reason: blocking }
      }
      const steps: PlannedStep[] = record.entries.map((entry) => {
        const expect: Expectation =
          entry.after === null
            ? { kind: 'absent' }
            : { kind: 'blob', oid: entry.after.oid, mode: entry.after.mode }
        return {
          path: entry.path,
          target: entry.before,
          expect,
          before: entry.after,
          isIgnoreChecked: false,
        }
      })
      const applied = await this.runRecorded(
        setup,
        record.sessionId,
        steps,
        undefined,
        this.unsavedTest(request.unsavedPaths),
        isAllowed,
      )
      const donePaths = new Set(applied.entries.map((entry) => entry.path))
      let isStillKept = true
      try {
        isStillKept = await this.trimRestore(
          setup,
          record,
          keep,
          record.entries.filter((entry) => !donePaths.has(entry.path)),
          new AbortController().signal,
        )
      } catch (error: unknown) {
        this.deps.log.warn(`A redo's original record could not be trimmed: ${failureForLog(error)}`)
      }
      return {
        ok: true,
        restoreId: applied.restoreId,
        changed: applied.entries.map((entry) => entry.path),
        refused: applied.refused,
        unsure: [],
        isIgnoredIncomplete: false,
        isRedoSpent: !isStillKept,
      }
    })
  }

  /**
   * The conversation was archived: the archive is written to its own file
   * before anything else (no lock, no git), so every window honours it from
   * now on, whatever happens next; then this window deletes the
   * conversation's records and prunes their copies (those younger than the
   * grace period at the next cleanup).
   */
  public async forgetSession(sessionId: string): Promise<void> {
    await writeArchive(this.deps.storageDir, this.deps.newId(), {
      sessionId,
      at: this.deps.now(),
    })
    this.dropOpenTurns(sessionId)
    await this.serial(async () => {
      await this.tidy(await this.ready(), true)
    })
  }

  /**
   * The conversation was archived while no git may run (Restricted Mode):
   * the archive is written to its own file (no git), even before any
   * checkpoint exists; the records and copies go the next time a window that
   * may run git cleans up.
   */
  public async queueForget(sessionId: string): Promise<void> {
    await writeArchive(this.deps.storageDir, this.deps.newId(), {
      sessionId,
      at: this.deps.now(),
    })
    this.dropOpenTurns(sessionId)
  }

  /**
   * The window opened (or the workspace was trusted): when checkpoints were
   * ever taken here, what no one needs any more goes and the retention
   * bounds apply, whether or not checkpoints are on now.
   */
  public async maintain(): Promise<void> {
    if ((await lstatOrUndefined(path.join(this.deps.storageDir, SHADOW_HEAD))) === undefined) {
      return
    }
    await this.serial(async () => {
      await this.tidy(await this.ready(), true)
    })
  }

  /**
   * The window is closing: every git still running is ended, nothing new
   * starts (a restore under way stops before its next file), and the
   * window's presence and staged copies go.
   */
  public dispose(): void {
    this.stopping.abort()
    void this.queue.then(() => {
      clearInterval(this.heartbeat)
      this.presenceStopping.abort()
      if (!this.hasUnprovedLocalWork()) {
        this.presence.leave()
      }
      if (!this.hasUnprovedLocalWork()) {
        try {
          rmSync(this.stagingDir, { recursive: true, force: true })
        } catch {
          // Its folder goes with the next window's cleanup.
        }
      }
    })
  }
}
