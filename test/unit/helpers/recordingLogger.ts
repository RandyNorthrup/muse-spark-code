import type { Logger } from '../../../src/host/logger'

/** A log sink that records every line with its level, for driving real code through the Logger seam. */
export function recordingLogger(): { log: Logger; logged: string[] } {
  const logged: string[] = []
  const log: Logger = {
    trace: (message) => {
      logged.push(`trace:${message}`)
    },
    info: (message) => {
      logged.push(`info:${message}`)
    },
    warn: (message) => {
      logged.push(`warn:${message}`)
    },
    error: (message) => {
      logged.push(`error:${message}`)
    },
  }
  return { log, logged }
}
