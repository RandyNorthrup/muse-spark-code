// D121: the person's own plan byte limit for reports, the
// `reportsPlanMaxBytes` key of the agent data folder's settings.json (beside
// `paidDailyBudgetUsd`), read per report. No workspace file and no
// environment variable can set it. Absent, empty or unreadable: no limit.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
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
  } catch {
    // No settings file (the default) or an unreadable one: no limit.
    return 0
  }
}
