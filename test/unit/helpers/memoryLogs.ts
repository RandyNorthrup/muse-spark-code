// In-memory logs for unit tests: captures warn lines for the failure-words
// assertions, or drops every line when the failure arrives through the
// return values instead of the log.
import type { CoreLogger } from '../../../src/core/logging'
import type { Logger } from '../../../src/host/logger'

const quiet = (): void => undefined

/** Captures warn lines; trace, info and error stay quiet. */
export function warnLog(warned: string[]): Logger {
  return { trace: quiet, info: quiet, warn: (message) => void warned.push(message), error: quiet }
}

/** A log with its captured warn lines. */
export function warnLogPair(): { log: Logger; warned: string[] } {
  const warned: string[] = []
  return { warned, log: warnLog(warned) }
}

/** Drops every line; the failure arrives through the return values. */
export function silentCoreLog(): CoreLogger {
  return { trace: quiet, info: quiet, warn: quiet, error: quiet }
}
