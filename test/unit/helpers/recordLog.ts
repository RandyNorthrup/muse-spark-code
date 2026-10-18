// A recording CoreLogger for failure-path suites: warnings and infos are
// kept for the assertions, everything else is dropped. Shared so the
// suites cannot drift apart.
import type { CoreLogger } from '../../../src/core/logging'

export function recordLog(): {
  readonly log: CoreLogger
  readonly warnings: string[]
  readonly infos: string[]
} {
  const warnings: string[] = []
  const infos: string[] = []
  const log: CoreLogger = {
    trace: () => undefined,
    info: (message) => {
      infos.push(message)
    },
    warn: (message) => {
      warnings.push(message)
    },
    error: () => undefined,
  }
  return { log, warnings, infos }
}
