// The logging surface core modules accept. src/host/logger.ts satisfies it
// structurally (with secret redaction); tests pass a recording fake.

import { CLI_STDERR_LOG_MAX_CHARS } from '../shared/constants'

/** A process's output as the log keeps it: the first part, and how much was left out. */
export function clipForLog(text: string, maxChars: number = CLI_STDERR_LOG_MAX_CHARS): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}… [${String(text.length - maxChars)} more characters]`
    : text
}

// A word from the wire (an MSP state, error kind or outcome) in the shape of
// one: a letter, then up to 63 letters, digits, `_` or `-`. Free text of any
// other shape (a message, a path, an e-mail address) is never logged, since
// the redactor catches only key-shaped strings (the review of PR #49).
const WIRE_WORD = /^[A-Za-z][\w-]{0,63}$/u

/** A protocol word as the log names it; any other text becomes a fixed phrase. */
export function wireWordForLog(value: string): string {
  return WIRE_WORD.test(value) ? value : 'an unrecognized value'
}

export interface CoreLogger {
  /** The finest detail (M39): shown when the Muse Spark channel's level is Trace. */
  trace(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}
