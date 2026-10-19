// A hostile or broken provider 429 wait is honoured whole and told at
// once: the retry notice names when the wait ends in absolute time and
// plain words, and the turn's Stop ends the wait immediately. Over real
// loopback sockets against the real transport with real timers and a real
// AbortSignal: the socket answering with the header is a fixture for the
// header, and the header values are the hostile input under test.

import { afterEach, describe, expect, it } from 'vitest'
import {
  isModelApiError,
  RequestTransport,
  type RetryNotice,
} from '../../src/core/backends/modelapi/transport'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import { closeLoopbackServers, listenLoopback } from './helpers/loopbackServer'

const FIXED_NOW = 1_800_000_000_000
const HOSTILE_WAIT_MS = 99_999_999_999_999

afterEach(closeLoopbackServers)

async function listen429(
  headers: Record<string, string>,
): Promise<{ port: number; requests: string[] }> {
  return await listenLoopback((_request, reply) => {
    reply(429, JSON.stringify({ error: { message: 'slow down' } }), {
      'content-type': 'application/json',
      ...headers,
    })
  })
}

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function transportFor(port: number): RequestTransport {
  return new RequestTransport({
    fetch: globalThis.fetch,
    baseUrl: `http://127.0.0.1:${String(port)}`,
    apiKey: () => Promise.resolve('test-key'),
    sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    now: () => FIXED_NOW,
    random: () => 0,
    log: silent,
  })
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

describe('a hostile provider 429 wait', () => {
  it('is honoured whole and its notice names when it ends', async () => {
    const target = await listen429({ 'retry-after-ms': String(HOSTILE_WAIT_MS) })
    const notices: RetryNotice[] = []
    const outcome = await postTurn(
      transportFor(target.port),
      new AbortController().signal,
      (notice) => {
        notices.push(notice)
      },
    )
    // Four retries, then the 429 stands: every wait slept whole.
    expect(isModelApiError(outcome) && outcome.status).toBe(429)
    expect(notices).toHaveLength(4)
    const expected = fill(UI_TEXT.modelApiProviderRetryWait, {
      reason: 'HTTP 429: slow down',
      time: formatDateTime(FIXED_NOW + HOSTILE_WAIT_MS),
    })
    for (const [index, notice] of notices.entries()) {
      expect(notice.delayMs).toBe(HOSTILE_WAIT_MS)
      expect(notice.reason).toBe(expected)
      expect(notice.attempt).toBe(index + 1)
    }
    expect(target.requests).toHaveLength(5)
  })

  it('ends at once when the turn stops', async () => {
    const target = await listen429({ 'retry-after': '120' })
    const notices: RetryNotice[] = []
    const stop = new AbortController()
    const started = performance.now()
    const outcome = await postTurn(transportFor(target.port), stop.signal, (notice) => {
      notices.push(notice)
      stop.abort()
    })
    const elapsed = performance.now() - started
    // The 120 s provider wait never elapses: the notice fired at once and
    // the stop ended the wait immediately, before any retry was sent.
    expect(isModelApiError(outcome) && outcome.message).toBe('cancelled')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.delayMs).toBe(120_000)
    expect(notices[0]?.reason).toBe(
      fill(UI_TEXT.modelApiProviderRetryWait, {
        reason: 'HTTP 429: slow down',
        time: formatDateTime(FIXED_NOW + 120_000),
      }),
    )
    expect(target.requests).toHaveLength(1)
    expect(elapsed).toBeLessThan(2000)
  })
})
