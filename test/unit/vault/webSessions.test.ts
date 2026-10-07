import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  signInYourself,
  restoreWebSession,
  type WebSessionDeps,
} from '../../../src/core/vault/web/sessions'
import {
  encodeCookies,
  decodeCookies,
  eraseCookies,
  sessionCookies,
  sessionDeadline,
} from '../../../src/core/vault/web/cookies'
import { webItemMetadata } from '../../../src/core/vault/web/items'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { type WebSessionUse } from '../../../src/core/vault/web/ports'
import { InMemoryVault } from '../helpers/vault/core'
import { WEB_ORIGIN, webCookie, webFixture, TestWebBrowser } from './webFixture'

function sessionFixture() {
  const browser = new TestWebBrowser()
  browser.cookies = [webCookie()]
  const store = new InMemoryVault()
  const now = 1_000_000
  const open = vi.fn(() => Promise.resolve(browser))
  const deps: WebSessionDeps = {
    headed: {
      open,
      captureOnUserClose: async (_browser, _signal, run) => {
        await run()
      },
    },
    pin: browser.runtime,
    store,
    now: () => now,
    randomId: () => randomBytes(16).toString('hex'),
  }
  return { browser, store, deps, open, now, controller: new AbortController() }
}

function restore(f: Awaited<ReturnType<typeof webFixture>>, use: WebSessionUse) {
  return restoreWebSession(
    f.browser,
    f.broker,
    { ...f.approved, digest: vaultUseDigest(use) },
    use,
    f.controller.signal,
    () => 100,
  )
}

describe('vault web sessions', () => {
  it.each(['future', 'metadata', 'cap', 'cookie'])(
    'refuses incoherent %s expiry at restore',
    async (failure) => {
      const f = await webFixture()
      const use: WebSessionUse = {
        kind: 'session',
        origin: WEB_ORIGIN,
        browserId: f.browser.browserId,
      }
      const expiresAt = failure === 'cap' ? 31 * 86_400_000 : 1000
      f.item.metadata = webItemMetadata(
        'session',
        f.item.metadata.id,
        WEB_ORIGIN,
        failure === 'future' ? 200 : 0,
        failure === 'metadata' ? 999 : expiresAt,
      )
      f.item.material = {
        kind: 'session',
        origin: WEB_ORIGIN,
        cookies: encodeCookies([{ ...webCookie(), expiresAt: failure === 'cookie' ? 2000 : 1000 }]),
        expiresAt,
      }
      await expect(restore(f, use)).rejects.toThrow('useChanged')
      expect(f.browser.restoreCookies).not.toHaveBeenCalled()
    },
  )
  it('refuses an unsafe or overflowing session deadline', () => {
    for (const now of [-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER])
      expect(() => sessionDeadline(now)).toThrow('useChanged')
  })
  it('maps close failures to fixed words without suppressing cleanup', async () => {
    const f = sessionFixture()
    f.browser.close.mockRejectedValue(new Error('private cleanup detail'))
    await expect(signInYourself(WEB_ORIGIN, f.controller.signal, f.deps)).rejects.toThrow(
      /^useChanged$/u,
    )
    expect(f.browser.close).toHaveBeenCalledOnce()
  })
  it('captures only origin-bound cookies on user close, stores expiry, and zeroes acquisition buffers', async () => {
    const f = sessionFixture()
    const value = Buffer.from(f.browser.cookies[0]?.value ?? [])
    const result = await signInYourself(WEB_ORIGIN, f.controller.signal, f.deps)
    expect(result.kind).toBe('session')
    expect(result.policy.mode).toBe('askEveryTime')
    expect(result.dates.expiresAt).toBe(f.now + 30 * 86_400_000)
    expect(f.open).toHaveBeenCalledWith({
      origin: WEB_ORIGIN,
      explicitHosts: ['login.example.test'],
      signal: f.controller.signal,
    })
    const stored = await f.store.read(result.id)
    if (stored.material.kind !== 'session') throw new Error('bad session')
    const rows = decodeCookies(stored.material.cookies, WEB_ORIGIN, f.now)
    expect(rows[0]?.value).toEqual(value)
    expect(rows[0]?.expiresAt).toBe(result.dates.expiresAt)
    expect(Object.keys(stored.material).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'cookies',
      'expiresAt',
      'kind',
      'origin',
    ])
    expect(f.browser.cookies.every((row) => row.value.every((byte) => byte === 0))).toBe(true)
    expect(f.browser.close).toHaveBeenCalledOnce()
    eraseCookies(rows)
    value.fill(0)
    f.store.lock()
  })
  for (const [name, runtime] of [
    ['headless runtime', { headed: false }],
    ['headless shell', { product: 'headless-shell' }],
    ['virtual authenticator', { virtualAuthenticator: true }],
    ['wrong version', { version: '1' }],
    ['wrong manifest', { manifestDigest: 'e'.repeat(64) }],
    ['wrong executable', { executableDigest: 'e'.repeat(64) }],
  ] as const) {
    it(`refuses ${name} before capturing cookies`, async () => {
      const f = sessionFixture()
      f.browser.runtime = { ...f.browser.runtime, ...runtime }
      await expect(signInYourself(WEB_ORIGIN, f.controller.signal, f.deps)).rejects.toThrow(
        'useChanged',
      )
      expect(f.browser.readCookies).not.toHaveBeenCalled()
      expect(await f.store.list()).toHaveLength(0)
      expect(f.browser.close).toHaveBeenCalledOnce()
    })
  }
  it.each(['empty', 'insecure', 'domain', 'origin', 'passkey'])(
    'refuses %s cookies without storing a passkey',
    async (mutation) => {
      const f = sessionFixture()
      const cookie = f.browser.cookies[0]
      if (cookie === undefined) throw new Error('bad fixture')
      switch (mutation) {
        case 'empty': {
          f.browser.cookies = []
          break
        }
        case 'insecure': {
          Object.assign(cookie, { secure: false })
          break
        }
        case 'domain': {
          Object.assign(cookie, { hostOnly: false })
          break
        }
        case 'origin': {
          Object.assign(cookie, { origin: 'https://other.test' })
          break
        }
        case 'passkey': {
          {
            Object.assign(cookie, { privateKey: randomBytes(32) })
            // No default
          }
          break
        }
      }
      await expect(signInYourself(WEB_ORIGIN, f.controller.signal, f.deps)).rejects.toThrow(
        'useChanged',
      )
      expect(await f.store.list()).toHaveLength(0)
      expect(cookie.value.every((byte) => byte === 0)).toBe(mutation !== 'empty')
      expect(f.browser.close).toHaveBeenCalledOnce()
    },
  )
  it('drops expired cookies and caps each surviving expiry to 30 days without extending native expiry', () => {
    const now = 1_000_000
    const rows = [
      { ...webCookie(), name: 'past', expiresAt: now },
      { ...webCookie(), name: 'short', expiresAt: now + 100 },
      { ...webCookie(), name: 'long', expiresAt: now + 31 * 86_400_000 },
      { ...webCookie(), name: 'session', expiresAt: null },
    ]
    const result = sessionCookies(rows, WEB_ORIGIN, now)
    expect(result.map((row) => [row.name, row.expiresAt])).toEqual([
      ['short', now + 100],
      ['long', now + 30 * 86_400_000],
      ['session', now + 30 * 86_400_000],
    ])
    const short = rows[1]
    if (short === undefined) throw new Error('bad fixture')
    expect(() => sessionCookies([short, short], WEB_ORIGIN, now)).toThrow()
    eraseCookies(result)
    eraseCookies(rows)
  })
  it('closes a runtime acquired after cancellation and saves nothing', async () => {
    const f = sessionFixture()
    f.open.mockImplementation(() => {
      f.controller.abort()
      return Promise.resolve(f.browser)
    })
    await expect(signInYourself(WEB_ORIGIN, f.controller.signal, f.deps)).rejects.toThrow(
      'useChanged',
    )
    expect(f.browser.close).toHaveBeenCalledOnce()
    expect(await f.store.list()).toHaveLength(0)
  })
  it('refuses changed frame/certificate after cookie read and scrubs all buffers even if storage throws', async () => {
    for (const stage of ['read', 'store']) {
      const f = sessionFixture()
      if (stage === 'read')
        f.browser.readCookies.mockImplementation(() => {
          f.browser.facts = { ...f.browser.facts, certificateValid: false }
          return Promise.resolve(f.browser.cookies)
        })
      else f.deps.store.write = () => Promise.reject(new Error('private storage error'))
      await expect(signInYourself(WEB_ORIGIN, f.controller.signal, f.deps)).rejects.toThrow(
        /^useChanged$/u,
      )
      expect(f.browser.cookies.every((row) => row.value.every((byte) => byte === 0))).toBe(true)
      expect(f.browser.close).toHaveBeenCalledOnce()
    }
  })
  it('restores a session only through its ticket and origin and erases decoded cookie values', async () => {
    const f = await webFixture()
    const row = { ...webCookie(), expiresAt: 1000 }
    const serialized = encodeCookies(sessionCookies([row], WEB_ORIGIN, 100))
    const use: WebSessionUse = {
      kind: 'session',
      origin: WEB_ORIGIN,
      browserId: f.browser.browserId,
    }
    f.item.metadata = webItemMetadata('session', f.item.metadata.id, WEB_ORIGIN, 100, 1000)
    f.item.material = { kind: 'session', origin: WEB_ORIGIN, cookies: serialized, expiresAt: 1000 }
    f.browser.restoreCookies.mockImplementation((origin, cookies) => {
      expect(origin).toBe(WEB_ORIGIN)
      expect(cookies[0]?.value).toEqual(row.value)
      return Promise.resolve()
    })
    await restoreWebSession(
      f.browser,
      f.broker,
      { ...f.approved, digest: vaultUseDigest(use) },
      use,
      f.controller.signal,
      () => 200,
    )
    expect(f.browser.restoreCookies).toHaveBeenCalledOnce()
    const received = f.browser.restoreCookies.mock.calls[0]?.[1] ?? []
    expect(received.every((cookie) => cookie.value.every((byte) => byte === 0))).toBe(true)
    expect(f.finish).toHaveBeenCalledWith(f.approved.id, true)
    serialized.fill(0)
    row.value.fill(0)
  })
  it('refuses expired or foreign sessions and forged private cookie envelopes', async () => {
    for (const failure of ['expired', 'origin', 'envelope']) {
      const f = await webFixture()
      const use: WebSessionUse = {
        kind: 'session',
        origin: WEB_ORIGIN,
        browserId: f.browser.browserId,
      }
      f.item.metadata = webItemMetadata(
        'session',
        f.item.metadata.id,
        WEB_ORIGIN,
        0,
        failure === 'expired' ? 100 : 1000,
      )
      const encoded = encodeCookies([{ ...webCookie(), expiresAt: 1000 }])
      f.item.material = {
        kind: 'session',
        origin: failure === 'origin' ? 'https://elsewhere.test' : WEB_ORIGIN,
        cookies:
          failure === 'envelope'
            ? Buffer.from(encoded.toString().replace('{"v":1,', '{"v":1,"passkey":true,'))
            : encoded,
        expiresAt: failure === 'expired' ? 100 : 1000,
      }
      await expect(restore(f, use)).rejects.toThrow('useChanged')
      expect(f.browser.restoreCookies).not.toHaveBeenCalled()
      expect(f.finish).toHaveBeenCalledWith(f.approved.id, false)
    }
  })
})
