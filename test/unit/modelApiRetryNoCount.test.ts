import { describe, expect, it } from 'vitest'
import { RequestTransport, type TransportDeps } from '../../src/core/backends/modelapi/transport'
import { transportTestDeps } from './helpers/modelApiTransport'

function deps(
  overrides: Partial<TransportDeps> & { fetch: TransportDeps['fetch'] },
): TransportDeps {
  return transportTestDeps({
    // No waiting between attempts: the test counts tries, not time.
    sleep: () => Promise.resolve(),
    random: () => 0,
    apiKey: () => Promise.resolve('test-key'),
    ...overrides,
  })
}

function failure(status: number): Response {
  return Response.json({ error: { message: 'busy', type: 'server_error' } }, { status })
}

describe('model API retries without a count of their own (NOLIMITS2 C1)', () => {
  it('retries a retryable failure past the old four-count, then hands back success', async () => {
    let sends = 0
    const transport = new RequestTransport(
      deps({
        fetch: () => {
          sends += 1
          return Promise.resolve(sends <= 6 ? failure(503) : new Response('{}', { status: 200 }))
        },
      }),
    )
    const { response } = await transport.request(
      '/models',
      { method: 'GET', accept: 'application/json' },
      undefined,
    )
    expect(response.status).toBe(200)
    expect(sends).toBe(7)
  })

  it('honours a provider-named wait whole instead of capping it at the fallback ceiling', () => {
    const transport = new RequestTransport(deps({ fetch: () => Promise.resolve(new Response()) }))
    expect(transport.backoffMs(0, 300_000)).toBe(300_000)
    expect(transport.backoffMs(10, undefined)).toBe(60_000)
  })

  it('Stop still ends a retry wait', async () => {
    const controller = new AbortController()
    let notices = 0
    const transport = new RequestTransport(deps({ fetch: () => Promise.resolve(failure(503)) }))
    await expect(
      transport.request(
        '/models',
        { method: 'GET', accept: 'application/json' },
        controller.signal,
        () => {
          notices += 1
          if (notices === 2) controller.abort()
        },
      ),
    ).rejects.toThrow('cancelled')
    expect(notices).toBe(2)
  })

  it('a call that names no retries still makes its one send', async () => {
    let sends = 0
    const transport = new RequestTransport(
      deps({
        fetch: () => {
          sends += 1
          return Promise.resolve(failure(503))
        },
      }),
    )
    await expect(
      transport.request(
        '/models',
        { method: 'GET', accept: 'application/json' },
        undefined,
        undefined,
        { retriesUsed: 0, maxRetries: 0 },
      ),
    ).rejects.toThrow('busy')
    expect(sends).toBe(1)
  })
})
