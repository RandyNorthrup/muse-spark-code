import { describe, expect, it } from 'vitest'
import {
  canRetryWithinBudget,
  RequestTransport,
  type TransportDeps,
} from '../../src/core/backends/modelapi/transport'
import { MODEL_API_RETRY_JITTER_MS, TIMER_MAX_DELAY_MS } from '../../src/shared/constants'
import { transportTestDeps } from './helpers/modelApiTransport'

function deps(
  overrides: Partial<TransportDeps> & { fetch: TransportDeps['fetch'] },
): TransportDeps {
  return transportTestDeps({
    apiKey: () => Promise.resolve('test-key'),
    ...overrides,
  })
}

describe('model API retries without a count of their own (NOLIMITS2 C1)', () => {
  // The send-count proofs that stood here fed the transport invented 503
  // answers through its fetch seam: outside-world input the owner's
  // testing rules (2026-10-12) allow only as a recorded real exchange,
  // which this lane has none of. They were deleted in review
  // (RVNOLIMITS2); the retry loop's end at Stop is the lead's real-life
  // step. What remains is pure through the real module.
  it('honours a provider-named wait whole instead of capping it at the fallback ceiling', () => {
    const transport = new RequestTransport(deps({ fetch: globalThis.fetch }))
    // The jitter is real randomness: the named wait lands whole beneath
    // it, inside one jitter window.
    const named = transport.backoffMs(0, 300_000)
    expect(named).toBeGreaterThanOrEqual(300_000)
    expect(named).toBeLessThanOrEqual(300_000 + MODEL_API_RETRY_JITTER_MS)
    // D228: no provider documents a maximum wait here, so the unnamed
    // backoff follows the industry 0.5 s base up to its 8 s ceiling, under
    // the same jitter window; at the ceiling the jitter cannot lengthen it.
    const first = transport.backoffMs(0, undefined)
    expect(first).toBeGreaterThanOrEqual(500)
    expect(first).toBeLessThanOrEqual(500 + MODEL_API_RETRY_JITTER_MS)
    expect(transport.backoffMs(10, undefined)).toBe(8000)
  })

  it('an unnamed budget never counts a retry out; a named one stops at its count', () => {
    expect(canRetryWithinBudget(undefined, 1000)).toBe(true)
    expect(canRetryWithinBudget({ retriesUsed: 1000 }, 1000)).toBe(true)
    expect(canRetryWithinBudget({ retriesUsed: 0, maxRetries: 0 }, 0)).toBe(false)
    expect(canRetryWithinBudget({ retriesUsed: 0, maxRetries: 2 }, 1)).toBe(true)
    expect(canRetryWithinBudget({ retriesUsed: 0, maxRetries: 2 }, 2)).toBe(false)
  })

  it('waits out a provider wait past one timer range instead of resending at once', async () => {
    const transport = new RequestTransport(
      deps({
        fetch: globalThis.fetch,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms)
          }),
      }),
    )
    const controller = new AbortController()
    const waited = transport.pause(TIMER_MAX_DELAY_MS + 1000, controller.signal)
    // One timer given the whole wait would have ended after 1 ms; then the
    // pause resolves before the stop below and nothing rejects.
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()
    await expect(waited).rejects.toThrow('cancelled')
  })
})
