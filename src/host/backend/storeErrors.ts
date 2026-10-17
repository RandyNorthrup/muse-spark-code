// Error details shared by the durable session and schedule file stores.

import { redactSecrets } from '../../core/redact'

export function storeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

export function describeStoreError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}
