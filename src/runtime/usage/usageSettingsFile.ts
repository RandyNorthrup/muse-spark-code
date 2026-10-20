// M102: the machine's usage-history choice, shared by every editor and the CLI.
// The resource journal (M107 J) reads the same file, so one switch covers both.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { USAGE_HISTORY_DAY_MIN, USAGE_SETTINGS_FILE } from '../../shared/constants'

const settingsSchema = z.strictObject({
  enabled: z.boolean(),
  // NOLIMITSSET (PLAN.md D121): null (absent) keeps history until the person
  // sets a day count or clears it; a set whole number of days of at least 1
  // trims as set.
  days: z.nullable(z.int().check(z.gte(USAGE_HISTORY_DAY_MIN))),
})
export type UsageHistorySettings = z.infer<typeof settingsSchema>

/** Whether `error` is the invalid-settings refusal below (never a missing file). */
export function isInvalidUsageSettings(error: unknown): boolean {
  return error instanceof Error && error.message === 'invalidUsageSettings'
}

/**
A missing file is the default (on, keeping history); an unreadable one
throws rather than guessing.
*/
export function readUsageHistorySettings(dataFolder: string): UsageHistorySettings {
  try {
    return settingsSchema.parse(
      JSON.parse(readFileSync(path.join(dataFolder, USAGE_SETTINGS_FILE), 'utf8')),
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { enabled: true, days: null }
    throw new Error('invalidUsageSettings', { cause: error })
  }
}
