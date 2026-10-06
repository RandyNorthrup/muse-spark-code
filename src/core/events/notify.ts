import type { CoreLogger } from '../logging'

/** Each observer runs even when another surface has already been disposed. */
export function notify<T>(
  listeners: Iterable<(value: T) => void>,
  value: T,
  log: CoreLogger,
  site: string,
  report?: (error: unknown) => void,
): void {
  for (const listener of listeners) {
    try {
      listener(value)
    } catch (error: unknown) {
      // Only the caller's fixed site is logged; observer errors may contain secrets.
      log.error(`${site} observer failed`)
      try {
        report?.(error)
      } catch {
        log.error(`${site} observer failure reporter failed`)
      }
    }
  }
}
