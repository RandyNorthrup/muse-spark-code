// M95 lane K (PLAN.md D74, M95 acceptance 13): Connect OpenRouter account
// stores a key without copy-paste; the key's usage validates before display.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  connectOpenRouterAccount,
  OPENROUTER_ORIGIN,
  openRouterAuthorizeUrl,
  openRouterSpendPage,
  readOpenRouterKeyUsage,
  type OpenRouterConnectDeps,
} from '../../src/host/providers/openRouter'
import type { OAuthLoopback } from '../../src/host/providers/oauthLoopback'
import type {
  CodeExchanger,
  KeyUsageReader,
  PkceSource,
} from '../../src/host/providers/providerPorts'

const PKCE: PkceSource = {
  create: () => ({ verifier: 'verifier-value', challenge: 'challenge-value' }),
  newState: () => 'state-value',
}

function loopback(code: string): OAuthLoopback {
  return {
    bindHost: '127.0.0.1',
    redirectUri: 'http://127.0.0.1:9/callback',
    waitForCode: () => Promise.resolve(code),
    close: () => undefined,
  }
}

function deps(overrides: Partial<OpenRouterConnectDeps> = {}): OpenRouterConnectDeps {
  const exchange: CodeExchanger = {
    exchange: (request) => Promise.resolve(`key-for-${request.code}`),
  }
  return {
    pkce: PKCE,
    exchange,
    openBrowser: () => Promise.resolve(),
    startServer: () => Promise.resolve(loopback('browser-code')),
    promptForPastedCode: () => Promise.resolve(undefined),
    isRemote: false,
    ...overrides,
  }
}

describe('openRouterAuthorizeUrl', () => {
  it('registers the loopback callback with the challenge and state', () => {
    const url = new URL(
      openRouterAuthorizeUrl({
        challenge: 'challenge-value',
        state: 'state-value',
        redirectUri: 'http://127.0.0.1:9/callback',
      }),
    )
    expect(url.origin).toBe(OPENROUTER_ORIGIN)
    expect(url.searchParams.get('callback_url')).toBe('http://127.0.0.1:9/callback')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-value')
  })

  it('omits the callback in a remote window', () => {
    const url = new URL(openRouterAuthorizeUrl({ challenge: 'c', state: 's' }))
    expect(url.searchParams.get('callback_url')).toBeNull()
    expect(url.searchParams.get('code_challenge')).toBe('c')
  })
})

describe('openRouterSpendPage', () => {
  it('deep-links the key page by the key SHA-256', () => {
    const hash = createHash('sha256').update('sk-or-test', 'utf8').digest('hex')
    expect(openRouterSpendPage('sk-or-test')).toBe(`https://openrouter.ai/keys/${hash}`)
  })
})

describe('connectOpenRouterAccount', () => {
  it('exchanges the loopback code once and binds the record', async () => {
    const opened: string[] = []
    const exchanged: unknown[] = []
    const closed: string[] = []
    const server = loopback('browser-code')
    const connection = await connectOpenRouterAccount(
      deps({
        openBrowser: (url) => {
          opened.push(url)
          return Promise.resolve()
        },
        startServer: (state) => {
          expect(state).toBe('state-value')
          return Promise.resolve({
            ...server,
            close: () => {
              closed.push('closed')
            },
          })
        },
        exchange: {
          exchange: (request) => {
            exchanged.push(request)
            return Promise.resolve('sk-or-connected')
          },
        },
      }),
    )
    expect(connection).toEqual({
      key: 'sk-or-connected',
      record: { v: 1, auth: 'apiKey', origin: OPENROUTER_ORIGIN, secret: 'sk-or-connected' },
    })
    expect(opened).toHaveLength(1)
    expect(exchanged).toEqual([
      {
        code: 'browser-code',
        verifier: 'verifier-value',
        redirectUri: 'http://127.0.0.1:9/callback',
      },
    ])
    expect(closed).toEqual(['closed'])
  })

  it('closes the loopback when the callback fails', async () => {
    const closed: string[] = []
    await expect(
      connectOpenRouterAccount(
        deps({
          startServer: () =>
            Promise.resolve({
              ...loopback('unused'),
              waitForCode: () => Promise.reject(new Error('The callback carried the wrong state')),
              close: () => {
                closed.push('closed')
              },
            }),
        }),
      ),
    ).rejects.toThrow('state')
    expect(closed).toEqual(['closed'])
  })

  it('takes the pasted code in a remote window, and cancels on dismiss', async () => {
    const opened: string[] = []
    const started = vi.fn()
    const connected = await connectOpenRouterAccount(
      deps({
        isRemote: true,
        openBrowser: (url) => {
          opened.push(url)
          return Promise.resolve()
        },
        startServer: started,
        promptForPastedCode: () => Promise.resolve('  pasted-code  '),
      }),
    )
    expect(connected?.key).toBe('key-for-pasted-code')
    expect(new URL(opened[0] ?? '').searchParams.get('callback_url')).toBeNull()
    expect(started).not.toHaveBeenCalled()
    const cancelled = await connectOpenRouterAccount(
      deps({ isRemote: true, promptForPastedCode: () => Promise.resolve(undefined) }),
    )
    expect(cancelled).toBeUndefined()
  })

  it('refuses an empty exchanged key', async () => {
    await expect(
      connectOpenRouterAccount(deps({ exchange: { exchange: () => Promise.resolve('  ') } })),
    ).rejects.toThrow()
  })
})

describe('readOpenRouterKeyUsage', () => {
  const SNAPSHOT = {
    usedToday: 1.5,
    usedThisWeek: 2.5,
    usedThisMonth: 3.5,
    limit: 10,
    remaining: 6.5,
  }

  it('passes valid numbers through', async () => {
    const reader: KeyUsageReader = { read: () => Promise.resolve(SNAPSHOT) }
    await expect(readOpenRouterKeyUsage(reader, 'sk-or-x')).resolves.toEqual(SNAPSHOT)
  })

  it('refuses invalid numbers before they reach a tally', async () => {
    for (const bad of [
      { ...SNAPSHOT, usedToday: NaN },
      { ...SNAPSHOT, limit: -1 },
      { ...SNAPSHOT, remaining: Infinity },
    ]) {
      const reader: KeyUsageReader = { read: () => Promise.resolve(bad) }
      await expect(readOpenRouterKeyUsage(reader, 'sk-or-x')).rejects.toThrow()
    }
  })
})
