// The standalone runtime's shared daily budget for paid extras (D78): the
// agent data folder's settings file, or the default. The daily ledger
// (dist/runtimeAccounting.js) admits against it and an account's paid-use
// question (M108 lane P) names it, so both always state the same budget.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../shared/constants'
import { storeErrorCode } from '../host/backend/storeErrors'

const settingsSchema = z.strictObject({
  paidDailyBudgetUsd: z.optional(
    z
      .number()
      .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  ),
})

/** The configured budget in USD. A missing file is the default; an unreadable one refuses. */
export function runtimeDailyBudgetUsd(dataFolder: string): number {
  try {
    return (
      settingsSchema.parse(
        JSON.parse(readFileSync(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8')),
      ).paidDailyBudgetUsd ?? SETTING_DEFAULTS.paidDailyBudgetUsd
    )
  } catch (error: unknown) {
    if (storeErrorCode(error) === 'ENOENT') return SETTING_DEFAULTS.paidDailyBudgetUsd
    throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
  }
}
