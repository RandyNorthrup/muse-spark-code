// Turn checkpoints (M72, M86; PLAN.md D51, D63): a restore reverses only the
// writes the model's own file tools made, and only along an unbroken chain of
// bytes that ends in exactly what is on disk now. Nothing of the workspace is
// captured.
//
// - Units. Each turn of a conversation (child sessions' turns included, under
//   their top conversation) and each restore or Redo of it (a batch) is a
//   unit with a number of its own in the conversation: a ref under
//   `refs/muse-spark/m86/unit/`, created only if absent, so two windows never
//   take one number (the second takes the next). The record is made when the
//   unit starts, before any write.
// - Writes. The model's tools journal each write in this window's journal
//   (writeJournal.ts, the recorder in writeRecorder.ts) with a copy of the
//   bytes before and after. At a unit's end its writes are folded into its
//   record by write id, each with how it ended, and the copies it needs are
//   brought into the shadow repository (shadowGit.ts) under the record's
//   tree; then the journal is sealed for it, and only then does its running
//   mark go. A window that died leaves its journal: any window folds it into
//   the units' records by compare-and-swap, never writing that journal.
// - Restore and Redo. The conversation's units, the writes of everything else
//   to the same paths and each path's bytes on disk now go to the pure engine
//   (restoreChain.ts), which decides each path; the store writes what it
//   decided through the kept writer (checkpointFiles.ts), each write recorded
//   as the batch's own, so a later restore or Redo sees it.
// - Two windows on the same folder share the store with no lock. Each record
//   is its own ref, created only if absent and changed or deleted only from
//   the value it was read at (recordRefs.ts). A turn (or a message about to
//   start one) is published as running in the window's presence file before
//   it may edit a file (windowPresence.ts), and stays published until its unit
//   is sealed. No restore or Redo runs while any turn runs, in this window or
//   another live one, nor while a 0.10.0 window is live; one restore at a
//   time holds `CHECKPOINT_RESERVATION_REF` across windows.
// - Within a window, one operation runs at a time.

import type { Buffer } from 'node:buffer'
import { realpathSync } from 'node:fs'
import { rm, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BackendKind } from '../../core/agent/agentBackend'
import { failureForLog } from '../../core/backends/musecode/logText'
import {
  type BlobRef,
  gitBlobOid,
  parseBatchCheck,
  parseCatFileBatch,
} from '../../core/checkpoints/gitListings'
import { decideRange } from '../../core/checkpoints/restoreChain'
import type {
  ContentState,
  FoldedWrite,
  JournalEntry,
  Owner,
  PathDecision,
  PathRefusal,
  RangeInput,
  RangeRefusal,
  UnitKind,
  WriteOutcome,
  WriteRecord,
} from '../../core/checkpoints/toolWrites'
import { turnKey } from '../../core/checkpoints/turnKey'
import { isSamePath } from '../../core/paths'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  CHECKPOINT_BLOB_BATCH_MAX_BYTES,
  CHECKPOINT_BLOBS_DIR,
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_FOLD_ATTEMPTS,
  CHECKPOINT_FORGOTTEN_KEEP_MS,
  CHECKPOINT_HEARTBEAT_MS,
  CHECKPOINT_NATIVE_WINDOW,
  CHECKPOINT_PRUNE_GRACE_MS,
  CHECKPOINT_PRUNE_INTERVAL_MS,
  CHECKPOINT_PUBLISH_RETRY_MS,
  CHECKPOINT_SEQUENCE_ATTEMPTS,
  CHECKPOINT_STALE_LOCK_MS,
  CHECKPOINT_WRITES_DIR,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import type { GitProcess } from '../git'
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
  lstatOrUndefined,
  repositoryTop,
  resolvedPath,
  type RestoreTarget,
  type StepResult,
} from './checkpointFiles'
import { type StoredUnit } from './checkpointRecords'
import { CheckpointCopies } from './checkpointCopies'
import { CheckpointLease } from './checkpointLease'
import { droppedRecords } from './checkpointRetention'
import {
  deleteRefs,
  type HeldRef,
  type ListedRecord,
  type ListedUnit,
  listRecords,
  listUnits,
  readUnit,
  recordRef,
  sessionKey,
  unitRef,
  writeUnit,
} from './recordRefs'
import {
  indexFileInstance,
  isInShadowRepository,
  ShadowGit,
  ShadowPathTooLongError,
  ShadowStorageInWorkspaceError,
} from './shadowGit'
import { pathIdentityRelation } from '../../core/pathIdentity'
import { windowsPathProblem } from '../../core/windowsPathSpelling'
import { isLegacyWindow, WindowPresence } from './windowPresence'
import { WriteJournal } from './writeJournal'
import { innermostFolders, type WriteLanes } from './writeRecorder'

export { turnKey } from '../../core/checkpoints/turnKey'

/** Why a tool may not write a path (`storagePathProblem`); the host words it. */
export type StoragePathProblem = 'spelling' | 'storage' | 'uncertain'

/**
 * Why a restore or a Redo did nothing: no unit to restore from (any more); a
 * turn is running here, or in another window on the folder; the Redo's batch
 * is gone or not this conversation's; checkpoints are not available here; or
 * the engine refused the whole range (its edits not all recorded, a turn an
 * earlier version recorded, a 0.10.0 window live).
 */
export type RestoreFailure =
  | 'noCheckpoint'
  | 'turnRunning'
  | 'turnElsewhere'
  | 'redoGone'
  | 'unavailable'
  | 'backendUnsupported'
  | 'nativeUnsafe'
  | RangeRefusal

/** A path a restore or a Redo left as it is, and why. */
export interface PathOutcome {
  readonly path: string
  readonly reason: PathRefusal
}

export type RestoreOutcome =
  | {
      readonly ok: true
      /** The batch a Redo takes; undefined when nothing changed. */
      readonly restoreId: string | undefined
      readonly changed: readonly string[]
      /** Paths already as the restore would leave them (not refused). */
      readonly unchanged: readonly string[]
      readonly refused: readonly PathOutcome[]
      /** A unit in range ran commands, hooks or MCP tools: their changes are not undone. */
      readonly ranProcesses: boolean
      /** A Redo: whether its batch is spent (every path done or unchanged). */
      readonly isRedoSpent: boolean
    }
  | { readonly ok: false; readonly reason: RestoreFailure }

export interface RestoreRequest {
  /** Server-owned actual attached backend, read again after awaits; absent is unsafe. */
  readonly backend?: () => BackendKind | undefined
  readonly sessionId: string
  readonly turnId: string
  /**
   * The transcript's turn ids of the conversation from `turnId` on, the turns
   * of every child session they started included (spec 3.2): each must have
   * a record.
   */
  readonly transcriptTurnIds: readonly string[]
  /** Files open with unsaved changes, absolute, asked again before each file changes. */
  readonly unsavedPaths: () => readonly string[]
}

export interface RedoRequest {
  readonly backend?: () => BackendKind | undefined
  /** The conversation the Redo was offered in: it must be the batch's own. */
  readonly sourceSessionId: string
  /** The batch to redo. */
  readonly restoreId: string
  /** Read the full later transcript from the source batch's persisted anchor. */
  readonly transcriptTurnIds?: (fromTurnId: string) => Promise<readonly string[] | undefined>
  readonly unsavedPaths: () => readonly string[]
}

export interface CheckpointStoreDeps {
  readonly workspaceRoot: string
  /** The original first-folder spelling, only for conservative unsaved-editor matching. */
  readonly displayRoot?: string | undefined
  /** `<global storage>/checkpoints/<namespace>`: the shadow repository, the records and the journals. */
  readonly storageDir: string
  readonly platform: NodeJS.Platform
  readonly git: GitProcess
  /** The extension host's environment (PATH, HOME); `GIT_*` never reaches the shadow. */
  readonly env: NodeJS.ProcessEnv
  /** `museSpark.cleanupPeriodDays`: a conversation idle longer goes; 0 keeps them by age. */
  readonly retentionDays: () => number
  readonly now: () => number
  readonly newId: () => string
  /** This extension host's process, and whether another window's still runs. */
  readonly pid: number
  readonly isProcessAlive: (pid: number) => boolean
  /** This window's instance (`createTurnRecording`): the owner of every unit and write it records. */
  readonly instance: string
  /**
   * This window's journal and write lanes, the turns' recorder's own: the
   * store's restores and Redos journal their writes in it, take their places
   * in the one order and hold each path's lock as the tools' writes do.
   */
  readonly journal: WriteJournal
  readonly lanes: WriteLanes
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

/** One instance's journal as read: its entries and what its last line was. */
interface ReadJournal {
  readonly entries: readonly JournalEntry[]
  readonly tornTail: 'none' | 'unparsed' | 'intent'
}

type Journals = ReadonlyMap<string, ReadJournal>

/** What one instance's journal says of one unit. */
interface UnitFacts {
  readonly intents: readonly WriteRecord[]
  readonly done: ReadonlySet<string>
  readonly aborted: ReadonlySet<string>
  /** An `incomplete` marker, or a last line that could not be read while the unit was unsealed. */
  readonly isMarked: boolean
  readonly isSealed: boolean
}

/** A unit of this window started and not yet sealed. */
interface OpenUnit {
  readonly owner: Owner
  readonly ref: string
}

/** A unit whose end could not be folded or sealed yet: tried again before the next operation. */
interface PendingEnd {
  readonly unit: OpenUnit
  readonly endedAt: number
  readonly ranProcesses: boolean
}

/** The shadow repository and the workspace's place in its work tree (an M72 record's), set up once. */
interface Opened {
  readonly shadow: ShadowGit
  readonly top: string
  readonly prefix: string
}

/** An M72 turn of this place, which is listed as legacy and never restored. */
interface LegacyTurn {
  readonly sessionId: string
  readonly turnId: string
  /** Its start's number; an M72 candidate's record (no number) counts as before every other. */
  readonly sequence: number
  /** The last number it holds (its end's, when seen): the next unit is numbered after it. */
  readonly lastSequence: number
  readonly createdAt: number
}

/**
 * One operation's view, read afresh: every unit (archived ones left out),
 * this place's M72 turns, everything listed (for cleanup), the archives, and
 * each live window's running turns.
 */
interface Setup extends Opened {
  readonly units: readonly ListedUnit[]
  readonly legacy: readonly LegacyTurn[]
  readonly listedUnits: readonly ListedUnit[]
  readonly listedRecords: readonly ListedRecord[]
  readonly archives: readonly ArchiveFile[]
  readonly live: ReadonlyMap<string, readonly string[]>
}

/** A path's state now, as the restore read it. */
interface PathState {
  readonly content: ContentState
  readonly isTooLarge: boolean
}

const SHADOW_HEAD = path.join('shadow.git', 'HEAD')
const REF_ROOT = 'refs/muse-spark/'
// Refs and files an M72 window kept: its captures' pins, its index's ref and file, its staged copies.
const PIN_REF_PREFIX = `${REF_ROOT}pin/`
const WORK_REF_PREFIX = `${REF_ROOT}work/`
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
const SEPARATOR = '/'
const LINE_FEED = '\n'
const SPACE = ' '
const EXECUTABLE_BITS = 0o111
const DISPOSED = 'the checkpoint store was closed with the window'

/** Whether two owners are one unit of one window. */
function isSameOwner(left: Owner, right: Owner): boolean {
  return (
    left.instance === right.instance &&
    left.sessionId === right.sessionId &&
    left.unitKind === right.unitKind &&
    left.unitId === right.unitId
  )
}

function ownerKey(owner: Owner): string {
  return JSON.stringify([owner.instance, owner.sessionId, owner.unitKind, owner.unitId])
}

/** The unit a journal line speaks of; undefined for a write's settlement (named by write id). */
function ownerOf(entry: JournalEntry): Owner | undefined {
  if (entry.kind === 'intent') {
    return entry.write.owner
  }
  return entry.kind === 'incomplete' || entry.kind === 'seal' ? entry.owner : undefined
}

/** Cheap alias candidate filter; only OS resolution below decides actual identity. */
function foldedCase(relative: string): string {
  return relative.normalize('NFC').toLowerCase()
}

/** OS identity for live dirty documents, with spelling retained when lookup is unavailable. */
function editorIdentity(absolute: string): string {
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

/** A writer already admitted before cleanup's reservation keeps its copies. */
function hasLiveWriter(live: ReadonlyMap<string, readonly string[]>): boolean {
  for (const running of live.values()) {
    if (running.some((key) => key !== CHECKPOINT_FENCED_WINDOW)) {
      return true
    }
  }
  return false
}

/** What one instance's journal says of one unit. */
function factsOf(owner: Owner, journal: ReadJournal | undefined): UnitFacts {
  const entries = journal?.entries ?? []
  const intents = entries.flatMap((entry) =>
    entry.kind === 'intent' && isSameOwner(entry.write.owner, owner) ? [entry.write] : [],
  )
  const ids = new Set(intents.map((write) => write.id))
  const settledAs = (kind: 'done' | 'aborted') =>
    new Set(
      entries.flatMap((entry) => (entry.kind === kind && ids.has(entry.id) ? [entry.id] : [])),
    )
  const isSealed = entries.some((entry) => entry.kind === 'seal' && isSameOwner(entry.owner, owner))
  // A torn last line that parses as an intent is that intent, unsettled; one
  // that does not parse could have been any unsealed unit's.
  const isTorn =
    journal !== undefined &&
    (journal.tornTail === 'unparsed' ||
      (journal.tornTail === 'intent' && entries.at(-1)?.kind !== 'intent'))
  return {
    intents,
    done: settledAs('done'),
    aborted: settledAs('aborted'),
    isMarked:
      entries.some((entry) => entry.kind === 'incomplete' && isSameOwner(entry.owner, owner)) ||
      (isTorn && !isSealed),
    isSealed,
  }
}

/**
 * The record with the journal's facts folded in, by write id: a write keeps
 * an ending a fold already gave it (`done`, `aborted`), and is `unsettled`
 * until the journal settles it. Folding again changes nothing. A folded unit
 * is `complete` unless its journal says writes may exist that no intent
 * describes (spec 6.3, as amended): an unsettled write is the engine's to
 * judge at restore time (rule 6.4).
 */
function foldUnit(
  record: StoredUnit,
  facts: UnitFacts,
  end: { readonly endedAt: number | undefined; readonly ranProcesses: boolean },
): StoredUnit {
  const journaled = (id: string): WriteOutcome => {
    if (facts.done.has(id)) {
      return 'done'
    }
    return facts.aborted.has(id) ? 'aborted' : 'unsettled'
  }
  const folded = record.writes.map((write) =>
    write.outcome === 'unsettled' ? { ...write, outcome: journaled(write.id) } : write,
  )
  const known = new Set(record.writes.map((write) => write.id))
  for (const write of facts.intents) {
    if (known.has(write.id)) {
      continue
    }

    known.add(write.id)
    folded.push({ ...write, outcome: journaled(write.id) })
  }
  const writes = folded.toSorted((left, right) => left.seq - right.seq)
  const isMarkedIncomplete = record.isMarkedIncomplete || facts.isMarked
  return {
    ...record,
    ...(end.endedAt !== undefined && { endedAt: end.endedAt }),
    ranProcesses: record.ranProcesses || end.ranProcesses,
    isMarkedIncomplete,
    status: isMarkedIncomplete ? 'incomplete' : 'complete',
    writes,
  }
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

/** What a step's result means for the outcome's list. */
function refusalFor(result: Exclude<StepResult, 'done'>): PathRefusal {
  const reasons: Readonly<Record<Exclude<StepResult, 'done'>, PathRefusal>> = {
    changed: 'changedAfter',
    linked: 'linked',
    failed: 'failed',
    unsaved: 'unsaved',
    tooLarge: 'tooLarge',
  }
  return reasons[result]
}

/** The oids a write's copies need: its before for a restore, its after for a Redo. */
function neededOids(write: WriteRecord): readonly string[] {
  return [write.before, write.after].flatMap((state) =>
    state.present && state.oid !== undefined ? [state.oid] : [],
  )
}

export class CheckpointStore {
  private queue: Promise<unknown> = Promise.resolve()
  /** The shadow repository's setup: under way, or done. */
  private opening: Promise<Opened> | undefined
  private hasTidied = false
  private place: { readonly top: string; readonly prefix: string } | undefined
  /** Every turn running in the window, and every message about to start one, as published. */
  private readonly runningTurns = new Set<string>()
  /** This window's units started and not yet sealed, by owner. */
  private readonly openUnits = new Map<string, OpenUnit>()
  private readonly pendingEnds = new Map<string, PendingEnd>()
  private readonly stopping = new AbortController()
  /** Presence outlives cancellation until the final in-flight file/record step has settled. */
  private readonly presenceStopping = new AbortController()
  /** This store's id: one extension-host lifetime of one window. */
  private readonly ownInstance: string
  private readonly ownJournal: WriteJournal
  private readonly presence: WindowPresence
  private readonly lease: CheckpointLease
  private readonly copies: CheckpointCopies
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private lastPruneAt = 0
  private isPruneDue = false
  private isPeerUnsafe = false

  public constructor(private readonly deps: CheckpointStoreDeps) {
    this.ownInstance = deps.instance
    this.ownJournal = deps.journal
    this.copies = new CheckpointCopies(deps.storageDir, deps.log)
    this.presence = new WindowPresence({
      storageDir: deps.storageDir,
      instance: this.ownInstance,
      pid: deps.pid,
      isProcessAlive: deps.isProcessAlive,
      sleep: pause,
      signal: this.presenceStopping.signal,
    })
    this.lease = new CheckpointLease({
      instance: this.ownInstance,
      storageDir: deps.storageDir,
      now: deps.now,
      log: deps.log,
      isGone: async (instance) => {
        const live = await this.presence.liveWindows()
        return !live.has(instance)
      },
    })
  }

  private publishedTurns(): readonly string[] {
    const units = [
      ...this.openUnits.values(),
      ...Array.from(this.pendingEnds.values(), (end) => end.unit),
    ]
    return [
      CHECKPOINT_FENCED_WINDOW,
      ...new Set([
        ...this.runningTurns,
        ...units.flatMap(({ owner }) =>
          owner.unitKind === 'turn' ? [turnKey(owner.sessionId, owner.unitId)] : [],
        ),
      ]),
    ]
  }

  private hasUnprovedLocalWork(): boolean {
    if (this.runningTurns.has(CHECKPOINT_NATIVE_WINDOW)) {
      return true
    }
    for (const key of this.runningTurns) {
      if (key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) {
        return true
      }
    }
    return false
  }

  private get target(): RestoreTarget {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      log: this.deps.log,
      signal: this.stopping.signal,
    }
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

  /** Folds and seals the ends that failed before, from what they were, before another operation. */
  private async finishPendingEnds(): Promise<void> {
    if (this.pendingEnds.size === 0) {
      return
    }
    const { opened } = await this.open()
    for (const pending of this.pendingEnds.values()) {
      await this.sealUnit(opened.shadow, pending)
    }
  }

  /** The work tree's top and the workspace's place in it, as an M72 record names it (no git). */
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
   * moment: every caller shares the one setup under way. A setup that failed
   * is not kept: the next caller tries again.
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
        instance: this.ownInstance,
        gitPathMax: this.deps.gitPathMax,
        storageRoot: this.deps.storageRoot,
      },
      { git: this.deps.git, env: this.deps.env, signal: this.stopping.signal },
    )
    shadow.assertFits()
    await shadow.assertSeparate()
    await shadow.prepare()
    await shadow.clearStaleLocks(this.deps.now(), CHECKPOINT_STALE_LOCK_MS)
    return { shadow, top, prefix }
  }

  /**
   * The shadow repository for a turn's start, or undefined where none can ever
   * exist: a path git cannot use, or storage and workspace holding one another.
   * Every window of that folder meets the same refusal, so no restore can be
   * running elsewhere and the turn goes ahead with no record; any other
   * failure still stops it.
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
    await this.lease.recoverAbandoned(opened)
    const listedUnits = await listUnits(opened.shadow)
    const listedRecords = await listRecords(opened.shadow)
    const archives = await readArchives(this.deps.storageDir)
    const live = await this.presence.liveWindows()
    this.isPeerUnsafe = [...live].some(
      ([instance, running]) => instance !== this.ownInstance && this.isUnfenced(running),
    )
    const units = listedUnits.filter(
      (unit) => unit.record?.isRetired !== true && !this.isUnitArchived(archives, unit),
    )
    const legacy = listedRecords.flatMap((entry): LegacyTurn[] => {
      const { record } = entry
      return record?.kind === 'checkpoint' &&
        record.top === opened.top &&
        record.prefix === opened.prefix &&
        !isArchived(archives, record.sessionId, record.createdAt)
        ? [
            {
              sessionId: record.sessionId,
              turnId: record.turnId,
              sequence: record.sequence ?? 0,
              lastSequence: Math.max(record.sequence ?? 0, record.endSequence ?? 0),
              createdAt: record.createdAt,
            },
          ]
        : []
    })
    const setup: Setup = { ...opened, units, legacy, listedUnits, listedRecords, archives, live }
    if (!this.hasTidied) {
      this.hasTidied = true
      await this.recover(setup, await WriteJournal.readAll(this.deps.storageDir))
      await this.tidy(await this.ready(), false)
      return await this.ready()
    }
    return setup
  }

  /** A window whose running list proves no fence of either version, or names native work. */
  private isUnfenced(running: readonly string[]): boolean {
    return (
      (!running.includes(CHECKPOINT_FENCED_WINDOW) && !isLegacyWindow(running)) ||
      running.includes(CHECKPOINT_NATIVE_WINDOW)
    )
  }

  /** A unit of an archived conversation made at or before the archive; an unreadable one when its conversation was archived. */
  private isUnitArchived(archives: readonly ArchiveFile[], unit: ListedUnit): boolean {
    return unit.record === undefined
      ? archives.some((entry) => sessionKey(entry.archive.sessionId) === unit.sessionKey)
      : isArchived(archives, unit.record.owner.sessionId, unit.record.createdAt)
  }

  /** Whether a 0.10.0 window is live: this version then restores nothing and deletes no record. */
  private isLegacyLive(setup: Pick<Setup, 'live'>): boolean {
    for (const running of setup.live.values()) {
      if (isLegacyWindow(running)) {
        return true
      }
    }
    return false
  }

  /** Whether a ref named by a window's instance belongs to a window that is gone. */
  private isGoneWindowRef(
    ref: string,
    prefix: string,
    live: ReadonlyMap<string, readonly string[]>,
  ): boolean {
    return ref.startsWith(prefix) && !live.has(ref.slice(prefix.length).split(SEPARATOR)[0] ?? '')
  }

  /** The names in a folder; none when it is missing. */
  private async namesIn(folder: string): Promise<readonly string[]> {
    try {
      return await readdir(folder)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return []
      }
      throw error
    }
  }

  /**
   * What gone M72 windows left: their staging folders and index files, and
   * files of earlier builds.
   */
  private async dropGoneFiles(): Promise<void> {
    const stagingRoot = path.join(this.deps.storageDir, STAGING_DIR)
    const staged = await this.namesIn(stagingRoot)
    const names = await this.namesIn(this.deps.storageDir)
    // A window publishes before creating these files. Enumerate first,
    // then read presence, so a new window cannot be mistaken for an orphan.
    const live = await this.presence.liveWindows()
    const goneStaging = staged.filter((entry) => !live.has(entry))
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
   * The journal folders of gone windows whose units no record holds any
   * more (retention or an archive took them; their copies were brought into
   * the records' trees when they were folded). Right after those records
   * go: a journal naming a unit with no record refuses its conversation's
   * restores (rule 3.2).
   */
  private async dropGoneJournals(shadow: ShadowGit): Promise<void> {
    const journalsRoot = path.join(this.deps.storageDir, CHECKPOINT_WRITES_DIR)
    const journalFolders = await this.namesIn(journalsRoot)
    const journals = await WriteJournal.readAll(this.deps.storageDir)
    const units = await listUnits(shadow)
    // A surviving unreadable ref is not evidence of retirement. Keep every
    // recovery input until it can be explained, including a first torn line.
    if (units.some((unit) => unit.record === undefined)) {
      return
    }
    const retired = units.flatMap((unit) =>
      unit.record?.isRetired === true ? [unit.record.owner] : [],
    )
    // Enumerated first, as above: a window publishes before its journal exists.
    const live = await this.presence.liveWindows()
    const goneJournals = journalFolders.filter((name) => !live.has(name))
    for (const instance of goneJournals) {
      const journal = journals.get(instance)
      if (journal?.tornTail === 'unparsed') {
        continue
      }
      const entries = journal?.entries ?? []
      const isStillNeeded =
        units.some(
          (unit) => unit.record?.owner.instance === instance && unit.record.isRetired !== true,
        ) ||
        entries.some((entry) => {
          const owner = ownerOf(entry)
          return owner !== undefined && retired.every((candidate) => !isSameOwner(candidate, owner))
        })
      if (isStillNeeded || this.copies.isScanning(instance)) continue
      const copies = await this.namesIn(path.join(journalsRoot, instance, CHECKPOINT_BLOBS_DIR))
      if (copies.length === 0)
        await rm(path.join(journalsRoot, instance), { recursive: true, force: true })
    }
  }

  /**
   * Archive files past their time go, once the records they archived are
   * gone (until then they keep hiding them).
   */
  private async dropOldArchives(setup: Setup, deleted: ReadonlySet<string>): Promise<void> {
    const now = this.deps.now()
    for (const entry of setup.archives) {
      if (now - entry.archive.at < CHECKPOINT_FORGOTTEN_KEEP_MS) {
        continue
      }
      const { sessionId, at } = entry.archive
      const isHiding =
        setup.listedUnits.some(
          (unit) =>
            !deleted.has(unit.ref) &&
            unit.record?.isRetired !== true &&
            unit.record?.owner.sessionId === sessionId &&
            unit.record.createdAt <= at,
        ) ||
        setup.listedRecords.some(
          (listed) =>
            !deleted.has(recordRef(listed.id)) &&
            listed.record?.sessionId === sessionId &&
            listed.record.createdAt <= at,
        )
      if (!isHiding) {
        await removeArchive(entry)
      }
    }
  }

  /** Whether a listed unit still runs: its record has no end and its window is live. */
  private isUnitOpen(setup: Pick<Setup, 'live'>, unit: ListedUnit): boolean {
    return (
      unit.record !== undefined &&
      unit.record.endedAt === undefined &&
      setup.live.has(unit.record.owner.instance)
    )
  }

  /**
   * The refs the bounds drop: archived units, units and M72 turns past the
   * retention bounds, M72 records of another place or unreadable, and every
   * M72 restore record (which this version cannot redo).
   */
  private droppedRefs(setup: Setup): readonly HeldRef[] {
    const units = setup.listedUnits
      .filter((unit) => unit.record !== undefined && unit.record.isRetired !== true)
      .map((unit) => ({
        held: { ref: unit.ref, keep: unit.keep },
        sessionId: unit.sessionKey,
        sequence: unit.sequence,
        createdAt: unit.record?.createdAt ?? -Infinity,
        isOpen: this.isUnitOpen(setup, unit),
        isArchived: this.isUnitArchived(setup.archives, unit) && !this.isUnitOpen(setup, unit),
      }))
    const records = setup.listedRecords.map((listed) => {
      const { record } = listed
      const isHere = record?.top === setup.top && record.prefix === setup.prefix
      return {
        held: { ref: recordRef(listed.id), keep: listed.keep },
        sessionId: sessionKey(record?.sessionId ?? ''),
        sequence: record?.kind === 'checkpoint' ? (record.sequence ?? 0) : 0,
        createdAt: record?.createdAt ?? -Infinity,
        isOpen: false,
        isArchived:
          record === undefined ||
          !isHere ||
          record.kind === 'restore' ||
          isArchived(setup.archives, record.sessionId, record.createdAt),
      }
    })
    const kept = [...units, ...records].filter((entry) => !entry.isArchived)
    const dropped = new Set<unknown>(
      droppedRecords(kept, this.deps.now(), this.deps.retentionDays()),
    )
    const isDroppable = (entry: { readonly isArchived: boolean }) =>
      entry.isArchived || dropped.has(entry)
    return [
      ...units.filter((entry) => isDroppable(entry)),
      ...records.filter((entry) => isDroppable(entry)),
    ].map((entry) => entry.held)
  }

  /** Retire by CAS, dropping bytes but retaining the owner and sequence as durable proof. */
  private async retireRefs(setup: Setup): Promise<readonly string[]> {
    const selected = this.droppedRefs(setup)
    const retired: string[] = []
    const legacy: HeldRef[] = []
    for (const held of selected) {
      const unit = setup.listedUnits.find((candidate) => candidate.ref === held.ref)
      if (unit?.record === undefined) {
        legacy.push(held)
        continue
      }
      const record: StoredUnit = { ...unit.record, isRetired: true, writes: [] }
      if ((await writeUnit(setup.shadow, held.ref, record, [], held.keep)) !== undefined) {
        retired.push(held.ref)
      }
    }
    return [...retired, ...(await deleteRefs(setup.shadow, legacy))]
  }

  /** Mark live journal/record references and sweep all older unreferenced copies. */
  private async sweepCopies(shadow: ShadowGit): Promise<void> {
    const units = await listUnits(shadow)
    if (
      units.some((unit) => unit.record === undefined) ||
      hasLiveWriter(await this.presence.liveWindows())
    )
      return
    const retired = units.flatMap((unit) =>
      unit.record?.isRetired === true ? [unit.record.owner] : [],
    )
    const writes = units.flatMap((unit) =>
      unit.record?.isRetired === true ? [] : (unit.record?.writes ?? []),
    )
    await this.copies.sweep(retired, writes)
  }

  /** Cleanup and restore share one CAS lease; a precheck alone cannot protect source copies. */
  private async withCleanup(setup: Setup, task: () => Promise<void>): Promise<void> {
    if (this.isLegacyLive(setup)) {
      return
    }
    const keep = await this.lease.acquire(setup)
    if (keep === undefined) {
      return
    }
    try {
      if (!this.isLegacyLive({ live: await this.presence.liveWindows() })) {
        await task()
      }
    } finally {
      await this.lease.release(setup.shadow, keep)
    }
  }

  /**
   * Drops what no one needs any more: archived units, units and M72 records
   * the retention bounds exclude (each only if unchanged since it was read),
   * the refs and files an M72 window that is gone kept, the journal folders
   * of gone windows no record needs, and archive files past their time.
   * Unreferenced copies are then pruned when due (or now), sparing objects
   * younger than the grace period. While a restore runs, or a 0.10.0 window
   * is live, nothing goes.
   */
  private async tidy(setup: Setup, isPruneForced: boolean): Promise<void> {
    await this.withCleanup(setup, async () => {
      const deleted = new Set(await this.retireRefs(setup))
      if (deleted.size > 0) {
        this.isPruneDue = true
      }
      const refs = await setup.shadow.text([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        REF_ROOT,
      ])
      // Enumerate refs before refreshing windows: a window publishes its
      // presence before creating any ref this enumeration can see.
      const live = await this.presence.liveWindows()
      if (this.isLegacyLive({ live })) {
        return
      }
      const stale = refs.split(LINE_FEED).flatMap((line): HeldRef[] => {
        const [ref = '', keep = ''] = line.split(SPACE)
        const isStale =
          ref === LEGACY_INDEX_REF ||
          LEGACY_REF_PREFIXES.some((prefix) => ref.startsWith(prefix)) ||
          this.isGoneWindowRef(ref, PIN_REF_PREFIX, live) ||
          this.isGoneWindowRef(ref, WORK_REF_PREFIX, live)
        return isStale ? [{ ref, keep }] : []
      })
      const deletedStale = await deleteRefs(setup.shadow, stale)
      if (deletedStale.length > 0) {
        this.isPruneDue = true
      }
      await this.dropGoneFiles()
      await this.sweepCopies(setup.shadow)
      await this.dropGoneJournals(setup.shadow)
      await this.dropOldArchives(setup, deleted)
      const isIntervalOver = this.deps.now() - this.lastPruneAt > CHECKPOINT_PRUNE_INTERVAL_MS
      if (this.isPruneDue && (isPruneForced || isIntervalOver)) {
        await this.prune(setup.shadow)
      }
    })
  }

  /** Deletes every copy no ref names, sparing those younger than the grace period. */
  private async prune(shadow: ShadowGit): Promise<void> {
    const live = await this.presence.liveWindows()
    if (hasLiveWriter(live)) {
      return
    }
    await shadow.prune(CHECKPOINT_PRUNE_GRACE_MS)
    this.lastPruneAt = this.deps.now()
    this.isPruneDue = false
  }

  /**
   * Retention after a unit ended or a restore ran: the records the bounds
   * drop (each only if unchanged), pruned when due. Nothing goes while a
   * restore runs or a 0.10.0 window is live.
   */
  private async retain(): Promise<void> {
    const setup = await this.ready()
    await this.withCleanup(setup, async () => {
      const deleted = await this.retireRefs(setup)
      if (deleted.length > 0) {
        this.isPruneDue = true
      }
      await this.sweepCopies(setup.shadow)
      await this.dropGoneJournals(setup.shadow)
      const isIntervalOver = this.deps.now() - this.lastPruneAt > CHECKPOINT_PRUNE_INTERVAL_MS
      if (isIntervalOver && this.isPruneDue) {
        await this.prune(setup.shadow)
      }
    })
  }

  private absoluteOf(relative: string): string {
    return path.join(this.deps.workspaceRoot, ...relative.split(SEPARATOR))
  }

  private unsavedTest(unsavedPaths: () => readonly string[]): (relative: string) => boolean {
    return (relative) =>
      unsavedPaths().some(
        (unsaved) =>
          isSamePath(unsaved, this.absoluteOf(relative), this.deps.platform) ||
          isSamePath(
            editorIdentity(unsaved),
            editorIdentity(this.absoluteOf(relative)),
            this.deps.platform,
          ) ||
          (this.deps.displayRoot !== undefined &&
            isSamePath(
              unsaved,
              path.join(this.deps.displayRoot, ...relative.split(SEPARATOR)),
              this.deps.platform,
            )),
      )
  }

  private isAnyTurnRunning(): boolean {
    return this.runningTurns.size > 0 || this.openUnits.size > 0 || this.pendingEnds.size > 0
  }

  /**
   * Why no restore or Redo may run now: a 0.10.0 window is live, a window
   * that proves no fence, a turn running here, or a turn (or a message about
   * to start one) another live window publishes.
   */
  private turnBlocking(setup: Setup): RestoreFailure | undefined {
    if (this.isLegacyLive(setup)) {
      return 'legacyWindowOpen'
    }
    if ([...setup.live].some(([, running]) => this.isUnfenced(running))) {
      return 'nativeUnsafe'
    }
    if (this.isAnyTurnRunning()) {
      return 'turnRunning'
    }
    const isElsewhere = [...setup.live].some(
      ([instance, running]) =>
        instance !== this.ownInstance && running.some((key) => key !== CHECKPOINT_FENCED_WINDOW),
    )
    return isElsewhere ? 'turnElsewhere' : undefined
  }

  /**
   * The copies the folded writes need, brought into the shadow repository
   * from their windows' journals where it lacks them. A write whose copy is
   * in neither is no longer kept.
   */
  private async keptCopies(
    shadow: ShadowGit,
    writes: readonly FoldedWrite[],
    signal: AbortSignal,
  ): Promise<{ readonly writes: readonly FoldedWrite[]; readonly blobs: readonly BlobRef[] }> {
    const wanted = [...new Set(writes.flatMap((write) => (write.isKept ? neededOids(write) : [])))]
    const present = new Set<string>()
    if (wanted.length > 0) {
      const answer = await shadow.text(['cat-file', '--batch-check'], {
        input: wanted.map((oid) => `${oid}${LINE_FEED}`).join(''),
        signal,
      })
      for (const oid of parseBatchCheck(answer).keys()) {
        present.add(oid)
      }
    }
    const imports = new Map<string, string>()
    for (const write of writes) {
      const oids = write.isKept ? neededOids(write) : []
      for (const oid of oids) {
        const file = WriteJournal.blobPath(this.deps.storageDir, write.instance, oid)
        if (
          !present.has(oid) &&
          !imports.has(oid) &&
          (await lstatOrUndefined(file)) !== undefined
        ) {
          imports.set(oid, file)
        }
      }
    }
    if (imports.size > 0) {
      const files = [...imports]
      const hashed = await shadow.text(['hash-object', '-w', '--no-filters', '--stdin-paths'], {
        input: files.map(([, file]) => `${file}${LINE_FEED}`).join(''),
        signal,
      })
      const oids = hashed.split(LINE_FEED)
      for (const [index, [oid]] of files.entries()) {
        // A copy whose bytes are not what its name says is not kept.
        if (oids[index] === oid) {
          present.add(oid)
        }
      }
    }
    const folded = writes.map((write) =>
      write.isKept && neededOids(write).some((oid) => !present.has(oid))
        ? { ...write, isKept: false }
        : write,
    )
    const blobs = [...new Set(folded.flatMap((write) => (write.isKept ? neededOids(write) : [])))]
    return { writes: folded, blobs: blobs.map((oid) => ({ mode: GIT_MODE_FILE, oid })) }
  }

  /**
   * Folds a journal's facts into a unit's record by compare-and-swap, read
   * again whenever another window changed it meanwhile: whether it wrote the
   * record, found it already folded, or found it gone (archived, or dropped
   * by retention), when there is nothing to fold into and none is made.
   * Recording what already happened outlives a closing window: its git runs
   * to the end.
   */
  private async foldInto(
    shadow: ShadowGit,
    ref: string,
    facts: UnitFacts,
    end: { readonly endedAt: number | undefined; readonly ranProcesses: boolean },
  ): Promise<'written' | 'same' | 'gone'> {
    const finalizing = new AbortController().signal
    for (let attempt = 0; attempt < CHECKPOINT_FOLD_ATTEMPTS; attempt += 1) {
      const current = await readUnit(shadow, ref, finalizing)
      if (current === undefined || current.record.isRetired === true) {
        return 'gone'
      }
      const folded = foldUnit(current.record, facts, end)
      const kept = await this.keptCopies(shadow, folded.writes, finalizing)
      const record: StoredUnit = { ...folded, writes: kept.writes }
      if (JSON.stringify(record) === JSON.stringify(current.record)) {
        return 'same'
      }
      if (
        (await writeUnit(shadow, ref, record, kept.blobs, current.keep, finalizing)) !== undefined
      ) {
        return 'written'
      }
    }
    throw new Error(UI_TEXT.checkpointFailed)
  }

  /**
   * A unit's end: its writes folded into its record, then the journal sealed
   * for it, then its running mark withdrawn. A failure keeps it pending (and
   * its mark published), to be tried again before the next operation.
   */
  private async sealUnit(shadow: ShadowGit, pending: PendingEnd): Promise<void> {
    const { owner, ref } = pending.unit
    const key = ownerKey(owner)
    this.pendingEnds.set(key, pending)
    this.openUnits.delete(key)
    const journal = await this.ownJournal.snapshot()
    await this.foldInto(shadow, ref, factsOf(owner, journal), {
      endedAt: pending.endedAt,
      ranProcesses: pending.ranProcesses,
    })
    await this.ownJournal.appendSeal(owner)
    this.pendingEnds.delete(key)
    if (owner.unitKind === 'turn') {
      this.runningTurns.delete(turnKey(owner.sessionId, owner.unitId))
    }
    await this.presence.publish(this.publishedTurns())
  }

  /**
   * Folds what windows that are gone left into their units' records (spec
   * 6.4): each unit of theirs never folded (cut short, journal lines or none)
   * or unsealed in their journal, idempotent by write id. A unit cut short
   * may have run commands nobody can name now: it counts as having run them.
   * Another window's journal is only read.
   */
  private async recover(setup: Setup, journals: Journals): Promise<boolean> {
    let isChanged = false
    for (const unit of setup.listedUnits) {
      const { record } = unit
      if (
        record === undefined ||
        record.isRetired === true ||
        setup.live.has(record.owner.instance)
      ) {
        continue
      }
      const journal = journals.get(record.owner.instance)
      const facts = factsOf(record.owner, journal)
      // A unit never folded (its window went mid-turn, with or without a
      // journal line), or named unsealed by its window's journal.
      const isNeverFolded = record.status === 'incomplete' && !record.isMarkedIncomplete
      const isUnsealed =
        journal?.entries.some((entry) => {
          const owner = ownerOf(entry)
          return owner !== undefined && isSameOwner(owner, record.owner)
        }) === true && !facts.isSealed
      if (!isNeverFolded && !isUnsealed) {
        continue
      }
      // A unit folded at its end keeps what it said; one cut short ran what nobody can name now.
      const folded = await this.foldInto(setup.shadow, unit.ref, facts, {
        endedAt: undefined,
        ranProcesses: record.endedAt === undefined,
      })
      isChanged ||= folded === 'written'
    }
    return isChanged
  }

  /**
   * Takes the conversation's next unit number and makes the unit's record
   * there (one ref, created only if absent): another window that took the
   * number first makes this one take the next. M72 turns count.
   */
  private async startUnitNow(
    setup: Setup,
    owner: Owner,
    transcript?: StoredUnit['transcript'],
  ): Promise<{ readonly sequence: number }> {
    const key = sessionKey(owner.sessionId)
    const numbers = [
      ...setup.listedUnits.filter((unit) => unit.sessionKey === key).map((unit) => unit.sequence),
      ...setup.legacy
        .filter((turn) => turn.sessionId === owner.sessionId)
        .map((turn) => turn.lastSequence),
    ]
    let sequence = Math.max(0, ...numbers) + 1
    for (let attempt = 0; attempt < CHECKPOINT_SEQUENCE_ATTEMPTS; attempt += 1) {
      const ref = unitRef(owner.sessionId, sequence)
      const record: StoredUnit = {
        kind: 'unit',
        owner,
        sequence,
        createdAt: this.deps.now(),
        status: 'incomplete',
        ranProcesses: false,
        isMarkedIncomplete: false,
        writes: [],
        ...(transcript !== undefined && { transcript }),
      }
      if ((await writeUnit(setup.shadow, ref, record, [], undefined)) !== undefined) {
        this.openUnits.set(ownerKey(owner), { owner, ref })
        await this.presence.publish(this.publishedTurns())
        return { sequence }
      }
      sequence += 1
    }
    throw new Error(UI_TEXT.checkpointFailed)
  }

  /** The bytes of these blobs, by object name, read in bounded batches; a missing one is absent. */
  private async blobsOf(
    shadow: ShadowGit,
    oids: readonly string[],
  ): Promise<ReadonlyMap<string, Buffer>> {
    const unique = [...new Set(oids)]
    const blobs = new Map<string, Buffer>()
    if (unique.length === 0) {
      return blobs
    }
    const sizes = parseBatchCheck(
      await shadow.text(['cat-file', '--batch-check'], {
        input: unique.map((oid) => `${oid}${LINE_FEED}`).join(''),
      }),
    )
    const batches: string[][] = []
    let current: string[] = []
    let bytes = 0
    const stored = unique.filter((candidate) => sizes.has(candidate))
    for (const oid of stored) {
      const size = sizes.get(oid) ?? 0
      if (current.length > 0 && bytes + size > CHECKPOINT_BLOB_BATCH_MAX_BYTES) {
        batches.push(current)
        current = []
        bytes = 0
      }
      current.push(oid)
      bytes += size
    }
    if (current.length > 0) {
      batches.push(current)
    }
    for (const batch of batches) {
      const output = await shadow.run(['cat-file', '--batch'], {
        input: batch.map((oid) => `${oid}${LINE_FEED}`).join(''),
      })
      for (const [oid, content] of parseCatFileBatch(output)) {
        if (content !== undefined) {
          blobs.set(oid, content)
        }
      }
    }
    return blobs
  }

  /** A path's bytes and presence on disk now (its mode for a write's record). */
  private async stateOf(relative: string, rangeFolders: ReadonlySet<string>): Promise<PathState> {
    const absolute = this.absoluteOf(relative)
    const stats = await lstatOrUndefined(absolute)
    // A folder the range's own writes made goes with their files: as far as
    // the file of that name is concerned, nothing is there (the writer still
    // refuses when it is not empty by then).
    if (stats === undefined || (stats.isDirectory() && rangeFolders.has(relative))) {
      return { content: { present: false }, isTooLarge: false }
    }
    if (!stats.isFile()) {
      // A folder, a link or a device: present, and no bytes any write left.
      return { content: { present: true }, isTooLarge: false }
    }
    const isExecutable = this.deps.platform !== 'win32' && (stats.mode & EXECUTABLE_BITS) !== 0
    const mode = isExecutable ? GIT_MODE_EXECUTABLE : GIT_MODE_FILE
    if (stats.size > CHECKPOINT_FILE_MAX_BYTES) {
      return { content: { present: true, mode }, isTooLarge: true }
    }
    return {
      content: { present: true, oid: gitBlobOid(await readFile(absolute)), mode },
      isTooLarge: false,
    }
  }

  /**
   * Whether a journal names a unit of the conversation that has no record
   * (spec 3.2): its writes are nowhere a restore can see, and where it falls
   * cannot be told. A record is made before its unit's first write, and
   * retirement keeps its owner/sequence identity after dropping its payload.
   * Only unexplained missing owners refuse a later range; archived owners
   * with durable retirement proof do not poison new turns.
   */
  private hasUnrecordedOwner(
    journals: Journals,
    sessionId: string,
    listed: readonly ListedUnit[],
  ): boolean {
    const recorded = listed.flatMap((unit) =>
      unit.record?.owner.sessionId === sessionId ? [unit.record.owner] : [],
    )
    for (const journal of journals.values()) {
      const isUnrecorded = journal.entries.some(
        (entry) =>
          entry.kind === 'intent' &&
          entry.write.owner.sessionId === sessionId &&
          recorded.every((owner) => !isSameOwner(owner, entry.write.owner)),
      )
      if (isUnrecorded) {
        return true
      }
    }
    return false
  }

  /**
   * Decides a restore or a Redo with the engine and writes what it decided
   * as a batch of its own: each write journaled before it is made, and the
   * batch sealed at the end, so a later restore or Redo sees it.
   */
  private async restoreRange(
    setup: Setup,
    journals: Journals,
    request: {
      readonly sessionId: string
      readonly from: { readonly unitKind: UnitKind; readonly unitId: string }
      readonly mode: RangeInput['mode']
      readonly transcriptTurnIds: readonly string[]
      readonly transcript: NonNullable<StoredUnit['transcript']>
      readonly isUnsaved: (relative: string) => boolean
    },
    isAllowed: () => boolean,
  ): Promise<RestoreOutcome> {
    const { sessionId, from } = request
    const key = sessionKey(sessionId)
    const conversation = setup.units.filter((unit) => unit.sessionKey === key)
    const start = conversation.find(
      (unit) =>
        unit.record?.owner.unitKind === from.unitKind && unit.record.owner.unitId === from.unitId,
    )
    if (start === undefined) {
      if (request.mode === 'redo') {
        return { ok: false, reason: 'redoGone' }
      }
      const isLegacy = setup.legacy.some(
        (turn) => turn.sessionId === sessionId && turn.turnId === from.unitId,
      )
      return { ok: false, reason: isLegacy ? 'legacyInRange' : 'noCheckpoint' }
    }
    // A unit whose record does not parse, in range, and a journal naming a
    // unit with no record are what the engine cannot see (spec 3.2); every
    // other completeness rule is the engine's.
    const isUnreadableInRange = conversation.some(
      (unit) => unit.record === undefined && unit.sequence >= start.sequence,
    )
    if (isUnreadableInRange || this.hasUnrecordedOwner(journals, sessionId, setup.listedUnits)) {
      return { ok: false, reason: 'writesIncomplete' }
    }
    const records = conversation.flatMap((unit) => (unit.record === undefined ? [] : [unit.record]))
    // Each recorded path as it names a file now: keys that now name one file are one path.
    const resolved = new Map<string, string | undefined>()
    const resolve = async (key: string): Promise<string | undefined> => {
      if (!resolved.has(key)) {
        resolved.set(key, await resolvedPath(this.target, key))
      }
      return resolved.get(key)
    }
    const linked = new Set<string>()
    const pathOf = async (key: string): Promise<string> => {
      const found = await resolve(key)
      if (found === undefined) {
        linked.add(key)
        return key
      }
      return found
    }
    const rekey = async (write: FoldedWrite): Promise<FoldedWrite> => ({
      ...write,
      path: await pathOf(write.path),
    })
    const units: RangeInput['units'] = [
      ...(await Promise.all(
        records.map(async (unit) => ({
          ...unit,
          writes: await Promise.all(unit.writes.map(async (write) => await rekey(write))),
        })),
      )),
      ...setup.legacy
        .filter((turn) => turn.sessionId === sessionId)
        .map((turn) => ({ legacy: true as const, sequence: turn.sequence, turnId: turn.turnId })),
    ]
    const rangePaths = new Set(
      units.flatMap((unit) =>
        'legacy' in unit || unit.sequence < start.sequence
          ? []
          : unit.writes.map((write) => write.path),
      ),
    )
    const rangeCases = new Set(Array.from(rangePaths, (relative) => foldedCase(relative)))
    const foreignWrites: WriteRecord[] = []
    for (const unit of setup.units) {
      const record = unit.record
      const isOwnRange =
        record !== undefined && unit.sessionKey === key && unit.sequence >= start.sequence
      if (record === undefined || isOwnRange) {
        continue
      }
      for (const write of record.writes) {
        if (write.outcome === 'aborted' || !rangeCases.has(foldedCase(write.path))) {
          continue
        }
        const rekeyed = { ...write, path: await pathOf(write.path) }
        if (rangePaths.has(rekeyed.path)) {
          foreignWrites.push(rekeyed)
        }
      }
    }
    const rangeFolders = new Set<string>()
    for (const unit of units) {
      const isInRange = !('legacy' in unit) && unit.sequence >= start.sequence
      const folders = isInRange ? unit.writes.flatMap((write) => write.createdFolders) : []
      for (const folder of folders) {
        rangeFolders.add(await pathOf(folder))
      }
    }
    const states = new Map<string, PathState>()
    for (const relative of rangePaths) {
      // A path reached through a link is not read: its bytes match nothing,
      // and it is refused as linked whatever the engine says.
      states.set(
        relative,
        linked.has(relative)
          ? { content: { present: true }, isTooLarge: false }
          : await this.stateOf(relative, rangeFolders),
      )
    }
    const decision = decideRange({
      units,
      from,
      mode: request.mode,
      transcriptTurnIds: request.transcriptTurnIds,
      foreignWrites,
      current: new Map([...states].map(([relative, state]) => [relative, state.content])),
    })
    if (!decision.ok) {
      return { ok: false, reason: decision.reason }
    }
    const unchanged: string[] = []
    const refused: PathOutcome[] = []
    const steps: (PathDecision & { readonly kind: 'restore' })[] = []
    for (const decided of decision.paths) {
      if (linked.has(decided.path)) {
        refused.push({ path: decided.path, reason: 'linked' })
      } else if (states.get(decided.path)?.isTooLarge === true) {
        refused.push({ path: decided.path, reason: 'tooLarge' })
      } else if (decided.kind === 'unchanged') {
        unchanged.push(decided.path)
      } else if (decided.kind === 'refused') {
        refused.push({ path: decided.path, reason: decided.reason })
      } else if (request.isUnsaved(decided.path)) {
        refused.push({ path: decided.path, reason: 'unsaved' })
      } else {
        steps.push(decided)
      }
    }
    const applied =
      steps.length === 0
        ? { batchId: undefined, changed: [], refused: [] }
        : await this.runBatch(
            setup,
            sessionId,
            steps,
            states,
            request.isUnsaved,
            isAllowed,
            request.transcript,
          )
    const allRefused = [...refused, ...applied.refused]
    return {
      ok: true,
      restoreId: applied.changed.length > 0 ? applied.batchId : undefined,
      changed: applied.changed,
      unchanged,
      refused: allRefused,
      ranProcesses: decision.ranProcesses,
      isRedoSpent: allRefused.length === 0,
    }
  }

  /**
   * Writes the decided paths as one batch of the conversation: its unit is
   * numbered and recorded first, each write journaled before it is made and
   * settled after (`aborted` only when nothing changed, as a refused
   * conditional write proves; a failure stays unsettled), and the batch is
   * folded and sealed at the end, whatever happened. Deletions go first, so a
   * case-only rename or a file swapped for a folder clears the way.
   */
  private async runBatch(
    setup: Setup,
    sessionId: string,
    steps: readonly (PathDecision & { readonly kind: 'restore' })[],
    states: ReadonlyMap<string, PathState>,
    isUnsaved: (relative: string) => boolean,
    isAllowed: () => boolean,
    transcript: NonNullable<StoredUnit['transcript']>,
  ): Promise<{
    readonly batchId: string
    readonly changed: readonly string[]
    readonly refused: readonly PathOutcome[]
  }> {
    const owner: Owner = {
      instance: this.ownInstance,
      sessionId,
      unitKind: 'batch',
      unitId: this.deps.newId(),
    }
    await this.startUnitNow(setup, owner, transcript)
    const unit = this.openUnits.get(ownerKey(owner))
    const changed: string[] = []
    const refused: PathOutcome[] = []
    const ordered = [
      ...steps.filter((step) => !step.target.present),
      ...steps.filter((step) => step.target.present),
    ]
    const settledPaths = new Set<string>()
    try {
      const blobs = await this.blobsOf(
        setup.shadow,
        ordered.flatMap((step) =>
          step.target.present && step.target.oid !== undefined ? [step.target.oid] : [],
        ),
      )
      for (const step of ordered) {
        if (this.stopping.signal.aborted) {
          throw new Error(DISPOSED)
        }
        const result = await this.runStep(owner, step, states, blobs, isUnsaved, isAllowed)
        settledPaths.add(step.path)
        if (result === 'done') {
          changed.push(step.path)
        } else {
          refused.push({ path: step.path, reason: refusalFor(result) })
        }
      }
    } catch (error: unknown) {
      this.deps.log.warn(`A checkpoint restore stopped part way: ${failureForLog(error)}`)
      for (const step of ordered) {
        if (!settledPaths.has(step.path)) {
          refused.push({ path: step.path, reason: 'failed' })
        }
      }
    } finally {
      if (unit !== undefined) {
        try {
          await this.sealUnit(setup.shadow, { unit, endedAt: this.deps.now(), ranProcesses: false })
        } catch (error: unknown) {
          // What the batch did is in this window's journal: its end is tried
          // again before the next operation, and another window recovers it.
          this.deps.log.warn(`A restore's record was not sealed yet: ${failureForLog(error)}`)
        }
      }
    }
    return { batchId: owner.unitId, changed, refused }
  }

  /**
   * One write of a batch: journaled, made through the kept writer, settled,
   * alone on its path with the tools' writes (the window's lanes), so its
   * place in the window's order is the order the path's writes landed in.
   */
  private async runStep(
    owner: Owner,
    step: PathDecision & { readonly kind: 'restore' },
    states: ReadonlyMap<string, PathState>,
    blobs: ReadonlyMap<string, Buffer>,
    isUnsaved: (relative: string) => boolean,
    isAllowed: () => boolean,
  ): Promise<StepResult> {
    if (isUnsaved(step.path)) {
      return 'unsaved'
    }
    return await this.deps.lanes.exclusive(step.path, async () => {
      const currentMode = states.get(step.path)?.content.mode
      const before: ContentState = { ...step.expect, mode: currentMode }
      // An existing file keeps its own mode; one recreated gets the mode it had.
      const after: ContentState = step.expect.present
        ? { ...step.target, mode: currentMode }
        : step.target
      const write: WriteRecord = {
        id: this.deps.newId(),
        instance: this.ownInstance,
        seq: this.deps.lanes.nextSeq(),
        owner,
        path: step.path,
        before,
        after,
        createdFolders: [],
        isKept: true,
      }
      const fileStep: FileStep = {
        path: step.path,
        target:
          step.target.present && step.target.oid !== undefined
            ? { oid: step.target.oid, mode: step.target.mode ?? GIT_MODE_FILE }
            : null,
        expect:
          step.expect.present && step.expect.oid !== undefined
            ? { kind: 'blob', oid: step.expect.oid }
            : { kind: 'absent' },
        removeFolders: step.removeFolders,
      }
      const content = fileStep.target === null ? undefined : blobs.get(fileStep.target.oid)
      const result = await applyFileStep(
        {
          ...this.target,
          isAllowed,
          isUnsaved,
          beforePublish: async (createdFolders) => {
            await this.ownJournal.appendIntent({
              ...write,
              createdFolders: innermostFolders(step.path, createdFolders),
            })
          },
        },
        fileStep,
        content,
      )
      if (result === 'done') {
        try {
          await this.ownJournal.appendDone(write.id)
        } catch (error: unknown) {
          // Publication succeeded. Keep the known result and Redo; the
          // durable intent remains unsettled for recovery to judge.
          this.deps.log.warn(`A restore outcome was not durable: ${failureForLog(error)}`)
        }
      } else if (result !== 'failed') {
        // Refused before anything changed: the file was not as expected, or held
        // unsaved changes, or a link was on the way, or it is too large to compare.
        await this.ownJournal.appendAborted(write.id)
      }
      return result
    })
  }

  /** The journals of every window, and the setup again when folding a gone window's changed it. */
  private async recovered(
    setup: Setup,
  ): Promise<{ readonly setup: Setup; readonly journals: Journals }> {
    const journals = await WriteJournal.readAll(this.deps.storageDir)
    return { setup: (await this.recover(setup, journals)) ? await this.ready() : setup, journals }
  }

  /**
   * A single CAS ref admits one restore/Redo across independent windows. A
   * crashed owner's reservation is removed only from the value that was read.
   * Its record keeps the M72 restore shape, so a 0.10.0 window reads its owner.
   */
  private async withRestore(
    setup: Setup,
    isAllowed: () => boolean,
    task: (fresh: Setup) => Promise<RestoreOutcome>,
  ): Promise<RestoreOutcome> {
    const { shadow } = setup
    const keep = await this.lease.acquire(setup)
    if (keep === undefined) {
      return { ok: false, reason: 'turnElsewhere' }
    }
    try {
      const fresh = await this.ready()
      if (!isAllowed()) {
        return { ok: false, reason: 'backendUnsupported' }
      }
      const blocking = this.turnBlocking(fresh)
      return blocking === undefined ? await task(fresh) : { ok: false, reason: blocking }
    } finally {
      await this.lease.release(shadow, keep)
    }
  }

  /** Shared serial/backend/fence/CAS admission for both destructive operations. */
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
      const blocking = this.turnBlocking(initial)
      return blocking === undefined
        ? await this.withRestore(initial, isAllowed, async (setup) => await work(setup, isAllowed))
        : { ok: false, reason: blocking }
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

  /** This window's instance: the owner of every unit and write it records. */
  public get instance(): string {
    return this.ownInstance
  }

  /** Native/process uncertainty in this window or a freshly observed peer. */
  public get isNativeUnsafe(): boolean {
    return this.hasUnprovedLocalWork() || this.isPeerUnsafe
  }

  /** Actual I/O completion did not prove every workspace-capable descendant stopped. */
  public async markUnprovenProcess(): Promise<void> {
    this.runningTurns.add(CHECKPOINT_NATIVE_WINDOW)
    this.startHeartbeat()
    await this.presence.publish(this.publishedTurns())
  }

  /**
   * Before a workspace-capable native process starts, even with checkpoints off.
   * Presence precedes the reservation check. Trusted startup recovers abandoned leases;
   * Restricted Mode only checks reservation files, without invoking Git. A packed
   * ref file is conservatively refused too; this implementation never packs refs.
   */
  public async markNativeBackend(canRunGit = false): Promise<void> {
    if (this.stopping.signal.aborted) {
      throw new Error(UI_TEXT.sendMarkFailed)
    }
    // A fence an earlier start set stays: only the one this call sets is withdrawn.
    const isFirstStart = !this.runningTurns.has(CHECKPOINT_NATIVE_WINDOW)
    this.runningTurns.add(CHECKPOINT_NATIVE_WINDOW)
    this.startHeartbeat()
    try {
      await this.presence.publish(this.publishedTurns())
      if (canRunGit) {
        await this.serial(async () => {
          const opened = await this.openIfUsable()
          if (opened !== undefined) await this.lease.recoverAbandoned(opened)
        })
      }
      if (await this.lease.isReserved()) {
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

  /**
   * A turn (or a message about to start one, under its own key) begins or
   * stops running in this window. It is published at once in the window's
   * presence file, with no lock, so another window refuses a restore
   * meanwhile; this resolves once the file says so. A failed write is tried
   * again soon.
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
      this.runningTurns.add(key)
    }
    this.startHeartbeat()
    try {
      await this.presence.publish(this.publishedTurns())
      if (isRunning && canRunGit) {
        // Share first setup outside the queue, as the first conversation read does.
        const opened = await this.openIfUsable()
        await this.serial(async () => {
          if (opened === undefined) return
          await this.lease.recoverAbandoned(opened)
          if (await this.lease.isReserved(opened.shadow)) {
            throw new Error(UI_TEXT.restoreTurnElsewhere)
          }
        })
      } else if (isRunning && (await this.lease.isReserved())) {
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
  }

  /**
   * A unit starts (spec 2, 5.1): its number taken and its record made, before
   * any write of it. The owner's instance must be this window's.
   */
  public startUnit(owner: Owner): Promise<{ readonly sequence: number }> {
    return this.serial(async () => {
      if (owner.instance !== this.ownInstance) {
        throw new Error(UI_TEXT.checkpointFailed)
      }
      return await this.startUnitNow(await this.ready(), owner)
    })
  }

  /**
   * A unit ended (its owner io drained first): its writes folded into its
   * record, the journal sealed, then its running mark withdrawn. A unit this
   * window did not start has nothing to end. A failure is the caller's, and
   * the end is tried again before the next operation, its mark kept until then.
   */
  public endUnit(owner: Owner, end: { readonly ranProcesses: boolean }): Promise<void> {
    const unit = this.openUnits.get(ownerKey(owner))
    if (unit === undefined) {
      return Promise.resolve()
    }
    const pending: PendingEnd = { unit, endedAt: this.deps.now(), ranProcesses: end.ranProcesses }
    this.pendingEnds.set(ownerKey(owner), pending)
    this.openUnits.delete(ownerKey(owner))
    return this.serial(async () => {
      const { opened } = await this.open()
      if (this.pendingEnds.has(ownerKey(owner))) {
        await this.sealUnit(opened.shadow, pending)
      }
      await this.retain()
    })
  }

  /** The turns of a conversation that have a record: each offers a restore. */
  public turns(sessionId: string): Promise<readonly string[]> {
    return this.serial(async () => {
      const setup = await this.ready()
      return setup.units.flatMap((unit) =>
        unit.record?.owner.sessionId === sessionId && unit.record.owner.unitKind === 'turn'
          ? [unit.record.owner.unitId]
          : [],
      )
    })
  }

  /** The turns of a conversation an earlier version recorded: listed, never restored. */
  public legacyTurns(sessionId: string): Promise<readonly string[]> {
    return this.serial(async () => {
      const setup = await this.ready()
      return setup.legacy.filter((turn) => turn.sessionId === sessionId).map((turn) => turn.turnId)
    })
  }

  /** Whether a path is in the checkpoint storage of any namespace (tools never write there). */
  public isStoragePath(absolutePath: string): boolean {
    return this.storagePathProblem(absolutePath) !== undefined
  }

  /**
   * Why tools may not write a path: a refused Windows spelling, proven
   * storage, or a native identity that cannot prove it is outside storage.
   */
  public storagePathProblem(absolutePath: string): StoragePathProblem | undefined {
    // Workspace confinement owns UNC admission; a share alone is not storage.
    if (windowsPathProblem(absolutePath, process.platform, absolutePath) !== undefined) {
      return 'spelling'
    }
    if (isInShadowRepository(absolutePath)) return 'storage'
    const relations = new Set([
      pathIdentityRelation(absolutePath, this.deps.storageDir),
      ...(this.deps.storageRoot === undefined
        ? []
        : [pathIdentityRelation(absolutePath, this.deps.storageRoot)]),
    ])
    if (relations.has('inside')) return 'storage'
    return relations.has('unknown') ? 'uncertain' : undefined
  }

  /** Reverses the model's own writes from the turn on, where each file still holds what they left. */
  public restore(request: RestoreRequest): Promise<RestoreOutcome> {
    return this.restoreAdmitted(request, async (setup, isAllowed) => {
      const found = await this.recovered(setup)
      return await this.restoreRange(
        found.setup,
        found.journals,
        {
          sessionId: request.sessionId,
          from: { unitKind: 'turn', unitId: request.turnId },
          mode: 'restore',
          transcriptTurnIds: request.transcriptTurnIds,
          transcript: { fromTurnId: request.turnId, turnIds: request.transcriptTurnIds },
          isUnsaved: this.unsavedTest(request.unsavedPaths),
        },
        isAllowed,
      )
    })
  }

  /**
   * Puts back what a restore (or a Redo) replaced, path by path where each
   * still holds what it left and no later unit wrote it; the Redo is a batch
   * of its own, which can be redone in turn. It must come from the batch's
   * own conversation.
   */
  public redo(request: RedoRequest): Promise<RestoreOutcome> {
    return this.restoreAdmitted(request, async (setup, isAllowed) => {
      const found = await this.recovered(setup)
      const batch = found.setup.units.find(
        (unit) =>
          unit.record?.owner.unitKind === 'batch' && unit.record.owner.unitId === request.restoreId,
      )
      if (batch?.record?.owner.sessionId !== request.sourceSessionId) {
        if (batch !== undefined) {
          this.deps.log.warn('A Redo was asked for from another conversation than its own')
        }
        return { ok: false, reason: 'redoGone' }
      }
      const anchor = batch.record.transcript
      const current =
        anchor === undefined ? undefined : await request.transcriptTurnIds?.(anchor.fromTurnId)
      if (current === undefined || anchor === undefined) {
        return { ok: false, reason: 'writesIncomplete' }
      }
      const earlier = new Set([
        ...anchor.turnIds,
        ...found.setup.units.flatMap((unit) =>
          unit.record?.owner.sessionId === request.sourceSessionId &&
          unit.sequence < batch.sequence &&
          unit.record.owner.unitKind === 'turn'
            ? [unit.record.owner.unitId]
            : [],
        ),
      ])
      return await this.restoreRange(
        found.setup,
        found.journals,
        {
          sessionId: request.sourceSessionId,
          from: { unitKind: 'batch', unitId: request.restoreId },
          mode: 'redo',
          transcriptTurnIds: current.filter((id) => !earlier.has(id)),
          transcript: { fromTurnId: anchor.fromTurnId, turnIds: current },
          isUnsaved: this.unsavedTest(request.unsavedPaths),
        },
        isAllowed,
      )
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
    await this.serial(async () => {
      await this.tidy(await this.ready(), true)
    })
  }

  /**
   * The conversation was unarchived: its archive files go, so its new
   * records are kept again whatever the clock did meanwhile (an archive
   * hides what was made at or before its time). Plain files, no lock and no
   * git, as the archive itself.
   */
  public async unforgetSession(sessionId: string): Promise<void> {
    const archives = await readArchives(this.deps.storageDir)
    for (const entry of archives) {
      if (entry.archive.sessionId === sessionId) {
        await removeArchive(entry)
      }
    }
  }

  /**
   * The conversation was archived while no git may run (Restricted Mode):
   * the archive is written to its own file (no git); the records and copies
   * go the next time a window that may run git cleans up.
   */
  public async queueForget(sessionId: string): Promise<void> {
    await writeArchive(this.deps.storageDir, this.deps.newId(), {
      sessionId,
      at: this.deps.now(),
    })
  }

  /**
   * The window opened (or the workspace was trusted): when checkpoints were
   * ever taken here, the journals of windows that are gone are folded into
   * their records, what no one needs any more goes and the retention bounds
   * apply, whether or not checkpoints are on now.
   */
  public async maintain(): Promise<void> {
    if ((await lstatOrUndefined(path.join(this.deps.storageDir, SHADOW_HEAD))) === undefined) {
      return
    }
    await this.serial(async () => {
      const { setup } = await this.recovered(await this.ready())
      await this.tidy(setup, true)
    })
  }

  /**
   * The window is closing: every git still running is ended, nothing new
   * starts (a restore under way stops before its next file), and the
   * window's presence goes (unless it must stay; windowPresence.ts). Its
   * journal stays for another window to fold what it did not seal.
   */
  public dispose(): void {
    this.stopping.abort()
    void this.queue.then(async () => {
      await this.copies.close()
      clearInterval(this.heartbeat)
      this.presenceStopping.abort()
      if (!this.hasUnprovedLocalWork()) {
        this.presence.leave()
      }
    })
  }
}
