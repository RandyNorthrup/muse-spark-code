// What ends the serving agent besides its client closing the input
// (RLF-SHUTDOWN). An editor that quits, crashes or restarts leaves by closing
// its pipes or by signalling the agent, and the agent must then end its backend
// before it exits: a Muse Code process it started is never left running. A
// signal is heard as the client leaving, so the one orderly path ends both; a
// log pipe that closed is not a crash.

import { isErrno } from '../core/fs/errno'
import type { Logger } from '../host/logger'

/** The signals that mean the client, or the terminal it ran in, is gone. */
const LEAVING_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP']

interface ClientLeaving {
  /** Aborts when a leaving signal arrives. */
  readonly signal: AbortSignal
  dispose(): void
}

/**
A client that closed the agent's log pipe is leaving: logging stops there, and
the orderly end (the input closing, a signal) still runs. Any other error on
the pipe stays loud.
*/
function ignoreClosedLog(error: Error): void {
  if (!isErrno(error) || error.code !== 'EPIPE') throw error
}

export function watchClientLeaving(log: Logger): ClientLeaving {
  const left = new AbortController()
  const heard = (name: NodeJS.Signals): void => {
    if (left.signal.aborted) return
    log.info(`${name}: the client is leaving, ending the session`)
    left.abort()
  }
  const listeners = LEAVING_SIGNALS.map((name) => {
    const listener = () => {
      heard(name)
    }
    process.on(name, listener)
    return { name, listener }
  })
  process.stderr.on('error', ignoreClosedLog)
  return {
    signal: left.signal,
    // The log guard stays: the cleanup that follows still logs.
    dispose: () => {
      for (const { name, listener } of listeners) process.off(name, listener)
    },
  }
}
