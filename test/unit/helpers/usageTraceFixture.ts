import { readTraceAttempts } from '../../../src/runtime/usage/traceLogs'
import type { UsageAccessDeps } from '../../../src/runtime/usage/usageAdapter'

/**
 * The trace-log source for usage tests, rooted at the test's own folder:
 * no test may reach the developer's real home folder through `homedir()`.
 */
export function traceAttemptsLive(homeDir: string): NonNullable<UsageAccessDeps['live']> {
  return {
    readBudgets: () => Promise.resolve([]),
    readLiveLimits: () => Promise.resolve([]),
    providerConsoles: () => [],
    readAttempts: () => readTraceAttempts({ homeDir }),
  }
}
