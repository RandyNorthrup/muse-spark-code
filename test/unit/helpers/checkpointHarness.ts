// Real git over throwaway folders for the checkpoint store's tests (M72,
// M86): each test makes its own workspace and storage folder, so nothing is
// shared and every restore is checked against the bytes on disk.
//
// The model's tool writes are recorded here by `toolWrite`, a test stand-in
// for the recorder (writeRecorder.ts) that uses only the journal's own API:
// the before and after copies kept, the intent appended, the file written,
// the write settled. Its `settle` argument stops a write where a crash would.

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  ContentState,
  Owner,
  UnitKind,
  WriteRecord,
} from '../../../src/core/checkpoints/toolWrites'
import { turnKey } from '../../../src/core/checkpoints/turnKey'
import {
  createCheckpointPort,
  type CheckpointPort,
} from '../../../src/host/checkpoints/checkpointHost'
import {
  parseRecord,
  parseUnit,
  type StoredRecord,
  type StoredUnit,
} from '../../../src/host/checkpoints/checkpointRecords'
import { CheckpointStore, type RestoreOutcome } from '../../../src/host/checkpoints/checkpointStore'
import { WriteJournal } from '../../../src/host/checkpoints/writeJournal'
import { type GitProcess, processGitProcess } from '../../../src/host/git'
import { GIT_MODE_EXECUTABLE, GIT_MODE_FILE } from '../../../src/shared/constants'
import { FakeLogOutputChannel } from './fakes'
import { removeFolder } from './temporaryFolders'

export const REAL_GIT_TIMEOUT_MS = 120_000
const realGit = processGitProcess()
const folders: string[] = []
const stores: CheckpointStore[] = []
const EXECUTABLE_BITS = 0o111

/** Closes every store and removes every folder the tests made (an `afterEach`). */
export async function removeCheckpointFolders(): Promise<void> {
  for (const store of stores.splice(0)) {
    store.dispose()
  }
  for (const folder of folders.splice(0)) {
    await removeFolder(folder)
  }
}

function makeBase(): string {
  const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-checkpoints-')))
  folders.push(base)
  return base
}

/**
 * git's own read of a shadow repository, independent of the store: from the
 * storage folder, the repository named relative to it (as long paths need),
 * with `core.longpaths` scoped to this command as the store scopes it. A deep
 * temporary folder puts the refs' files past 260 characters, which git on
 * Windows opens only with it.
 */
export function shadowGit(storage: string, args: readonly string[], input?: string): string {
  return execFileSync('git', ['-c', 'core.longpaths=true', '--git-dir', 'shadow.git', ...args], {
    cwd: storage,
    encoding: 'utf8',
    ...(input !== undefined && { input }),
  })
}

export function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.x', ...args], {
    cwd,
    encoding: 'utf8',
  })
}

export interface HarnessOptions {
  readonly git?: 'commit' | 'empty' | 'none'
  readonly subfolder?: string
  /** The extension host's environment, given the work tree's top. */
  readonly env?: (top: string) => NodeJS.ProcessEnv
  /** The git the store runs (a wrapper around the real one). */
  readonly gitProcess?: GitProcess
  /** The store's clock; by default one that starts in 1970 and ticks a second a call. */
  readonly now?: () => number
  /** Whether a window's process still runs (every one does, by default). */
  readonly isProcessAlive?: (pid: number) => boolean
  /** The store's waits (the product's by default). */
  readonly heartbeatMs?: number
  /** The retention setting (`museSpark.cleanupPeriodDays`); 30 by default. */
  readonly retentionDays?: () => number
}

export interface Harness {
  readonly root: string
  readonly top: string
  readonly storage: string
  readonly store: CheckpointStore
  readonly log: FakeLogOutputChannel
  /**
   * Another store over the same workspace and storage: a second window on
   * the folder, or the window reopened (dispose the first), in the process
   * `pid` names (this one's by default).
   */
  readonly reopen: (pid?: number) => CheckpointStore
  /** A store at another storage folder (and workspace), with git's path limit a test lowers. */
  readonly reopenAt: (
    storageDir: string,
    workspaceRoot?: string,
    gitPathMax?: number,
    storageRoot?: string,
  ) => CheckpointStore
}

/** Real store admission stays active even when recording is disabled. */
export function checkpointPort(
  h: Pick<Harness, 'store'>,
  isTrusted: boolean | (() => boolean) = true,
  isEnabled: () => boolean = () => false,
): CheckpointPort {
  const isWorkspaceTrusted = () => (typeof isTrusted === 'function' ? isTrusted() : isTrusted)
  return createCheckpointPort({
    store: h.store,
    isNamespaceKnown: () => true,
    isWorkspaceTrusted,
    isEnabled,
    hasGit: isWorkspaceTrusted,
    log: new FakeLogOutputChannel(),
  })
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const base = makeBase()
  const top = path.join(base, 'ws')
  await mkdir(top)
  if (options.git !== 'none') {
    runGit(top, ['init', '-q', '-b', 'main'])
  }
  const root = options.subfolder === undefined ? top : path.join(top, options.subfolder)
  await mkdir(root, { recursive: true })
  const storage = path.join(base, 'storage')
  const log = new FakeLogOutputChannel()
  let clock = 1_000_000
  const open = (
    pid = process.pid,
    storeDir = storage,
    storeRoot = root,
    gitPathMax?: number,
    storageRoot?: string,
  ) => {
    const store = new CheckpointStore({
      workspaceRoot: storeRoot,
      storageDir: storeDir,
      platform: process.platform,
      git: options.gitProcess ?? realGit,
      env: options.env?.(top) ?? process.env,
      retentionDays: options.retentionDays ?? (() => 30),
      now:
        options.now ??
        (() => {
          clock += 1000
          return clock
        }),
      newId: () => randomUUID(),
      pid,
      isProcessAlive: options.isProcessAlive ?? (() => true),
      openJournal: (instance) => new WriteJournal({ storageDir: storeDir, instance }),
      ...(options.heartbeatMs !== undefined && { heartbeatMs: options.heartbeatMs }),
      ...(gitPathMax !== undefined && { gitPathMax }),
      ...(storageRoot !== undefined && { storageRoot }),
      log,
    })
    stores.push(store)
    return store
  }
  return {
    root,
    top,
    storage,
    store: open(),
    log,
    reopen: open,
    reopenAt: (storeDir, storeRoot, gitPathMax, storageRoot) =>
      open(process.pid, storeDir, storeRoot, gitPathMax, storageRoot),
  }
}

export async function write(
  root: string,
  relative: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
  await writeFile(path.join(root, relative), content)
}

export function read(root: string, relative: string): Promise<string> {
  return readFile(path.join(root, relative), 'utf8')
}

export async function isPresent(root: string, relative: string): Promise<boolean> {
  try {
    await stat(path.join(root, relative))
    return true
  } catch {
    return false
  }
}

/** The names in a folder, exactly as the file system spells them. */
export async function namesIn(folder: string): Promise<readonly string[]> {
  const entries = await readdir(folder)
  return entries.toSorted((a, b) => a.localeCompare(b))
}

/** Every path under a folder, sorted: what a test compares before and after. */
export async function treeListing(folder: string): Promise<string> {
  const entries = await readdir(folder, { recursive: true })
  return entries
    .map(String)
    .toSorted((a, b) => a.localeCompare(b))
    .join('\n')
}

export async function entryCount(folder: string): Promise<number> {
  const entries = await readdir(folder, { recursive: true })
  return entries.length
}

/** A unit of a conversation in a store's window. */
export function owner(
  store: Pick<CheckpointStore, 'instance'>,
  unitId: string,
  sessionId = 's1',
  unitKind: UnitKind = 'turn',
): Owner {
  return { instance: store.instance, sessionId, unitKind, unitId }
}

/**
 * How a recorded write ends: settled `done`; `aborted` (nothing written);
 * cut short after the file was written (`published`) or before (`unpublished`),
 * with no settling line, as a crash leaves it.
 */
export type Settle = 'done' | 'aborted' | 'published' | 'unpublished'

/** What a tool writes: bytes, or `null` to delete the file. */
export type ToolWriter = (
  relative: string,
  content: string | Uint8Array | null,
  settle?: Settle,
) => Promise<WriteRecord>

async function stateOf(
  store: Pick<CheckpointStore, 'journal'>,
  absolute: string,
): Promise<ContentState> {
  let bytes: Buffer
  try {
    bytes = await readFile(absolute)
  } catch {
    return { present: false }
  }
  const stats = await lstat(absolute)
  const isExecutable = process.platform !== 'win32' && (stats.mode & EXECUTABLE_BITS) !== 0
  return {
    present: true,
    oid: await store.journal.writeBlob(bytes),
    mode: isExecutable ? GIT_MODE_EXECUTABLE : GIT_MODE_FILE,
  }
}

/** The folders a write of the path creates, outermost first. */
async function missingFolders(root: string, relative: string): Promise<readonly string[]> {
  const missing: string[] = []
  for (
    let folder = path.posix.dirname(relative);
    folder !== '.' && !(await isPresent(root, folder));
    folder = path.posix.dirname(folder)
  ) {
    missing.unshift(folder)
  }
  return missing
}

/**
 * One tool write the way the recorder makes it (a test stand-in for
 * writeRecorder.ts): the copy before and the bytes after kept, the intent
 * appended, the file written (or deleted), then settled as `settle` says.
 */
export async function toolWrite(
  store: Pick<CheckpointStore, 'instance' | 'journal' | 'nextWriteSeq'>,
  unit: Owner,
  root: string,
  relative: string,
  content: string | Uint8Array | null,
  settle: Settle = 'done',
): Promise<WriteRecord> {
  const absolute = path.join(root, ...relative.split('/'))
  const before = await stateOf(store, absolute)
  const bytes = content === null ? undefined : Buffer.from(content)
  const after: ContentState =
    bytes === undefined
      ? { present: false }
      : {
          present: true,
          oid: await store.journal.writeBlob(bytes),
          mode: before.mode ?? GIT_MODE_FILE,
        }
  const record: WriteRecord = {
    id: randomUUID(),
    instance: store.instance,
    seq: store.nextWriteSeq(),
    owner: unit,
    path: relative,
    before,
    after,
    createdFolders: bytes === undefined ? [] : await missingFolders(root, relative),
    isKept: true,
  }
  await store.journal.appendIntent(record)
  if (settle === 'aborted') {
    await store.journal.appendAborted(record.id)
    return record
  }
  if (settle !== 'unpublished') {
    if (bytes === undefined) {
      await rm(absolute, { force: true })
    } else {
      await write(root, relative, bytes)
    }
  }
  if (settle === 'done') {
    await store.journal.appendDone(record.id)
  }
  return record
}

/**
 * One turn as the Model API host runs it: published as running, its unit
 * started, `act` given the tool writer, its unit ended, its mark withdrawn.
 */
export async function turn(
  h: { readonly store: CheckpointStore; readonly root: string },
  turnId: string,
  act: (tool: ToolWriter) => Promise<unknown> = async () => {
    // A turn that writes nothing.
  },
  sessionId = 's1',
  end: { readonly ranProcesses?: boolean } = {},
): Promise<void> {
  const unit = owner(h.store, turnId, sessionId)
  await h.store.markTurn(turnKey(sessionId, turnId), true)
  await h.store.startUnit(unit)
  await act(
    async (relative, content, settle) =>
      await toolWrite(h.store, unit, h.root, relative, content, settle),
  )
  await h.store.endUnit(unit, { ranProcesses: end.ranProcesses ?? false })
  await h.store.markTurn(turnKey(sessionId, turnId), false)
}

/** Two files a turn's tools changed: `a.txt` a0 to a1 and `b.txt` b0 to b1. */
export async function twoFileTurn(h: Pick<Harness, 'root' | 'store'>): Promise<void> {
  await write(h.root, 'a.txt', 'a0\n')
  await write(h.root, 'b.txt', 'b0\n')
  await turn(h, 't1', async (tool) => {
    await tool('a.txt', 'a1\n')
    await tool('b.txt', 'b1\n')
  })
}

/** A turn of each of two conversations: `t1` of s1 writes `a.txt`, `u1` of s2 writes `b.txt`. */
export async function twoConversations(h: Pick<Harness, 'root' | 'store'>): Promise<void> {
  await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
  await turn(h, 'u1', (tool) => tool('b.txt', 'b1\n'), 's2')
}

/** The repeated changed-file turn used by admission race fixtures. */
export async function changedFileTurn(h: Pick<Harness, 'root' | 'store'>): Promise<void> {
  await write(h.root, 'a.txt', 'a0\n')
  await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
}

/** Holds a real restore ref without running any file mutation. */
export async function holdRestoreRef(h: Pick<Harness, 'store' | 'storage'>): Promise<void> {
  // Any operation sets the shadow repository up.
  await h.store.turns('none')
  const tree = shadowGit(h.storage, ['mktree'], '').trim()
  shadowGit(h.storage, ['update-ref', 'refs/muse-spark/restore-active', tree])
}

/** A standard Model API request, returning a refusal as well as success. */
export async function restoreOutcome(
  store: Pick<CheckpointStore, 'restore'>,
  turnId: string,
  sessionId = 's1',
  transcriptTurnIds: readonly string[] = [turnId],
): Promise<RestoreOutcome> {
  return await store.restore({
    backend: () => 'modelApi',
    sessionId,
    turnId,
    transcriptTurnIds,
    unsavedPaths: () => [],
  })
}

export function done(outcome: RestoreOutcome): Extract<RestoreOutcome, { ok: true }> {
  if (!outcome.ok) {
    throw new Error(`restore failed: ${outcome.reason}`)
  }
  return outcome
}

/** Restores a turn's files, which the test must see go ahead. */
export async function restoreTurn(
  store: Pick<CheckpointStore, 'restore'>,
  turnId: string,
  sessionId = 's1',
): Promise<Extract<RestoreOutcome, { ok: true }>> {
  return done(await restoreOutcome(store, turnId, sessionId))
}

/** A Redo's outcome, a refusal included. */
export async function redoOutcome(
  store: Pick<CheckpointStore, 'redo'>,
  restoreId: string | undefined,
  sourceSessionId = 's1',
): Promise<RestoreOutcome> {
  return await store.redo({
    backend: () => 'modelApi',
    sourceSessionId,
    restoreId: restoreId ?? '',
    unsavedPaths: () => [],
  })
}

/** Redoes a restore, which the test must see go ahead. */
export async function redoRestore(
  store: Pick<CheckpointStore, 'redo'>,
  restoreId: string | undefined,
  sourceSessionId = 's1',
): Promise<Extract<RestoreOutcome, { ok: true }>> {
  return done(await redoOutcome(store, restoreId, sourceSessionId))
}

/** The refs the shadow repository holds under `refs/muse-spark/`. */
export function shadowRefs(storage: string): readonly string[] {
  return shadowGit(storage, ['for-each-ref', '--format=%(refname)', 'refs/muse-spark/'])
    .split('\n')
    .filter((ref) => ref !== '')
}

/**
 * An M72 record as a 0.10.0 window writes it (a turn's checkpoint, or a
 * restore's redo record), at the place `top` names, under its own ref.
 */
export function writeLegacyRecord(
  storage: string,
  top: string,
  record:
    | {
        readonly kind: 'checkpoint'
        readonly id: string
        readonly sessionId: string
        readonly turnId: string
        readonly sequence?: number
        readonly endSequence?: number
      }
    | { readonly kind: 'restore'; readonly id: string; readonly sessionId: string },
): void {
  const json = JSON.stringify({
    top,
    prefix: '',
    createdAt: 1,
    ...(record.kind === 'checkpoint'
      ? { start: { tree: '', coverage: { skipped: [], repositories: [] } } }
      : { entries: [] }),
    ...record,
  })
  const blob = shadowGit(storage, ['hash-object', '-w', '--stdin'], json).trim()
  const tree = shadowGit(storage, ['mktree'], `100644 blob ${blob}\trecord.json\n`).trim()
  shadowGit(storage, ['update-ref', `refs/muse-spark/record/${record.id}`, tree])
}

/** M72 records read independently from the ref's JSON, not the store's own reads. */
export function storedRecords(storage: string): readonly StoredRecord[] {
  return shadowRefs(storage)
    .filter((ref) => ref.includes('/record/'))
    .map((ref) => {
      const text = shadowGit(storage, ['cat-file', '-p', `${ref}:record.json`])
      const record = parseRecord(text)
      if (record === undefined) {
        throw new Error(`unreadable record: ${ref}`)
      }
      return record
    })
}

/** Unit records read independently from the ref's JSON, oldest number first within each conversation. */
export function storedUnits(storage: string): readonly StoredUnit[] {
  return shadowRefs(storage)
    .filter((ref) => ref.includes('/m86/unit/'))
    .map((ref) => {
      const text = shadowGit(storage, ['cat-file', '-p', `${ref}:record.json`])
      const record = parseUnit(text)
      if (record === undefined) {
        throw new Error(`unreadable unit: ${ref}`)
      }
      return record
    })
    .toSorted((left, right) => left.sequence - right.sequence)
}

/** The one unit record of a turn or batch, read independently. */
export function storedUnit(storage: string, unitId: string): StoredUnit {
  const found = storedUnits(storage).find((unit) => unit.owner.unitId === unitId)
  if (found === undefined) {
    throw new Error(`no unit ${unitId}`)
  }
  return found
}
