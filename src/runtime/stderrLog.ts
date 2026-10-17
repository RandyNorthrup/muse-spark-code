// The agent's log (PLAN.md D62): stdout is the protocol, so everything else
// goes to stderr, where the editors show an agent's log. Redacted by the
// same logger the panel uses. Serving logs from `info` (`trace` with
// `--verbose`); the sign-in commands only warnings, so their output stays
// what the user asked for.

import { createLogger, type Logger } from '../host/logger'

export type LogLevel = 'trace' | 'info' | 'warn'

const LEVELS: readonly LogLevel[] = ['trace', 'info', 'warn']

export function stderrLogger(write: (line: string) => void, level: LogLevel): Logger {
  const isShown = (line: LogLevel) => LEVELS.indexOf(line) >= LEVELS.indexOf(level)
  return createLogger({
    trace(message) {
      if (isShown('trace')) {
        write(`[trace] ${message}`)
      }
    },
    info(message) {
      if (isShown('info')) {
        write(`[info] ${message}`)
      }
    },
    warn(message) {
      write(`[warn] ${message}`)
    },
    error(message) {
      write(`[error] ${message}`)
    },
  })
}
