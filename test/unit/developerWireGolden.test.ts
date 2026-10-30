// M108 X cross-profile wire golden: the same provider request built for
// two accounts is byte-identical except the credential header. Both sides
// run the real billing resolver and the real transport over a capturing
// probe fetch, which records the outgoing bytes and then fails before any
// vendor call — no response is ever faked, and the two synthetic keys
// never leave this file. The record names the per-request ids: this route
// carries none, so nothing else may differ.
import { describe, expect, it } from 'vitest'
import { resolveAttemptBillingRoute } from '../../src/core/backends/modelapi/billingRoute'
import { RequestTransport } from '../../src/core/backends/modelapi/transport'
import { MODEL_API_BASE_URL } from '../../src/shared/constants'

const NOW = 1_790_000_000_000
const KEY_A = 'test-only-golden-key-a'
const KEY_B = 'test-only-golden-key-b'

interface Captured {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string
}

function silent(): void {
  // The golden never logs.
}

function byString(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

async function capture(key: string): Promise<Captured[]> {
  const captured: Captured[] = []
  const transport = new RequestTransport({
    fetch: ((url: string, init?: { method?: string; headers?: unknown; body?: unknown }) => {
      const headers: Record<string, string> = {}
      const entries = Object.entries((init?.headers ?? {}) as Record<string, unknown>)
      for (const [name, value] of entries) {
        if (typeof value === 'string') headers[name] = value
      }
      captured.push({
        url,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : JSON.stringify(init?.body ?? null),
      })
      return Promise.reject(new Error('golden probe: no vendor call'))
    }) as typeof fetch,
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(key),
    now: () => NOW,
    random: () => 0,
    log: { trace: silent, info: silent, warn: silent, error: silent },
  })
  // The same call the client's token count makes, verbatim.
  try {
    await transport.request(
      '/responses/input_tokens',
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'tokenCount',
          isMetaDirect: true,
          readCredential: () => Promise.resolve(key),
        }),
        method: 'POST',
        body: { model: 'muse-spark-1.3', input: 'Count my tokens.', stream: false },
        modelId: 'muse-spark-1.3',
        accept: 'application/json',
        countRequest: true,
      },
      undefined,
    )
  } catch (error: unknown) {
    expect((error as Error).message).toBe('golden probe: no vendor call')
    return captured
  }
  throw new Error('the probe fetch unexpectedly succeeded')
}

describe('M108 X cross-profile wire golden', () => {
  it('sends byte-identical requests except the credential header', async () => {
    const [first] = await capture(KEY_A)
    const [second] = await capture(KEY_B)
    if (first === undefined || second === undefined) throw new Error('no request was captured')
    expect(first.url).toBe(second.url)
    expect(first.method).toBe(second.method)
    expect(first.body).toBe(second.body)
    const firstNames = Object.keys(first.headers).toSorted(byString)
    const secondNames = Object.keys(second.headers).toSorted(byString)
    expect(firstNames).toEqual(secondNames)
    for (const name of firstNames) {
      if (name === 'Authorization') continue
      expect(second.headers[name]).toBe(first.headers[name])
    }
    expect(first.headers['Authorization']).toBe(`Bearer ${KEY_A}`)
    expect(second.headers['Authorization']).toBe(`Bearer ${KEY_B}`)
    // The keys reach nowhere else: not the address, the body or another header.
    const rest = JSON.stringify({
      url: first.url,
      body: first.body,
      headers: Object.fromEntries(
        Object.entries(first.headers).filter(([name]) => name !== 'Authorization'),
      ),
    })
    expect(rest.includes(KEY_A)).toBe(false)
    expect(rest.includes(KEY_B)).toBe(false)
  })
})
