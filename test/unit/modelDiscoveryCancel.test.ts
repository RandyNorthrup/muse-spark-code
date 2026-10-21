import { describe, expect, it } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { transportTestDeps } from './helpers/modelApiTransport'

// Stop owns a stuck model listing (PR #214 review): the client's /models
// wait ends at the caller's signal. The fetch below never answers, so no
// provider bytes cross this test at all; what is proven is that the abort
// reaches the network wait and ends it.
describe('model discovery answers Stop', () => {
  it('ends a stuck /models wait when the turn stops', async () => {
    let seen: AbortSignal | null | undefined
    const client = new ModelApiClient({
      ...transportTestDeps({
        fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
          seen = init?.signal ?? null
          return new Promise<Response>(() => undefined)
        },
        sleep: () => Promise.resolve(),
        random: () => 0,
      }),
      apiKey: () => Promise.resolve('test-key'),
    })
    const stop = new AbortController()
    const listing = client.listModels(stop.signal)
    // Let the request reach the network before stopping it.
    for (let waited = 0; seen === undefined && waited < 1000; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(seen).toBeDefined()
    expect(seen?.aborted).toBe(false)
    stop.abort()
    await expect(listing).rejects.toThrow('cancelled')
    expect(seen?.aborted).toBe(true)
  })
})
