import { Usd, legacyUsdSchema, usdAmountSchema, type UsdAmount } from '../../shared/usd'
// Tab's daily spend ledger (M94, PLAN.md D73): one file per window per
// local day under the extension's global storage, written atomically, with
// the cross-window daily total read from all of today's files.
//
// Lane LIMITSFIX (F3, D113): Tab follows the one cap rule
// (src/shared/spendCap.ts). A request is admitted while the REAL spend
// already settled today, across all files, is below the budget; at or over
// it the request is refused and the notice names that spend. Nothing is
// estimated against the budget. The admitted request writes a marker (an
// unknown-cost entry of zero dollars) into this window's file so a response
// lost before its usage is visible as unknown; reported usage then settles
// the real cost into that day's file (`settle`), even after midnight.
// Admission reads the clock once: the marker, the total it is checked
// against and any rollback belong to that one local day. A missing, corrupt
// or unreadable ledger refuses the request (fail closed: a corrupt file
// never counts as zero spend), and nothing here throws into the provider:
// every outcome is returned.
//
// The spend can pass the budget by at most the requests in flight when they
// were admitted (Tab runs at most TAB_MAX_IN_FLIGHT at once).
//
// Two windows never share a file (one instance per window), so concurrent
// windows cannot lose each other's spend; one instance serialises its own
// read-modify-write steps so concurrent admissions in the same window
// cannot lose one either. Writes go through `writeFileAtomically`
// (host/fsAtomic.ts), the pattern the session store uses.

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { ATOMIC_TEMPORARY_SUFFIX } from '../../shared/constants'
import { isBelowCap } from '../../shared/spendCap'
import { writeFileAtomically } from '../fsAtomic'
import type { Logger } from '../logger'

export interface TabLedgerDeps {
  /** The ledger's own folder (lane H: global storage's `tab-spend`). */
  readonly directory: string
  /** This window's file name (without extension); only the id alphabet below. */
  readonly windowId: string
  /** Epoch milliseconds; injectable so tests cross the local day. */
  readonly now: () => number
  /** Waits between rename attempts; injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  readonly log: Logger
}

// A window id names a file; only this alphabet is allowed into a path
// (the session store's `SESSION_ID_PATTERN`).
const WINDOW_ID_PATTERN = /^[A-Za-z0-9_-]+$/
// A day names a folder; only a `YYYY-MM-DD` date is allowed into a path.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FILE_EXTENSION = '.json'
const ENOENT = 'ENOENT'

const ledgerFileSchema = z.object({
  date: z.string(),
  window: z.string(),
  // Written before lane LIMITSFIX (F3) as a worst-case hold; still read and
  // counted so past spend is never lost, never added to by new requests.
  reservedUsd: legacyUsdSchema,
  reportedUsd: legacyUsdSchema,
  // Requests admitted and not yet settled by a usage report: in flight, or
  // lost before their usage, whose cost is then unknown (never guessed).
  unreportedRequests: z.optional(z.int().check(z.nonnegative())),
})

interface LedgerFile {
  readonly reservedUsd: UsdAmount
  readonly reportedUsd: UsdAmount
  readonly unreportedRequests: number
}

/** Today's total spend across every window, or the refusal to trust it. */
export type TabDayTotal =
  | {
      readonly ok: true
      readonly totalUsd: UsdAmount
      readonly uncertainUsd?: UsdAmount
      /** Requests across every window that have not reported usage (in flight or lost). */
      readonly unreportedRequests: number
    }
  | { readonly ok: false; readonly detail: string }

/**
 * An admitted request: the local day it was admitted on. Nothing is held for
 * its response (F3); it is marked in flight until its usage settles it.
 */
export interface TabLedgerReservation {
  /** The admission's local day, as `YYYY-MM-DD`; settlement writes to this day's file. */
  readonly date: string
}

/** Whether the next request may be sent, and what that day's total then is. */
export type TabAdmission =
  | {
      readonly admitted: true
      readonly totalUsd: UsdAmount
      /** What `settle` takes once the request reports its usage. */
      readonly reservation: TabLedgerReservation
    }
  | {
      readonly admitted: false
      readonly reason: 'budgetReached' | 'ledgerUnreadable'
      readonly detail: string
      readonly totalUsd?: UsdAmount
    }

/** This window's part of a local day, as `YYYY-MM-DD`. */
export function tabLocalDate(nowMs: number): string {
  const date = new Date(nowMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

function isUsableAmount(value: UsdAmount): boolean {
  return usdAmountSchema.safeParse(value).success && !value.startsWith('-')
}

/** What a name failure is: anything but a folder that is not there yet. */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === ENOENT
}

/** Waits for `promise` however it ends; its outcome belongs to whoever awaits it. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch {
    // Reported to the one who awaited it.
  }
}

export interface TabLedger {
  /**
   * The day's total across every window's file: today's, or `date`'s
   * (`YYYY-MM-DD`, as a reservation names it). Never throws.
   */
  readonly todayTotal: (date?: string) => Promise<TabDayTotal>
  /** The same validated read with retained reservations distinguished. No writes. */
  readonly todayUsage?: () => Promise<TabDayTotal>
  /**
   * Admits the request only while the real spend already settled that local
   * day (read once from the clock), across all files, is below `budgetUsd`:
   * the one cap rule, src/shared/spendCap.ts. It marks one request in flight
   * in this window's file, holding no dollars. At or over the budget the
   * request is refused with that spend. Never throws.
   */
  readonly admit: (budgetUsd: UsdAmount) => Promise<TabAdmission>
  /**
   * Settles the request's real `actualUsd` into the reservation's own day's
   * file, also after midnight, and clears its in-flight mark. A request that
   * never reports keeps its mark: its cost stays unknown, never guessed.
   * Never throws.
   */
  readonly settle: (reservation: TabLedgerReservation, actualUsd: UsdAmount) => Promise<void>
}

export function createTabLedger(
  deps: TabLedgerDeps,
): TabLedger & Required<Pick<TabLedger, 'todayUsage'>> {
  if (!WINDOW_ID_PATTERN.test(deps.windowId)) {
    throw new Error(`Tab window id ${deps.windowId} cannot name a ledger file`)
  }
  const fileName = `${deps.windowId}${FILE_EXTENSION}`
  const dayDirectory = (date: string): string => path.join(deps.directory, date)
  const ownFile = (date: string): string => path.join(dayDirectory(date), fileName)
  // One instance's admissions and settlements run in order, so two at once
  // in the same window cannot read the same reservation and lose one.
  let ordered: Promise<void> = Promise.resolve()

  const readOwn = async (date: string): Promise<LedgerFile | undefined> => {
    let raw: string
    try {
      raw = await readFile(ownFile(date), 'utf8')
    } catch (error: unknown) {
      if (isMissing(error)) {
        return {
          reservedUsd: Usd.from(0).toAmount(),
          reportedUsd: Usd.from(0).toAmount(),
          unreportedRequests: 0,
        }
      }
      // This window's own unreadable file: fail closed, and say which.
      return undefined
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
    const file = ledgerFileSchema.safeParse(parsed)
    return !file.success || file.data.date !== date || file.data.window !== deps.windowId
      ? undefined
      : {
          reservedUsd: file.data.reservedUsd,
          reportedUsd: file.data.reportedUsd,
          unreportedRequests: file.data.unreportedRequests ?? 0,
        }
  }

  const didWriteOwn = async (date: string, file: LedgerFile): Promise<boolean> => {
    try {
      await writeFileAtomically(
        ownFile(date),
        JSON.stringify({
          date,
          window: deps.windowId,
          reservedUsd: file.reservedUsd,
          reportedUsd: file.reportedUsd,
          unreportedRequests: file.unreportedRequests,
        }),
        { sleep: deps.sleep },
      )
      return true
    } catch {
      return false
    }
  }

  const dayTotal = async (date: string, shouldReadUsage = false): Promise<TabDayTotal> => {
    if (!DATE_PATTERN.test(date)) {
      return { ok: false, detail: date }
    }
    try {
      // Windows answers ENOENT (not ENOTDIR) through a file used as a
      // folder, so a base that is not a directory must refuse explicitly:
      // it never counts as zero spend.
      const base = await stat(deps.directory)
      if (!base.isDirectory()) {
        return { ok: false, detail: date }
      }
    } catch (error: unknown) {
      // No folder yet means no window spent today; anything else refuses.
      return isMissing(error)
        ? { ok: true, totalUsd: Usd.from(0).toAmount(), unreportedRequests: 0 }
        : { ok: false, detail: date }
    }
    let names: string[]
    try {
      names = await readdir(dayDirectory(date))
    } catch (error: unknown) {
      // No folder yet means no window spent today; anything else refuses.
      return isMissing(error)
        ? { ok: true, totalUsd: Usd.from(0).toAmount(), unreportedRequests: 0 }
        : { ok: false, detail: date }
    }
    let totalUsd = Usd.from(0).toAmount()
    let uncertainUsd = Usd.from(0).toAmount()
    let unreportedRequests = 0
    const sorted = names.toSorted((left, right) => left.localeCompare(right))
    for (const name of sorted) {
      if (name.endsWith(ATOMIC_TEMPORARY_SUFFIX) || !name.endsWith(FILE_EXTENSION)) {
        continue
      }
      let raw: string
      try {
        raw = await readFile(path.join(dayDirectory(date), name), 'utf8')
      } catch {
        return { ok: false, detail: name }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        return { ok: false, detail: name }
      }
      const file = ledgerFileSchema.safeParse(parsed)
      if (
        !file.success ||
        file.data.date !== date ||
        !WINDOW_ID_PATTERN.test(file.data.window) ||
        file.data.window !== name.slice(0, -FILE_EXTENSION.length)
      ) {
        return { ok: false, detail: name }
      }
      totalUsd = Usd.from(totalUsd)
        .add(Usd.from(file.data.reservedUsd))
        .add(Usd.from(file.data.reportedUsd))
        .toAmount()
      uncertainUsd = Usd.from(uncertainUsd).add(Usd.from(file.data.reservedUsd)).toAmount()
      unreportedRequests += file.data.unreportedRequests ?? 0
    }
    return { ok: true, totalUsd, unreportedRequests, ...(shouldReadUsage && { uncertainUsd }) }
  }

  const didClearMark = async (date: string, reportedUsd?: UsdAmount): Promise<boolean> => {
    const current = await readOwn(date)
    if (current === undefined) return false
    return await didWriteOwn(date, {
      reservedUsd: current.reservedUsd,
      reportedUsd:
        reportedUsd === undefined
          ? current.reportedUsd
          : Usd.from(current.reportedUsd).add(Usd.from(reportedUsd)).toAmount(),
      unreportedRequests: Math.max(0, current.unreportedRequests - 1),
    })
  }

  const admit = async (budgetUsd: UsdAmount): Promise<TabAdmission> => {
    if (!isUsableAmount(budgetUsd)) {
      deps.log.warn('Tab ledger refused a request with an unusable amount')
      return { admitted: false, reason: 'ledgerUnreadable', detail: 'amount' }
    }
    // The clock is read once: the marker, the total it is checked against
    // and its settlement all belong to this day, so midnight cannot split them.
    const date = tabLocalDate(deps.now())
    const before = await dayTotal(date)
    if (!before.ok) {
      deps.log.warn(`Tab ledger ${before.detail} is unreadable, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: before.detail }
    }
    // The one admission rule (F3): below the budget on real spend is admitted.
    if (!isBelowCap(budgetUsd, before.totalUsd)) {
      deps.log.info(`Tab daily budget reached: ${before.totalUsd} of ${budgetUsd} spent`)
      return {
        admitted: false,
        reason: 'budgetReached',
        detail: fileName,
        totalUsd: before.totalUsd,
      }
    }
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} is unreadable, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: fileName }
    }
    if (
      !(await didWriteOwn(date, {
        reservedUsd: current.reservedUsd,
        reportedUsd: current.reportedUsd,
        unreportedRequests: current.unreportedRequests + 1,
      }))
    ) {
      deps.log.warn(`Tab ledger ${fileName} could not be written, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: fileName }
    }
    return { admitted: true, totalUsd: before.totalUsd, reservation: { date } }
  }

  const settle = async (reservation: TabLedgerReservation, actualUsd: UsdAmount): Promise<void> => {
    if (!isUsableAmount(actualUsd)) {
      deps.log.warn('Tab ledger ignored settlement with an unusable amount')
      return
    }
    if (!DATE_PATTERN.test(reservation.date)) {
      deps.log.warn('Tab ledger ignored settlement for a day it cannot name, keeping its mark')
      return
    }
    // The request's own day, not today's: a request admitted before midnight
    // settles into the day that holds its mark.
    if (!(await didClearMark(reservation.date, actualUsd))) {
      deps.log.warn(`Tab ledger ${fileName} could not settle, keeping its mark`)
    }
  }

  // `work` once every step queued before it has settled (writeJournal's queue).
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = ordered
    const run = (async () => {
      await previous
      return await work()
    })()
    ordered = settled(run)
    return await run
  }

  return {
    todayTotal: (date) => dayTotal(date ?? tabLocalDate(deps.now())),
    todayUsage: () => dayTotal(tabLocalDate(deps.now()), true),
    admit: (budgetUsd) => exclusive(() => admit(budgetUsd)),
    settle: (reservation, actualUsd) => exclusive(() => settle(reservation, actualUsd)),
  }
}
