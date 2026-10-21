// A fetch waits until the page answers or the person presses Stop (D121):
// no deadline of ours, and the wait names how long it has waited. The
// injected transport seam answers slowly but never dials.
import { describe, expect, it } from 'vitest'
import {
  fetchWebPage,
  type Nat64Discovery,
  type PinnedResponse,
  type WebFetchDeps,
} from '../../src/core/web/webFetch'

const noNat64: Nat64Discovery = { isKnown: true, prefixes: [] }
const bodyText = 'a slow page, read whole'

function textResponse(): PinnedResponse {
  const bytes = new TextEncoder().encode(bodyText)
  return {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: (async function* () {
      await Promise.resolve()
      yield bytes
    })(),
    close() {
      // Nothing to let go: the body already arrived.
    },
  }
}

/**
A transport that answers like a slow page: after a fixed wait, with wait
notices on a fixed cadence. Every test here uses the same timing; the
fixture's own suite owns the numbers.
*/
function slowDeps(notices: string[]): WebFetchDeps {
  return {
    resolve: () => Promise.resolve(['93.184.215.14']),
    nat64: () => Promise.resolve(noNat64),
    request: () =>
      new Promise<PinnedResponse>((resolve) => {
        setTimeout(() => {
          resolve(textResponse())
        }, 300)
      }),
    convertHtml: () => Promise.reject(new Error('text needs no converter')),
    newMarker: () => 'marker',
    notice: (text) => {
      notices.push(text)
    },
    noticeMs: 20,
  }
}

/** Fetches the slow fixture page, read whole; the test fails when it is not a page. */
async function fetchSlowPage(notices: string[]) {
  const result = await fetchWebPage(
    'https://example.com/slow',
    slowDeps(notices),
    new AbortController().signal,
  )
  expect(result.kind).toBe('page')
  if (result.kind !== 'page') throw new Error('expected the slow page to read')
  return result
}

describe('web fetch with no deadline of ours', () => {
  it('reads a slow page whole instead of timing out', async () => {
    const notices: string[] = []
    const result = await fetchSlowPage(notices)
    expect(result.page.bytes).toBe(new TextEncoder().encode(bodyText).byteLength)
    expect(result.text).toContain(bodyText)
  })

  it('names how long a slow page has waited', async () => {
    const notices: string[] = []
    await fetchSlowPage(notices)
    expect(notices.length).toBeGreaterThan(0)
    for (const notice of notices) {
      expect(notice).toContain('the web page')
      expect(notice).toContain('Stop ends it.')
    }
  })

  it('still ends the wait when the turn stops', async () => {
    const stopped = new AbortController()
    const waiting = fetchWebPage('https://example.com/slow', slowDeps([]), stopped.signal)
    stopped.abort()
    await expect(waiting).rejects.toThrow()
  })
})
