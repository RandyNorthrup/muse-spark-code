// Logging adapter over VS Code's LogOutputChannel that redacts secrets before
// anything is written. Every host module logs through this interface, never
// through the channel or `console` directly. The channel is taken by its
// shape, so the modules that log stay free of `vscode` (M61, PLAN.md D60).

import { redactSecrets } from '../core/redact'

export interface Logger {
  /** Shown only when the channel's level is Trace (M39). */
  trace(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** An error as the log wants it: the stack where there is one, else the message. */
export function errorDetail(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

/**
 * For a call nobody awaits (`void promise.catch(…)`): its failure goes to the
 * log as "`what` failed", not only to VS Code's Extension Host log (M39).
 */
export function logRejection(log: Logger, what: string): (error: unknown) => void {
  return (error) => {
    log.error(`${what} failed: ${errorDetail(error)}`)
  }
}

/** `channel` is VS Code's `LogOutputChannel`, taken by the four methods it shares with `Logger`. */
export function createLogger(channel: Logger): Logger {
  return {
    trace(message) {
      channel.trace(redactSecrets(message))
    },
    info(message) {
      channel.info(redactSecrets(message))
    },
    warn(message) {
      channel.warn(redactSecrets(message))
    },
    error(message) {
      channel.error(redactSecrets(message))
    },
  }
}
