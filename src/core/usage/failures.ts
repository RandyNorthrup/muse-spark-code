// A usage-journal failure as the log names it: a fixed word, never a path.
// The journal throws fixed words (journalStore.ts, nodeUsageFs.ts,
// usageSettingsFile.ts) and the filesystem throws coded errors; anything
// else keeps the fixed fallback. Matched exactly, so a message carrying a
// path or record content never matches.
import { wireWordForLog } from '../logging'

const KNOWN_USAGE_FAILURES: ReadonlySet<string> = new Set([
  'usageLocked',
  'usageLockLost',
  'usageLockRaced',
  'invalidRollupMonth',
  'invalidUsageSettings',
  'usageRemoveIncomplete',
  'usageNameTaken',
  'usagePathChanged',
  'invalidUsagePath',
  'linkedUsagePath',
  'unsafeUsagePath',
  'invalidUsageLock',
  'invalidUsageFile',
])

/** The recording's wrapper names nothing; the failure it wraps does. */
const RECORDING_WRAPPER = 'Usage history unavailable'

function codeOf(error: Error): string | undefined {
  if (!('code' in error)) return undefined
  const code: unknown = error.code
  return typeof code === 'string' ? code : undefined
}

/** A usage failure as the log names it: never free text, paths or content. */
export function usageFailureForLog(error: unknown): string {
  let current = error
  while (
    current instanceof Error &&
    current.message === RECORDING_WRAPPER &&
    current.cause !== undefined
  )
    current = current.cause
  if (current instanceof Error && KNOWN_USAGE_FAILURES.has(current.message)) return current.message
  if (current instanceof Error) {
    const code = codeOf(current)
    if (code !== undefined) return wireWordForLog(code)
  }
  return 'an unknown failure'
}
