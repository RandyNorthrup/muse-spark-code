// A provider-named 429 wait is honoured whole and told at once: the retry
// notice names when the wait ends in absolute time and plain words, and
// the turn's Stop ends the wait immediately. Through the real transport
// with real timers and a real AbortController, with no socket and no
// server: the injected fetch answers each attempt with a hand-built 429
// `Response` whose header values are the hostile input under test (a real
// `Headers` object is input data, not a provider), exactly as the parsers
// read them.

import { describe, expect, it } from 'vitest'
import {
  isModelApiError,
  RequestTransport,
  type RetryNotice,
} from '../../src/core/backends/modelapi/transport'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'

const FIXED_NOW = 1_800_000_000_000
const HOSTILE_WAIT_MS = 99_999_999_999_999

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** A 429 answer carrying the header values under test, built per attempt. */
function answer429(headers: Record<string, string>): Response {
  return Response.json(
    { error: { message: 'slow down' } },
    {
      status: 429,
      headers: { 'content-type': 'application/json', ...headers },
    },
  )
}

function transportAnswering(headers: Record<string, string>): {
  readonly transport: RequestTransport
  readonly calls: () => number
} {
  let calls = 0
  const transport = new RequestTransport({
    fetch: () => {
      calls += 1
      return Promise.resolve(answer429(headers))
    },
    baseUrl: 'https://example.invalid',
    apiKey: () => Promise.resolve('test-key'),
    sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    now: () => FIXED_NOW,
    random: () => 0,
    log: silent,
  })
  return { transport, calls: () => calls }
}

async function postTurn(
  transport: RequestTransport,
  signal: AbortSignal,
  onRetry: (notice: RetryNotice) => void,
): Promise<unknown> {
  try {
    await transport.request(
      '/responses',
      {
        method: 'POST',
        body: { model: 'muse-spark-1-3' },
        modelId: 'muse-spark-1-3',
        accept: 'application/json',
      },
      signal,
      onRetry,
    )
    return 'answered'
  } catch (error: unknown) {
    return error
  }
}

describe('a provider-named 429 wait', () => {
  it('is slept whole and its notice names when it ends in absolute time', async () => {
    // A 250 ms provider wait over real timers: four retries, then the 429
    // stands. Every per-try pause really slept the whole named wait — the
    // elapsed floor proves the sleeps happened, not just their values.
    const { transport, calls } = transportAnswering({ 'retry-after-ms': '250' })
    const notices: RetryNotice[] = []
    const started = performance.now()
    const outcome = await postTurn(transport, new AbortController().signal, (notice) => {
      notices.push(notice)
    })
    const elapsed = performance.now() - started
    expect(isModelApiError(outcome) && outcome.status).toBe(429)
    expect(calls()).toBe(5)
    expect(notices).toHaveLength(4)
    const expected = fill(UI_TEXT.modelApiProviderRetryWait, {
      reason: 'HTTP 429: slow down',
      time: formatDateTime(FIXED_NOW + 250),
    })
    for (const [index, notice] of notices.entries()) {
      expect(notice.delayMs).toBe(250)
      expect(notice.reason).toBe(expected)
      expect(notice.attempt).toBe(index + 1)
    }
    expect(elapsed).toBeGreaterThanOrEqual(1000)
  })

  it('ends at once when the turn stops, naming the whole wait it cut short', async () => {
    // A 120 s provider wait never elapses: the notice fired at once naming
    // the whole wait and its absolute end, and the Stop 50 ms later ended
    // the real in-progress sleep immediately, before any retry was sent.
    const { transport, calls } = transportAnswering({ 'retry-after': '120' })
    const notices: RetryNotice[] = []
    const stop = new AbortController()
    const started = performance.now()
    const outcome = await postTurn(transport, stop.signal, (notice) => {
      notices.push(notice)
      setTimeout(() => {
        stop.abort()
      }, 50)
    })
    const elapsed = performance.now() - started
    expect(isModelApiError(outcome) && outcome.message).toBe('cancelled')
    expect(calls()).toBe(1)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.delayMs).toBe(120_000)
    expect(notices[0]?.reason).toBe(
      fill(UI_TEXT.modelApiProviderRetryWait, {
        reason: 'HTTP 429: slow down',
        time: formatDateTime(FIXED_NOW + 120_000),
      }),
    )
    expect(elapsed).toBeLessThan(2000)
  })

  it('honours a trillions-scale provider wait whole in the computed delay', async () => {
    // No ceiling of ours applies to a value the provider sent: the delay
    // handed to the sleep hook is the whole named wait, told with its
    // absolute end. The hook records instead of sleeping, so the run ends
    // at once; the sleep above proves the hook's value is really slept.
    let calls = 0
    const slept: number[] = []
    const transport = new RequestTransport({
      fetch: () => {
        calls += 1
        return Promise.resolve(answer429({ 'retry-after-ms': String(HOSTILE_WAIT_MS) }))
      },
      baseUrl: 'https://example.invalid',
      apiKey: () => Promise.resolve('test-key'),
      sleep: (ms: number) => {
        slept.push(ms)
        return Promise.resolve()
      },
      now: () => FIXED_NOW,
      random: () => 0,
      log: silent,
    })
    const notices: RetryNotice[] = []
    const outcome = await postTurn(transport, new AbortController().signal, (notice) => {
      notices.push(notice)
    })
    expect(isModelApiError(outcome) && outcome.status).toBe(429)
    expect(calls).toBe(5)
    expect(slept).toEqual([HOSTILE_WAIT_MS, HOSTILE_WAIT_MS, HOSTILE_WAIT_MS, HOSTILE_WAIT_MS])
    expect(notices).toHaveLength(4)
    const expected = fill(UI_TEXT.modelApiProviderRetryWait, {
      reason: 'HTTP 429: slow down',
      time: formatDateTime(FIXED_NOW + HOSTILE_WAIT_MS),
    })
    for (const notice of notices) expect(notice.reason).toBe(expected)
  })
})
