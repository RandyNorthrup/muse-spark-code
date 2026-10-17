// M102: the machine's usage-history choice, shared by every editor and the CLI.
// The resource journal (M107 J) reads the same file, so one switch covers both.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  USAGE_HISTORY_DAYS_DEFAULT,
  USAGE_HISTORY_DAYS_MAX,
  USAGE_HISTORY_DAYS_MIN,
  USAGE_SETTINGS_FILE,
} from '../../shared/constants'

const settingsSchema = z.strictObject({
  enabled: z.boolean(),
  days: z.int().check(z.minimum(USAGE_HISTORY_DAYS_MIN), z.maximum(USAGE_HISTORY_DAYS_MAX)),
})
export type UsageHistorySettings = z.infer<typeof settingsSchema>

/** A missing file is the default (on); an unreadable one throws rather than guessing. */
export function readUsageHistorySettings(dataFolder: string): UsageHistorySettings {
  try {
    return settingsSchema.parse(
      JSON.parse(readFileSync(path.join(dataFolder, USAGE_SETTINGS_FILE), 'utf8')),
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { enabled: true, days: USAGE_HISTORY_DAYS_DEFAULT }
    throw new Error('invalidUsageSettings', { cause: error })
  }
}
