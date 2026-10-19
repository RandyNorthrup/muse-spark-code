// Abort-responsive yielding for the legal scanner's CPU-bound phases (M97,
// PR #214 review): the file walk (synchronous syscalls block the event
// loop) and the scan loop (CPU-bound over thousands of files on one
// thread) yield every `LEGAL_SCAN_YIELD_EVERY` steps, so a Stop/SIGINT
// abort lands mid-phase instead of only before it starts. The wait itself
// never ends here: `checkCancelled` throws the phase's own error.
import { setImmediate as yieldToHost } from 'node:timers/promises'

import { LEGAL_SCAN_YIELD_EVERY } from '../../shared/constants'

/** Yields to the host every `LEGAL_SCAN_YIELD_EVERY` calls, then checks for cancellation. */
export function createYieldCheck(checkCancelled: () => void): () => Promise<void> {
  let sinceYield = 0
  return async (): Promise<void> => {
    sinceYield += 1
    if (sinceYield < LEGAL_SCAN_YIELD_EVERY) return
    sinceYield = 0
    await yieldToHost()
    checkCancelled()
  }
}
