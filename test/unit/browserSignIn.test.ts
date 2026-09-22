import { describe, expect, it, vi } from 'vitest'
import { type BrowserSignInDeps, signInWithBrowser } from '../../src/host/auth/browserSignIn'

function deps(overrides: Partial<BrowserSignInDeps> = {}) {
  let clock = 0
  const base: BrowserSignInDeps = {
    runLogin: vi.fn(),
    credentialFileExists: vi.fn(() => Promise.resolve(false)),
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
      credentialFileExists: vi.fn(() => {
        polls += 1
        return Promise.resolve(polls >= 3)
      }),
    })
    await expect(signInWithBrowser(d)).resolves.toBe('signedIn')
    expect(d.runLogin).toHaveBeenCalledOnce()
    expect(polls).toBe(3)
    expect(d.sleep).toHaveBeenCalledTimes(2)
  })

  it('times out when the file never appears', async () => {
    const d = deps()
    await expect(signInWithBrowser(d)).resolves.toBe('timedOut')
    expect(d.sleep).toHaveBeenCalledTimes(10)
  })

  it('does not sleep at all when the credential already exists', async () => {
    const d = deps({ credentialFileExists: vi.fn(() => Promise.resolve(true)) })
    await expect(signInWithBrowser(d)).resolves.toBe('signedIn')
    expect(d.sleep).not.toHaveBeenCalled()
  })
})
