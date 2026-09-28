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
// - Every operation runs in one queue: a capture, a restore and a tool
//   write never interleave in the shadow repository. No restore or redo runs
//   while any turn of the window runs.

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
  CHECKPOINT_GIT_TIMEOUT_MS,
  CHECKPOINT_IGNORED_CHANGES_MAX,
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
  loadForgotten,
  loadRecords,
  type RestoreEntry,
  type RestoreRecord,
  saveForgotten,
  saveRecords,
} from './checkpointRecords'
import { retainRecords } from './checkpointRetention'
import { type IgnoredInventory, ignoredChanges, regularFileStat, scanIgnored } from './ignoredScan'
import { readOptionalText, ShadowGit, withoutGitVariables } from './shadowGit'

/** A capture's result, before it is recorded against a turn. */
export interface Snapshot {
  readonly tree: string
  readonly coverage: Coverage
  readonly inventory: IgnoredInventory
  readonly createdAt: number
  /** The ref that keeps the capture from pruning until it is recorded or let go. */
  readonly pin: string | undefined
}

export type CaptureRefusal = 'tooManyFiles' | 'tooLarge' | 'noGit' | 'failed'

export type CaptureResult =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly reason: CaptureRefusal; readonly detail: string }

/**
 * Why a restore or a redo did nothing: no checkpoint (any more); a turn is
 * running in the window; the capture it starts with was refused; the redo
 * record is gone; checkpoints are not available here.
 */
export type RestoreFailure =
  'noCheckpoint' | 'turnRunning' | 'captureFailed' | 'redoGone' | 'unavailable'

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

interface Setup {
  readonly shadow: ShadowGit
  readonly prefix: string
  readonly records: CheckpointRecords
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
const FORGOTTEN_FILE = 'forgotten.json'
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
  private setup: Setup | undefined
  /** The start scan of each recorded turn still running, by checkpoint id. */
  private readonly openTurns = new Map<string, OpenTurn>()
  /** Every turn running in the window, recorded or not (a refused capture included). */
  private readonly runningTurns = new Set<string>()
  private readonly journal = new Map<string, JournalEntry[]>()
  /** When each conversation was forgotten: a capture taken before then is not recorded. */
  private readonly forgottenAt = new Map<string, number>()
  private readonly stopping = new AbortController()
  private emptyTree: string | undefined
  /** The private index's tree its ref last named. */
  private indexTree: string | undefined
  private lastPruneAt = 0
  private isPruneDue = false

  public constructor(private readonly deps: CheckpointStoreDeps) {}

  private get target(): RestoreTarget {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      log: this.deps.log,
    }
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const guarded = async (): Promise<T> => {
      if (this.stopping.signal.aborted) {
        throw new Error(DISPOSED)
      }
      return await task()
    }
    const run = afterSettled(this.queue, guarded)
    this.queue = settled(run)
    return run
  }

  private async ready(): Promise<Setup> {
    if (this.setup !== undefined) {
      return this.setup
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
    const loaded = await loadRecords(path.join(storageDir, RECORDS_FILE), (reason) => {
      this.deps.log.warn(`Checkpoint records were unreadable and were set aside: ${reason}`)
    })
    const isSameWorkspace = loaded?.top === top && loaded.prefix === prefix
    if (loaded !== undefined && !isSameWorkspace) {
      this.deps.log.info('The workspace moved: its checkpoints start afresh')
    }
    const setup: Setup = {
      shadow,
      prefix,
      records: isSameWorkspace ? loaded : emptyRecords(top, prefix),
    }
    this.setup = setup
    await this.applyForgotten(setup)
    await this.dropOrphanRefs(setup)
    await this.save(setup)
    return setup
  }

  /** The conversations archived while no git could run: their records go now. */
  private async applyForgotten(setup: Setup): Promise<void> {
    const filePath = path.join(this.deps.storageDir, FORGOTTEN_FILE)
    const queued = await loadForgotten(filePath, (reason) => {
      this.deps.log.warn(
        `The archived-conversation queue was unreadable and was set aside: ${reason}`,
      )
    })
    for (const sessionId of queued) {
      this.dropSession(setup, sessionId)
    }
    if (queued.length > 0) {
      await saveForgotten(filePath, [])
    }
  }

  /**
   * Refs no record names: a record file set aside or a window that closed
   * between a ref and its record, every tool copy and every pinned capture
   * of an earlier window. Their copies are pruned.
   */
  private async dropOrphanRefs(setup: Setup): Promise<void> {
    const named = new Set(
      [...setup.records.checkpoints, ...setup.records.restores].map(
        (record) => `${KEEP_REF_PREFIX}${record.id}`,
      ),
    )
    const listed = await setup.shadow.text(['for-each-ref', '--format=%(refname)', REF_ROOT])
    const orphans = listed
      .split(LINE_FEED)
      .filter(
        (ref) =>
          ref.startsWith(JOURNAL_REF_PREFIX) ||
          ref.startsWith(PIN_REF_PREFIX) ||
          (ref.startsWith(KEEP_REF_PREFIX) && !named.has(ref)),
      )
    if (orphans.length === 0) {
      return
    }
    await this.deleteRefs(setup.shadow, orphans)
    this.isPruneDue = true
  }

  private async save(setup: Setup): Promise<void> {
    await saveRecords(path.join(this.deps.storageDir, RECORDS_FILE), setup.records)
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
    // The ref keeps the index's copies from pruning; it moves only when they change.
    if (full !== this.indexTree) {
      await shadow.run(['update-ref', INDEX_REF, full])
      this.indexTree = full
    }
    if (wanted.size === 0) {
      return { tree: await this.emptyTreeOf(shadow) }
    }
    return {
      tree:
        setup.prefix === '' ? full : await shadow.text(['rev-parse', `${full}:${setup.prefix}`]),
    }
  }

  /**
   * The workspace's files now: the private index brought up to date, and
   * the ignored scan. Paths below a link or junction are left out.
   */
  private async captureNow(setup: Setup): Promise<CaptureResult> {
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
      const inventory = await scanIgnored(
        this.deps.workspaceRoot,
        ignoredFiles.filter((relative) => isReachable(relative)),
        ignoredFolders.filter((relative) => isReachable(relative)),
      )
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
        refs.push(`${JOURNAL_REF_PREFIX}${oid}`)
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
      end: record.endedAt ?? (this.openTurns.has(record.id) ? now : record.createdAt),
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

  /** The folders a tree holds, so a restore removes only the folders the turns made. */
  private async foldersOf(shadow: ShadowGit, tree: string): Promise<ReadonlySet<string>> {
    const answer = await shadow.text(['ls-tree', '-r', '-d', '--name-only', '-z', tree])
    return new Set(splitNul(answer))
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
    const kept = retainRecords(
      setup.records,
      this.deps.now(),
      this.deps.retentionDays(),
      (record) => this.openTurns.has(record.id),
    )
    setup.records.checkpoints = kept.checkpoints
    setup.records.restores = kept.restores
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
    await shadow.run(['update-ref', '--stdin'], {
      input: refs.map((ref) => `delete ${ref}${LINE_FEED}`).join(''),
    })
  }

  /** Deletes every copy no record, pinned capture, running turn or the private index needs. */
  private async prune(shadow: ShadowGit): Promise<void> {
    await shadow.run(['prune', '--expire=now'])
    this.lastPruneAt = this.deps.now()
    this.isPruneDue = false
  }

  /** Drops a conversation's records from memory (the refs go with the next orphan sweep). */
  private dropSession(setup: Setup, sessionId: string): void {
    for (const record of setup.records.checkpoints) {
      if (record.sessionId === sessionId) {
        this.openTurns.delete(record.id)
      }
    }
    setup.records.checkpoints = setup.records.checkpoints.filter(
      (record) => record.sessionId !== sessionId,
    )
    setup.records.restores = setup.records.restores.filter(
      (record) => record.sessionId !== sessionId,
    )
  }

  /**
   * One step, if it may still run: a file with unsaved editor changes is
   * left as it is, and so is one no longer as the restore expects.
   */
  private async runStep(
    step: PlannedStep,
    content: Buffer | undefined,
    foldersThen: ReadonlySet<string> | undefined,
    isUnsaved: (relative: string) => boolean,
  ): Promise<Refusal | undefined> {
    if (isUnsaved(step.path)) {
      return { path: step.path, reason: 'unsaved' }
    }
    const result = await applyFileStep(this.target, step, content, foldersThen)
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
    foldersThen: ReadonlySet<string> | undefined,
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
                step.isIgnoreChecked ? foldersThen : undefined,
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
    foldersThen: ReadonlySet<string> | undefined,
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
    const applied = await this.runSteps(setup, steps, foldersThen, isUnsaved)
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

  /** A capture of the workspace now, pinned until `record` or `release`. */
  public capture(): Promise<CaptureResult> {
    return this.serial(async (): Promise<CaptureResult> => {
      let setup: Setup
      try {
        setup = await this.ready()
      } catch (error: unknown) {
        return {
          ok: false,
          reason: error instanceof GitMissingError ? 'noGit' : 'failed',
          detail: errorDetail(error),
        }
      }
      const result = await this.captureNow(setup)
      if (!result.ok) {
        return result
      }
      const pin = `${PIN_REF_PREFIX}${this.deps.newId()}`
      await setup.shadow.run(['update-ref', pin, result.snapshot.tree])
      return { ok: true, snapshot: { ...result.snapshot, pin } }
    })
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

  /** Ties a capture to the turn it precedes, unless its conversation was forgotten since. */
  public record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      const pins = snapshot.pin === undefined ? [] : [snapshot.pin]
      const forgotten = this.forgottenAt.get(sessionId)
      if (
        this.find(setup, sessionId, turnId) !== undefined ||
        (forgotten !== undefined && snapshot.createdAt <= forgotten)
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
        start: { tree: snapshot.tree, coverage: storedCoverage(snapshot.coverage) },
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
      if (record === undefined || record.endedAt !== undefined) {
        return
      }
      const start = this.openTurns.get(record.id)
      this.openTurns.delete(record.id)
      const capture = await this.captureNow(setup)
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
        const ref = `${JOURNAL_REF_PREFIX}${copy.preImage.oid}`
        await setup.shadow.run(['update-ref', ref, copy.preImage.oid])
      }
      this.journal.set(relative, [...entries, { at: this.deps.now(), ...copy }])
    })
  }

  /** Puts the workspace's files back as they were before the turn. */
  public restore(request: RestoreRequest): Promise<RestoreOutcome> {
    return this.serial(async (): Promise<RestoreOutcome> => {
      const setup = await this.ready()
      const checkpoint = this.find(setup, request.sessionId, request.turnId)
      if (checkpoint === undefined) {
        return { ok: false, reason: 'noCheckpoint' }
      }
      if (this.isAnyTurnRunning()) {
        return { ok: false, reason: 'turnRunning' }
      }
      const turns = oldestFirst(
        setup.records.checkpoints.filter(
          (record) =>
            record.sessionId === request.sessionId && record.createdAt >= checkpoint.createdAt,
        ),
      )
      const capture = await this.captureNow(setup)
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
      const foldersThen = await this.foldersOf(setup.shadow, checkpoint.start.tree)
      const applied = await this.runRecorded(
        setup,
        request.sessionId,
        planned,
        foldersThen,
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
    return this.serial(async (): Promise<RestoreOutcome> => {
      const setup = await this.ready()
      const record = setup.records.restores.find((candidate) => candidate.id === request.restoreId)
      if (record === undefined) {
        return { ok: false, reason: 'redoGone' }
      }
      if (this.isAnyTurnRunning()) {
        return { ok: false, reason: 'turnRunning' }
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
      this.forgottenAt.set(sessionId, this.deps.now())
      const setup = await this.ready()
      const refs = [...setup.records.checkpoints, ...setup.records.restores]
        .filter((record) => record.sessionId === sessionId)
        .map((record) => `${KEEP_REF_PREFIX}${record.id}`)
      if (refs.length === 0) {
        return
      }
      this.dropSession(setup, sessionId)
      await this.deleteRefs(setup.shadow, refs)
      await this.save(setup)
      await this.prune(setup.shadow)
    })
  }

  /**
   * The conversation was archived while no git may run (Restricted Mode):
   * it is queued, and its checkpoints go the next time the store opens.
   */
  public queueForget(sessionId: string): Promise<void> {
    return this.serial(async () => {
      this.forgottenAt.set(sessionId, this.deps.now())
      const filePath = path.join(this.deps.storageDir, FORGOTTEN_FILE)
      if ((await readOptionalText(path.join(this.deps.storageDir, RECORDS_FILE))) === undefined) {
        return
      }
      const queued = await loadForgotten(filePath, (reason) => {
        this.deps.log.warn(
          `The archived-conversation queue was unreadable and was set aside: ${reason}`,
        )
      })
      if (!queued.includes(sessionId)) {
        await saveForgotten(filePath, [...queued, sessionId])
      }
    })
  }

  /**
   * The window opened (or the workspace was trusted): when checkpoints were
   * ever taken here, the queued forgets, the orphan refs and the retention
   * bounds are applied and the unneeded copies pruned, whether or not
   * checkpoints are on now.
   */
  public maintain(): Promise<void> {
    return this.serial(async () => {
      if ((await lstatOrUndefined(path.join(this.deps.storageDir, SHADOW_HEAD))) === undefined) {
        return
      }
      const setup = await this.ready()
      await this.retain(setup, true)
      await this.save(setup)
    })
  }

  /** The window is closing: every git still running is ended, and nothing new starts. */
  public dispose(): void {
    this.stopping.abort()
  }
}
