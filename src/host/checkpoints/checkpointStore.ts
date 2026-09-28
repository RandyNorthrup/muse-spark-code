// Turn checkpoints (M72, PLAN.md D51): a snapshot of the workspace's files
// at each turn's start and end, in a shadow repository in the extension's
// storage (shadowGit.ts), never in the workspace's `.git`.
//
// - A capture holds every file outside the ignore rules, untracked ones
//   included, byte for byte; a file over CHECKPOINT_FILE_MAX_BYTES or a
//   link is left out and named, and a folder that is a repository of its
//   own is left out whole. A private index keeps the files' stat data, so a
//   capture hashes only what changed since the last one.
// - Ignored files are not copied wholesale: a bounded scan records their
//   size and time at each end of a turn (ignoredScan.ts), and a file the
//   extension itself is about to write (the Model API's tools, the image
//   tools) is copied first (`beforeToolWrite`). A restore deletes ignored
//   files the turn created, puts back the ones it copied first, and lists
//   the rest as not restorable.
// - A restore undoes the conversation's turns from the chosen one on, file
//   by file (restorePlan.ts): a file changed outside those turns, or with
//   unsaved editor changes, is refused and listed. What a restore replaces
//   is recorded, so a redo puts it back, and a redo can be redone.
// - Every operation runs in one queue: a capture, a restore and a tool
//   write never interleave in the shadow repository.

import type { Buffer } from 'node:buffer'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  type BlobRef,
  parseCatFileBatch,
  parseDiffTree,
  parseStatusListing,
  splitNul,
  type TreeChange,
} from '../../core/checkpoints/gitListings'
import {
  type Coverage,
  type FileStat,
  type IgnoredChange,
  planRestore,
  type Refusal,
} from '../../core/checkpoints/restorePlan'
import { isSamePath } from '../../core/paths'
import {
  CHECKPOINT_CAPTURE_MAX_BYTES,
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_GIT_TIMEOUT_MS,
  CHECKPOINT_IGNORED_CHANGES_MAX,
  CHECKPOINT_MAX_FILES,
  CHECKPOINT_PRUNE_INTERVAL_MS,
  CHECKPOINT_RESTORES_PER_SESSION_MAX,
  CHECKPOINT_SESSIONS_MAX,
  CHECKPOINT_STALE_LOCK_MS,
  CHECKPOINTS_PER_SESSION_MAX,
  GIT_MISSING_OBJECT,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
  MILLISECONDS_PER_DAY,
} from '../../shared/constants'
import { GitExitError, type GitProcess } from '../git'
import { errorDetail, type Logger } from '../logger'
import {
  didDeleteRestoredFile,
  lstatOrUndefined,
  mapInBatches,
  repositoryTop,
  type RestoreTarget,
  userExclude,
  didWriteRestoredFile,
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
import { type IgnoredInventory, ignoredChanges, regularFileStat, scanIgnored } from './ignoredScan'
import { ShadowGit, withoutGitVariables } from './shadowGit'

/** A capture's result, before it is recorded against a turn. */
export interface Snapshot {
  readonly tree: string
  readonly coverage: Coverage
  readonly inventory: IgnoredInventory
  readonly createdAt: number
}

export type CaptureRefusal = 'tooManyFiles' | 'tooLarge' | 'failed'

export type CaptureResult =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly reason: CaptureRefusal; readonly detail: string }

export type RestoreFailure = 'noCheckpoint' | 'turnRunning' | 'captureFailed' | 'redoGone'

export type RestoreOutcome =
  | {
      readonly ok: true
      /** What a redo takes; undefined when nothing changed. */
      readonly restoreId: string | undefined
      readonly changed: readonly string[]
      readonly refused: readonly Refusal[]
      /** Some turn's ignored files were not fully tracked (a reload mid-turn, the scan's limit). */
      readonly isIgnoredIncomplete: boolean
    }
  | { readonly ok: false; readonly reason: RestoreFailure; readonly detail?: string }

export interface RestoreRequest {
  readonly sessionId: string
  readonly turnId: string
  /** Files open with unsaved changes, absolute. */
  readonly unsavedPaths: readonly string[]
}

export interface RedoRequest {
  readonly sessionId: string
  readonly restoreId: string
  readonly unsavedPaths: readonly string[]
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

interface Setup {
  readonly shadow: ShadowGit
  readonly prefix: string
  readonly records: CheckpointRecords
}

const RECORDS_FILE = 'records.json'
const KEEP_REF_PREFIX = 'refs/muse-spark/keep/'
const JOURNAL_REF_PREFIX = 'refs/muse-spark/journal/'
const INDEX_REF = 'refs/muse-spark/index'
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

/** Keeps the records the per-group count allows, newest first. */
function newestPerGroup<T extends { readonly createdAt: number; readonly sessionId: string }>(
  records: readonly T[],
  limit: number,
  isKept: (record: T) => boolean,
): readonly T[] {
  const counts = new Map<string, number>()
  return records
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .filter((record) => {
      const count = (counts.get(record.sessionId) ?? 0) + 1
      counts.set(record.sessionId, count)
      return count <= limit && isKept(record)
    })
}

export class CheckpointStore {
  private queue: Promise<unknown> = Promise.resolve()
  private setup: Setup | undefined
  /** The start scan of each turn still running, by checkpoint id. */
  private readonly openTurns = new Map<string, { createdAt: number; inventory: IgnoredInventory }>()
  private readonly journal = new Map<string, JournalEntry[]>()
  private emptyTree: string | undefined
  /** The private index's tree its ref last named. */
  private indexTree: string | undefined
  private lastPruneAt = 0

  public constructor(private readonly deps: CheckpointStoreDeps) {}

  private get target(): RestoreTarget {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      log: this.deps.log,
    }
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = afterSettled(this.queue, task)
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
      { git: this.deps.git, env: this.deps.env },
    )
    await mkdir(storageDir, { recursive: true })
    await shadow.prepare(await userExclude(top), await this.globalExcludesFile())
    const loaded = await loadRecords(path.join(storageDir, RECORDS_FILE), (reason) => {
      this.deps.log.warn(`Checkpoint records were unreadable and were set aside: ${reason}`)
    })
    const isSameWorkspace = loaded?.top === top && loaded.prefix === prefix
    if (!isSameWorkspace) {
      if (loaded !== undefined) {
        this.deps.log.info('The workspace moved: its checkpoints start afresh')
        await this.dropRefs(shadow, [...loaded.checkpoints, ...loaded.restores])
      }
      await rm(shadow.indexPath('work'), { force: true })
    }
    const setup: Setup = {
      shadow,
      prefix,
      records: isSameWorkspace ? loaded : emptyRecords(top, prefix),
    }
    this.setup = setup
    await this.save(setup)
    return setup
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
        { cwd: this.deps.storageDir, env, timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS },
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

  private unsavedTest(unsavedPaths: readonly string[]): (relative: string) => boolean {
    return (relative) =>
      unsavedPaths.some((unsaved) =>
        isSamePath(unsaved, this.absoluteOf(relative), this.deps.platform),
      )
  }

  private find(setup: Setup, sessionId: string, turnId: string): CheckpointRecord | undefined {
    return setup.records.checkpoints.find(
      (record) => record.sessionId === sessionId && record.turnId === turnId,
    )
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

  /** The workspace's files now: the private index brought up to date, and the ignored scan. */
  private async captureNow(setup: Setup): Promise<CaptureResult> {
    try {
      await setup.shadow.clearStaleLock('work', this.deps.now(), CHECKPOINT_STALE_LOCK_MS)
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
      if (listing.files.length > CHECKPOINT_MAX_FILES) {
        return {
          ok: false,
          reason: 'tooManyFiles',
          detail: `${String(listing.files.length)} files outside the ignore rules`,
        }
      }
      const inWorkspace = (paths: readonly string[]) =>
        paths.map((topPath) => this.inWorkspace(setup, topPath))
      const { wanted, skipped } = await this.sortListed(inWorkspace(listing.files))
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
        inWorkspace(listing.ignoredFiles),
        inWorkspace(listing.ignoredFolders),
      )
      return {
        ok: true,
        snapshot: {
          tree: synced.tree,
          coverage: {
            skipped: skipped.toSorted(byText),
            repositories: inWorkspace(listing.repositories).toSorted(byText),
          },
          inventory,
          createdAt: this.deps.now(),
        },
      }
    } catch (error: unknown) {
      return { ok: false, reason: 'failed', detail: errorDetail(error) }
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

  /** What is at `relative` before a restore replaces it: the current capture's blob, or a copy. */
  private async beforeOf(
    setup: Setup,
    relative: string,
    inCurrent: ReadonlyMap<string, BlobRef>,
  ): Promise<BlobRef | null | undefined> {
    const captured = inCurrent.get(relative)
    if (captured !== undefined) {
      return captured
    }
    const copy = await this.copyOf(setup, relative)
    return copy.preImage
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
        refs.push(`delete ${JOURNAL_REF_PREFIX}${oid}${LINE_FEED}`)
      }
    }
    if (refs.length > 0) {
      await setup.shadow.run(['update-ref', '--stdin'], { input: refs.join('') })
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

  /** Paths changed between the turns and after the last one: not these turns' doing. */
  private async changedOutside(
    shadow: ShadowGit,
    turns: readonly CheckpointRecord[],
    currentTree: string,
  ): Promise<ReadonlySet<string>> {
    const changed = new Set<string>()
    for (const [index, turn] of turns.entries()) {
      const next = turns[index + 1]?.start.tree ?? currentTree
      // A turn whose end was not seen counts everything up to the next as its own.
      const end = turn.end?.tree ?? next
      const gap = await this.diff(shadow, end, next)
      for (const change of gap) {
        changed.add(change.path)
      }
    }
    return changed
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

  /** The object names of these files as they are now (nothing written). */
  private async currentOids(
    setup: Setup,
    relatives: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const oids = new Map<string, string>()
    for (const relative of relatives) {
      if ((await regularFileStat(this.absoluteOf(relative))) === undefined) {
        continue
      }
      const oid = await setup.shadow.text([
        'hash-object',
        '--no-filters',
        '--',
        this.topOf(setup, relative),
      ])
      oids.set(relative, oid)
    }
    return oids
  }

  /** Which of these paths the ignore rules (as restored) name. */
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
        input: nulInput(relatives.map((relative) => this.topOf(setup, relative))),
      })
      return new Set(splitNul(answer).map((topPath) => this.inWorkspace(setup, topPath)))
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

  /** A redo record for the files a restore changed; undefined when it changed none. */
  private async recordRestore(
    setup: Setup,
    sessionId: string,
    entries: readonly RestoreEntry[],
  ): Promise<string | undefined> {
    if (entries.length === 0) {
      return undefined
    }
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
    await this.retain(setup)
    await this.save(setup)
    return id
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

  /** Drops what the retention bounds exclude; prunes when anything went. */
  private async retain(setup: Setup): Promise<void> {
    const now = this.deps.now()
    const days = this.deps.retentionDays()
    const cutoff = days > 0 ? now - days * MILLISECONDS_PER_DAY : -Infinity
    const sessions: string[] = []
    const newestFirst = setup.records.checkpoints.toSorted(
      (left, right) => right.createdAt - left.createdAt,
    )
    for (const record of newestFirst) {
      if (!sessions.includes(record.sessionId)) {
        sessions.push(record.sessionId)
      }
    }
    const keptSessions = new Set(sessions.slice(0, CHECKPOINT_SESSIONS_MAX))
    const keptCheckpoints = newestPerGroup(
      setup.records.checkpoints,
      CHECKPOINTS_PER_SESSION_MAX,
      (record) =>
        this.openTurns.has(record.id) ||
        (keptSessions.has(record.sessionId) && record.createdAt >= cutoff),
    )
    const keptRestores = newestPerGroup(
      setup.records.restores,
      CHECKPOINT_RESTORES_PER_SESSION_MAX,
      (record) => record.createdAt >= cutoff,
    )
    const dropped = [
      ...setup.records.checkpoints.filter((record) => !keptCheckpoints.includes(record)),
      ...setup.records.restores.filter((record) => !keptRestores.includes(record)),
    ]
    setup.records.checkpoints = oldestFirst(keptCheckpoints)
    setup.records.restores = oldestFirst(keptRestores)
    if (dropped.length === 0) {
      return
    }
    await this.dropRefs(setup.shadow, dropped)
    if (now - this.lastPruneAt > CHECKPOINT_PRUNE_INTERVAL_MS) {
      await this.prune(setup.shadow)
    }
  }

  private async dropRefs(
    shadow: ShadowGit,
    records: readonly { readonly id: string }[],
  ): Promise<void> {
    if (records.length === 0) {
      return
    }
    await shadow.run(['update-ref', '--stdin'], {
      input: records.map((record) => `delete ${KEEP_REF_PREFIX}${record.id}${LINE_FEED}`).join(''),
    })
  }

  /** Deletes every copy no record, running turn or the private index still needs. */
  private async prune(shadow: ShadowGit): Promise<void> {
    await shadow.run(['prune', '--expire=now'])
    this.lastPruneAt = this.deps.now()
  }

  /** The restore's writes and deletions; what changed, for the redo record. */
  private async applyRestore(
    setup: Setup,
    plan: ReturnType<typeof planRestore>,
    inCurrent: ReadonlyMap<string, BlobRef>,
    checkpointTree: string,
  ): Promise<{ readonly entries: readonly RestoreEntry[]; readonly refused: Refusal[] }> {
    const refused = [...plan.refused]
    const entries: RestoreEntry[] = []
    const blobs = await this.blobsOf(
      setup.shadow,
      plan.writes.map((write) => write.blob.oid),
    )
    for (const write of plan.writes) {
      const before = await this.beforeOf(setup, write.path, inCurrent)
      const content = blobs.get(write.blob.oid)
      if (before === undefined || content === undefined) {
        refused.push({ path: write.path, reason: 'notInCheckpoint' })
      } else if (await didWriteRestoredFile(this.target, write.path, content, write.blob.mode)) {
        entries.push({ path: write.path, before, after: write.blob })
      } else {
        refused.push({ path: write.path, reason: 'failed' })
      }
    }
    // An added file the restored ignore rules name was an ignored file at
    // the checkpoint: it may have been there then, so it stays.
    const ignoredNow = await this.ignoredAmong(
      setup,
      plan.deletes.filter((deleted) => inCurrent.has(deleted)),
    )
    const foldersThen = await this.foldersOf(setup.shadow, checkpointTree)
    for (const deleted of plan.deletes) {
      const before = ignoredNow.has(deleted)
        ? undefined
        : await this.beforeOf(setup, deleted, inCurrent)
      if (before === undefined) {
        refused.push({ path: deleted, reason: 'notInCheckpoint' })
        continue
      }
      const folders = inCurrent.has(deleted) ? foldersThen : undefined
      if (await didDeleteRestoredFile(this.target, deleted, folders)) {
        entries.push({ path: deleted, before, after: null })
      } else {
        refused.push({ path: deleted, reason: 'failed' })
      }
    }
    return { entries, refused }
  }

  /** A capture of the workspace now; `record` ties it to a turn. */
  public capture(): Promise<CaptureResult> {
    return this.serial(async () => await this.captureNow(await this.ready()))
  }

  /** Ties a capture to the turn it precedes. */
  public record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      if (this.find(setup, sessionId, turnId) !== undefined) {
        return
      }
      const id = this.deps.newId()
      const keep = await this.keepTree(setup.shadow, [{ name: 'start', tree: snapshot.tree }], [])
      await setup.shadow.run(['update-ref', `${KEEP_REF_PREFIX}${id}`, keep])
      setup.records.checkpoints.push({
        id,
        sessionId,
        turnId,
        createdAt: snapshot.createdAt,
        start: { tree: snapshot.tree, coverage: storedCoverage(snapshot.coverage) },
        keep,
      })
      this.openTurns.set(id, { createdAt: snapshot.createdAt, inventory: snapshot.inventory })
      await this.retain(setup)
      await this.save(setup)
    })
  }

  /** The turn ended: capture again and record the ignored files it changed. */
  public endTurn(sessionId: string, turnId: string): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      const record = this.find(setup, sessionId, turnId)
      if (record === undefined || record.end !== undefined) {
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
      const index = setup.records.checkpoints.indexOf(record)
      setup.records.checkpoints[index] = {
        ...record,
        ...(capture.ok && {
          end: {
            tree: capture.snapshot.tree,
            coverage: storedCoverage(capture.snapshot.coverage),
          },
        }),
        ignored: {
          changes: [...kept],
          isComplete: start !== undefined && capture.ok && kept.length === changes.length,
        },
        keep,
      }
      await this.trimJournal(setup)
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
      const turns = oldestFirst(
        setup.records.checkpoints.filter(
          (record) =>
            record.sessionId === request.sessionId && record.createdAt >= checkpoint.createdAt,
        ),
      )
      if (turns.some((record) => this.openTurns.has(record.id))) {
        return { ok: false, reason: 'turnRunning' }
      }
      const capture = await this.captureNow(setup)
      if (!capture.ok) {
        return { ok: false, reason: 'captureFailed', detail: capture.detail }
      }
      const current = capture.snapshot
      const changes = await this.diff(setup.shadow, checkpoint.start.tree, current.tree)
      const changedOutsideTurns = await this.changedOutside(setup.shadow, turns, current.tree)
      const ignoredTurns = turns.map((record) => record.ignored?.changes ?? [])
      const currentStat = new Map<string, FileStat | null>()
      for (const change of ignoredTurns.flat()) {
        const stat = await regularFileStat(this.absoluteOf(change.path))
        currentStat.set(change.path, stat ?? null)
      }
      const plan = planRestore({
        changes,
        changedOutsideTurns,
        ignoredTurns,
        coverage: { checkpoint: checkpoint.start.coverage, current: current.coverage },
        currentStat,
        isUnsaved: this.unsavedTest(request.unsavedPaths),
      })
      const inCurrent = new Map<string, BlobRef>()
      for (const change of changes) {
        if (change.after !== undefined) {
          inCurrent.set(change.path, change.after)
        }
      }
      const applied = await this.applyRestore(setup, plan, inCurrent, checkpoint.start.tree)
      const restoreId = await this.recordRestore(setup, request.sessionId, applied.entries)
      return {
        ok: true,
        restoreId,
        changed: applied.entries.map((entry) => entry.path),
        refused: applied.refused,
        isIgnoredIncomplete: turns.some((record) => record.ignored?.isComplete !== true),
      }
    })
  }

  /** Puts back what a restore (or a redo) replaced; the redo can be redone in turn. */
  public redo(request: RedoRequest): Promise<RestoreOutcome> {
    return this.serial(async (): Promise<RestoreOutcome> => {
      const setup = await this.ready()
      const record = setup.records.restores.find(
        (candidate) =>
          candidate.id === request.restoreId && candidate.sessionId === request.sessionId,
      )
      if (record === undefined) {
        return { ok: false, reason: 'redoGone' }
      }
      const isUnsaved = this.unsavedTest(request.unsavedPaths)
      const nowOids = await this.currentOids(
        setup,
        record.entries.flatMap((entry) => (entry.after === null ? [] : [entry.path])),
      )
      const refused: Refusal[] = []
      const ready: RestoreEntry[] = []
      for (const entry of record.entries) {
        const isAsLeft =
          entry.after === null
            ? (await regularFileStat(this.absoluteOf(entry.path))) === undefined
            : nowOids.get(entry.path) === entry.after.oid
        if (!isAsLeft) {
          refused.push({ path: entry.path, reason: 'changedAfter' })
        } else if (isUnsaved(entry.path)) {
          refused.push({ path: entry.path, reason: 'unsaved' })
        } else {
          ready.push(entry)
        }
      }
      const blobs = await this.blobsOf(
        setup.shadow,
        ready.flatMap((entry) => (entry.before === null ? [] : [entry.before.oid])),
      )
      const entries: RestoreEntry[] = []
      for (const entry of ready) {
        const content = entry.before === null ? undefined : blobs.get(entry.before.oid)
        let isDone = false
        if (entry.before === null) {
          isDone = await didDeleteRestoredFile(this.target, entry.path, undefined)
        } else if (content !== undefined) {
          isDone = await didWriteRestoredFile(this.target, entry.path, content, entry.before.mode)
        }
        if (isDone) {
          entries.push({ path: entry.path, before: entry.after, after: entry.before })
        } else {
          refused.push({ path: entry.path, reason: 'failed' })
        }
      }
      setup.records.restores = setup.records.restores.filter((candidate) => candidate !== record)
      await setup.shadow.run(['update-ref', '-d', `${KEEP_REF_PREFIX}${record.id}`])
      const restoreId = await this.recordRestore(setup, request.sessionId, entries)
      return {
        ok: true,
        restoreId,
        changed: entries.map((entry) => entry.path),
        refused,
        isIgnoredIncomplete: false,
      }
    })
  }

  /** The conversation was archived or deleted: its checkpoints and copies go. */
  public forgetSession(sessionId: string): Promise<void> {
    return this.serial(async () => {
      const setup = await this.ready()
      const dropped = [
        ...setup.records.checkpoints.filter((record) => record.sessionId === sessionId),
        ...setup.records.restores.filter((record) => record.sessionId === sessionId),
      ]
      if (dropped.length === 0) {
        return
      }
      for (const record of dropped) {
        this.openTurns.delete(record.id)
      }
      setup.records.checkpoints = setup.records.checkpoints.filter(
        (record) => record.sessionId !== sessionId,
      )
      setup.records.restores = setup.records.restores.filter(
        (record) => record.sessionId !== sessionId,
      )
      await this.dropRefs(setup.shadow, dropped)
      await this.save(setup)
      await this.prune(setup.shadow)
    })
  }
}
