// The logging surface core modules accept. src/host/logger.ts satisfies it
// structurally (with secret redaction); tests pass a recording fake.

import { CLI_STDERR_LOG_MAX_CHARS } from '../shared/constants'

/** A process's output as the log keeps it: the first part, and how much was left out. */
export function clipForLog(text: string, maxChars: number = CLI_STDERR_LOG_MAX_CHARS): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}… [${String(text.length - maxChars)} more characters]`
    : text
}

export interface CoreLogger {
  /** The finest detail (M39): shown when the Muse Spark channel's level is Trace. */
  trace(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}
