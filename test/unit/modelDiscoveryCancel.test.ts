import { createServer, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { transportTestDeps } from './helpers/modelApiTransport'

// Stop owns a stuck model listing (PR #214 review): the client's /models
// wait ends at the caller's signal. The listing runs against a loopback
// connection that is accepted and never answered, so no provider bytes
// cross this test at all; what is proven is that the abort reaches the
// real network wait and ends it.
describe('model discovery answers Stop', () => {
  it('ends a stuck /models wait when the turn stops', async () => {
    const held = new Set<Socket>()
    const silent = createServer((socket) => {
      held.add(socket)
    })
    await new Promise<void>((done) => {
      silent.listen(0, '127.0.0.1', done)
    })
    try {
      let seen: AbortSignal | null | undefined
      const recordingFetch: typeof fetch = (input, init) => {
        seen = init?.signal ?? null
        return globalThis.fetch(input, init)
      }
      const client = new ModelApiClient({
        ...transportTestDeps({ fetch: recordingFetch }),
        baseUrl: `http://127.0.0.1:${String((silent.address() as { readonly port: number }).port)}`,
        apiKey: () => Promise.resolve('test-key'),
      })
      const stop = new AbortController()
      const listing = client.listModels(stop.signal)
      // Stop only once the request is provably in flight: the fetch call
      // alone has not dialled yet, and stopping before the dial proves
      // nothing about the network wait.
      for (let waited = 0; held.size === 0 && waited < 1000; waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      expect(held.size).toBe(1)
      expect(seen).toBeDefined()
      expect(seen?.aborted).toBe(false)
      stop.abort()
      await expect(listing).rejects.toThrow('cancelled')
      expect(seen?.aborted).toBe(true)
    } finally {
      for (const socket of held) socket.destroy()
      await new Promise<void>((done) => {
        silent.close(() => {
          done()
        })
      })
    }
  })
})
