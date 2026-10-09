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

import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { bytesFingerprint } from '../../../core/verify/fingerprint'
import {
  holdFor,
  parseWorktreeRegistry,
  recordFor,
  withRecord,
  type WorktreeHold,
  type WorktreeRecord,
} from '../../../core/worktreeConversations'
import type { CoreLogger } from '../../../core/logging'
import { writeFileAtomically, writeFileIfUnchanged } from '../../../host/fsAtomic'
import { WORKTREE_RECORD_SAVE_ATTEMPTS } from '../../../shared/constants'

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

function slashedPut(record: WorktreeRecord): WorktreeRecord {
  return { ...record, folder: slashed(record.folder) }
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

/**
 * The records as a JSON file under the runtime data folder. No window
 * keeps the registry: every operation reads the file first, so a window
 * that read earlier never writes its stale snapshot back over a newer
 * checkout, and reads never write at all. A save whose file another
 * window rewrote first is read again and retried; operations in this
 * window queue, so they never interleave a read and a write.
 */
export function createFileWorktreeRecordStore(
  dataFolder: string,
  platform: NodeJS.Platform,
  log: CoreLogger,
): WorktreeRecordStore {
  const file = path.join(dataFolder, RECORDS_FILE)
  const atomic = { sleep: delay }
  let tail: Promise<void> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const previous = tail
    const next = (async (): Promise<T> => {
      await previous
      return await work()
    })()
    tail = (async (): Promise<void> => {
      try {
        await next
      } catch {
        // A failed operation releases the next queued one.
      }
    })()
    return next
  }
  const readRegistry = async (): Promise<{
    readonly found: boolean
    readonly fingerprint: string | undefined
    readonly records: readonly WorktreeRecord[]
  }> => {
    let bytes: Buffer
    try {
      bytes = await readFile(file)
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
      return { found: false, fingerprint: undefined, records: [] }
    }
    let raw: unknown
    try {
      raw = JSON.parse(bytes.toString('utf8'))
    } catch {
      log.warn('The worktree records could not be read; starting with none')
      return { found: true, fingerprint: bytesFingerprint(bytes), records: [] }
    }
    return {
      found: true,
      fingerprint: bytesFingerprint(bytes),
      records: parseWorktreeRegistry(raw),
    }
  }
  const mutate = <T>(
    apply: (records: readonly WorktreeRecord[]) => {
      readonly records: readonly WorktreeRecord[]
      readonly result: T
    },
  ): Promise<T> =>
    enqueue(async () => {
      for (let attempt = 1; ; attempt += 1) {
        const read = await readRegistry()
        const applied = apply(read.records)
        const content = JSON.stringify(applied.records)
        try {
          if (read.fingerprint === undefined) {
            // Gone, or bytes no edit matches: replace it whole.
            await writeFileAtomically(file, content, atomic)
            return applied.result
          }
          const wrote = await writeFileIfUnchanged(file, read.fingerprint, content, atomic)
          if (wrote === 'written') {
            return applied.result
          }
          if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
            log.warn('The worktree records could not be kept')
            await writeFileAtomically(file, content, atomic)
            return applied.result
          }
        } catch {
          log.warn('The worktree records could not be kept')
          return applied.result
        }
      }
    })
  return {
    list: () =>
      enqueue(async () => {
        const read = await readRegistry()
        return read.records
      }),
    recordFor: (folder) =>
      enqueue(async () => {
        const read = await readRegistry()
        return recordFor(read.records, slashed(folder), platform)
      }),
    put: (record) =>
      mutate((records) => {
        const stored = slashedPut(record)
        return {
          records: withRecord(records, stored, platform),
          result: recordFor(records, stored.folder, platform),
        }
      }),
    complete: (folder, createdAt) =>
      mutate((records) => {
        const found = recordFor(records, slashed(folder), platform)
        if (found === undefined) {
          return { records, result: undefined }
        }
        return {
          records:
            found.createdAt === createdAt
              ? withRecord(records, completeRecord(found), platform)
              : records,
          result: undefined,
        }
      }),
    remove: (folder, createdAt, previous) =>
      mutate((records) => {
        const found = recordFor(records, slashed(folder), platform)
        if (found === undefined) {
          return { records, result: undefined }
        }
        if (found.createdAt !== createdAt) {
          return { records, result: undefined }
        }
        return {
          records:
            previous === undefined
              ? records.filter((entry) => entry !== found)
              : withRecord(records, previous, platform),
          result: undefined,
        }
      }),
    release: (folder, now) =>
      mutate((records) => {
        const found = recordFor(records, slashed(folder), platform)
        if (found === undefined) {
          return { records, result: undefined }
        }
        const released: WorktreeRecord = { ...found, isHeld: false, trustConfirmedAt: now }
        return { records: withRecord(records, released, platform), result: released }
      }),
  }
}
