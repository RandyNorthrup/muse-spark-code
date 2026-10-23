// The VS Code side of Grok sign-in, driven over the real loopback
// listener, the real file lock in a temporary directory, and the recorded
// discovery document: every other fetch refuses, so the tests assert our
// own request shapes and refusal codes instead of inventing xAI's
// answers. The authorize and token requests must name the endpoints the
// recorded document advertises.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GrokSignInError } from '../../src/core/providers/subscriptions/grok'
import { createGrokSignIn, type GrokVsCodeDeps } from '../../src/host/providers/grokSignIn'
import { startGrokCallback } from '../../src/host/providers/subscriptionCallback'
import { withSubscriptionFileLock } from '../../src/host/providers/subscriptionFileLock'
import { UI_TEXT } from '../../src/shared/constants'
import { captureFailure } from './helpers/captureFailure'
import {
  CLIENT_ID,
  DISCOVERY_URL,
  discoveryEndpoints,
  discoveryOnlyFetch,
  type FetchCall,
} from './helpers/grokDiscoveryFetch'
import { grokGrantRecord } from './helpers/grokGrant'
import { mapSecrets } from './helpers/mapSecrets'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const STATE = 'test-state-sent-to-xai-0123456789abcdef'
const OTHER_STATE = 'another-attempt-state-0123456789abcdef'
const GRANT_KEY = 'museSpark.provider.grok'

async function probe(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const response = await fetch(url, init)
  const body = await response.text()
  return { status: response.status, body }
}

function deps(overrides: Partial<GrokVsCodeDeps> & { readonly directory: string }): GrokVsCodeDeps {
  return {
    secrets: mapSecrets({}),
    globalStoragePath: overrides.directory,
    isRemote: false,
    clientId: CLIENT_ID,
    scopes: undefined,
    fetch: discoveryOnlyFetch(),
    openExternal: () => Promise.resolve(true),
    log: () => undefined,
    ...overrides,
  }
}

describe('grok host callback', () => {
  type CallbackFlow = Awaited<ReturnType<typeof startGrokCallback>>

  async function withCallback(
    work: (flow: CallbackFlow, lines: string[]) => Promise<void>,
  ): Promise<void> {
    const lines: string[] = []
    const flow = await startGrokCallback(STATE, 10_000, (message) => {
      lines.push(message)
    })
    try {
      await work(flow, lines)
    } finally {
      flow.close()
    }
  }

  it('completes a callback whose state matches, with the Grok page', async () => {
    await withCallback(async (flow, lines) => {
      const answer = await probe(`${flow.redirectUri}?code=auth-code&state=${STATE}`)
      expect(answer.status).toBe(200)
      expect(answer.body).toBe(UI_TEXT.acpGrok.callback)
      await expect(flow.waitForCallback()).resolves.toContain('code=auth-code')
      expect(lines).toEqual([])
    })
  })

  it('refuses a mismatched state with the validated failure and one fixed log line', async () => {
    await withCallback(async (flow, lines) => {
      const answer = await probe(`${flow.redirectUri}?code=x&state=${OTHER_STATE}`)
      expect(answer.status).toBe(400)
      const failure = await captureFailure(() => flow.waitForCallback())
      expect(failure).toBeInstanceOf(GrokSignInError)
      expect(failure).toMatchObject({ code: 'invalid-state' })
      expect(lines).toHaveLength(1)
      expect(lines[0]).not.toContain(OTHER_STATE)
      expect(lines[0]).not.toContain('code=')
    })
  })

  it('says an xAI refusal as authorize-refused', async () => {
    const flow = await startGrokCallback(STATE, 10_000, () => undefined)
    try {
      const answer = await probe(`${flow.redirectUri}?error=access_denied&state=${STATE}`)
      expect(answer.status).toBe(400)
      const failure = await captureFailure(() => flow.waitForCallback())
      expect(failure).toMatchObject({ code: 'authorize-refused' })
    } finally {
      flow.close()
    }
  })

  it('still reports the timeout to a waiter that attaches late', async () => {
    const flow = await startGrokCallback(STATE, 50, () => undefined)
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      const failure = await captureFailure(() => flow.waitForCallback())
      expect(failure).toMatchObject({ code: 'callback-timeout' })
    } finally {
      flow.close()
    }
  })

  it('leaves the flow waiting for a foreign method and a non-callback path', async () => {
    const flow = await startGrokCallback(STATE, 10_000, () => undefined)
    try {
      const posted = await probe(flow.redirectUri, { method: 'POST' })
      expect(posted.status).toBe(405)
      const other = await probe(
        `${flow.redirectUri.replace('/auth/callback', '/elsewhere')}?code=x&state=${STATE}`,
      )
      expect(other.status).toBe(404)
      const answer = await probe(`${flow.redirectUri}?code=auth-code&state=${STATE}`)
      expect(answer.status).toBe(200)
      await expect(flow.waitForCallback()).resolves.toContain('code=auth-code')
    } finally {
      flow.close()
    }
  })
})

describe('grok VS Code port', () => {
  it('drives the browser flow through the real server to the recorded token endpoint', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const calls: FetchCall[] = []
      const secrets = mapSecrets({})
      const seen: string[] = []
      const signIn = createGrokSignIn(
        deps({
          directory,
          secrets,
          fetch: discoveryOnlyFetch({ calls }),
          openExternal: async (url) => {
            seen.push(url)
            const authorize = new URL(url)
            const redirectUri = authorize.searchParams.get('redirect_uri') ?? ''
            const state = authorize.searchParams.get('state') ?? ''
            // The person approves in the browser; the app's own server keeps
            // the early callback for the waiter that attaches after the open.
            const answer = await probe(`${redirectUri}?code=test-authorization-code&state=${state}`)
            expect(answer.status).toBe(200)
            return true
          },
        }),
      )
      const failure = await captureFailure(() => signIn.signIn())
      expect(failure).toMatchObject({ code: 'request-failed' })
      const endpoints = discoveryEndpoints()
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        `GET ${DISCOVERY_URL}`,
        `POST ${endpoints.token}`,
      ])
      expect(seen).toHaveLength(1)
      const authorize = new URL(seen[0] ?? '')
      expect(`${authorize.origin}${authorize.pathname}`).toBe(endpoints.authorization)
      expect(authorize.searchParams.get('response_type')).toBe('code')
      expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID)
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
      expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(authorize.searchParams.get('redirect_uri')).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
      )
      const token = calls[1]?.form
      expect(token?.get('grant_type')).toBe('authorization_code')
      expect(token?.get('code')).toBe('test-authorization-code')
      expect(token?.get('client_id')).toBe(CLIENT_ID)
      expect(token?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
      // No grant was kept from the failed exchange, and the lock is released.
      expect(await secrets.get(GRANT_KEY)).toBeUndefined()
      expect(readdirSync(directory)).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses without a client id before any request goes out', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const calls: FetchCall[] = []
      let isOpened = false
      const signIn = createGrokSignIn(
        deps({
          directory,
          clientId: undefined,
          fetch: discoveryOnlyFetch({ calls }),
          openExternal: () => {
            isOpened = true
            return Promise.resolve(true)
          },
        }),
      )
      const failure = await captureFailure(() => signIn.signIn())
      expect(failure).toMatchObject({ code: 'client-id-unset' })
      expect(calls).toEqual([])
      expect(isOpened).toBe(false)
    } finally {
      await removeFolder(directory)
    }
  })

  it('says a refused browser as browser-unavailable, keeping a rejection cause', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const closed = createGrokSignIn(
        deps({ directory, openExternal: () => Promise.resolve(false) }),
      )
      const refused = await captureFailure(() => closed.signIn())
      expect(refused).toMatchObject({ code: 'browser-unavailable' })
      const broken = new Error('the editor cannot open addresses')
      const failing = createGrokSignIn(
        deps({
          directory,
          openExternal: () => Promise.reject(broken),
        }),
      )
      const failure = await captureFailure(() => failing.signIn())
      expect(failure).toMatchObject({ code: 'browser-unavailable' })
      expect(failure).toBeInstanceOf(GrokSignInError)
      if (!(failure instanceof GrokSignInError)) throw new Error('unreachable')
      expect(failure.cause).toBe(broken)
    } finally {
      await removeFolder(directory)
    }
  })

  it('reads a store failure as store-unavailable', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const signIn = createGrokSignIn(
        deps({
          directory,
          secrets: {
            ...mapSecrets({}),
            get: () => Promise.reject(new Error('the store is locked')),
          },
        }),
      )
      const failure = await captureFailure(() => signIn.remove())
      expect(failure).toMatchObject({ code: 'store-unavailable' })
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses the browser flow on a remote host before opening anything', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      let isOpened = false
      const signIn = createGrokSignIn(
        deps({
          directory,
          isRemote: true,
          openExternal: () => {
            isOpened = true
            return Promise.resolve(true)
          },
        }),
      )
      const failure = await captureFailure(() => signIn.signIn())
      expect(failure).toMatchObject({ code: 'invalid-callback' })
      expect(isOpened).toBe(false)
    } finally {
      await removeFolder(directory)
    }
  })

  it('says the device flow is unsupported without that surface', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const calls: FetchCall[] = []
      const signIn = createGrokSignIn(deps({ directory, fetch: discoveryOnlyFetch({ calls }) }))
      const failure = await captureFailure(() => signIn.signInWithDevice())
      expect(failure).toMatchObject({ code: 'local-failed', reason: 'device-unsupported' })
      expect(calls).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('serves an unexpired grant without any request', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const calls: FetchCall[] = []
      const secrets = mapSecrets({ [GRANT_KEY]: JSON.stringify(grokGrantRecord()) })
      const signIn = createGrokSignIn(
        deps({ directory, secrets, fetch: discoveryOnlyFetch({ calls }) }),
      )
      await expect(
        signIn.accessToken('https://api.x.ai/v1/chat/completions', 60_000),
      ).resolves.toBe('test-access-token-placeholder')
      expect(calls).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('names a malformed grant grant-unreadable', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const secrets = mapSecrets({ [GRANT_KEY]: '{oops' })
      const signIn = createGrokSignIn(deps({ directory, secrets }))
      const failure = await captureFailure(() =>
        signIn.accessToken('https://api.x.ai/v1/chat/completions', 60_000),
      )
      expect(failure).toMatchObject({ code: 'grant-unreadable' })
    } finally {
      await removeFolder(directory)
    }
  })
})

describe('subscription file lock', () => {
  const binding = {
    lockFile: 'test.refresh.lock',
    tmpPrefix: '.test-lock-',
    failBusy: () => new GrokSignInError('lock-busy'),
  }

  it('serializes two contenders and says the loser lock-busy', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      const { promise: entered, resolve: markEntered } = Promise.withResolvers<undefined>()
      const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
      const first = withSubscriptionFileLock(
        directory,
        randomUUID(),
        10_000,
        5,
        async () => {
          markEntered(undefined)
          await gate
          return 'first'
        },
        binding,
      )
      await entered
      const failure = await captureFailure(() =>
        withSubscriptionFileLock(
          directory,
          randomUUID(),
          60,
          5,
          () => Promise.resolve('second'),
          binding,
        ),
      )
      expect(failure).toMatchObject({ code: 'lock-busy' })
      release(undefined)
      await expect(first).resolves.toBe('first')
    } finally {
      await removeFolder(directory)
    }
  })

  it('recovers a lock whose owner is gone', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      // Above every platform's pid ceiling, so no live process can hold it.
      const deadPid = 2 ** 30
      const refusal = await captureFailure(() => process.kill(deadPid, 0))
      expect(refusal).toMatchObject({ code: 'ESRCH' })
      const lockPath = path.join(directory, binding.lockFile)
      mkdirSync(lockPath, { recursive: true })
      writeFileSync(
        path.join(lockPath, `${randomUUID()}.json`),
        JSON.stringify({
          pid: deadPid,
          startedAt: 1,
          windowId: randomUUID(),
          expiresAt: 1,
        }),
      )
      await expect(
        withSubscriptionFileLock(
          directory,
          randomUUID(),
          5000,
          5,
          () => Promise.resolve('recovered'),
          binding,
        ),
      ).resolves.toBe('recovered')
    } finally {
      await removeFolder(directory)
    }
  })

  it('says lock-busy while a live ownerless file holds the path', async () => {
    const directory = await temporaryDir('grok-host-ports-')
    try {
      writeFileSync(path.join(directory, binding.lockFile), 'legacy')
      const failure = await captureFailure(() =>
        withSubscriptionFileLock(
          directory,
          randomUUID(),
          60,
          5,
          () => Promise.resolve('never'),
          binding,
        ),
      )
      expect(failure).toMatchObject({ code: 'lock-busy' })
    } finally {
      await removeFolder(directory)
    }
  })
})
