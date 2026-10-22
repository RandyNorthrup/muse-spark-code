// M117 round 7, edge 3: the generation answers "who pays", not "which
// bytes". It changes exactly when the identity behind a credential an
// estimator producer uses changes; a refreshed token for the same account
// is the same owner. Each of the four secret writers the review lists is
// covered by name; no live or paid calls, memory only.
import { describe, expect, it } from 'vitest'
import {
  createProviderGenerationTracker,
  isProviderCredentialKey,
  providerCredentialIdentity,
} from '../../src/host/auth/providerGeneration'

const CHATGPT_KEY = 'museSpark.provider.chatgpt'
const META_KEY = 'museSpark.modelApiKey'
const OPENROUTER_KEY = 'museSpark.provider.openrouter'
const ACCOUNT_KEY = 'museSpark.provider.openrouter.account.work'

function track(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  let bumps = 0
  const tracker = createProviderGenerationTracker({
    secrets: { get: (key: string) => Promise.resolve(store.get(key)) },
    onGenerationChanged: () => {
      bumps += 1
    },
  })
  return {
    store,
    tracker,
    onBump: () => bumps,
  }
}

const chatgptRecord = (hash: string, token: string): string =>
  JSON.stringify({ accountIdHash: hash, accessToken: token, refreshToken: 'stable-refresh' })
const apiKeyRecord = (secret: string): string =>
  JSON.stringify({ v: 1, auth: 'apiKey', origin: 'https://openrouter.ai', secret })

describe('provider credential identity', () => {
  it('covers only estimator credential keys', () => {
    expect(isProviderCredentialKey(META_KEY)).toBe(true)
    expect(isProviderCredentialKey(CHATGPT_KEY)).toBe(true)
    expect(isProviderCredentialKey(OPENROUTER_KEY)).toBe(true)
    expect(isProviderCredentialKey(ACCOUNT_KEY)).toBe(true)
    expect(isProviderCredentialKey('museSpark.vault.key')).toBe(false)
    expect(isProviderCredentialKey('unrelated')).toBe(false)
  })
  it('keeps a refreshed token for the same account identical', () => {
    expect(providerCredentialIdentity(chatgptRecord('hash-a', 'token-1'))).toBe(
      providerCredentialIdentity(chatgptRecord('hash-a', 'token-2')),
    )
  })
  it('treats a replaced api key as a new identity', () => {
    expect(providerCredentialIdentity(apiKeyRecord('key-1'))).not.toBe(
      providerCredentialIdentity(apiKeyRecord('key-2')),
    )
    expect(providerCredentialIdentity(apiKeyRecord('key-1'))).toBe(
      providerCredentialIdentity(apiKeyRecord('key-1')),
    )
  })
  it('treats a removed credential as changed', () => {
    expect(providerCredentialIdentity(undefined)).not.toBe(providerCredentialIdentity('key-1'))
  })
})

describe('provider generation tracker', () => {
  it('ignores keys no estimator producer reads', async () => {
    const { store, tracker, onBump } = track()
    store.set('unrelated', 'value')
    await tracker.noteSecretChanged('unrelated')
    expect(onBump()).toBe(0)
  })
  it('leaves cards and facts in place across a ChatGPT token refresh (chatgptSignIn writeRecord)', async () => {
    const { store, tracker, onBump } = track({ [CHATGPT_KEY]: chatgptRecord('hash-a', 'token-1') })
    await tracker.seed([CHATGPT_KEY])
    // The background refresh rewrites the record with new token bytes for
    // the same account: the same owner, no change, no second panel.
    store.set(CHATGPT_KEY, chatgptRecord('hash-a', 'token-2'))
    await tracker.noteSecretChanged(CHATGPT_KEY)
    expect(onBump()).toBe(0)
  })
  it('retires on a ChatGPT account switch or sign-out (chatgptSignIn writeRecord)', async () => {
    const same = track({ [CHATGPT_KEY]: chatgptRecord('hash-a', 'token-1') })
    await same.tracker.seed([CHATGPT_KEY])
    same.store.set(CHATGPT_KEY, chatgptRecord('hash-b', 'token-3'))
    await same.tracker.noteSecretChanged(CHATGPT_KEY)
    expect(same.onBump()).toBe(1)
    const gone = track({ [CHATGPT_KEY]: chatgptRecord('hash-a', 'token-1') })
    await gone.tracker.seed([CHATGPT_KEY])
    gone.store.delete(CHATGPT_KEY)
    await gone.tracker.noteSecretChanged(CHATGPT_KEY)
    expect(gone.onBump()).toBe(1)
  })
  it('bumps once for an account secret replacement and never for a rewrite (accountSecrets vault write)', async () => {
    const { store, tracker, onBump } = track({ [ACCOUNT_KEY]: apiKeyRecord('key-1') })
    await tracker.seed([ACCOUNT_KEY])
    store.set(ACCOUNT_KEY, apiKeyRecord('key-1'))
    await tracker.noteSecretChanged(ACCOUNT_KEY)
    expect(onBump()).toBe(0)
    store.set(ACCOUNT_KEY, apiKeyRecord('key-2'))
    await tracker.noteSecretChanged(ACCOUNT_KEY)
    expect(onBump()).toBe(1)
    store.delete(ACCOUNT_KEY)
    await tracker.noteSecretChanged(ACCOUNT_KEY)
    expect(onBump()).toBe(2)
  })
  it('does not bump when vault migration moves identical bytes (migrateSecretStorage legacy write)', async () => {
    const { store, tracker, onBump } = track({ [OPENROUTER_KEY]: apiKeyRecord('key-1') })
    await tracker.seed([OPENROUTER_KEY])
    // The migration rewrites the same credential at its new home.
    store.set(OPENROUTER_KEY, apiKeyRecord('key-1'))
    await tracker.noteSecretChanged(OPENROUTER_KEY)
    expect(onBump()).toBe(0)
  })
  it('bumps once for a replaced provider key (credentialRecords saveProviderCredential)', async () => {
    const { store, tracker, onBump } = track({ [OPENROUTER_KEY]: apiKeyRecord('key-1') })
    await tracker.seed([OPENROUTER_KEY])
    // One of our own saves bumps once, not twice: the listener is the only
    // bump now, and a rewrite without a change bumps not at all.
    store.set(OPENROUTER_KEY, apiKeyRecord('key-2'))
    await tracker.noteSecretChanged(OPENROUTER_KEY)
    expect(onBump()).toBe(1)
    store.set(OPENROUTER_KEY, apiKeyRecord('key-2'))
    await tracker.noteSecretChanged(OPENROUTER_KEY)
    expect(onBump()).toBe(1)
  })
  it('bumps fail-safe on a first-seen key with no baseline', async () => {
    const { store, tracker, onBump } = track()
    store.set(OPENROUTER_KEY, apiKeyRecord('key-1'))
    await tracker.noteSecretChanged(OPENROUTER_KEY)
    expect(onBump()).toBe(1)
    // The baseline is set now: a repeat is quiet.
    await tracker.noteSecretChanged(OPENROUTER_KEY)
    expect(onBump()).toBe(1)
  })
  it('collapses rapid saves to their net change, in order', async () => {
    const { store, tracker, onBump } = track({ [META_KEY]: 'meta-key-1' })
    await tracker.seed([META_KEY])
    // Two rapid writes; both events read the latest value when processed.
    // Changed and changed back is a net no-change: quiet.
    store.set(META_KEY, 'meta-key-2')
    const first = tracker.noteSecretChanged(META_KEY)
    store.set(META_KEY, 'meta-key-1')
    const second = tracker.noteSecretChanged(META_KEY)
    await Promise.all([first, second])
    expect(onBump()).toBe(0)
    // Changed twice forward is one net change: exactly one bump, and the
    // baseline follows in event order.
    store.set(META_KEY, 'meta-key-2')
    const third = tracker.noteSecretChanged(META_KEY)
    store.set(META_KEY, 'meta-key-3')
    const fourth = tracker.noteSecretChanged(META_KEY)
    await Promise.all([third, fourth])
    expect(onBump()).toBe(1)
    store.set(META_KEY, 'meta-key-1')
    await tracker.noteSecretChanged(META_KEY)
    expect(onBump()).toBe(2)
  })
})
