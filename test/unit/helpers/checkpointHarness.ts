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
import { type GitProcess, processGitProcess } from '../../../src/host/git'
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
  /** How long an operation waits for another window's (the product's wait by default). */
  readonly lockWaitMs?: number
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
  const open = (pid = process.pid) => {
    const store = new CheckpointStore({
      workspaceRoot: root,
      storageDir: storage,
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
      ...(options.lockWaitMs !== undefined && { lockWaitMs: options.lockWaitMs }),
      log,
    })
    stores.push(store)
    return store
  }
  return { root, top, storage, store: open(), log, reopen: open }
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
  return done(await store.restore({ sessionId, turnId, unsavedPaths: () => [] }))
}

/** Redoes a restore, which the test must see go ahead. */
export async function redoRestore(
  store: CheckpointStore,
  restoreId: string | undefined,
): Promise<Extract<RestoreOutcome, { ok: true }>> {
  return done(await store.redo({ restoreId: restoreId ?? '', unsavedPaths: () => [] }))
}

/** The refs the shadow repository holds under `refs/muse-spark/`. */
export function shadowRefs(storage: string): readonly string[] {
  return execFileSync(
    'git',
    [
      '--git-dir',
      path.join(storage, 'shadow.git'),
      'for-each-ref',
      '--format=%(refname)',
      'refs/muse-spark/',
    ],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((ref) => ref !== '')
}
