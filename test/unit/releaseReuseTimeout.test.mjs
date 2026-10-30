import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createLookupRequest, findBuild } from '../../scripts/release-reuse.mjs'

// A hung API answers nothing at all. The platform's own fetch is aimed at a
// loopback connection that is accepted and never answered, so no bytes of any
// API cross this test; the whole-lookup bound must end the wait so the
// release falls back to a full rebuild with words (the find step's catch,
// unchanged), instead of failing the job at its own timeout.
describe('release CI lookup timeout', () => {
  it('ends a hung lookup at the bound', async () => {
    const held = new Set()
    const silent = createServer((socket) => {
      held.add(socket)
    })
    await new Promise((done) => {
      silent.listen(0, '127.0.0.1', done)
    })
    try {
      const { port } = silent.address()
      // Only the host changes: the path, the headers and the signal are the
      // product's own.
      const toLoopback = (url, init) => {
        const { pathname, search } = new URL(url)
        return fetch(`http://127.0.0.1:${String(port)}${pathname}${search}`, init)
      }
      const request = createLookupRequest('token', { timeoutMs: 200, fetchImpl: toLoopback })
      const started = Date.now()
      let failure
      try {
        await findBuild('RandyNorthrup/muse-spark-code', '0'.repeat(40), request)
      } catch (error) {
        failure = error
      }
      const elapsed = Date.now() - started
      // Unbounded code would wait here past the suite's own timeout; the
      // bound aborts the hung call at ~200 ms.
      expect(failure).toBeInstanceOf(globalThis.DOMException)
      expect(failure?.name).toBe('TimeoutError')
      expect(elapsed).toBeLessThan(5000)
      expect(held.size).toBe(1)
    } finally {
      for (const socket of held) socket.destroy()
      await new Promise((done) => {
        silent.close(done)
      })
    }
  })
})
