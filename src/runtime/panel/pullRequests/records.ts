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
//   absent --reserve--> pending --claim--> pending (folder made) --complete--> ready
//   ready --release--> trusted
//   pending --discard--> absent
//   ready | trusted --supersede--> pending (exactly the version read, folder gone)
//   pending (owner gone or stale, folder gone) --supersede--> pending
//
// Every change runs under one hold of the registry's lease (core/locks/
// fileLease.ts) and stamps the record it writes with that hold's fence, a
// number no other hold ever has. A checkout's reservation is its record's
// checkout id and fence: any other writer's change to the record moves the
// fence, so `claim`, `complete` and `discard` are compare-and-swaps on it,
// and `supersede` on the version read (checkout id, revision and fence)
// with the folder checked absent under the same hold. `claim` makes the
// folder under the hold that published it. `reserve` never replaces;
// `release` consumes a trust ticket bound to one finished checkout (its
// id, revision, fence, head and folder identity). Nothing ever restores an
// older record.
//
// The registry is the lease plus the record generations
// (recordGenerations.ts): each hold reads the head and publishes at most
// once, by a compare-and-swap on the head's generation and fence, refused
// once its lease is no longer current. A write that published but whose
// place in history can no longer be proven (its successor swept while it
// was delayed) is reconciled against the head by the one record it wrote.

import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import {
  holdFor,
  parseWorktreeRegistry,
  recordFor,
  withRecord,
  type PullRequestOrigin,
  type WorktreeHold,
  type WorktreeRecord,
} from '../../../core/worktreeConversations'
import type { CoreLogger } from '../../../core/logging'
import { acquireFileLease, LeaseBusyError, type FileLeaseEnv } from '../../../core/locks/fileLease'
import {
  currentProcessOwner,
  isProcessOwnerGone,
  type ProcessOwner,
} from '../../../core/locks/processOwner'
import {
  UI_TEXT,
  WORKTREE_RECORD_LOCK_LEASE_MS,
  WORKTREE_RECORD_LOCK_POLL_MS,
  WORKTREE_RECORD_LOCK_TIMEOUT_MS,
  WORKTREE_RECORD_LOCK_UNREADABLE_MS,
  WORKTREE_RECORD_SAVE_ATTEMPTS,
} from '../../../shared/constants'
import {
  readRecordHead,
  readRecordHeadSync,
  sweepGenerations,
  writeNextGeneration,
  type GenerationWrite,
} from './recordGenerations'
import { nodeRecordStoreFs, type RecordStoreFs } from './recordStoreFs'

const RECORDS_FOLDER = 'worktree-records'
const RECORDS_LOCK = 'lock'

/** `/` separators, which git accepts on Windows too, so the folders compare. */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

/** The version a supersede must name: exactly the record read. */
export interface RecordVersion {
  readonly checkoutId: string | undefined
  readonly revision: number
  /** Undefined on a record an earlier version wrote. */
  readonly fence: number | undefined
}

/**
 * A checkout's hold on its folder's record: its checkout id and the fence
 * of the hold that last wrote the record. Any other writer's change to the
 * record moves the fence, so this no longer matches.
 */
export interface Reservation {
  readonly folder: string
  readonly checkoutId: string
  readonly fence: number
}

/**
 * What the held-worktree card showed and the user confirmed: one finished
 * checkout, by its id, record revision and fence, head and folder
 * identity. Single use: the release it authorizes moves both on.
 */
export interface TrustTicket {
  readonly folder: string
  readonly checkoutId: string
  readonly revision: number
  readonly fence: number | undefined
  readonly headSha: string
  readonly folderIdentity: string
  /** What the card names; never consulted by the release. */
  readonly pullRequest: PullRequestOrigin
}

export type ReserveResult =
  | {
      readonly ok: true
      readonly stored: WorktreeRecord
      readonly reservation: Reservation
    }
  | { readonly ok: false; readonly current: WorktreeRecord | undefined }

/** What a claim came to. */
export type ClaimResult<T> =
  /** Claimed, and `make` made the folder under the same hold. */
  | { readonly status: 'made'; readonly reservation: Reservation; readonly made: T }
  /** The record is no longer this reservation's: nothing was made. */
  | { readonly status: 'refused'; readonly current: WorktreeRecord | undefined }
  /** Claimed, but `make` failed: `reservation` is the claimed one, to discard. */
  | { readonly status: 'failed'; readonly reservation: Reservation; readonly error: unknown }
  /**
   * Not known whether the claim landed (its write failed after it may
   * have): nothing was made, and the record is one of `reservations` (the
   * claimed ones, then the one claimed from), to discard.
   */
  | {
      readonly status: 'unknown'
      readonly reservations: readonly Reservation[]
      readonly error: unknown
    }

/**
 * A write whose landing is not known: it failed after its publish may
 * have landed. `results` are what each such attempt would have written
 * (a reservation among them), so the caller can drop it.
 */
export class UnknownWriteError<T> extends Error {
  public constructor(
    public readonly results: readonly T[],
    cause: unknown,
  ) {
    super(UI_TEXT.worktreeRecordsWriteUnknown, { cause })
    this.name = 'UnknownWriteError'
  }
}

/** The revision a record carries; records an earlier version wrote read as 0. */
export function recordRevision(record: WorktreeRecord): number {
  return record.revision ?? 0
}

export function versionOf(record: WorktreeRecord): RecordVersion {
  return { checkoutId: record.checkoutId, revision: recordRevision(record), fence: record.fence }
}

function isVersion(record: WorktreeRecord, expected: RecordVersion): boolean {
  return (
    record.checkoutId === expected.checkoutId &&
    recordRevision(record) === expected.revision &&
    record.fence === expected.fence
  )
}

/** Whether `record` is still exactly the pending checkout `reservation` names. */
export function isReservationOf(
  record: WorktreeRecord | undefined,
  reservation: Reservation,
): boolean {
  return (
    record?.isCheckoutPending === true &&
    record.checkoutId === reservation.checkoutId &&
    record.fence === reservation.fence
  )
}

function reservationOf(record: WorktreeRecord, checkoutId: string, fence: number): Reservation {
  return { folder: record.folder, checkoutId, fence }
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
   * record kept (no trust), only while `isFolderAbsent` says so under the
   * same hold. The caller supersedes only a finished record, or a pending
   * one whose owner is gone or whose reservation is stale.
   */
  supersede(
    folder: string,
    expected: RecordVersion,
    record: WorktreeRecord,
    isFolderAbsent: () => boolean,
  ): Promise<ReserveResult>
  /**
   * Still exactly `reservation`'s pending record → claimed under a new
   * fence, then `make` (the folder) under the same hold. Refused, nothing
   * is made.
   */
  claim<T>(reservation: Reservation, make: () => Promise<T>): Promise<ClaimResult<T>>
  /** pending → ready, only while the record is exactly `reservation`'s. */
  complete(reservation: Reservation, folderIdentity: string | undefined): Promise<boolean>
  /** pending → absent, only while the record is exactly `reservation`'s. */
  discard(reservation: Reservation): Promise<boolean>
  /**
   * ready → trusted, only for the very checkout the ticket names, once.
   * Never a pending checkout, never one already trusted. `isCurrent` (the
   * caller's trust and lifetime) is asked under the hold and again just
   * before the publish lands; false refuses the release.
   */
  release(
    ticket: TrustTicket,
    now: number,
    isCurrent?: () => boolean,
  ): Promise<WorktreeRecord | undefined>
  /**
   * Synchronously, for a gate with no await before it acts: whether the
   * record is still exactly `reservation`'s. False when it cannot be read.
   */
  holdsSync(reservation: Reservation): boolean
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

/** One hold of the registry's lease: its fence, the head read under it, and its one publish. */
export interface RegistryHold {
  /** Strictly greater than every earlier hold's. */
  readonly fence: number
  /** The head, read under this hold. */
  readonly records: readonly WorktreeRecord[]
  /**
   * Publishes `records` as the next head: a compare-and-swap on the head
   * read, refused (`lost`) once another publish landed or this hold is no
   * longer current (`GenerationWrite`), or once `isCurrent` (asked just
   * before it lands) is false.
   */
  publish(records: readonly WorktreeRecord[], isCurrent?: () => boolean): Promise<GenerationWrite>
}

/** Where the records live: a lease-held, fenced head. */
export interface RecordRegistry {
  read(): Promise<readonly WorktreeRecord[]>
  /** The head, synchronously; undefined when it cannot be read. */
  readSync(): readonly WorktreeRecord[] | undefined
  /** Runs `work` under one hold; the hold ends when `work` settles. Throws when busy. */
  hold<T>(work: (hold: RegistryHold) => Promise<T>): Promise<T>
}

interface Mutation<T> {
  readonly records: readonly WorktreeRecord[]
  readonly result: T
  /**
   * The one record a change wrote (undefined: removed), by its folder: the
   * operation's committed identity, which a publish whose place in history
   * can no longer be proven is reconciled against.
   */
  readonly touched?: { readonly folder: string; readonly record: WorktreeRecord | undefined }
}

/** The same record, field for field, as the store reads it back. */
function isSameRecord(
  left: WorktreeRecord | undefined,
  right: WorktreeRecord | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }
  const [readLeft, readRight] = parseWorktreeRegistry([left, right])
  return JSON.stringify(readLeft) === JSON.stringify(readRight)
}

function refused<T>(records: readonly WorktreeRecord[], result: T): Mutation<T> {
  return { records, result }
}

type Claimed =
  | { readonly ok: true; readonly reservation: Reservation }
  | { readonly ok: false; readonly current: WorktreeRecord | undefined }

function unheard(): void {
  // A store in memory has nobody to tell.
}

const SILENT: CoreLogger = { trace: unheard, info: unheard, warn: unheard, error: unheard }

/**
 * The transitions, pure: each validates against the head it is given and
 * stamps what it writes with the hold's `fence`.
 */
function transitions(platform: NodeJS.Platform) {
  const written = <T>(
    records: readonly WorktreeRecord[],
    record: WorktreeRecord,
    result: T,
  ): Mutation<T> => ({
    records: withRecord(records, record, platform),
    result,
    touched: { folder: record.folder, record },
  })
  return {
    reserve: (
      records: readonly WorktreeRecord[],
      record: WorktreeRecord & { readonly checkoutId: string },
      fence: number,
    ): Mutation<ReserveResult> => {
      const current = recordFor(records, record.folder, platform)
      if (current !== undefined) {
        return refused(records, { ok: false, current })
      }
      const stored: WorktreeRecord = {
        ...record,
        folder: slashed(record.folder),
        revision: 1,
        fence,
      }
      return written(records, stored, {
        ok: true,
        stored,
        reservation: reservationOf(stored, record.checkoutId, fence),
      })
    },
    supersede: (
      records: readonly WorktreeRecord[],
      folder: string,
      expected: RecordVersion,
      record: WorktreeRecord & { readonly checkoutId: string },
      isFolderAbsent: () => boolean,
      fence: number,
    ): Mutation<ReserveResult> => {
      const current = recordFor(records, folder, platform)
      if (current === undefined || !isVersion(current, expected) || !isFolderAbsent()) {
        return refused(records, { ok: false, current })
      }
      const stored: WorktreeRecord = {
        ...record,
        folder: current.folder,
        revision: expected.revision + 1,
        fence,
      }
      delete stored.trustConfirmedAt
      delete stored.folderIdentity
      return written(records, stored, {
        ok: true,
        stored,
        reservation: reservationOf(stored, record.checkoutId, fence),
      })
    },
    claim: (
      records: readonly WorktreeRecord[],
      reservation: Reservation,
      fence: number,
    ): Mutation<Claimed> => {
      const found = recordFor(records, reservation.folder, platform)
      if (found === undefined || !isReservationOf(found, reservation)) {
        return refused(records, { ok: false, current: found })
      }
      const claimed: WorktreeRecord = { ...found, revision: recordRevision(found) + 1, fence }
      return written(records, claimed, {
        ok: true,
        reservation: reservationOf(claimed, reservation.checkoutId, fence),
      })
    },
    complete: (
      records: readonly WorktreeRecord[],
      reservation: Reservation,
      folderIdentity: string | undefined,
      fence: number,
    ): Mutation<boolean> => {
      const found = recordFor(records, reservation.folder, platform)
      if (found === undefined || !isReservationOf(found, reservation)) {
        return refused(records, false)
      }
      const completed: WorktreeRecord = { ...found, revision: recordRevision(found) + 1, fence }
      delete completed.isCheckoutPending
      delete completed.pendingOwner
      delete completed.folderIdentity
      if (folderIdentity !== undefined) {
        completed.folderIdentity = folderIdentity
      }
      return written(records, completed, true)
    },
    discard: (records: readonly WorktreeRecord[], reservation: Reservation): Mutation<boolean> => {
      const found = recordFor(records, reservation.folder, platform)
      return found === undefined || !isReservationOf(found, reservation)
        ? refused(records, false)
        : {
            records: records.filter((entry) => entry !== found),
            result: true,
            touched: { folder: found.folder, record: undefined },
          }
    },
    release: (
      records: readonly WorktreeRecord[],
      ticket: TrustTicket,
      now: number,
      fence: number,
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
        return refused(records, undefined)
      }
      const released: WorktreeRecord = {
        ...found,
        isHeld: false,
        trustConfirmedAt: now,
        revision: recordRevision(found) + 1,
        fence,
      }
      return written(records, released, released)
    },
  }
}

function withCheckoutId(record: WorktreeRecord): WorktreeRecord & { readonly checkoutId: string } {
  if (record.checkoutId === undefined) {
    throw new Error('A reservation needs a checkout id')
  }
  return { ...record, checkoutId: record.checkoutId }
}

/**
 * The store over `registry`. Every change takes one hold, applies its
 * transition to the head read under it and publishes; one that lost its
 * publish takes a new hold and applies again, and past the attempts it
 * throws — never a write over a state it did not read. Operations of one
 * store queue, so they never interleave either.
 */
export function createWorktreeRecordStore(
  registry: RecordRegistry,
  platform: NodeJS.Platform,
  log: CoreLogger,
): WorktreeRecordStore {
  const apply = transitions(platform)
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
  const read = (): Promise<readonly WorktreeRecord[]> => enqueue(() => registry.read())
  const isInHead = async (touched: Mutation<unknown>['touched']): Promise<boolean> => {
    if (touched === undefined) {
      return false
    }
    const head = await registry.read()
    return isSameRecord(recordFor(head, touched.folder, platform), touched.record)
  }
  /**
   * Applies `change` under one hold; `whileHeld` runs under the same hold
   * once the change is in effect (a refused change runs nothing). A
   * failure after a publish may have landed throws `UnknownWriteError`
   * with what such attempts would have written; a landed write is never
   * reported as failed for anything after it.
   */
  const mutate = <T>(
    change: (records: readonly WorktreeRecord[], fence: number) => Mutation<T>,
    whileHeld?: (result: T) => Promise<void>,
    isCurrent?: () => boolean,
  ): Promise<T> =>
    enqueue(async () => {
      // What attempts whose landing is not known would have written.
      const unknown: T[] = []
      for (let attempt = 1; ; attempt += 1) {
        let settled: { readonly result: T } | undefined
        try {
          settled = await registry.hold(async (hold) => {
            const changed = change(hold.records, hold.fence)
            if (changed.records === hold.records) {
              // A refused transition: nothing to publish, nothing touched.
              return { result: changed.result }
            }
            unknown.push(changed.result)
            const outcome = await hold.publish(changed.records, isCurrent)
            // Published, and its place could not be proven (its successor
            // swept, or the proof unreadable): in effect while the head
            // still holds exactly what it wrote. Applying it again would
            // refuse its own record.
            const isInEffect =
              outcome === 'written' ||
              (outcome === 'unverified' && (await isInHead(changed.touched)))
            // Known now: in effect, or not (lost, or no longer the head's).
            unknown.pop()
            if (!isInEffect) {
              return
            }
            await whileHeld?.(changed.result)
            return { result: changed.result }
          })
        } catch (error: unknown) {
          if (unknown.length > 0) {
            log.warn('The worktree records may have been written; not known')
            throw new UnknownWriteError(unknown, error)
          }
          throw error
        }
        if (settled !== undefined) {
          return settled.result
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
    reserve: (record) => {
      const reserved = withCheckoutId(record)
      return mutate((records, fence) => apply.reserve(records, reserved, fence))
    },
    supersede: (wanted, expected, record, isFolderAbsent) => {
      const replacement = withCheckoutId(record)
      return mutate((records, fence) =>
        apply.supersede(records, slashed(wanted), expected, replacement, isFolderAbsent, fence),
      )
    },
    claim: async <T>(reservation: Reservation, make: () => Promise<T>): Promise<ClaimResult<T>> => {
      const wanted = { ...reservation, folder: slashed(reservation.folder) }
      const outcome: { made?: { readonly value: T }; error?: unknown } = {}
      let claimed: Claimed
      try {
        claimed = await mutate(
          (records, fence) => apply.claim(records, wanted, fence),
          async (result) => {
            if (!result.ok) {
              return
            }
            try {
              outcome.made = { value: await make() }
            } catch (error: unknown) {
              outcome.error = error
            }
          },
        )
      } catch (error: unknown) {
        if (!(error instanceof UnknownWriteError)) {
          throw error
        }
        // Only this mutate<Claimed> can produce UnknownWriteError here:
        // make's errors are caught above, and mutate retains its own T[];
        // instanceof erases that generic (M123P9, PLAN.md §8).
        const results = error.results as readonly Claimed[]
        return {
          status: 'unknown',
          reservations: [
            ...results.flatMap((result) => (result.ok ? [result.reservation] : [])),
            wanted,
          ],
          error,
        }
      }
      if (!claimed.ok) {
        return { status: 'refused', current: claimed.current }
      }
      return outcome.made === undefined
        ? { status: 'failed', reservation: claimed.reservation, error: outcome.error }
        : { status: 'made', reservation: claimed.reservation, made: outcome.made.value }
    },
    complete: (reservation, identity) =>
      mutate((records, fence) =>
        apply.complete(
          records,
          { ...reservation, folder: slashed(reservation.folder) },
          identity,
          fence,
        ),
      ),
    discard: (reservation) =>
      mutate((records) =>
        apply.discard(records, { ...reservation, folder: slashed(reservation.folder) }),
      ),
    release: (ticket, at, isCurrent) =>
      mutate(
        (records, fence) =>
          isCurrent?.() === false
            ? { records, result: undefined }
            : apply.release(records, { ...ticket, folder: slashed(ticket.folder) }, at, fence),
        undefined,
        isCurrent,
      ),
    holdsSync: (reservation) => {
      const records = registry.readSync()
      return (
        records !== undefined &&
        isReservationOf(recordFor(records, slashed(reservation.folder), platform), reservation)
      )
    },
  }
}

/**
 * One window's registry, in memory: holds queue in turn, each with the
 * next fence; a publish lands only on the head it read.
 */
export function createMemoryRecordRegistry(): RecordRegistry {
  let records: readonly WorktreeRecord[] = []
  let generation = 0
  let fences = 0
  let tail: Promise<void> = Promise.resolve()
  return {
    read: () => Promise.resolve(records),
    readSync: () => records,
    hold: <T>(work: (hold: RegistryHold) => Promise<T>): Promise<T> => {
      const previous = tail
      const next = (async (): Promise<T> => {
        await previous
        fences += 1
        const read = generation
        return await work({
          fence: fences,
          records,
          publish: (changed, isCurrent) => {
            if (generation !== read || isCurrent?.() === false) {
              return Promise.resolve('lost')
            }
            records = changed
            generation += 1
            return Promise.resolve('written')
          },
        })
      })()
      tail = (async (): Promise<void> => {
        try {
          await next
        } catch {
          // A failed hold releases the next one.
        }
      })()
      return next
    },
  }
}

/** One window's records, in memory. */
export function createMemoryWorktreeRecordStore(
  platform: NodeJS.Platform,
  log: CoreLogger = SILENT,
): WorktreeRecordStore {
  return createWorktreeRecordStore(createMemoryRecordRegistry(), platform, log)
}

export interface FileWorktreeRecordStoreOptions {
  /** The file operations; a test pauses one to stand an interleaving. */
  readonly fs?: RecordStoreFs
  /** The wall clock: the sweep's ages and the notes' readable times. */
  readonly now?: () => number
  /** The monotonic clock every lease wait is measured on. */
  readonly monotonic?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /** This process, as its lease notes name it. */
  readonly owner?: ProcessOwner
  readonly isOwnerGone?: (owner: ProcessOwner) => Promise<boolean>
  readonly leaseMs?: number
  /** The longest lease of another window this one waits out. */
  readonly honoredLeaseMs?: number
  readonly unreadableMs?: number
  readonly timeoutMs?: number
  readonly pollMs?: number
}

/**
 * The registry as record generations under the runtime data folder, held
 * by the records' file lease. No window keeps the registry: every hold
 * reads the head first, and reads never write.
 */
export function createFileRecordRegistry(
  dataFolder: string,
  log: CoreLogger,
  options: FileWorktreeRecordStoreOptions = {},
): RecordRegistry {
  const folder = path.join(dataFolder, RECORDS_FOLDER)
  const fs = options.fs ?? nodeRecordStoreFs
  const now = options.now ?? Date.now
  const makeLeaseEnv = async (): Promise<FileLeaseEnv> => ({
    port: fs,
    now,
    monotonic: options.monotonic ?? (() => performance.now()),
    sleep: options.sleep ?? ((ms: number) => delay(ms)),
    owner: options.owner ?? (await currentProcessOwner()),
    isOwnerGone: options.isOwnerGone ?? ((owner: ProcessOwner) => isProcessOwnerGone(owner)),
    leaseMs: options.leaseMs ?? WORKTREE_RECORD_LOCK_LEASE_MS,
    honoredLeaseMs: options.honoredLeaseMs ?? WORKTREE_RECORD_LOCK_LEASE_MS,
    unreadableMs: options.unreadableMs ?? WORKTREE_RECORD_LOCK_UNREADABLE_MS,
    timeoutMs: options.timeoutMs ?? WORKTREE_RECORD_LOCK_TIMEOUT_MS,
    pollMs: options.pollMs ?? WORKTREE_RECORD_LOCK_POLL_MS,
  })
  let leaseEnv: Promise<FileLeaseEnv> | undefined
  const leaseEnvOf = (): Promise<FileLeaseEnv> => {
    leaseEnv ??= makeLeaseEnv()
    return leaseEnv
  }
  return {
    read: async () => {
      const head = await readRecordHead(fs, folder, log)
      return head.records
    },
    readSync: () => readRecordHeadSync(fs, folder)?.records,
    hold: async (work) => {
      await fs.mkdir(folder)
      const env = await leaseEnvOf()
      const acquire = async (fenceAbove: number) => {
        try {
          return await acquireFileLease(path.join(folder, RECORDS_LOCK), env, fenceAbove)
        } catch (error: unknown) {
          if (error instanceof LeaseBusyError) {
            log.warn('The worktree records are busy; leaving them alone')
          }
          throw error
        }
      }
      let held = await acquire(0)
      try {
        let head = await readRecordHead(fs, folder, log)
        while (head.fence !== undefined && head.fence >= held.fence) {
          // The fences beside the lock lost their history (removed by hand):
          // hold again above every fence the records carry, or nothing would
          // ever publish.
          await held.release()
          held = await acquire(head.fence)
          head = await readRecordHead(fs, folder, log)
        }
        const lease = held
        const read = head
        let hasPublished = false
        return await work({
          fence: lease.fence,
          records: read.records,
          publish: async (records, isCurrent) => {
            if (hasPublished) {
              throw new Error('One hold publishes once')
            }
            hasPublished = true
            const outcome = await writeNextGeneration(
              fs,
              folder,
              read,
              records,
              lease.fence,
              () => lease.isHeldSync() && isCurrent?.() !== false,
            )
            if (outcome === 'written') {
              // Best effort, and never past the landed write it follows.
              try {
                await sweepGenerations(fs, folder, read.generation + 1, now(), log)
              } catch {
                log.warn('The worktree records could not be swept; the next write tries again')
              }
            }
            return outcome
          },
        })
      } finally {
        await held.release()
      }
    },
  }
}

/** The records as generations under the runtime data folder (`createFileRecordRegistry`). */
export function createFileWorktreeRecordStore(
  dataFolder: string,
  platform: NodeJS.Platform,
  log: CoreLogger,
  options: FileWorktreeRecordStoreOptions = {},
): WorktreeRecordStore {
  return createWorktreeRecordStore(
    createFileRecordRegistry(dataFolder, log, options),
    platform,
    log,
  )
}
