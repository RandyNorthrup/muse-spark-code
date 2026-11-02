// RLF-SMALLFIX2: the runtime's machine-scoped serial Python, the
// `serialPythonPath` key of the agent data folder's settings.json (beside
// `mediaConverterPath`), read at each use so a changed setting applies to the
// next serial action. No workspace file and no environment variable can set
// it. Absent, empty or unreadable: python3 is found on PATH outside the
// workspace, as before the setting existed.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { RUNTIME_SETTINGS_FILE, SERIAL_PYTHON_PATH_MAX_CHARS } from '../shared/constants'
import { isErrno } from '../core/fs/errno'

const serialPythonSettingSchema = z.object({
  serialPythonPath: z.optional(z.string().check(z.maxLength(SERIAL_PYTHON_PATH_MAX_CHARS))),
})

export function runtimeSerialPythonPath(dataFolder: string): string | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8'))
  } catch (error: unknown) {
    // NARROW: no settings file is the default; a file that is not JSON is the
    // settings store's to refuse. Any other failure is the caller's.
    if (error instanceof SyntaxError) return undefined
    if (isErrno(error) && error.code === 'ENOENT') return undefined
    throw error
  }
  const parsed = serialPythonSettingSchema.safeParse(raw)
  const value = parsed.success ? parsed.data.serialPythonPath : undefined
  return value === '' ? undefined : value
}
