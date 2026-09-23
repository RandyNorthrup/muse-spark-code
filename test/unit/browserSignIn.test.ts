import { describe, expect, it, vi } from 'vitest'
import { type BrowserSignInDeps, signInWithBrowser } from '../../src/host/auth/browserSignIn'

const STALE_MTIME = 1000

function deps(overrides: Partial<BrowserSignInDeps> = {}) {
  let clock = 0
  const base: BrowserSignInDeps = {
    runLogin: vi.fn(),
    credentialFileModifiedAt: vi.fn(() => undefined),
    sleep: vi.fn((ms: number) => {
      clock += ms
      return Promise.resolve()
    }),
    now: () => clock,
    pollIntervalMs: 100,
    timeoutMs: 1000,
  }
  return { ...base, ...overrides }
}

describe('signInWithBrowser', () => {
  it('runs muse login first and resolves once the credential file appears', async () => {
    let polls = 0
    const d = deps({
      credentialFileModifiedAt: vi.fn(() => {
        polls += 1
        // The first read is the "before" stamp; the file appears on the fourth.
        return polls >= 4 ? STALE_MTIME : undefined
      }),
    })
    await expect(signInWithBrowser(d)).resolves.toBe('signedIn')
    expect(d.runLogin).toHaveBeenCalledOnce()
    expect(polls).toBe(4)
    expect(d.sleep).toHaveBeenCalledTimes(2)
  })

  it('times out when the file never appears', async () => {
    const d = deps()
    await expect(signInWithBrowser(d)).resolves.toBe('timedOut')
    expect(d.sleep).toHaveBeenCalledTimes(10)
  })

  it('waits for a stale credential file to be rewritten (D25)', async () => {
    let writes = 0
    const d = deps({
      credentialFileModifiedAt: vi.fn(() => {
        writes += 1
        // Present before the login, unchanged for two polls, then rewritten.
        return writes >= 4 ? STALE_MTIME + 1 : STALE_MTIME
      }),
    })
    await expect(signInWithBrowser(d)).resolves.toBe('signedIn')
    expect(d.sleep).toHaveBeenCalledTimes(2)
    const unchanged = deps({ credentialFileModifiedAt: vi.fn(() => STALE_MTIME) })
    await expect(signInWithBrowser(unchanged)).resolves.toBe('timedOut')
  })
})
