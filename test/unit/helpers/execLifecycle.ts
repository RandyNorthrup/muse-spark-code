// One exec lifecycle for the transport suites: real timers, a signal
// listener the tests never trigger, and an exit that fails loudly.
import { createLifecycle } from '../../../src/runtime/exec/execLimits'

/** A listener the test never triggers. */
export function ignoreExecEvent(): void {
  // Nothing to observe on this path.
}

export function createExecTestLifecycle() {
  return createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 30_000,
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: () => ignoreExecEvent,
    forceFinish: ignoreExecEvent,
    exit: (code): never => {
      throw new Error(`exit ${String(code)}`)
    },
  })
}
