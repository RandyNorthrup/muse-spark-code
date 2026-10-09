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
//
// One serialized owner per repository (PLAN.md M123): every record carries
// a per-folder `revision`, and every mutation is validate → act → persist
// against the fresh state — a stale writer detects it lost and re-reads,
// never overwrites. The states per folder:
//
//   absent --reserve--> pending --complete--> ready --release--> trusted
//   pending --remove--> absent (or the displaced record, on rollback)
//   ready --supersede--> pending (exactly the version read, folder gone)
//
// `reserve` never replaces: a second checkout of a folder in flight is
// refused, never merged over. `complete` and `remove` name the version
// `reserve` returned. `release` never marks a pending checkout trusted. A
// mutation that cannot persist fails loudly; nothing silently restores an
// older trust grant or drops another window's record.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
import {
  WORKTREE_RECORD_LOCK_POLL_MS,
  WORKTREE_RECORD_LOCK_STALE_MS,
  WORKTREE_RECORD_LOCK_TIMEOUT_MS,
  WORKTREE_RECORD_SAVE_ATTEMPTS,
} from '../../../shared/constants'

const RECORDS_FILE = 'worktree-records.json'
const RECORDS_LOCK_DIR = 'worktree-records.lock'
const RECORDS_LOCK_OWNER = 'owner.json'

/** `/` separators, which git accepts on Windows too, so the folders compare. */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

/** The version a mutation must name: the record it saw. */
export interface RecordVersion {
  readonly createdAt: number
  readonly revision: number
}

export type ReserveResult =
  | {
      readonly ok: true
      readonly stored: WorktreeRecord
      readonly previous: WorktreeRecord | undefined
    }
  | { readonly ok: false; readonly current: WorktreeRecord | undefined }

/** The revision a record carries; records an earlier version wrote read as 0. */
export function recordRevision(record: WorktreeRecord): number {
  return record.revision ?? 0
}

function isVersion(record: WorktreeRecord, expected: RecordVersion): boolean {
  return record.createdAt === expected.createdAt && recordRevision(record) === expected.revision
}

function withRevision(record: WorktreeRecord, revision: number): WorktreeRecord {
  return { ...record, revision }
}

export interface WorktreeRecordStore {
  list(): Promise<readonly WorktreeRecord[]>
  recordFor(folder: string): Promise<WorktreeRecord | undefined>
  /**
   * absent → pending. Never replaces: when a record is already there the
   * caller follows what is there (reopen, refuse, supersede), so a second
   * checkout can never merge over the first one's record.
   */
  reserve(record: WorktreeRecord): Promise<ReserveResult>
  /**
   * ready → pending for exactly the version read, when its folder is gone
   * and the pull request is checked out again. Any other state, or a
   * version that moved on, refuses with what is there now.
   */
  supersede(folder: string, expected: RecordVersion, record: WorktreeRecord): Promise<ReserveResult>
  /** pending → ready, only for the version `reserve` returned. */
  complete(folder: string, createdAt: number, revision: number): Promise<boolean>
  /** pending → absent (or back to the displaced record): only that version. */
  remove(
    folder: string,
    createdAt: number,
    revision: number,
    previous?: WorktreeRecord,
  ): Promise<boolean>
  /**
   * ready → trusted. Never marks a pending checkout trusted: a trust the
   * card confirms always lands on the finished checkout the user saw.
   */
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

interface Mutation<T> {
  readonly records: readonly WorktreeRecord[]
  readonly result: T
}

function reserveTransition(
  records: readonly WorktreeRecord[],
  record: WorktreeRecord,
  platform: NodeJS.Platform,
): Mutation<ReserveResult> {
  const current = recordFor(records, record.folder, platform)
  if (current !== undefined) {
    return { records, result: { ok: false, current } }
  }
  const stored = withRevision(record, 1)
  return {
    records: withRecord(records, stored, platform),
    result: { ok: true, stored, previous: undefined },
  }
}

function supersedeTransition(
  records: readonly WorktreeRecord[],
  folder: string,
  expected: RecordVersion,
  record: WorktreeRecord,
  platform: NodeJS.Platform,
): Mutation<ReserveResult> {
  const current = recordFor(records, folder, platform)
  if (current === undefined || !isVersion(current, expected)) {
    return { records, result: { ok: false, current } }
  }
  const stored = withRevision({ ...record, folder: current.folder }, expected.revision + 1)
  return {
    records: withRecord(records, stored, platform),
    result: { ok: true, stored, previous: current },
  }
}

function completeTransition(
  records: readonly WorktreeRecord[],
  folder: string,
  expected: RecordVersion,
  platform: NodeJS.Platform,
): Mutation<boolean> {
  const found = recordFor(records, folder, platform)
  if (found === undefined || !isVersion(found, expected) || found.isCheckoutPending !== true) {
    return { records, result: false }
  }
  return {
    records: withRecord(
      records,
      withRevision(completeRecord(found), expected.revision + 1),
      platform,
    ),
    result: true,
  }
}

function removeTransition(
  records: readonly WorktreeRecord[],
  folder: string,
  expected: RecordVersion,
  previous: WorktreeRecord | undefined,
  platform: NodeJS.Platform,
): Mutation<boolean> {
  const found = recordFor(records, folder, platform)
  if (found === undefined || !isVersion(found, expected)) {
    return { records, result: false }
  }
  return {
    records:
      previous === undefined
        ? records.filter((entry) => entry !== found)
        : withRecord(records, previous, platform),
    result: true,
  }
}

function releaseTransition(
  records: readonly WorktreeRecord[],
  folder: string,
  now: number,
  platform: NodeJS.Platform,
): Mutation<WorktreeRecord | undefined> {
  const found = recordFor(records, folder, platform)
  if (found === undefined || found.isCheckoutPending === true) {
    return { records, result: undefined }
  }
  const released: WorktreeRecord = withRevision(
    { ...found, isHeld: false, trustConfirmedAt: now },
    recordRevision(found) + 1,
  )
  return { records: withRecord(records, released, platform), result: released }
}

export function createMemoryWorktreeRecordStore(platform: NodeJS.Platform): WorktreeRecordStore {
  let records: readonly WorktreeRecord[] = []
  return {
    list: () => Promise.resolve(records),
    recordFor: (folder) => Promise.resolve(recordFor(records, slashed(folder), platform)),
    reserve: (record) => {
      const applied = reserveTransition(records, slashedPut(record), platform)
      records = applied.records
      return Promise.resolve(applied.result)
    },
    supersede: (folder, expected, record) => {
      const applied = supersedeTransition(
        records,
        slashed(folder),
        expected,
        slashedPut(record),
        platform,
      )
      records = applied.records
      return Promise.resolve(applied.result)
    },
    complete: (folder, createdAt, revision) => {
      const applied = completeTransition(
        records,
        slashed(folder),
        { createdAt, revision },
        platform,
      )
      records = applied.records
      return Promise.resolve(applied.result)
    },
    remove: (folder, createdAt, revision, previous) => {
      const applied = removeTransition(
        records,
        slashed(folder),
        { createdAt, revision },
        previous,
        platform,
      )
      records = applied.records
      return Promise.resolve(applied.result)
    },
    release: (folder, now) => {
      const applied = releaseTransition(records, slashed(folder), now, platform)
      records = applied.records
      return Promise.resolve(applied.result)
    },
  }
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/**
 * The cross-window lock: `mkdir` is atomic on every platform, so at most
 * one window holds the folder. A waiter takes over a lock older than the
 * stale bound (its holder crashed mid-mutation) and fails loudly past the
 * timeout instead of writing uncoordinated.
 */
async function withRecordLock<T>(
  dataFolder: string,
  log: CoreLogger,
  work: () => Promise<T>,
): Promise<T> {
  const lockDir = path.join(dataFolder, RECORDS_LOCK_DIR)
  await mkdir(dataFolder, { recursive: true })
  const deadline = Date.now() + WORKTREE_RECORD_LOCK_TIMEOUT_MS
  for (;;) {
    try {
      await mkdir(lockDir)
      try {
        await writeFile(
          path.join(lockDir, RECORDS_LOCK_OWNER),
          JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
        )
      } catch {
        // The folder is ours; an owner note that cannot be written only
        // means waiters cannot age it.
      }
      break
    } catch (error: unknown) {
      if (codeOf(error) !== 'EEXIST') {
        throw error
      }
    }
    try {
      const raw = await readFile(path.join(lockDir, RECORDS_LOCK_OWNER), 'utf8')
      const startedAt = (JSON.parse(raw) as { readonly startedAt?: unknown }).startedAt
      if (typeof startedAt === 'number' && Date.now() - startedAt > WORKTREE_RECORD_LOCK_STALE_MS) {
        await rm(lockDir, { recursive: true, force: true })
        continue
      }
    } catch {
      // Unreadable or unparsable: someone else's live lock. Wait for it.
    }
    if (Date.now() >= deadline) {
      log.warn('The worktree records are busy; leaving them alone')
      throw new Error('The worktree records are busy')
    }
    await delay(WORKTREE_RECORD_LOCK_POLL_MS)
  }
  try {
    return await work()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}

/**
 * The records as a JSON file under the runtime data folder. No window
 * keeps the registry: every operation reads the file first, and reads
 * never write at all. Mutations hold the cross-window lock while they
 * validate the fresh registry and persist it, so two windows never
 * interleave a read-modify-write; operations in this window queue as well,
 * so they never interleave a read and a write either. A mutation whose
 * file changed underneath is read again and merged again; when it still
 * cannot persist, it throws — never a silent last-write over a state it
 * did not read.
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
      if (codeOf(error) !== 'ENOENT') {
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
  const mutate = <T>(apply: (records: readonly WorktreeRecord[]) => Mutation<T>): Promise<T> =>
    enqueue(async () => {
      return await withRecordLock(dataFolder, log, async () => {
        for (let attempt = 1; ; attempt += 1) {
          const read = await readRegistry()
          const applied = apply(read.records)
          if (applied.records === read.records) {
            // A refused transition: nothing to persist, nothing touched.
            return applied.result
          }
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
          } catch (error: unknown) {
            if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
              log.warn('The worktree records could not be kept')
              throw error instanceof Error
                ? error
                : new Error('The worktree records could not be kept')
            }
            continue
          }
          if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
            // Changed under the lock on every attempt: a hand edit racing
            // the write, not another window. Fail loudly rather than merge
            // over bytes never read.
            log.warn('The worktree records could not be kept')
            throw new Error('The worktree records could not be kept')
          }
        }
      })
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
    reserve: (record) =>
      mutate((records) => reserveTransition(records, slashedPut(record), platform)),
    supersede: (folder, expected, record) =>
      mutate((records) =>
        supersedeTransition(records, slashed(folder), expected, slashedPut(record), platform),
      ),
    complete: (folder, createdAt, revision) =>
      mutate((records) =>
        completeTransition(records, slashed(folder), { createdAt, revision }, platform),
      ),
    remove: (folder, createdAt, revision, previous) =>
      mutate((records) =>
        removeTransition(records, slashed(folder), { createdAt, revision }, previous, platform),
      ),
    release: (folder, now) =>
      mutate((records) => releaseTransition(records, slashed(folder), now, platform)),
  }
}
