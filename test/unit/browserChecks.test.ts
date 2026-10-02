// The window's browser checks (M81, PLAN.md D49): the browser's own bundle
// loaded on the first check, a broken one refused and read again later, and
// every check under way ended when the window closes.
import { describe, expect, it } from 'vitest'
import type { BrowserCheckRequest } from '../../src/core/browser/browserRun'
import { BrowserChecks, isBrowserCheckBundle } from '../../src/host/browser/browserChecks'
import { FakeLogOutputChannel } from './helpers/fakes'

function request(signal = new AbortController().signal): BrowserCheckRequest {
  return {
    url: 'http://localhost/',
    actions: [],
    allowedHosts: [],
    includeScreenshot: true,
    signal,
  }
}

/** A bundle whose check waits until its signal aborts, then says it was stopped. */
function waitingBundle(seen: AbortSignal[]) {
  return {
    runBrowserCheck: (checked: BrowserCheckRequest) => {
      seen.push(checked.signal)
      return new Promise((resolve) => {
        checked.signal.addEventListener('abort', () => {
          resolve({ ok: false, failure: { kind: 'cancelled' } })
        })
      })
    },
  }
}

describe('the browser check bundle (M81)', () => {
  it('is loaded on the first check only, and once', async () => {
    const loads: string[] = []
    const seen: AbortSignal[] = []
    const checks = new BrowserChecks({
      bundlePath: '/ext/dist/browserCheck.js',
      log: new FakeLogOutputChannel(),
      loadBundle: (file) => {
        loads.push(file)
        return waitingBundle(seen)
      },
    })
    expect(loads).toEqual([])
    const stop = new AbortController()
    const first = checks.check(request(stop.signal))
    const second = checks.check(request())
    expect(loads).toEqual(['/ext/dist/browserCheck.js'])
    stop.abort()
    await expect(first).resolves.toEqual({ ok: false, failure: { kind: 'cancelled' } })
    // The window closing ends every check still under way, and any asked later.
    checks.dispose()
    await expect(second).resolves.toEqual({ ok: false, failure: { kind: 'cancelled' } })
    expect(seen.every((signal) => signal.aborted)).toBe(true)
    await expect(checks.check(request())).resolves.toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
    })
  })

  it('refuses a check when the bundle is missing or malformed, and reads it again next time', async () => {
    const log = new FakeLogOutputChannel()
    let attempt = 0
    const checks = new BrowserChecks({
      bundlePath: '/ext/dist/browserCheck.js',
      log,
      loadBundle: () => {
        attempt += 1
        if (attempt === 1) {
          throw new Error('ENOENT')
        }
        return attempt === 2 ? { runBrowserCheck: 'nope' } : waitingBundle([])
      },
    })
    const unavailable = {
      ok: false,
      failure: { kind: 'launch' },
    }
    await expect(checks.check(request())).resolves.toEqual(unavailable)
    await expect(checks.check(request())).resolves.toEqual(unavailable)
    const stop = new AbortController()
    const third = checks.check(request(stop.signal))
    stop.abort()
    await expect(third).resolves.toEqual({ ok: false, failure: { kind: 'cancelled' } })
    expect(attempt).toBe(3)
    expect(isBrowserCheckBundle({ runBrowserCheck: () => undefined })).toBe(true)
    expect(isBrowserCheckBundle(null)).toBe(false)
  })
})
