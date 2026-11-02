// RLF-EMPTYCAT (RSCH-MUSE-F): a signed-in host that serves zero models is
// said, not obeyed. `muse serve` answers `model/list` with `{"models":
// [], "source": "bundledCatalog"}` for a signed-in account when Meta's
// catalogue fails server-side (meta-models/muse-code-sdk#115, #106,
// #110; the served shape captured 2026-11-02 in
// test/fixtures/muse-empty-catalogue/). That evidence never means the
// person lost access: the panel keeps the last good catalogue, says one
// sentence, retries on Meta's documented backoff, and recovers without a
// restart when the list returns. The decision and the waits live here,
// pure; the panel owns the retained rows, the sentence and the loop.
import type { BackendKind } from '../../agent/agentBackend'
import { MODEL_API_RETRY_JITTER_MS } from '../../../shared/constants'
import {
  effectiveMaxRetries,
  META_DOCUMENTED_RETRY_LIMITS,
  retryDelayMs,
} from '../../../shared/retryPolicy'

/** A served listing as the episode decision reads it. */
export interface EmptyCatalogueReading {
  /** The served rows' count; the wire shape, empty included, is the CLI's own. */
  readonly servedCount: number
  /** The backend that served it; only the Muse Code host serves Meta's list. */
  readonly backendKind: BackendKind
  /** Whether the account is signed in: logged out serves empty by design. */
  readonly signedIn: boolean
}

/**
Whether the served listing starts the empty-catalogue episode: zero rows
from the Muse Code backend for a signed-in account. A logged-out empty
list is the expected logged-out state (the sign-in screen owns it), and
another backend's empty list is that backend's own truth.
*/
export function isEmptyCatalogueEpisode(reading: EmptyCatalogueReading): boolean {
  return reading.servedCount === 0 && reading.backendKind === 'museCode' && reading.signedIn
}

/**
Retries after the first try while the served list stays empty: Meta
documents 3–5 attempts (dev.meta.ai/docs/error-handling, via
META_DOCUMENTED_RETRY_LIMITS), so the burst runs five listings, then
stops with the sentence staying; later listings still recover.
*/
export function emptyCatalogueMaxRetries(): number {
  return effectiveMaxRetries(undefined, META_DOCUMENTED_RETRY_LIMITS)
}

/**
The wait before catalogue retry `attempt` (0-based): Meta's documented
backoff — 500 ms doubling per try with jitter — through the shared
policy. `jitterSample` is the caller's 0 ≤ n < 1 draw.
*/
export function emptyCatalogueRetryDelayMs(attempt: number, jitterSample: number): number {
  return retryDelayMs(
    attempt,
    META_DOCUMENTED_RETRY_LIMITS,
    undefined,
    jitterSample,
    MODEL_API_RETRY_JITTER_MS,
  )
}
