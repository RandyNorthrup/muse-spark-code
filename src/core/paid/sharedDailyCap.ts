import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { legacyUsdSchema, Usd, type UsdAmount } from '../../shared/usd'
import {
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../shared/constants'

// THE shared daily cap has ONE source for the window family and the runtime
// family: the data-folder settings file, with the same stop-marker and
// per-day override the journal directory carries. Both families read it
// through this helper, so they can never enforce different shared caps
// against the one ledger. A missing file means the install default; a
// corrupt one refuses spending instead of guessing.
const settingsSchema = z.strictObject({
  paidDailyBudgetUsd: z.optional(
    z
      .number()
      .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  ),
})
const dailyLimitSchema = z.object({ limitUsd: legacyUsdSchema, stopped: z.boolean() })

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

export function sharedDayScope(nowMs: number): string {
  const today = new Date(nowMs)
  return [today.getFullYear(), today.getMonth() + 1, today.getDate()].join('-')
}

export function readSharedDailyCapUsd(dataFolder: string, scope: string): UsdAmount {
  const directory = path.join(dataFolder, PAID_DAILY_BUDGET.directory, scope)
  let isStopped = true
  try {
    statSync(path.join(directory, PAID_DAILY_BUDGET.stopDirectory))
  } catch (error: unknown) {
    if (codeOf(error) !== 'ENOENT')
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    isStopped = false
  }
  if (isStopped) throw new Error(UI_TEXT.paidDailyStopped)
  let raw: string | undefined
  try {
    raw = readFileSync(path.join(directory, PAID_DAILY_BUDGET.overrideFile), 'utf8')
  } catch (error: unknown) {
    if (codeOf(error) !== 'ENOENT')
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
  }
  if (raw !== undefined) {
    let limit: z.infer<typeof dailyLimitSchema>
    try {
      limit = dailyLimitSchema.parse(JSON.parse(raw))
    } catch (error: unknown) {
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    }
    if (limit.stopped) throw new Error(UI_TEXT.paidDailyStopped)
    const amount = Usd.from(limit.limitUsd)
    if (
      amount.compare(Usd.from(PAID_DAILY_BUDGET.minimumUsd)) < 0 ||
      amount.compare(Usd.from(PAID_DAILY_BUDGET.maximumUsd)) > 0
    )
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    return amount.toAmount()
  }
  try {
    return Usd.from(
      settingsSchema.parse(
        JSON.parse(readFileSync(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8')),
      ).paidDailyBudgetUsd ?? SETTING_DEFAULTS.paidDailyBudgetUsd,
    ).toAmount()
  } catch (error: unknown) {
    if (codeOf(error) === 'ENOENT') return Usd.from(SETTING_DEFAULTS.paidDailyBudgetUsd).toAmount()
    throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
  }
}
