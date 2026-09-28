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
// - Every operation runs in one queue, and under the store's lock
//   (storeLock.ts): two windows on the same folder share the store, so each
//   operation reads the records afresh inside the lock and saves them before
//   letting go, and one that cannot take the lock in time is refused with
//   the reason. Pinned captures and tool copies are named by the window's
//   instance, and only a window that is gone loses them. No restore or redo
//   runs while any turn runs, in this window or in another live one.
// - Git trees hold no empty folder, so a capture before a turn also records
//   the folders it holds no file of: a restore removes only the folders the
//   turns made.

import type { Buffer } from 'node:buffer'
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
  CHECKPOINT_LOCK_WAIT_MS,
  CHECKPOINT_MAX_FILES,
  CHECKPOINT_PRUNE_INTERVAL_MS,
  CHECKPOINT_STALE_LOCK_MS,
  GIT_MISSING_OBJECT,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
} from '../../shared/constants'
import { GitExitError, GitMissingError, type GitProcess } from '../git'
import { errorDetail, type Logger } from '../logger'
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
  emptyRecords,
  loadRecords,
  type RestoreEntry,
  type RestoreRecord,
  saveRecords,
} from './checkpointRecords'
import { retainRecords } from './checkpointRetention'
import { type IgnoredInventory, ignoredChanges, regularFileStat, scanIgnored } from './ignoredScan'
import { ShadowGit, withoutGitVariables } from './shadowGit'
import { StoreBusyError, StoreLock } from './storeLock'

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

/** Why no capture: the limits, no git, another window holding the store, or a failure. */
export type CaptureRefusal = 'tooManyFiles' | 'tooLarge' | 'noGit' | 'busy' | 'failed'

export type CaptureResult =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly reason: CaptureRefusal; readonly detail: string }

/**
 * Why a restore or a redo did nothing: no checkpoint (any more); a turn is
 * running in the window, or in another window on the folder; the capture it
 * starts with was refused; the redo record is gone; another window held the
 * store too long; checkpoints are not available here.
 */
export type RestoreFailure =
  | 'noCheckpoint'
  | 'turnRunning'
  | 'turnElsewhere'
  | 'captureFailed'
  | 'redoGone'
  | 'busy'
  | 'unavailable'

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
  readonly sessionId: string
  readonly turnId: string
  /** Files open with unsaved changes, absolute, asked again before each file changes. */
  readonly unsavedPaths: () => readonly string[]
}

export interface RedoRequest {
  readonly restoreId: string
  readonly unsavedPaths: () => readonly string[]
}

export interface CheckpointStoreDeps {
  readonly workspaceRoot: string
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
  /** How long an operation waits for another window's; CHECKPOINT_LOCK_WAIT_MS by default. */
  readonly lockWaitMs?: number
  readonly log: Logger
}

/** A copy of a file taken just before the extension wrote it. */
interface JournalEntry {
  readonly at: number
  /** null: there was no file; undefined: none taken (over the limit, a link). */
  readonly preImage: BlobRef | null | undefined
  readonly stat: FileStat | null
}

interface OpenTurn {
  readonly createdAt: number
  readonly inventory: IgnoredInventory
}

/** The shadow repository and the workspace's place in its work tree, set up once. */
interface Opened {
  readonly shadow: ShadowGit
  readonly top: string
  readonly prefix: string
}

/** One operation's view: the records read afresh under the lock, and the live windows. */
interface Setup extends Opened {
  readonly records: CheckpointRecords
  readonly live: ReadonlySet<string>
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

const RECORDS_FILE = 'records.json'
const SHADOW_HEAD = path.join('shadow.git', 'HEAD')
const REF_ROOT = 'refs/muse-spark/'
const KEEP_REF_PREFIX = `${REF_ROOT}keep/`
const JOURNAL_REF_PREFIX = `${REF_ROOT}journal/`
const PIN_REF_PREFIX = `${REF_ROOT}pin/`
const INDEX_REF = `${REF_ROOT}index`
const IGNORE_FILE = '.gitignore'
const CURRENT_PATH_PREFIX = './'
const TREE_MODE = '040000'
const SEPARATOR = '/'
const NUL = '\0'
const LINE_FEED = '\n'
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

function oldestFirst<T extends { readonly createdAt: number }>(records: readonly T[]): T[] {
  return records.toSorted((left, right) => left.createdAt - right.createdAt)
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

/** Drops a conversation's records (their refs go with the next orphan sweep). */
function withoutSession(records: CheckpointRecords, sessionId: string): void {
  records.checkpoints = records.checkpoints.filter((record) => record.sessionId !== sessionId)
  records.restores = records.restores.filter((record) => record.sessionId !== sessionId)
}

/** Remembers that the conversation was archived now (see `record`). */
function markForgotten(records: CheckpointRecords, sessionId: string, at: number): void {
  records.forgotten = [
    ...(records.forgotten ?? []).filter((entry) => entry.sessionId !== sessionId),
    { sessionId, at },
  ]
}

/** What a step's result means for the file list of the report. */
function refusalFor(result: Exclude<StepResult, 'done'>): RefusalReason {
  const reasons: Readonly<Record<Exclude<StepResult, 'done'>, RefusalReason>> = {
    changed: 'changedAfter',
    linked: 'notInCheckpoint',
    failed: 'failed',
  }
  return reasons[result]
}

export class CheckpointStore {
  private queue: Promise<unknown> = Promise.resolve()
  private opened: Opened | undefined
  /** The start scan of each recorded turn still running, by checkpoint id. */
  private readonly openTurns = new Map<string, OpenTurn>()
  /** Every turn running in the window, recorded or not (a refused capture included). */
  private readonly runningTurns = new Set<string>()
  private readonly journal = new Map<string, JournalEntry[]>()
  private readonly stopping = new AbortController()
  /** This store's id: its pins and tool copies are named by it. */
  private readonly instance: string
  private readonly lock: StoreLock
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private emptyTree: string | undefined
  private lastPruneAt = 0
  private isPruneDue = false

  public constructor(private readonly deps: CheckpointStoreDeps) {
    this.instance = deps.newId()
    this.lock = new StoreLock({
      storageDir: deps.storageDir,
      instance: this.instance,
      pid: deps.pid,
      isProcessAlive: deps.isProcessAlive,
      clock: () => Date.now(),
      sleep: pause,
      waitMs: deps.lockWaitMs ?? CHECKPOINT_LOCK_WAIT_MS,
      signal: this.stopping.signal,
      log: deps.log,
    })
  }

  private get pinPrefix(): string {
    return `${PIN_REF_PREFIX}${this.instance}${SEPARATOR}`
  }

  private get journalPrefix(): string {
    return `${JOURNAL_REF_PREFIX}${this.instance}${SEPARATOR}`
  }

  private get target(): RestoreTarget {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      log: this.deps.log,
    }
  }

  /**
   * Runs the task after the ones before it, holding the store's lock (the
   * window's presence and the lock beat while it is open). A lock not taken
   * in time throws StoreBusyError.
   */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const guarded = async (): Promise<T> => {
      if (this.stopping.signal.aborted) {
        throw new Error(DISPOSED)
      }
      this.heartbeat ??= setInterval(() => {
        void this.lock.beat().catch((error: unknown) => {
          this.deps.log.warn(`The checkpoint store's heartbeat failed: ${errorDetail(error)}`)
        })
      }, CHECKPOINT_HEARTBEAT_MS).unref()
      return await this.lock.run(task)
    }
    const run = afterSettled(this.queue, guarded)
    this.queue = settled(run)
    return run
  }

  private get recordsPath(): string {
    return path.join(this.deps.storageDir, RECORDS_FILE)
  }

  /** The records on disk now (another window may have changed them), or none. */
  private async loadRecords(): Promise<CheckpointRecords | undefined> {
    return await loadRecords(this.recordsPath, (reason) => {
      this.deps.log.warn(`Checkpoint records were unreadable and were set aside: ${reason}`)
    })
  }

  /** The shadow repository, set up the first time; refs no live window needs go then. */
  private async open(): Promise<{ readonly opened: Opened; readonly isFirst: boolean }> {
    if (this.opened !== undefined) {
      return { opened: this.opened, isFirst: false }
    }
    const { workspaceRoot, storageDir, platform } = this.deps
    const top = await repositoryTop(workspaceRoot)
    const prefix = path.relative(top, workspaceRoot).split(path.sep).join(SEPARATOR)
    const shadow = new ShadowGit(
      { storageDir, top, platform },
      { git: this.deps.git, env: this.deps.env, signal: this.stopping.signal },
    )
    await shadow.prepare(await userExclude(top), await this.globalExcludesFile())
    await shadow.clearStaleLocks(this.deps.now(), CHECKPOINT_STALE_LOCK_MS)
    this.opened = { shadow, top, prefix }
    return { opened: this.opened, isFirst: true }
  }

  /**
   * One operation's setup, under the lock: the records read afresh from disk
   * (never an earlier copy, which another window may have outdated) and the
   * live windows. The first time, the refs no live window needs go.
   */
  private async ready(): Promise<Setup> {
    const { opened, isFirst } = await this.open()
    const loaded = await this.loadRecords()
    const isSameWorkspace = loaded?.top === opened.top && loaded.prefix === opened.prefix
    if (loaded !== undefined && !isSameWorkspace) {
      this.deps.log.info('The workspace moved: its checkpoints start afresh')
    }
    const setup: Setup = {
      ...opened,
      records: isSameWorkspace ? loaded : emptyRecords(opened.top, opened.prefix),
      live: await this.lock.liveInstances(),
    }
    if (isFirst) {
      await this.dropOrphanRefs(setup)
      await this.save(setup)
    }
    return setup
  }

  /**
   * Refs no live need names: keep refs no record names (a record file set
   * aside, a window that closed between a ref and its record), and the tool
   * copies and pinned captures of windows that are gone. Their copies are
   * pruned. A live window's pins and copies stay.
   */
  private async dropOrphanRefs(setup: Setup): Promise<void> {
    const named = new Set(
      [...setup.records.checkpoints, ...setup.records.restores].map(
        (record) => `${KEEP_REF_PREFIX}${record.id}`,
      ),
    )
    const isGoneWindows = (ref: string, prefix: string) =>
      ref.startsWith(prefix) && !setup.live.has(ref.slice(prefix.length).split(SEPARATOR)[0] ?? '')
    const listed = await setup.shadow.text(['for-each-ref', '--format=%(refname)', REF_ROOT])
    const orphans = listed
      .split(LINE_FEED)
      .filter(
        (ref) =>
          isGoneWindows(ref, JOURNAL_REF_PREFIX) ||
          isGoneWindows(ref, PIN_REF_PREFIX) ||
          (ref.startsWith(KEEP_REF_PREFIX) && !named.has(ref)),
      )
    if (orphans.length === 0) {
      return
    }
    await this.deleteRefs(setup.shadow, orphans)
    this.isPruneDue = true
  }

  /** Saves the records, only while this window still holds the lock. */
  private async save(setup: Pick<Setup, 'records'>): Promise<void> {
    await this.lock.assertHeld()
    await saveRecords(this.recordsPath, setup.records)
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
      if (!(error instanceof GitExitError) || error.exitCode !== NONE_EXIT) {
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
    const relative = path.relative(this.deps.workspaceRoot, absolutePath)
    const isOutside = relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
    return isOutside ? undefined : relative.split(path.sep).join(SEPARATOR)
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
      unsavedPaths().some((unsaved) =>
        isSamePath(unsaved, this.absoluteOf(relative), this.deps.platform),
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

  /** A turn another live window recorded and has not ended. */
  private isRunningElsewhere(setup: Setup, record: CheckpointRecord): boolean {
    return (
      record.endedAt === undefined &&
      record.owner !== undefined &&
      record.owner !== this.instance &&
      setup.live.has(record.owner)
    )
  }

  /** A turn still running here, or in another live window. */
  private isOpen(setup: Setup, record: CheckpointRecord): boolean {
    return this.openTurns.has(record.id) || this.isRunningElsewhere(setup, record)
  }

  /** Why no restore or redo may run now: a turn running here, or in another live window. */
  private turnBlocking(setup: Setup): RestoreFailure | undefined {
    if (this.isAnyTurnRunning()) {
      return 'turnRunning'
    }
    const isElsewhere = setup.records.checkpoints.some((record) =>
      this.isRunningElsewhere(setup, record),
    )
    return isElsewhere ? 'turnElsewhere' : undefined
  }

  /** A restore or a redo, refused with the reason when another window held the store too long. */
  private async lockedRestore(task: () => Promise<RestoreOutcome>): Promise<RestoreOutcome> {
    try {
      return await this.serial(task)
    } catch (error: unknown) {
      if (error instanceof StoreBusyError) {
        return { ok: false, reason: 'busy', detail: error.message }
      }
      throw error
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
    await shadow.run(['update-ref', INDEX_REF, full])
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
      const inventory = await scanIgnored(
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
            repositories: repositories.filter((relative) => isReachable(relative)).toSorted(byText),
          },
          inventory,
          createdAt: this.deps.now(),
          pin: undefined,
          folders,
        },
      }
    } catch (error: unknown) {
      return {
        ok: false,
        reason: error instanceof GitMissingError ? 'noGit' : 'failed',
        detail: errorDetail(error),
      }
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
      this.topOf(setup, relative),
    ])
    const isExecutable = this.deps.platform !== 'win32' && (stats.mode & EXECUTABLE_BITS) !== 0
    return { preImage: { mode: isExecutable ? GIT_MODE_EXECUTABLE : GIT_MODE_FILE, oid }, stat }
  }

  /** Adds the copies the tool writes of this turn took to its ignored changes. */
  private async withToolCopies(
    setup: Setup,
    record: CheckpointRecord,
    scanned: readonly IgnoredChange[],
  ): Promise<readonly IgnoredChange[]> {
    const copies = new Map<string, JournalEntry>()
    for (const [relative, entries] of this.journal) {
      const first = entries.find((entry) => entry.at >= record.createdAt)
      if (first !== undefined) {
        copies.set(relative, first)
      }
    }
    if (copies.size === 0) {
      return scanned
    }
    // A file in the start capture is restored from it; the copies matter for the rest.
    const copied = [...copies].map(([relative]) => relative)
    const inStart = await this.presentIn(setup.shadow, record.start.tree, copied)
    const changes = new Map(scanned.map((change) => [change.path, change]))
    for (const [relative, copy] of copies) {
      if (inStart.has(relative)) {
        continue
      }
      const scannedChange = changes.get(relative)
      const endStat = (await regularFileStat(this.absoluteOf(relative))) ?? null
      if (scannedChange !== undefined) {
        changes.set(relative, {
          ...scannedChange,
          kind: copy.preImage === null ? 'created' : scannedChange.kind,
          preImage: copy.preImage,
        })
        continue
      }
      if (endStat === null && copy.preImage === null) {
        continue
      }
      let kind: IgnoredChange['kind'] = 'changed'
      if (copy.preImage === null) {
        kind = 'created'
      } else if (endStat === null) {
        kind = 'deleted'
      }
      changes.set(relative, {
        path: relative,
        kind,
        ...(copy.preImage !== undefined && { preImage: copy.preImage }),
        startStat: copy.stat,
        endStat,
      })
    }
    return [...changes]
      .map(([, change]) => change)
      .toSorted((left, right) => byText(left.path, right.path))
  }

  /** Journal copies no running turn can need any more, and their refs, go. */
  private async trimJournal(setup: Setup): Promise<void> {
    const oldestOpen = Math.min(
      Infinity,
      ...Array.from(this.openTurns.values(), (turn) => turn.createdAt),
    )
    const released = new Set<string>()
    const kept = new Set<string>()
    for (const [relative, entries] of this.journal) {
      const remaining = entries.filter((entry) => entry.at >= oldestOpen)
      for (const entry of entries) {
        if (entry.preImage === undefined || entry.preImage === null) {
          continue
        }
        const bucket = remaining.includes(entry) ? kept : released
        bucket.add(entry.preImage.oid)
      }
      if (remaining.length === 0) {
        this.journal.delete(relative)
      } else {
        this.journal.set(relative, remaining)
      }
    }
    const refs: string[] = []
    for (const oid of released) {
      if (!kept.has(oid)) {
        refs.push(`${this.journalPrefix}${oid}`)
      }
    }
    await this.deleteRefs(setup.shadow, refs)
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
   * Paths these turns did not change themselves: between them and after the
   * last, and every path another conversation's turn changed while one of
   * them ran. A turn whose end was not seen counts everything up to the next
   * capture as its own; those paths are `uncertain`.
   */
  private async changedOutside(
    setup: Setup,
    turns: readonly CheckpointRecord[],
    currentTree: string,
  ): Promise<{ readonly changed: ReadonlySet<string>; readonly uncertain: ReadonlySet<string> }> {
    const changed = new Set<string>()
    const uncertain = new Set<string>()
    for (const [index, turn] of turns.entries()) {
      const next = turns[index + 1]?.start.tree ?? currentTree
      if (turn.end === undefined) {
        const sinceStart = await this.diff(setup.shadow, turn.start.tree, next)
        for (const change of sinceStart) {
          uncertain.add(change.path)
        }
        continue
      }
      const sinceEnd = await this.diff(setup.shadow, turn.end.tree, next)
      for (const change of sinceEnd) {
        changed.add(change.path)
      }
    }
    const now = this.deps.now()
    // A turn's time: from its start capture to its end; to now while it
    // runs; an end an earlier window never saw is taken as its start.
    const windowOf = (record: CheckpointRecord) => ({
      start: record.createdAt,
      end: record.endedAt ?? (this.isOpen(setup, record) ? now : record.createdAt),
    })
    const sessionId = turns[0]?.sessionId
    const overlapping = setup.records.checkpoints.filter((other) => {
      if (other.sessionId === sessionId) {
        return false
      }
      const theirs = windowOf(other)
      return turns.some((turn) => {
        const ours = windowOf(turn)
        return theirs.start < ours.end && theirs.end > ours.start
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
      if (error instanceof GitExitError && error.exitCode === NONE_EXIT) {
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

  /** A redo record for these entries, saved with a ref keeping every blob it names. */
  private async recordRestore(
    setup: Setup,
    sessionId: string,
    entries: readonly RestoreEntry[],
  ): Promise<RestoreRecord> {
    const blobs = entries.flatMap((entry) =>
      [entry.before, entry.after].filter((blob) => blob !== null),
    )
    const keep = await this.keepTree(setup.shadow, [], blobs)
    const id = this.deps.newId()
    await setup.shadow.run(['update-ref', `${KEEP_REF_PREFIX}${id}`, keep])
    const record: RestoreRecord = {
      id,
      sessionId,
      createdAt: this.deps.now(),
      entries: [...entries],
      keep,
    }
    setup.records.restores.push(record)
    await this.save(setup)
    return record
  }

  /** Cuts a redo record to these entries; drops it (and its ref) when none is left. */
  private async trimRestore(
    setup: Setup,
    record: RestoreRecord,
    entries: readonly RestoreEntry[],
  ): Promise<boolean> {
    const index = setup.records.restores.findIndex((candidate) => candidate.id === record.id)
    if (index === -1) {
      return false
    }
    if (entries.length === 0) {
      setup.records.restores.splice(index, 1)
      await this.deleteRefs(setup.shadow, [`${KEEP_REF_PREFIX}${record.id}`])
      this.isPruneDue = true
      await this.save(setup)
      return false
    }
    setup.records.restores[index] = { ...record, entries: [...entries] }
    await this.save(setup)
    return true
  }

  /** One tree holding trees and blobs, so one ref keeps all of them from pruning. */
  private async keepTree(
    shadow: ShadowGit,
    trees: readonly { readonly name: string; readonly tree: string }[],
    blobs: readonly BlobRef[],
  ): Promise<string> {
    const lines = [
      ...trees.map((entry) => `${TREE_MODE} tree ${entry.tree}\t${entry.name}`),
      ...blobs.map((blob, index) => `${blob.mode} blob ${blob.oid}\tb${String(index)}`),
    ]
    return await shadow.text(['mktree', '-z'], { input: nulInput(lines) })
  }

  /** Drops what the retention bounds exclude; prunes when due and not done lately. */
  private async retain(setup: Setup, isPruneForced: boolean): Promise<void> {
    const now = this.deps.now()
    const kept = retainRecords(setup.records, now, this.deps.retentionDays(), (record) =>
      this.isOpen(setup, record),
    )
    setup.records.checkpoints = kept.checkpoints
    setup.records.restores = kept.restores
    setup.records.forgotten = (setup.records.forgotten ?? []).filter(
      (entry) => now - entry.at < CHECKPOINT_FORGOTTEN_KEEP_MS,
    )
    if (kept.dropped.length > 0) {
      await this.deleteRefs(
        setup.shadow,
        kept.dropped.map((record) => `${KEEP_REF_PREFIX}${record.id}`),
      )
      this.isPruneDue = true
    }
    const isIntervalOver = this.deps.now() - this.lastPruneAt > CHECKPOINT_PRUNE_INTERVAL_MS
    if (this.isPruneDue && (isPruneForced || isIntervalOver)) {
      await this.prune(setup.shadow)
    }
  }

  private async deleteRefs(shadow: ShadowGit, refs: readonly string[]): Promise<void> {
    if (refs.length === 0) {
      return
    }
    await this.lock.assertHeld()
    await shadow.run(['update-ref', '--stdin'], {
      input: refs.map((ref) => `delete ${ref}${LINE_FEED}`).join(''),
    })
  }

  /** Deletes every copy no record, pinned capture, running turn or the private index needs. */
  private async prune(shadow: ShadowGit): Promise<void> {
    await this.lock.assertHeld()
    await shadow.run(['prune', '--expire=now'])
    this.lastPruneAt = this.deps.now()
    this.isPruneDue = false
  }

  /** Drops a conversation's records and its turns running here (the refs go with the next orphan sweep). */
  private dropSession(setup: Setup, sessionId: string): void {
    for (const record of setup.records.checkpoints) {
      if (record.sessionId === sessionId) {
        this.openTurns.delete(record.id)
      }
    }
    withoutSession(setup.records, sessionId)
  }

  /**
   * One step, if it may still run: a file with unsaved editor changes is
   * left as it is, and so is one no longer as the restore expects.
   */
  private async runStep(
    step: PlannedStep,
    content: Buffer | undefined,
    wasFolderThere: ((folder: string) => boolean) | undefined,
    isUnsaved: (relative: string) => boolean,
  ): Promise<Refusal | undefined> {
    if (isUnsaved(step.path)) {
      return { path: step.path, reason: 'unsaved' }
    }
    const result = await applyFileStep(this.target, step, content, wasFolderThere)
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
          note(step, await this.runStep(step, content, undefined, isUnsaved))
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
              ),
        )
      }
      await runWrites(steps.filter((step) => step.target !== null && !isIgnoreFile(step)))
    } catch (error: unknown) {
      this.deps.log.warn(`A checkpoint restore stopped part way: ${errorDetail(error)}`)
      for (const step of steps) {
        if (!settledPaths.has(step.path)) {
          refused.push({ path: step.path, reason: 'failed' })
        }
      }
    }
    return { entries, refused }
  }

  /**
   * Saves the redo record of every step before the first file changes, runs
   * them, then cuts the record to what was done: a restore that stops part
   * way keeps its Redo and says what it changed.
   */
  private async runRecorded(
    setup: Setup,
    sessionId: string,
    steps: readonly PlannedStep[],
    wasFolderThere: ((folder: string) => boolean) | undefined,
    isUnsaved: (relative: string) => boolean,
  ): Promise<Applied & { readonly restoreId: string | undefined }> {
    if (steps.length === 0) {
      return { entries: [], refused: [], restoreId: undefined }
    }
    const pending = await this.recordRestore(
      setup,
      sessionId,
      steps.map((step) => ({ path: step.path, before: step.before, after: step.target })),
    )
    const applied = await this.runSteps(setup, steps, wasFolderThere, isUnsaved)
    const isKept = await this.trimRestore(setup, pending, applied.entries)
    await this.retain(setup, false)
    await this.save(setup)
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
   * A capture of the workspace now, with the folders it holds no file of,
   * pinned until `record` or `release`.
   */
  public async capture(): Promise<CaptureResult> {
    try {
      return await this.serial(async (): Promise<CaptureResult> => {
        let setup: Setup
        try {
          setup = await this.ready()
        } catch (error: unknown) {
          if (error instanceof StoreBusyError) {
            throw error
          }
          return {
            ok: false,
            reason: error instanceof GitMissingError ? 'noGit' : 'failed',
            detail: errorDetail(error),
          }
        }
        const result = await this.captureNow(setup, true)
        if (!result.ok) {
          return result
        }
        const pin = `${this.pinPrefix}${this.deps.newId()}`
        await setup.shadow.run(['update-ref', pin, result.snapshot.tree])
        return { ok: true, snapshot: { ...result.snapshot, pin } }
      })
    } catch (error: unknown) {
      if (error instanceof StoreBusyError) {
        return { ok: false, reason: 'busy', detail: error.message }
      }
      throw error
    }
  }

  /** A capture no turn took: its pin goes. */
  public release(snapshot: Snapshot): Promise<void> {
    return this.serial(async () => {
      if (snapshot.pin === undefined) {
        return
      }
      const { shadow } = await this.ready()
      await this.deleteRefs(shadow, [snapshot.pin])
    })
  }

  /**
   * Ties a capture to the turn it precedes, unless the turn has one already
   * (another window's) or its conversation was archived since the capture,
   * in any window.
   */
  public record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      const pins = snapshot.pin === undefined ? [] : [snapshot.pin]
      const forgotten = setup.records.forgotten?.find((entry) => entry.sessionId === sessionId)
      if (
        this.find(setup, sessionId, turnId) !== undefined ||
        (forgotten !== undefined && snapshot.createdAt <= forgotten.at)
      ) {
        await this.deleteRefs(setup.shadow, pins)
        return
      }
      const id = this.deps.newId()
      const keep = await this.keepTree(setup.shadow, [{ name: 'start', tree: snapshot.tree }], [])
      await setup.shadow.run(['update-ref', `${KEEP_REF_PREFIX}${id}`, keep])
      await this.deleteRefs(setup.shadow, pins)
      setup.records.checkpoints.push({
        id,
        sessionId,
        turnId,
        createdAt: snapshot.createdAt,
        start: {
          tree: snapshot.tree,
          coverage: storedCoverage(snapshot.coverage),
          ...(snapshot.folders !== undefined && { folders: [...snapshot.folders] }),
        },
        owner: this.instance,
        keep,
      })
      this.openTurns.set(id, { createdAt: snapshot.createdAt, inventory: snapshot.inventory })
      await this.retain(setup, false)
      await this.save(setup)
    })
  }

  /** The window's turns, running or not (no git): no restore runs while one does. */
  public markTurn(sessionId: string, turnId: string, isRunning: boolean): void {
    const key = `${sessionId}${NUL}${turnId}`
    if (isRunning) {
      this.runningTurns.add(key)
    } else {
      this.runningTurns.delete(key)
    }
  }

  /** The turn ended: capture again and record the ignored files it changed. */
  public endTurn(sessionId: string, turnId: string): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      const record = this.find(setup, sessionId, turnId)
      const isOthers = record?.owner !== undefined && record.owner !== this.instance
      if (isOthers || record === undefined || record.endedAt !== undefined) {
        return
      }
      const start = this.openTurns.get(record.id)
      this.openTurns.delete(record.id)
      const capture = await this.captureNow(setup, false)
      if (!capture.ok) {
        this.deps.log.warn(`Checkpoint at the end of turn ${turnId}: ${capture.detail}`)
      }
      const scanned =
        start === undefined || !capture.ok
          ? []
          : ignoredChanges(start.inventory, capture.snapshot.inventory)
      const changes = await this.withToolCopies(setup, record, scanned)
      const kept = changes.slice(0, CHECKPOINT_IGNORED_CHANGES_MAX)
      const preImages = kept.flatMap((change) =>
        change.preImage === undefined || change.preImage === null ? [] : [change.preImage],
      )
      const trees = [
        { name: 'start', tree: record.start.tree },
        ...(capture.ok ? [{ name: 'end', tree: capture.snapshot.tree }] : []),
      ]
      const keep = await this.keepTree(setup.shadow, trees, preImages)
      await setup.shadow.run(['update-ref', `${KEEP_REF_PREFIX}${record.id}`, keep])
      const isScanWhole =
        start !== undefined &&
        capture.ok &&
        !start.inventory.isPartial &&
        !capture.snapshot.inventory.isPartial
      const index = setup.records.checkpoints.indexOf(record)
      setup.records.checkpoints[index] = {
        ...record,
        ...(capture.ok && {
          end: {
            tree: capture.snapshot.tree,
            coverage: storedCoverage(capture.snapshot.coverage),
          },
        }),
        endedAt: this.deps.now(),
        ignored: {
          changes: [...kept],
          isComplete: isScanWhole && kept.length === changes.length,
        },
        keep,
      }
      await this.trimJournal(setup)
      await this.retain(setup, false)
      await this.save(setup)
    })
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

  /**
   * The extension is about to write `absolutePath` for a running turn (the
   * Model API's tools, the image tools): copy what is there first, once per
   * turn, so a restore can put an ignored file back.
   */
  public beforeToolWrite(absolutePath: string): Promise<void> {
    return this.serial(async () => {
      if (this.openTurns.size === 0) {
        return
      }
      const setup = await this.ready()
      const relative = this.relativeOf(absolutePath)
      if (relative === undefined) {
        return
      }
      const latestStart = Math.max(...Array.from(this.openTurns.values(), (turn) => turn.createdAt))
      const entries = this.journal.get(relative) ?? []
      if ((entries.at(-1)?.at ?? -1) >= latestStart) {
        return
      }
      const copy = await this.copyOf(setup, relative)
      if (copy.preImage !== undefined && copy.preImage !== null) {
        const ref = `${this.journalPrefix}${copy.preImage.oid}`
        await setup.shadow.run(['update-ref', ref, copy.preImage.oid])
      }
      this.journal.set(relative, [...entries, { at: this.deps.now(), ...copy }])
    })
  }

  /** Puts the workspace's files back as they were before the turn. */
  public restore(request: RestoreRequest): Promise<RestoreOutcome> {
    return this.lockedRestore(async (): Promise<RestoreOutcome> => {
      const setup = await this.ready()
      const checkpoint = this.find(setup, request.sessionId, request.turnId)
      if (checkpoint === undefined) {
        return { ok: false, reason: 'noCheckpoint' }
      }
      const blocking = this.turnBlocking(setup)
      if (blocking !== undefined) {
        return { ok: false, reason: blocking }
      }
      const turns = oldestFirst(
        setup.records.checkpoints.filter(
          (record) =>
            record.sessionId === request.sessionId && record.createdAt >= checkpoint.createdAt,
        ),
      )
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
      const ignoredTurns = turns.map((record) => record.ignored?.changes ?? [])
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
      )
      const changed = applied.entries.map((entry) => entry.path)
      return {
        ok: true,
        restoreId: applied.restoreId,
        changed,
        refused: [...plan.refused, ...refused, ...applied.refused],
        unsure: plan.unsure.filter((unsurePath) => changed.includes(unsurePath)),
        isIgnoredIncomplete: turns.some((record) => record.ignored?.isComplete !== true),
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
    return this.lockedRestore(async (): Promise<RestoreOutcome> => {
      const setup = await this.ready()
      const record = setup.records.restores.find((candidate) => candidate.id === request.restoreId)
      if (record === undefined) {
        return { ok: false, reason: 'redoGone' }
      }
      const blocking = this.turnBlocking(setup)
      if (blocking !== undefined) {
        return { ok: false, reason: blocking }
      }
      const steps: PlannedStep[] = record.entries.map((entry) => {
        const expect: Expectation =
          entry.after === null ? { kind: 'absent' } : { kind: 'blob', oid: entry.after.oid }
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
      )
      const donePaths = new Set(applied.entries.map((entry) => entry.path))
      const isStillKept = await this.trimRestore(
        setup,
        record,
        record.entries.filter((entry) => !donePaths.has(entry.path)),
      )
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

  /** The conversation was archived: its checkpoints and copies go now. */
  public forgetSession(sessionId: string): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      const refs = [...setup.records.checkpoints, ...setup.records.restores]
        .filter((record) => record.sessionId === sessionId)
        .map((record) => `${KEEP_REF_PREFIX}${record.id}`)
      markForgotten(setup.records, sessionId, this.deps.now())
      this.dropSession(setup, sessionId)
      await this.deleteRefs(setup.shadow, refs)
      await this.save(setup)
      if (refs.length > 0) {
        await this.prune(setup.shadow)
      }
    })
  }

  /**
   * The conversation was archived while no git may run (Restricted Mode):
   * its records go now, with no git; its refs and copies go the next time a
   * trusted window opens the store (`maintain`).
   */
  public async queueForget(sessionId: string): Promise<void> {
    if ((await lstatOrUndefined(this.recordsPath)) === undefined) {
      return
    }
    await this.serial(async () => {
      const records = await this.loadRecords()
      if (records === undefined) {
        return
      }
      markForgotten(records, sessionId, this.deps.now())
      withoutSession(records, sessionId)
      await this.save({ records })
    })
  }

  /**
   * The window opened (or the workspace was trusted): when checkpoints were
   * ever taken here, the refs no live window needs are dropped, the
   * retention bounds applied and the unneeded copies pruned, whether or not
   * checkpoints are on now.
   */
  public async maintain(): Promise<void> {
    if ((await lstatOrUndefined(path.join(this.deps.storageDir, SHADOW_HEAD))) === undefined) {
      return
    }
    await this.serial(async () => {
      const setup = await this.ready()
      await this.dropOrphanRefs(setup)
      await this.retain(setup, true)
      await this.save(setup)
    })
  }

  /**
   * The window is closing: every git still running is ended, nothing new
   * starts, and the window's presence goes (a lock it holds goes when its
   * task ends, or is taken over once the process is gone).
   */
  public dispose(): void {
    this.stopping.abort()
    clearInterval(this.heartbeat)
    this.lock.leave()
  }
}
