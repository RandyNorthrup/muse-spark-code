import { describe, expect, it } from 'vitest'
import { createLookupRequest, findBuild } from '../../scripts/release-reuse.mjs'

// A hung API answers nothing at all: the fetch below never settles on
// its own and invents no data, but honors its abort signal as fetch
// does. The whole-lookup bound must end the wait so the release falls
// back to a full rebuild with words (the find step's catch, unchanged),
// instead of failing the job at its own timeout.
const hangingFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener(
      'abort',
      () => {
        reject(init.signal.reason)
      },
      { once: true },
    )
  })

describe('release CI lookup timeout', () => {
  it('ends a hung lookup at the bound', async () => {
    const request = createLookupRequest('token', {
      timeoutMs: 200,
      fetchImpl: hangingFetch,
    })
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
  })
})
