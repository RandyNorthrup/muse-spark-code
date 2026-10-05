// Tab's daily spend ledger (M94, PLAN.md D73): one file per window per
// local day under the extension's global storage, written atomically, with
// the cross-window daily total read from all of today's files.
//
// Before every request the window writes the request's worst case into its
// own file; the request is sent only when that write succeeds and today's
// total across all files stays within the budget. Reported usage then
// replaces the reservation (`settle`); a request that never reports keeps
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
const FILE_EXTENSION = '.json'
const ENOENT = 'ENOENT'

const ledgerFileSchema = z.object({
  date: z.string(),
  window: z.string(),
  reservedUsd: z.number().check(z.nonnegative()),
  reportedUsd: z.number().check(z.nonnegative()),
})

interface LedgerFile {
  readonly reservedUsd: number
  readonly reportedUsd: number
}

/** Today's total spend across every window, or the refusal to trust it. */
export type TabDayTotal =
  | { readonly ok: true; readonly totalUsd: number }
  | { readonly ok: false; readonly detail: string }

/** Whether the next request may be sent, and what today's total then is. */
export type TabAdmission =
  | { readonly admitted: true; readonly totalUsd: number }
  | {
      readonly admitted: false
      readonly reason: 'budgetReached' | 'ledgerUnreadable'
      readonly detail: string
      readonly totalUsd?: number
    }

/** This window's part of a local day, as `YYYY-MM-DD`. */
export function tabLocalDate(nowMs: number): string {
  const date = new Date(nowMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

function isUsableAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** What a name failure is: anything but a folder that is not there yet. */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === ENOENT
}

export interface TabLedger {
  /** Today's total across every window's file; never throws. */
  readonly todayTotal: () => Promise<TabDayTotal>
  /**
   * Writes `worstCaseUsd` into this window's file, then admits the request
   * only while today's total across all files stays within `budgetUsd`.
   * A refusal rolls the reservation back. Never throws.
   */
  readonly admit: (worstCaseUsd: number, budgetUsd: number) => Promise<TabAdmission>
  /**
   * Replaces `reservedUsd` of reservation with the reported `actualUsd`.
   * A request that never reports keeps its whole reservation. Never throws.
   */
  readonly settle: (reservedUsd: number, actualUsd: number) => Promise<void>
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
        return { reservedUsd: 0, reportedUsd: 0 }
      }
      // This window's own unreadable file: fail closed, and say which.
      return undefined
    }
    const parsed: unknown = (() => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return undefined
      }
    })()
    const file = ledgerFileSchema.safeParse(parsed)
    if (!file.success || file.data.date !== date || file.data.window !== deps.windowId) {
      return undefined
    }
    return { reservedUsd: file.data.reservedUsd, reportedUsd: file.data.reportedUsd }
  }

  const writeOwn = async (date: string, file: LedgerFile): Promise<boolean> => {
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

  const todayTotal = async (): Promise<TabDayTotal> => {
    const date = tabLocalDate(deps.now())
    try {
      // Windows answers ENOENT (not ENOTDIR) through a file used as a
      // folder, so a base that is not a directory must refuse explicitly:
      // it never counts as zero spend.
      if (!(await stat(deps.directory)).isDirectory()) {
        return { ok: false, detail: date }
      }
    } catch (error: unknown) {
      // No folder yet means no window spent today; anything else refuses.
      return isMissing(error)
        ? { ok: true, totalUsd: 0 }
        : { ok: false, detail: date }
    }
    let names: string[]
    try {
      names = await readdir(dayDirectory(date))
    } catch (error: unknown) {
      // No folder yet means no window spent today; anything else refuses.
      return isMissing(error)
        ? { ok: true, totalUsd: 0 }
        : { ok: false, detail: date }
    }
    let totalUsd = 0
    for (const name of names.toSorted()) {
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
      totalUsd += file.data.reservedUsd + file.data.reportedUsd
    }
    return { ok: true, totalUsd }
  }

  const rollback = async (date: string, worstCaseUsd: number): Promise<void> => {
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} could not roll back its reservation`)
      return
    }
    const kept = await writeOwn(date, {
      reservedUsd: Math.max(0, current.reservedUsd - worstCaseUsd),
      reportedUsd: current.reportedUsd,
    })
    if (!kept) {
      // The over-count stays: spend is over-counted, never lost.
      deps.log.warn(`Tab ledger ${fileName} could not roll back its reservation`)
    }
  }

  const admit = async (worstCaseUsd: number, budgetUsd: number): Promise<TabAdmission> => {
    if (!isUsableAmount(worstCaseUsd) || !isUsableAmount(budgetUsd)) {
      deps.log.warn('Tab ledger refused a request with an unusable amount')
      return { admitted: false, reason: 'ledgerUnreadable', detail: 'amount' }
    }
    const date = tabLocalDate(deps.now())
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} is unreadable, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: fileName }
    }
    const reserved = {
      reservedUsd: current.reservedUsd + worstCaseUsd,
      reportedUsd: current.reportedUsd,
    }
    if (!(await writeOwn(date, reserved))) {
      deps.log.warn(`Tab ledger ${fileName} could not be written, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: fileName }
    }
    const total = await todayTotal()
    if (!total.ok) {
      await rollback(date, worstCaseUsd)
      deps.log.warn(`Tab ledger ${total.detail} is unreadable, treating the budget as reached`)
      return { admitted: false, reason: 'ledgerUnreadable', detail: total.detail }
    }
    if (total.totalUsd > budgetUsd) {
      await rollback(date, worstCaseUsd)
      deps.log.info(
        `Tab daily budget reached: ${String(total.totalUsd)} of ${String(budgetUsd)} spent`,
      )
      return {
        admitted: false,
        reason: 'budgetReached',
        detail: fileName,
        totalUsd: total.totalUsd - worstCaseUsd,
      }
    }
    return { admitted: true, totalUsd: total.totalUsd }
  }

  const settle = async (reservedUsd: number, actualUsd: number): Promise<void> => {
    if (!isUsableAmount(reservedUsd) || !isUsableAmount(actualUsd)) {
      deps.log.warn('Tab ledger ignored settlement with an unusable amount')
      return
    }
    const date = tabLocalDate(deps.now())
    const current = await readOwn(date)
    if (current === undefined) {
      deps.log.warn(`Tab ledger ${fileName} is unreadable, keeping its reservation`)
      return
    }
    const kept = await writeOwn(date, {
      reservedUsd: Math.max(0, current.reservedUsd - reservedUsd),
      reportedUsd: current.reportedUsd + actualUsd,
    })
    if (!kept) {
      deps.log.warn(`Tab ledger ${fileName} could not settle, keeping its reservation`)
    }
  }

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = ordered.then(work)
    ordered = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    todayTotal,
    admit: (worstCaseUsd, budgetUsd) => exclusive(() => admit(worstCaseUsd, budgetUsd)),
    settle: (reservedUsd, actualUsd) => exclusive(() => settle(reservedUsd, actualUsd)),
  }
}
