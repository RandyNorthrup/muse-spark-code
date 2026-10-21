// D121: the person's own plan byte limit for reports, the
// `reportsPlanMaxBytes` key of the agent data folder's settings.json (beside
// `paidDailyBudgetUsd`), read per report. No workspace file and no
// environment variable can set it. Absent, malformed or misshapen: no limit;
// any other read failure throws for the caller to see.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { isStoreErrorCode } from '../host/backend/storeErrors'
import { RUNTIME_SETTINGS_FILE } from '../shared/constants'

const planSettingSchema = z.object({
  reportsPlanMaxBytes: z.optional(z.number().check(z.nonnegative())),
})

export function runtimeReportsPlanMaxBytes(dataFolder: string): number {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8'),
    )
    const parsed = planSettingSchema.safeParse(raw)
    return parsed.success ? (parsed.data.reportsPlanMaxBytes ?? 0) : 0
  } catch (error: unknown) {
    // NARROW: a missing settings file (the default), malformed text or a
    // misshapen record reads as no limit; anything else is not this file's
    // answer to give.
    if (isStoreErrorCode(error, 'ENOENT')) return 0
    if (error instanceof SyntaxError) return 0
    if (error instanceof Error && error.name === '$ZodError') return 0
    throw error
  }
}
