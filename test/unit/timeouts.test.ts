import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeadlineError, withSlowDeadline } from '../../src/core/timeouts'
import {
  MILLISECONDS_PER_SECOND,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MSP_SLOW_HANDSHAKE_TIMEOUT_MS,
} from '../../src/shared/constants'

// The handshake's deadline as `muse serve` gets it (0.10.1): a start whose
// process still runs at 30 s is waited for to 120 s in all.
const FORTY_FIVE_SECONDS_MS = 45_000
const FORTY_SECONDS_MS = 40_000

function startDeadline(isRunning: () => boolean, onSlow = vi.fn()) {
  return {
    firstMs: MSP_HANDSHAKE_TIMEOUT_MS,
    totalMs: MSP_SLOW_HANDSHAKE_TIMEOUT_MS,
    isRunning,
    message: (ms: number) =>
      `did not finish starting within ${String(ms / MILLISECONDS_PER_SECOND)} s`,
    onSlow,
  }
}

interface Outcome {
  failure?: unknown
}

/** Waits for `promise`, keeping its failure in `seen` so a test can look before it settles. */
async function keepFailure(promise: Promise<unknown>, seen: Outcome): Promise<void> {
  try {
    await promise
  } catch (error: unknown) {
    seen.failure = error
  }
}

describe('withSlowDeadline (the handshake of a slow start, 0.10.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects a start that answers at 45 s while its process runs, saying it waits once', async () => {
    const onSlow = vi.fn()
    const handshake = Promise.withResolvers<string>()
    const waiting = withSlowDeadline(
      handshake.promise,
      startDeadline(() => true, onSlow),
    )
    await vi.advanceTimersByTimeAsync(FORTY_FIVE_SECONDS_MS)
    handshake.resolve('connected')
    await expect(waiting).resolves.toBe('connected')
    expect(onSlow).toHaveBeenCalledOnce()
  })

  it('fails at the first deadline when the process no longer runs', async () => {
    const onSlow = vi.fn()
    const waiting = withSlowDeadline(
      new Promise<never>(() => undefined),
      startDeadline(() => false, onSlow),
    )
    const failed = expect(waiting).rejects.toThrow('did not finish starting within 30 s')
    await vi.advanceTimersByTimeAsync(MSP_HANDSHAKE_TIMEOUT_MS)
    await failed
    expect(onSlow).not.toHaveBeenCalled()
  })

  it('ends a running start that never answers at 120 s in all, not before', async () => {
    const seen: Outcome = {}
    const waiting = keepFailure(
      withSlowDeadline(
        new Promise<never>(() => undefined),
        startDeadline(() => true),
      ),
      seen,
    )
    await vi.advanceTimersByTimeAsync(MSP_SLOW_HANDSHAKE_TIMEOUT_MS - 1)
    expect(seen.failure).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(seen.failure).toBeInstanceOf(DeadlineError)
    expect(String(seen.failure)).toContain('did not finish starting within 120 s')
  })

  it('fails at once when the process dies during the longer wait', async () => {
    const handshake = Promise.withResolvers<string>()
    const seen: Outcome = {}
    const waiting = keepFailure(
      withSlowDeadline(
        handshake.promise,
        startDeadline(() => true),
      ),
      seen,
    )
    await vi.advanceTimersByTimeAsync(FORTY_SECONDS_MS)
    handshake.reject(new Error('connection closed'))
    await waiting
    expect(seen.failure).toEqual(new Error('connection closed'))
    expect(vi.getTimerCount()).toBe(0)
  })
})
