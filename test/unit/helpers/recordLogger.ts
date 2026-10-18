import type { Logger } from '../../../src/host/logger'

/** An in-memory logger recording level-prefixed messages, for assertions. */
export function recordLogger(): { log: Logger; logged: string[] } {
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
