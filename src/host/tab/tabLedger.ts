import { Usd, legacyUsdSchema, usdAmountSchema, type UsdAmount } from '../../shared/usd'
// Tab's daily spend ledger (M94, PLAN.md D73): one file per window per
// local day under the extension's global storage, written atomically, with
// the cross-window daily total read from all of today's files.
//
// Before every request the window writes the request's worst case into its
// own file; the request is sent only when that write succeeds and today's
// total across all files stays within the budget. Admission reads the clock
// once: the reservation, the total it is checked against and any rollback
// belong to that one local day, and the admitted request carries it as its
// reservation. Reported usage then replaces the reservation in that day's
// file (`settle`), even after midnight; a request that never reports keeps
// its whole reservation. A missing, corrupt or unreadable ledger refuses
// the request (fail closed: a corrupt file never counts as zero spend), and
// nothing here throws into the provider: every outcome is returned.
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
  reservedUsd: legacyUsdSchema,
  reportedUsd: legacyUsdSchema,
})

interface LedgerFile {
  readonly reservedUsd: UsdAmount
  readonly reportedUsd: UsdAmount
}

/** Today's total spend across every window, or the refusal to trust it. */
export type TabDayTotal =
  | { readonly ok: true; readonly totalUsd: UsdAmount }
  | { readonly ok: false; readonly detail: string }

/** An admitted request's reservation: the local day it was written to and its worst case. */
export interface TabLedgerReservation {
  /** The admission's local day, as `YYYY-MM-DD`; settlement writes to this day's file. */
  readonly date: string
  readonly worstCaseUsd: UsdAmount
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

function nonnegativeDifference(left: UsdAmount, right: UsdAmount): UsdAmount {
  const difference = Usd.from(left).subtract(Usd.from(right))
  return difference.compare(Usd.from(0)) < 0 ? Usd.from(0).toAmount() : difference.toAmount()
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
  /**
   * Writes `worstCaseUsd` into this window's file for the local day read
   * once from the clock, then admits the request only while that day's
   * total across all files stays within `budgetUsd`. A refusal rolls the
   * reservation back on the same day. Never throws.
   */
  readonly admit: (worstCaseUsd: UsdAmount, budgetUsd: UsdAmount) => Promise<TabAdmission>
  /**
   * Replaces the reservation's worst case with the reported `actualUsd`
   * in the reservation's own day's file, also after midnight. A request
   * that never reports keeps its whole reservation. Never throws.
   */
  readonly settle: (reservation: TabLedgerReservation, actualUsd: UsdAmount) => Promise<void>
}

export function createTabLedger(deps: TabLedgerDeps): TabLedger {
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
        return { reservedUsd: Usd.from(0).toAmount(), reportedUsd: Usd.from(0).toAmount() }
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
      : { reservedUsd: file.data.reservedUsd, reportedUsd: file.data.reportedUsd }
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
        }),
        { sleep: deps.sleep },
      )
      return true
    } catch {
      return false
    }
  }

  const dayTotal = async (date: string): Promise<TabDayTotal> => {
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
        ? { ok: true, totalUsd: Usd.from(0).toAmount() }
        : { ok: false, detail: date }
    }
    let names: string[]
    try {
      names = await readdir(dayDirectory(date))
    } catch (error: unknown) {
      // No folder yet means no window spent today; anything else refuses.
      return isMissing(error)
        ? { ok: true, totalUsd: Usd.from(0).toAmount() }
        : { ok: false, detail: date }
    }
    let totalUsd = Usd.from(0).toAmount()
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
    }
    return { ok: true, totalUsd }
  }

  const rollback = async (date: string, worstCaseUsd: UsdAmount): Promise<void> => {
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} could not roll back its reservation`)
      return
    }
    const didRollBack = await didWriteOwn(date, {
      reservedUsd: nonnegativeDifference(current.reservedUsd, worstCaseUsd),
      reportedUsd: current.reportedUsd,
    })
    if (!didRollBack) {
      // The over-count stays: spend is over-counted, never lost.
      deps.log.warn(`Tab ledger ${fileName} could not roll back its reservation`)
    }
  }

  const admit = async (worstCaseUsd: UsdAmount, budgetUsd: UsdAmount): Promise<TabAdmission> => {
    if (!isUsableAmount(worstCaseUsd) || !isUsableAmount(budgetUsd)) {
      deps.log.warn('Tab ledger refused a request with an unusable amount')
      return { admitted: false, reason: 'ledgerUnreadable', detail: 'amount' }
    }
    // The clock is read once: the reservation, its check and any rollback
    // all belong to this day, so midnight cannot split them.
    const date = tabLocalDate(deps.now())
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} is unreadable, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: fileName }
    }
    const reserved = {
      reservedUsd: Usd.from(current.reservedUsd).add(Usd.from(worstCaseUsd)).toAmount(),
      reportedUsd: current.reportedUsd,
    }
    if (!(await didWriteOwn(date, reserved))) {
      deps.log.warn(`Tab ledger ${fileName} could not be written, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: fileName }
    }
    const total = await dayTotal(date)
    if (!total.ok) {
      await rollback(date, worstCaseUsd)
      deps.log.warn(`Tab ledger ${total.detail} is unreadable, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: total.detail }
    }
    if (Usd.from(total.totalUsd).compare(Usd.from(budgetUsd)) > 0) {
      await rollback(date, worstCaseUsd)
      deps.log.info(`Tab daily budget reached: ${total.totalUsd} of ${budgetUsd} spent`)
      return {
        admitted: false,
        reason: 'budgetReached',
        detail: fileName,
        totalUsd: Usd.from(total.totalUsd).subtract(Usd.from(worstCaseUsd)).toAmount(),
      }
    }
    return { admitted: true, totalUsd: total.totalUsd, reservation: { date, worstCaseUsd } }
  }

  const settle = async (reservation: TabLedgerReservation, actualUsd: UsdAmount): Promise<void> => {
    if (!isUsableAmount(reservation.worstCaseUsd) || !isUsableAmount(actualUsd)) {
      deps.log.warn('Tab ledger ignored settlement with an unusable amount')
      return
    }
    if (!DATE_PATTERN.test(reservation.date)) {
      deps.log.warn(
        'Tab ledger ignored settlement for a day it cannot name, keeping its reservation',
      )
      return
    }
    // The reservation's own day, not today's: a request admitted before
    // midnight settles into the day that holds its reservation.
    const { date } = reservation
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} is unreadable, keeping its reservation`)
      return
    }
    const didSettle = await didWriteOwn(date, {
      reservedUsd: nonnegativeDifference(current.reservedUsd, reservation.worstCaseUsd),
      reportedUsd: Usd.from(current.reportedUsd).add(Usd.from(actualUsd)).toAmount(),
    })
    if (!didSettle) {
      deps.log.warn(`Tab ledger ${fileName} could not settle, keeping its reservation`)
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
    admit: (worstCaseUsd, budgetUsd) => exclusive(() => admit(worstCaseUsd, budgetUsd)),
    settle: (reservation, actualUsd) => exclusive(() => settle(reservation, actualUsd)),
  }
}
