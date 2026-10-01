// Real git over throwaway folders for the checkpoint store's tests (M72):
// each test makes its own workspace and storage folder, so nothing is
// shared and every restore is checked against the bytes on disk.

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CheckpointStore,
  type RestoreOutcome,
  type Snapshot,
} from '../../../src/host/checkpoints/checkpointStore'
import { parseRecord, type StoredRecord } from '../../../src/host/checkpoints/checkpointRecords'
import { type GitProcess, processGitProcess } from '../../../src/host/git'
import {
  createCheckpointPort,
  type CheckpointPort,
} from '../../../src/host/checkpoints/checkpointHost'
import { FakeLogOutputChannel } from './fakes'
import { removeFolder } from './temporaryFolders'

export const REAL_GIT_TIMEOUT_MS = 120_000
const realGit = processGitProcess()
const folders: string[] = []
const stores: CheckpointStore[] = []

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
export function shadowGit(storage: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'core.longpaths=true', '--git-dir', 'shadow.git', ...args], {
    cwd: storage,
    encoding: 'utf8',
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
  ) => CheckpointStore
}

/** Real store admission stays active even when checkpoint capture is disabled. */
export function checkpointPort(
  h: Pick<Harness, 'store'>,
  isTrusted: boolean | (() => boolean) = true,
): CheckpointPort {
  const isWorkspaceTrusted = () => (typeof isTrusted === 'function' ? isTrusted() : isTrusted)
  return createCheckpointPort({
    store: h.store,
    isNamespaceKnown: () => true,
    isWorkspaceTrusted,
    isEnabled: () => false,
    hasGit: isWorkspaceTrusted,
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
  const open = (pid = process.pid, storeDir = storage, storeRoot = root, gitPathMax?: number) => {
    const store = new CheckpointStore({
      workspaceRoot: storeRoot,
      storageDir: storeDir,
      platform: process.platform,
      git: options.gitProcess ?? realGit,
      env: options.env?.(top) ?? process.env,
      retentionDays: () => 30,
      now:
        options.now ??
        (() => {
          clock += 1000
          return clock
        }),
      newId: () => randomUUID(),
      pid,
      isProcessAlive: options.isProcessAlive ?? (() => true),
      ...(options.heartbeatMs !== undefined && { heartbeatMs: options.heartbeatMs }),
      ...(gitPathMax !== undefined && { gitPathMax }),
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
    reopenAt: (storeDir, storeRoot, gitPathMax) =>
      open(process.pid, storeDir, storeRoot, gitPathMax),
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

/** A capture the test must have. */
export async function captured(store: CheckpointStore): Promise<Snapshot> {
  const capture = await store.capture()
  if (!capture.ok) {
    throw new Error(`capture refused: ${capture.detail}`)
  }
  return capture.snapshot
}

/** One turn: a checkpoint before it, `act` as the turn, the turn's end. */
export async function turn(
  h: Pick<Harness, 'store'>,
  turnId: string,
  act: () => Promise<void>,
  sessionId = 's1',
): Promise<void> {
  await h.store.record(sessionId, turnId, await captured(h.store))
  await act()
  await h.store.endTurn(sessionId, turnId)
}

/** The repeated tracked-file boundary used by admission race fixtures. */
export async function changedFileTurn(h: Pick<Harness, 'root' | 'store'>): Promise<void> {
  await write(h.root, 'a.txt', 'a0\n')
  await turn(h, 't1', () => write(h.root, 'a.txt', 'a1\n'))
}

/** Holds a real restore ref without running any file mutation. */
export async function holdRestoreRef(h: Pick<Harness, 'store' | 'storage'>): Promise<void> {
  const snapshot = await captured(h.store)
  shadowGit(h.storage, ['update-ref', 'refs/muse-spark/restore-active', snapshot.tree])
}

/** A standard Model API request, returning a refusal as well as success. */
export async function restoreOutcome(
  store: Pick<CheckpointStore, 'restore'>,
  turnId: string,
  sessionId = 's1',
): Promise<RestoreOutcome> {
  return await store.restore({
    backend: () => 'modelApi',
    sessionId,
    turnId,
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
  store: CheckpointStore,
  turnId: string,
  sessionId = 's1',
): Promise<Extract<RestoreOutcome, { ok: true }>> {
  return done(await restoreOutcome(store, turnId, sessionId))
}

/** Redoes a restore, which the test must see go ahead. */
export async function redoRestore(
  store: CheckpointStore,
  restoreId: string | undefined,
): Promise<Extract<RestoreOutcome, { ok: true }>> {
  return done(
    await store.redo({
      backend: () => 'modelApi',
      restoreId: restoreId ?? '',
      unsavedPaths: () => [],
    }),
  )
}

/** How many captures are pinned, and how many windows have staged tool copies. */
export async function leftovers(
  storage: string,
): Promise<{ readonly pins: number; readonly staging: number }> {
  const pins = shadowRefs(storage).filter((ref) => ref.includes('/pin/')).length
  try {
    const staging = await readdir(path.join(storage, 'staging'))
    return { pins, staging: staging.length }
  } catch {
    return { pins, staging: 0 }
  }
}

/** The refs the shadow repository holds under `refs/muse-spark/`. */
export function shadowRefs(storage: string): readonly string[] {
  return shadowGit(storage, ['for-each-ref', '--format=%(refname)', 'refs/muse-spark/'])
    .split('\n')
    .filter((ref) => ref !== '')
}

/** Records read independently from the ref's JSON, not the store's cached state. */
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
