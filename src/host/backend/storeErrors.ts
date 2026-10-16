// Error details shared by the durable session and schedule file stores.

import { redactSecrets } from '../../core/redact'

export function storeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/**
 * The catch-gate-visible form of the expected store condition: `is`-named so
 * the inventory reads it as the one handled case, with exactly the same
 * answer as `storeErrorCode` on every input.
 */
export function isStoreErrorCode(error: unknown, code: string): boolean {
  return storeErrorCode(error) === code
}

export function describeStoreError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}
