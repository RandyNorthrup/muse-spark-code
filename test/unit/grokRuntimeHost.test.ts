// The runtime Grok host's rules: a store failure reads as the store's
// refusal, malformed entries name their entry, typed failures cross
// unchanged, and the device surface, abortable sleep, fetch abort and
// loopback callback reach the core as given. No request leaves the test
// process: the fetch either records its call or answers only with the
// recorded discovery document.
import { describe, expect, it } from 'vitest'
import { GrokSignIn } from '../../src/core/providers/subscriptions/grok'
import { pkceRandom } from '../../src/core/providers/pkce'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { createRuntimeGrokHost, type RuntimeGrokOptions } from '../../src/runtime/grokHost'
import { startGrokCallback } from '../../src/runtime/subscriptionCallback'
import { captureFailure } from './helpers/captureFailure'
import { CLIENT_ID, discoveryOnlyFetch, type FetchCall } from './helpers/grokDiscoveryFetch'
import { grokGrantRecord } from './helpers/grokGrant'
import { mapSecrets } from './helpers/mapSecrets'

const GRANT_KEY = 'museSpark.provider.grok'

function options(
  secrets: SecretStore,
  overrides: Partial<RuntimeGrokOptions> = {},
): RuntimeGrokOptions {
  return {
    secrets,
    fetch,
    clientId: CLIENT_ID,
    scopes: undefined,
    openBrowser: () => Promise.resolve(),
    callbackText: () => 'callback page',
    presentDeviceCode: () => Promise.resolve(),
    ...overrides,
  }
}

async function probe(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url)
  const body = await response.text()
  return { status: response.status, body }
}

describe('createRuntimeGrokHost', () => {
  it('reads an unreadable store as the store refusal', async () => {
    const secrets: SecretStore = {
      ...mapSecrets({}),
      get: () => Promise.reject(new Error('the store is locked')),
    }
    const host = createRuntimeGrokHost(options(secrets))
    const failure = await captureFailure(() => host.readRecord())
    expect(failure).toMatchObject({ code: 'store-unavailable' })
  })

  it('names a malformed grant grant-unreadable', async () => {
    const host = createRuntimeGrokHost(options(mapSecrets({ [GRANT_KEY]: '{oops' })))
    const failure = await captureFailure(() => host.readRecord())
    expect(failure).toMatchObject({ code: 'grant-unreadable' })
  })

  it('reads a browser handoff failure as browser-unavailable, never an outage', async () => {
    const host = createRuntimeGrokHost(
      options(mapSecrets({}), { openBrowser: () => Promise.reject(new Error('no browser here')) }),
    )
    const failure = await captureFailure(() => host.openBrowser('https://auth.x.ai/'))
    expect(failure).toMatchObject({ code: 'browser-unavailable' })
  })

  it('round-trips a grant through the store', async () => {
    const secrets = mapSecrets({})
    const host = createRuntimeGrokHost(options(secrets))
    await host.writeRecord(grokGrantRecord())
    await expect(host.readRecord()).resolves.toMatchObject({
      accessToken: 'test-access-token-placeholder',
    })
    await host.deleteRecord()
    expect(await secrets.get(GRANT_KEY)).toBeUndefined()
  })

  it('hands the device prompt to the given surface unchanged', async () => {
    const seen: unknown[] = []
    const host = createRuntimeGrokHost(
      options(mapSecrets({}), {
        presentDeviceCode: (prompt) => {
          seen.push(prompt)
          return Promise.resolve()
        },
      }),
    )
    const prompt = {
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.x.ai/activate',
      expiresAt: 1_782_000_000_000,
    }
    await host.presentDeviceCode?.(prompt)
    expect(seen).toEqual([prompt])
  })

  it('says an aborted sleep as the person cancelling', async () => {
    const controller = new AbortController()
    const host = createRuntimeGrokHost(options(mapSecrets({}), { signal: controller.signal }))
    const pending = captureFailure(() => host.sleep?.(30_000))
    controller.abort()
    const failure = await pending
    expect(failure).toMatchObject({ code: 'cancelled' })
  })

  it('waits out a short sleep without a signal', async () => {
    const host = createRuntimeGrokHost(options(mapSecrets({})))
    await expect(host.sleep?.(5)).resolves.toBeUndefined()
  })

  it('answers the caller abort beside the request signal on fetch', async () => {
    const seen: (AbortSignal | null | undefined)[] = []
    const recording: typeof fetch = (_url, init) => {
      seen.push(init?.signal)
      return Promise.resolve(new Response())
    }
    const controller = new AbortController()
    const host = createRuntimeGrokHost(
      options(mapSecrets({}), { fetch: recording, signal: controller.signal }),
    )
    await host.fetch('https://example.invalid/discovery')
    expect(seen[0]).toBe(controller.signal)
    const request = new AbortController()
    await host.fetch('https://example.invalid/discovery', { signal: request.signal })
    const combined = seen[1]
    expect(combined).toBeInstanceOf(AbortSignal)
    expect(combined).not.toBe(controller.signal)
    expect(combined).not.toBe(request.signal)
  })

  it('runs work under the refresh lock', async () => {
    const host = createRuntimeGrokHost(options(mapSecrets({})))
    await expect(host.withRefreshLock(() => Promise.resolve('done'))).resolves.toBe('done')
  })

  it('refuses without a client id before any request goes out', async () => {
    const calls: FetchCall[] = []
    const host = createRuntimeGrokHost(
      options(mapSecrets({}), { clientId: undefined, fetch: discoveryOnlyFetch({ calls }) }),
    )
    const failure = await captureFailure(() => new GrokSignIn(host).signIn())
    expect(failure).toMatchObject({ code: 'client-id-unset' })
    expect(calls).toEqual([])
  })
})

describe('grok runtime callback', () => {
  it('completes a callback whose state matches', async () => {
    const state = pkceRandom(32)
    const flow = await startGrokCallback(state, 10_000, () => 'callback page')
    try {
      const answer = await probe(`${flow.redirectUri}?code=auth-code&state=${state}`)
      expect(answer.status).toBe(200)
      expect(answer.body).toBe('callback page')
      await expect(flow.waitForCallback()).resolves.toContain('code=auth-code')
    } finally {
      flow.close()
    }
  })

  it('refuses a mismatched state with the validated failure', async () => {
    const state = pkceRandom(32)
    const flow = await startGrokCallback(state, 10_000, () => 'callback page')
    try {
      const answer = await probe(`${flow.redirectUri}?code=x&state=${pkceRandom(32)}`)
      expect(answer.status).toBe(400)
      const failure = await captureFailure(() => flow.waitForCallback())
      expect(failure).toMatchObject({ code: 'invalid-state' })
    } finally {
      flow.close()
    }
  })

  it('says a caller abort as the person cancelling', async () => {
    const controller = new AbortController()
    const flow = await startGrokCallback(
      pkceRandom(32),
      10_000,
      () => 'callback page',
      controller.signal,
    )
    try {
      controller.abort()
      const failure = await captureFailure(() => flow.waitForCallback())
      expect(failure).toMatchObject({ code: 'cancelled' })
    } finally {
      flow.close()
    }
  })
})
