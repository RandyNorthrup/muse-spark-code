import type { CreateResponseBody, StreamEvent } from './schemas'
import type { ConfirmedModelRequest, ProviderClient, ResponseAttemptGuard } from './client'

/** The one client capability a repair attempt uses. */
type RepairClient = Pick<ProviderClient, 'streamResponse'>

/**
 * One unretried stream for structured-repair flows (the hook model, the auto
 * reviewer): the call names no transport retries, so a failure surfaces to
 * repair's own admission and settlement instead of retrying inside the
 * transport (owner 2026-10-16: only a call that names a ceiling stops at
 * it; these name zero).
 */
export function streamRepairAttempt(
  client: RepairClient,
  body: CreateResponseBody,
  signal: AbortSignal,
  timeoutMs: number,
  admission: ResponseAttemptGuard,
  confirmed: ConfirmedModelRequest,
): AsyncGenerator<StreamEvent> {
  return client.streamResponse(
    body,
    AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    undefined,
    // No transport retry; structured repair has its own admission and settlement.
    { retriesUsed: 0, maxRetries: 0 },
    admission,
    {
      ...confirmed,
      onRequestStarted: () => {
        // The combined admission observer above counts this paid use once.
      },
    },
  )
}
