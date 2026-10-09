// M105 lane V, seam 3B: the runtime's machine-scoped converter path, the
// `mediaConverterPath` key of the agent data folder's settings.json (beside
// `paidDailyBudgetUsd`), read per use. No workspace file and no environment
// variable can set it. Absent, empty or unreadable: documented installs only.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { MEDIA_CONVERTER_PATH_MAX_CHARS, RUNTIME_SETTINGS_FILE } from '../shared/constants'

const converterSettingSchema = z.object({
  mediaConverterPath: z.optional(z.string().check(z.maxLength(MEDIA_CONVERTER_PATH_MAX_CHARS))),
})

export function runtimeConverterPath(dataFolder: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8'),
    )
    const parsed = converterSettingSchema.safeParse(raw)
    return parsed.success ? parsed.data.mediaConverterPath : undefined
  } catch {
    // No settings file (the default) or an unreadable one: documented installs.
    return undefined
  }
}
