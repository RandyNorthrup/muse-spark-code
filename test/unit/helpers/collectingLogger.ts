import type { Logger } from '../../../src/host/logger'

/** A log that keeps every message in order, so a test can say what was said. */
export function collectingLogger(messages: string[]): Logger {
  const push = (message: string): void => {
    messages.push(message)
  }
  return { info: push, warn: push, error: push, trace: push }
}
