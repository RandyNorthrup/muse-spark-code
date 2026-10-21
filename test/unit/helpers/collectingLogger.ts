import type { Logger } from '../../../src/host/logger'

/** A log that keeps every message in order, so a test can say what was said. */
export function collectingLogger(messages: string[]): Logger {
  const push = (message: string): void => {
    messages.push(message)
  }
  return { info: push, warn: push, error: push, trace: push }
}

/** A log that keeps only errors, so a test can say what failed. */
export function errorLogger(errors: string[]): Logger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message: string): void => {
      errors.push(message)
    },
  }
}

/** A log that keeps only warnings, so a test can say what was warned. */
export function warningLogger(warnings: string[]): Logger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: (message: string): void => {
      warnings.push(message)
    },
    error: () => undefined,
  }
}
