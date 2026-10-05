// M95 lane K (PLAN.md D74, M95 Tests: OAuth loopback): the callback server
// listens on 127.0.0.1 only, serves one use, checks `state`, exchanges the
// code once, and closes in every path.

import { describe, expect, it } from 'vitest'
import { startOAuthLoopback } from '../../src/host/providers/oauthLoopback'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

const STATE = 'test-state-value'

async function callback(
  loopback: { readonly redirectUri: string },
  query: string,
): Promise<Response> {
  return await fetch(`${loopback.redirectUri}${query}`)
}

describe('the OAuth loopback server', () => {
  it('serves localized callback text as plain text, including HTML metacharacters', async () => {
    const text = '<script>alert("synthetic")</script> & "done"'
    setUiText({ ...EN, oauthCallbackDone: text }, 'en')
    const loopback = await startOAuthLoopback(STATE, 1000)
    try {
      const waited = loopback.waitForCode()
      const response = await callback(loopback, `?code=auth-code&state=${STATE}`)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(await response.text()).toBe(text)
      await expect(waited).resolves.toBe('auth-code')
    } finally {
      loopback.close()
      setUiText(EN, 'en')
    }
  })

  it('listens on 127.0.0.1 with a random port', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    try {
      expect(loopback.bindHost).toBe('127.0.0.1')
      expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    } finally {
      loopback.close()
    }
  })

  it('releases the code once and closes', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    const waited = loopback.waitForCode()
    const response = await callback(loopback, `?code=auth-code&state=${STATE}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(EN.oauthCallbackDone)
    await expect(waited).resolves.toBe('auth-code')
    await expect(loopback.waitForCode()).rejects.toThrow()
    await expect(fetch(loopback.redirectUri)).rejects.toThrow()
  })

  it('rejects a callback with the wrong state', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    const waited = loopback.waitForCode()
    const rejected = expect(waited).rejects.toThrow('state')
    const response = await callback(loopback, '?code=auth-code&state=forged')
    expect(response.status).toBe(400)
    await rejected
  })

  it('rejects a callback with no code', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    const waited = loopback.waitForCode()
    const rejected = expect(waited).rejects.toThrow('no code')
    await callback(loopback, `?state=${STATE}`)
    await rejected
  })

  it('rejects a provider refusal', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    const waited = loopback.waitForCode()
    const rejected = expect(waited).rejects.toThrow('refused')
    await callback(loopback, '?error=access_denied&error_description=nope')
    await rejected
  })

  it('ignores other paths and methods without settling', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    try {
      const waited = loopback.waitForCode()
      const missing = await fetch(`${loopback.redirectUri}/elsewhere?state=${STATE}`)
      expect(missing.status).toBe(404)
      const posted = await fetch(loopback.redirectUri, { method: 'POST' })
      expect(posted.status).toBe(405)
      loopback.close()
      await expect(waited).rejects.toThrow()
    } finally {
      loopback.close()
    }
  })

  it('ends at its timeout', async () => {
    const loopback = await startOAuthLoopback(STATE, 20)
    await expect(loopback.waitForCode()).rejects.toThrow('timed out')
    loopback.close()
  })

  it('closes on request, rejecting the waiter', async () => {
    const loopback = await startOAuthLoopback(STATE, 1000)
    const waited = loopback.waitForCode()
    loopback.close()
    loopback.close()
    await expect(waited).rejects.toThrow()
  })
})
