// The gist grant is stored apart from the repository sign-in. The store
// is the SecretStore the source is given (tests use a Map, as
// credentialStore.ts describes). The device-flow request is the real
// client's body, and the fetch fails before GitHub answers.
import { describe, expect, it } from 'vitest'
import { GitHubSignIn } from '../../src/core/git/githubSignIn'
import { deviceFlowSource } from '../../src/runtime/github/deviceFlowSource'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { recordLog } from './helpers/recordLog'
import { scriptedFetch } from './helpers/scriptedFetch'
import {
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_FLOW_SECRET_KEY,
  GITHUB_GIST_SHARE_SECRET_KEY,
  GITHUB_STORED_TOKEN_VERSION,
} from '../../src/shared/constants'

function memoryStore(seed: Readonly<Record<string, string>> = {}): SecretStore & {
  readonly values: Map<string, string>
} {
  const values = new Map(Object.entries(seed))
  return {
    values,
    get: (key) => Promise.resolve(values.get(key)),
    store(key, value) {
      values.set(key, value)
      return Promise.resolve()
    },
    delete(key) {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

function pair(accessToken: string): string {
  return JSON.stringify({
    v: GITHUB_STORED_TOKEN_VERSION,
    id: `id-${accessToken}`,
    generation: null,
    accessToken,
    refreshToken: null,
    expiresAt: null,
    refreshExpiresAt: null,
  })
}

function source(
  store: SecretStore,
  fetch: typeof globalThis.fetch = scriptedFetch(() =>
    Promise.reject(new TypeError('fetch failed')),
  ),
) {
  return deviceFlowSource({
    store,
    flow: { fetch, now: () => 0, sleep: () => Promise.resolve() },
    present: () => Promise.reject(new Error('must not present')),
    openExternal: () => Promise.resolve(),
    fetch,
  })
}

describe('gist grant storage', () => {
  it('serves a stored gist grant and leaves the repository sign-in where it is', async () => {
    const git = pair('git-access')
    const store = memoryStore({
      [GITHUB_DEVICE_FLOW_SECRET_KEY]: git,
      [GITHUB_GIST_SHARE_SECRET_KEY]: pair('gist-access'),
    })
    let calls = 0
    const granted = await source(
      store,
      scriptedFetch(() => {
        calls += 1
        return Promise.reject(new TypeError('fetch failed'))
      }),
    ).signInForGistShare(new AbortController().signal)
    expect(granted?.bearer).toBe('gist-access')
    expect(calls).toBe(0)
    expect(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(git)
  })

  it('reads a stored gist grant through the sign-in without a device flow', async () => {
    const git = pair('git-access')
    const store = memoryStore({
      [GITHUB_DEVICE_FLOW_SECRET_KEY]: git,
      [GITHUB_GIST_SHARE_SECRET_KEY]: pair('gist-access'),
    })
    let calls = 0
    let logins = 0
    const { log } = recordLog()
    const fetch = scriptedFetch(() => {
      calls += 1
      return Promise.reject(new TypeError('fetch failed'))
    })
    const signIn = new GitHubSignIn({
      sources: () => [source(store, fetch)],
      now: () => 0,
      login: () => {
        logins += 1
        return Promise.resolve(undefined)
      },
      log,
    })
    const granted = await signIn.storedGistGrant(new AbortController().signal)
    expect(granted?.bearer).toBe('gist-access')
    expect(calls).toBe(0)
    expect(logins).toBe(0)
    expect(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(git)
  })

  it('asks only for gist, and a failed grant does not replace the repository sign-in', async () => {
    const git = pair('git-access')
    const store = memoryStore({ [GITHUB_DEVICE_FLOW_SECRET_KEY]: git })
    const bodies: string[] = []
    const fetch = scriptedFetch((url, init) => {
      if (url === GITHUB_DEVICE_CODE_URL && typeof init?.body === 'string') bodies.push(init.body)
      return Promise.reject(new TypeError('fetch failed'))
    })
    await expect(
      source(store, fetch).signInForGistShare(new AbortController().signal),
    ).rejects.toMatchObject({ name: 'DeviceFlowFailure', reason: 'network' })
    expect(bodies[0]).toContain('scope=gist')
    expect(bodies[0]).not.toContain('repo')
    expect(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(git)
    expect(store.values.has(GITHUB_GIST_SHARE_SECRET_KEY)).toBe(false)
  })

  it('drops the gist grant on rejection and on sign-out without dropping the other grant early', async () => {
    const git = pair('git-access')
    const store = memoryStore({
      [GITHUB_DEVICE_FLOW_SECRET_KEY]: git,
      [GITHUB_GIST_SHARE_SECRET_KEY]: pair('gist-access'),
    })
    const granted = source(store)
    await granted.rejected({
      source: 'deviceFlow',
      bearer: 'gist-access',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      expiresAt: undefined,
    })
    expect(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(git)
    expect(store.values.has(GITHUB_GIST_SHARE_SECRET_KEY)).toBe(false)
    store.values.set(GITHUB_GIST_SHARE_SECRET_KEY, pair('gist-access'))
    await granted.signOut()
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    expect(store.values.has(GITHUB_GIST_SHARE_SECRET_KEY)).toBe(false)
  })
})
