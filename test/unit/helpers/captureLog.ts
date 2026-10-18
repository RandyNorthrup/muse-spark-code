// A Logger that keeps every line it was told, for tests that prove what a
// failure records. The lines carry their level, as the channel would show.

import { createLogger, type Logger } from '../../../src/host/logger'

export interface CapturedLog {
  readonly logger: Logger
  readonly lines: string[]
}

/** A real logger over an in-memory channel: every told line kept in order. */
export function captureLog(): CapturedLog {
  const lines: string[] = []
  const push =
    (level: string) =>
    (message: string): void => {
      lines.push(`${level} ${message}`)
    }
  return {
    logger: createLogger({
      trace: push('trace'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
    }),
    lines,
  }
}
