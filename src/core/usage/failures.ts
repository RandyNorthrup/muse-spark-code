// A usage-journal failure as the log names it: a fixed word, never a path.
// The journal throws fixed words (journalStore.ts, nodeUsageFs.ts,
// usageSettingsFile.ts) and the filesystem throws coded errors; a record the
// schema rejects is named by its failing fields (RLUSAGE, exec usage clock);
// anything else keeps the fixed fallback. Matched exactly, so a message
// carrying a path or record content never matches.
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
  'invalidUsage',
])

/** The recording's wrapper names nothing; the failure it wraps does. */
const RECORDING_WRAPPER = 'Usage history unavailable'

function codeOf(error: Error): string | undefined {
  if (!('code' in error)) return undefined
  const code: unknown = error.code
  return typeof code === 'string' ? code : undefined
}

interface RejectedField {
  readonly path: readonly (string | number)[]
  readonly code: string
  readonly expected?: unknown
}

function isRejectedField(value: unknown): value is RejectedField {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'path' in value &&
    Array.isArray(value.path) &&
    value.path.every((part: unknown) => typeof part === 'string' || typeof part === 'number')
  )
}

/**
A schema rejection's address, not its content: every failing field and the
shape each one wanted. Values, paths and record content never leave here.
*/
function rejectedFields(error: Error): string | undefined {
  if (!('issues' in error) || !Array.isArray(error.issues)) return undefined
  const issues: readonly unknown[] = error.issues
  if (issues.length === 0 || !issues.every(isRejectedField)) return undefined
  const fields = issues.map((issue) => {
    const field = issue.path.length === 0 ? 'record' : issue.path.join('.')
    const expected = typeof issue.expected === 'string' ? `, expected ${issue.expected}` : ''
    return `${field} (${issue.code}${expected})`
  })
  return `record rejected: ${fields.join('; ')}`
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
    const rejected = rejectedFields(current)
    if (rejected !== undefined) return rejected
  }
  if (current instanceof Error) {
    const code = codeOf(current)
    if (code !== undefined) return wireWordForLog(code)
  }
  return 'an unknown failure'
}
