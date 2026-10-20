// Error details shared by the durable session and schedule file stores.

import { wireWordForLog } from '../../core/logging'
import { redactSecrets } from '../../core/redact'

export function storeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/**
The catch-gate-visible form of the expected store condition: `is`-named so
the inventory reads it as the one handled case, with exactly the same
answer as `storeErrorCode` on every input.
*/
export function isStoreErrorCode(error: unknown, code: string): boolean {
  return storeErrorCode(error) === code
}

export function describeStoreError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

/**
A provider failure as the log names it: the HTTP status and the
envelope's words, never its message — a delete error can name the file
id and the file name it failed on. Anything else keeps its code, or a
fixed phrase when it has none. The user-facing failure keeps the
truthful reason; only the log line is scrubbed.

The provider check is structural and local: importing the client would
drag its graph into the sessions chunk, and dist/modelApiSessions.js
must not require dist/modelApi.js at load. It mirrors
transport.isModelApiError's shape (a message with a numeric status).
*/
function isProviderError(value: unknown): value is { status: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    'status' in value &&
    typeof value.status === 'number'
  )
}

function envelopeWord(value: { status: number }): string {
  const kind = 'kind' in value && typeof value.kind === 'string' ? value.kind : undefined
  const code = 'code' in value && typeof value.code === 'string' ? value.code : undefined
  return kind === undefined && code === undefined ? '' : ` ${wireWordForLog(kind ?? code ?? '')}`
}

export function storeErrorForLog(error: unknown): string {
  return isProviderError(error)
    ? `provider failure (HTTP ${String(error.status)}${envelopeWord(error)})`
    : (storeErrorCode(error) ?? 'a storage failure')
}
