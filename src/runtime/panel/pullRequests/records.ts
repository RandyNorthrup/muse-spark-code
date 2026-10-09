// The runtime's worktree records (M123, PLAN.md D104): one record per
// worktree the runtime made for a pull request, in the runtime's per-user
// store under its data folder. VS Code keeps its own in global state; the
// hold is by location, so every host checks both roots (its global
// storage's `pr-worktrees/` and the runtime data folder's): a worktree
// made in one editor is held when another opens it. Only a record for that
// worktree whose trust the user confirmed in the card lets it go.
//
// The store reads with `parseWorktreeRegistry`, so a value an earlier
// version or a hand edit left that does not validate reads as none (the
// hold is by location anyway).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  holdFor,
  parseWorktreeRegistry,
  recordFor,
  withRecord,
  type WorktreeHold,
  type WorktreeRecord,
} from '../../../core/worktreeConversations'
import type { CoreLogger } from '../../../core/logging'

const RECORDS_FILE = 'worktree-records.json'

/** `/` separators, which git accepts on Windows too, so the folders compare. */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

export interface WorktreeRecordStore {
  list(): Promise<readonly WorktreeRecord[]>
  recordFor(folder: string): Promise<WorktreeRecord | undefined>
  /**
   * Record before the folder exists, so no window ever sees it unrecorded;
   * pending until the checkout finished. Returns the previous record, if any.
   */
  put(record: WorktreeRecord): Promise<WorktreeRecord | undefined>
  complete(folder: string, createdAt: number): Promise<void>
  remove(folder: string, createdAt: number, previous?: WorktreeRecord): Promise<void>
  release(folder: string, now: number): Promise<WorktreeRecord | undefined>
}

function completeRecord(record: WorktreeRecord): WorktreeRecord {
  const completed = { ...record }
  delete completed.isCheckoutPending
  return completed
}

/** The hold on `root` under any of `heldRoots`, released only by the card. */
export function holdForRoots(
  roots: readonly string[],
  heldRoots: readonly string[],
  records: readonly WorktreeRecord[],
  platform: NodeJS.Platform,
): WorktreeHold | undefined {
  return holdFor(roots, heldRoots, records, platform)
}

export function createMemoryWorktreeRecordStore(platform: NodeJS.Platform): WorktreeRecordStore {
  let records: readonly WorktreeRecord[] = []
  return {
    list: () => Promise.resolve(records),
    recordFor: (folder) => Promise.resolve(recordFor(records, slashed(folder), platform)),
    put: (record) => {
      const stored = { ...record, folder: slashed(record.folder) }
      const previous = recordFor(records, stored.folder, platform)
      records = withRecord(records, stored, platform)
      return Promise.resolve(previous)
    },
    complete: (folder, createdAt) => {
      const found = recordFor(records, slashed(folder), platform)
      if (found === undefined) {
        return Promise.resolve()
      }
      if (found.createdAt !== createdAt) {
        return Promise.resolve()
      }
      records = withRecord(records, completeRecord(found), platform)
      return Promise.resolve()
    },
    remove: (folder, createdAt, previous) => {
      const found = recordFor(records, slashed(folder), platform)
      if (found === undefined) {
        return Promise.resolve()
      }
      if (found.createdAt !== createdAt) {
        return Promise.resolve()
      }
      records =
        previous === undefined
          ? records.filter((entry) => entry !== found)
          : withRecord(records, previous, platform)
      return Promise.resolve()
    },
    release: (folder, now) => {
      const found = recordFor(records, slashed(folder), platform)
      if (found === undefined) {
        return Promise.resolve(undefined)
      }
      const released: WorktreeRecord = { ...found, isHeld: false, trustConfirmedAt: now }
      records = withRecord(records, released, platform)
      return Promise.resolve(released)
    },
  }
}

/** The records as a JSON file under the runtime data folder. */
export function createFileWorktreeRecordStore(
  dataFolder: string,
  platform: NodeJS.Platform,
  log: CoreLogger,
): WorktreeRecordStore {
  const file = path.join(dataFolder, RECORDS_FILE)
  const memory = createMemoryWorktreeRecordStore(platform)
  let isLoaded = false
  const load = async (): Promise<void> => {
    if (isLoaded) {
      return
    }
    isLoaded = true
    try {
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
      for (const record of parseWorktreeRegistry(raw)) {
        await memory.put(record)
      }
    } catch (error: unknown) {
      // Missing or unreadable: start empty (the hold is by location
      // anyway). Anything else of the extension's never runs git there.
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined
      if (code !== 'ENOENT') {
        log.warn('The worktree records could not be read; starting with none')
      }
    }
  }
  const save = async (): Promise<void> => {
    try {
      await mkdir(dataFolder, { recursive: true })
      await writeFile(file, JSON.stringify(await memory.list()), 'utf8')
    } catch {
      log.warn('The worktree records could not be kept')
    }
  }
  const wrap =
    <T extends unknown[], R>(call: (...args: T) => Promise<R>) =>
    async (...args: T): Promise<R> => {
      await load()
      const result = await call(...args)
      await save()
      return result
    }
  return {
    list: () => wrap(() => memory.list())(),
    recordFor: (folder) => wrap(() => memory.recordFor(folder))(),
    put: (record) => wrap(() => memory.put(record))(),
    complete: (folder, createdAt) => wrap(() => memory.complete(folder, createdAt))(),
    remove: (folder, createdAt, previous) =>
      wrap(() => memory.remove(folder, createdAt, previous))(),
    release: (folder, now) => wrap(() => memory.release(folder, now))(),
  }
}
