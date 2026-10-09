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
// The states per folder (PLAN.md M123's table):
//
//   absent --reserve--> pending --complete--> ready --release--> trusted
//   pending --discard--> absent
//   ready | trusted --supersede--> pending (exactly the version read, folder gone)
//   pending (owner gone, folder gone) --supersede--> pending
//
// Every mutation names the version it read: the checkout's random
// `checkoutId` and the record's `revision`. `reserve` never replaces.
// `release` consumes a trust ticket bound to one finished checkout (its
// id, revision, head and folder identity): used once, it no longer
// matches, and any replacement makes a new checkout id. Nothing ever
// restores an older record: a failed checkout is discarded only when its
// folder is gone, else it stays pending, held and never trusted.
//
// The file store applies each transition to the freshly read head under
// the cross-window lock (storeLock.ts) and writes it as the next record
// generation (recordGenerations.ts), whose exclusive creation fences out
// a writer that lost the lock without knowing it.

import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  holdFor,
  recordFor,
  withRecord,
  type PullRequestOrigin,
  type WorktreeHold,
  type WorktreeRecord,
} from '../../../core/worktreeConversations'
import type { CoreLogger } from '../../../core/logging'
import {
  WORKTREE_RECORD_LOCK_LEASE_MS,
  WORKTREE_RECORD_LOCK_TIMEOUT_MS,
  WORKTREE_RECORD_SAVE_ATTEMPTS,
} from '../../../shared/constants'
import { readRecordHead, sweepGenerations, writeNextGeneration } from './recordGenerations'
import { nodeRecordStoreFs, type RecordStoreFs } from './recordStoreFs'
import {
  acquireStoreLock,
  currentProcessOwner,
  isProcessOwnerGone,
  StoreBusyError,
  type ProcessOwner,
  type StoreLease,
} from './storeLock'

const RECORDS_FOLDER = 'worktree-records'
const RECORDS_LOCK = 'lock'

/** `/` separators, which git accepts on Windows too, so the folders compare. */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

/** The version a mutation must name: the checkout and the record revision it read. */
export interface RecordVersion {
  readonly checkoutId: string | undefined
  readonly revision: number
}

/**
 * What the held-worktree card showed and the user confirmed: one finished
 * checkout, by its id, record revision, head and folder identity. Single
 * use: the release it authorizes moves the revision on.
 */
export interface TrustTicket {
  readonly folder: string
  readonly checkoutId: string
  readonly revision: number
  readonly headSha: string
  readonly folderIdentity: string
  /** What the card names; never consulted by the release. */
  readonly pullRequest: PullRequestOrigin
}

export type ReserveResult =
  | { readonly ok: true; readonly stored: WorktreeRecord }
  | { readonly ok: false; readonly current: WorktreeRecord | undefined }

/** The revision a record carries; records an earlier version wrote read as 0. */
export function recordRevision(record: WorktreeRecord): number {
  return record.revision ?? 0
}

export function versionOf(record: WorktreeRecord): RecordVersion {
  return { checkoutId: record.checkoutId, revision: recordRevision(record) }
}

function isVersion(record: WorktreeRecord, expected: RecordVersion): boolean {
  return record.checkoutId === expected.checkoutId && recordRevision(record) === expected.revision
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
   * The exact version read → a new pending checkout, nothing of the old
   * record kept (no trust). The caller supersedes only a finished record
   * whose folder is gone, or a pending one whose owner and folder are.
   */
  supersede(folder: string, expected: RecordVersion, record: WorktreeRecord): Promise<ReserveResult>
  /** pending → ready for exactly the version reserved, with the folder's identity. */
  complete(
    folder: string,
    expected: RecordVersion,
    folderIdentity: string | undefined,
  ): Promise<boolean>
  /** pending → absent, only that version (its folder is gone). */
  discard(folder: string, expected: RecordVersion): Promise<boolean>
  /**
   * ready → trusted, only for the very checkout the ticket names, once.
   * Never a pending checkout, never one already trusted.
   */
  release(ticket: TrustTicket, now: number): Promise<WorktreeRecord | undefined>
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

/** The transitions, pure: each validates against the state it is given. */
function transitions(platform: NodeJS.Platform) {
  return {
    reserve: (
      records: readonly WorktreeRecord[],
      record: WorktreeRecord,
    ): Mutation<ReserveResult> => {
      const current = recordFor(records, record.folder, platform)
      if (current !== undefined) {
        return { records, result: { ok: false, current } }
      }
      const stored: WorktreeRecord = { ...record, folder: slashed(record.folder), revision: 1 }
      return { records: withRecord(records, stored, platform), result: { ok: true, stored } }
    },
    supersede: (
      records: readonly WorktreeRecord[],
      folder: string,
      expected: RecordVersion,
      record: WorktreeRecord,
    ): Mutation<ReserveResult> => {
      const current = recordFor(records, folder, platform)
      if (current === undefined || !isVersion(current, expected)) {
        return { records, result: { ok: false, current } }
      }
      const stored: WorktreeRecord = {
        ...record,
        folder: current.folder,
        revision: expected.revision + 1,
      }
      delete stored.trustConfirmedAt
      delete stored.folderIdentity
      return { records: withRecord(records, stored, platform), result: { ok: true, stored } }
    },
    complete: (
      records: readonly WorktreeRecord[],
      folder: string,
      expected: RecordVersion,
      folderIdentity: string | undefined,
    ): Mutation<boolean> => {
      const found = recordFor(records, folder, platform)
      if (found === undefined || !isVersion(found, expected) || found.isCheckoutPending !== true) {
        return { records, result: false }
      }
      const completed: WorktreeRecord = { ...found, revision: expected.revision + 1 }
      delete completed.isCheckoutPending
      delete completed.pendingOwner
      delete completed.folderIdentity
      if (folderIdentity !== undefined) {
        completed.folderIdentity = folderIdentity
      }
      return { records: withRecord(records, completed, platform), result: true }
    },
    discard: (
      records: readonly WorktreeRecord[],
      folder: string,
      expected: RecordVersion,
    ): Mutation<boolean> => {
      const found = recordFor(records, folder, platform)
      return found === undefined || !isVersion(found, expected) || found.isCheckoutPending !== true
        ? { records, result: false }
        : { records: records.filter((entry) => entry !== found), result: true }
    },
    release: (
      records: readonly WorktreeRecord[],
      ticket: TrustTicket,
      now: number,
    ): Mutation<WorktreeRecord | undefined> => {
      const found = recordFor(records, ticket.folder, platform)
      if (
        found === undefined ||
        found.isCheckoutPending === true ||
        found.trustConfirmedAt !== undefined ||
        found.checkoutId === undefined ||
        !isVersion(found, ticket) ||
        found.pullRequest?.headSha !== ticket.headSha ||
        found.folderIdentity === undefined ||
        found.folderIdentity !== ticket.folderIdentity
      ) {
        return { records, result: undefined }
      }
      const released: WorktreeRecord = {
        ...found,
        isHeld: false,
        trustConfirmedAt: now,
        revision: recordRevision(found) + 1,
      }
      return { records: withRecord(records, released, platform), result: released }
    },
  }
}

/** One window's records, in memory: the transitions over a plain array. */
export function createMemoryWorktreeRecordStore(platform: NodeJS.Platform): WorktreeRecordStore {
  const apply = transitions(platform)
  let records: readonly WorktreeRecord[] = []
  const commit = <T>(mutation: Mutation<T>): Promise<T> => {
    records = mutation.records
    return Promise.resolve(mutation.result)
  }
  return {
    list: () => Promise.resolve(records),
    recordFor: (folder) => Promise.resolve(recordFor(records, slashed(folder), platform)),
    reserve: (record) => commit(apply.reserve(records, record)),
    supersede: (folder, expected, record) =>
      commit(apply.supersede(records, slashed(folder), expected, record)),
    complete: (folder, expected, identity) =>
      commit(apply.complete(records, slashed(folder), expected, identity)),
    discard: (folder, expected) => commit(apply.discard(records, slashed(folder), expected)),
    release: (ticket, now) =>
      commit(apply.release(records, { ...ticket, folder: slashed(ticket.folder) }, now)),
  }
}

export interface FileWorktreeRecordStoreOptions {
  /** The file operations; a test pauses one to stand an interleaving. */
  readonly fs?: RecordStoreFs
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /** This process, as its lock notes name it. */
  readonly owner?: ProcessOwner
  readonly isOwnerGone?: (owner: ProcessOwner) => boolean
  readonly leaseMs?: number
  readonly timeoutMs?: number
}

/**
 * The records as generations under the runtime data folder. No window
 * keeps the registry: every operation reads the head first, and reads
 * never write. Mutations take the cross-window lock, apply the transition
 * to the fresh head and write the next generation; one that lost its
 * generation reads and applies again, and past the attempts it throws —
 * never a write over a state it did not read. Operations in this window
 * queue, so they never interleave either.
 */
export function createFileWorktreeRecordStore(
  dataFolder: string,
  platform: NodeJS.Platform,
  log: CoreLogger,
  options: FileWorktreeRecordStoreOptions = {},
): WorktreeRecordStore {
  const folder = path.join(dataFolder, RECORDS_FOLDER)
  const fs = options.fs ?? nodeRecordStoreFs
  const now = options.now ?? Date.now
  const apply = transitions(platform)
  const lockEnv = {
    fs,
    now,
    sleep: options.sleep ?? ((ms: number) => delay(ms)),
    owner: options.owner ?? currentProcessOwner(),
    isOwnerGone: options.isOwnerGone ?? ((owner: ProcessOwner) => isProcessOwnerGone(owner)),
    leaseMs: options.leaseMs ?? WORKTREE_RECORD_LOCK_LEASE_MS,
    timeoutMs: options.timeoutMs ?? WORKTREE_RECORD_LOCK_TIMEOUT_MS,
  }
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
  const read = (): Promise<readonly WorktreeRecord[]> =>
    enqueue(async () => {
      const head = await readRecordHead(fs, folder, log)
      return head.records
    })
  const acquire = async (): Promise<StoreLease> => {
    try {
      return await acquireStoreLock(path.join(folder, RECORDS_LOCK), lockEnv)
    } catch (error: unknown) {
      if (error instanceof StoreBusyError) {
        log.warn('The worktree records are busy; leaving them alone')
      }
      throw error
    }
  }
  const mutate = <T>(change: (records: readonly WorktreeRecord[]) => Mutation<T>): Promise<T> =>
    enqueue(async () => {
      await fs.mkdir(folder)
      for (let attempt = 1; ; attempt += 1) {
        const lease = await acquire()
        try {
          const head = await readRecordHead(fs, folder, log)
          const changed = change(head.records)
          if (changed.records === head.records) {
            // A refused transition: nothing to persist, nothing touched.
            return changed.result
          }
          const written = await writeNextGeneration(fs, folder, head, changed.records, () =>
            lease.isHeld(),
          )
          if (written === 'written') {
            await sweepGenerations(fs, folder, head.generation + 1, now())
            return changed.result
          }
        } finally {
          await lease.release()
        }
        if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
          log.warn('The worktree records could not be kept')
          throw new Error('The worktree records could not be kept')
        }
      }
    })
  return {
    list: read,
    recordFor: async (wanted) => recordFor(await read(), slashed(wanted), platform),
    reserve: (record) => mutate((records) => apply.reserve(records, record)),
    supersede: (wanted, expected, record) =>
      mutate((records) => apply.supersede(records, slashed(wanted), expected, record)),
    complete: (wanted, expected, identity) =>
      mutate((records) => apply.complete(records, slashed(wanted), expected, identity)),
    discard: (wanted, expected) =>
      mutate((records) => apply.discard(records, slashed(wanted), expected)),
    release: (ticket, at) =>
      mutate((records) =>
        apply.release(records, { ...ticket, folder: slashed(ticket.folder) }, at),
      ),
  }
}
