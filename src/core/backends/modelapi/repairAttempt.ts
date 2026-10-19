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
/**
 * D121: no default deadline of ours — an absent timeout runs the attempt
 * until it ends or the caller stops it; only a caller that names a ceiling
 * still bounds it.
 */
export function streamRepairAttempt(
  client: RepairClient,
  body: CreateResponseBody,
  signal: AbortSignal,
  timeoutMs: number | undefined,
  admission: ResponseAttemptGuard,
  confirmed: ConfirmedModelRequest,
): AsyncGenerator<StreamEvent> {
  const bounded =
    timeoutMs === undefined ? signal : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  return client.streamResponse(
    body,
    bounded,
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
