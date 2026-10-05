// M95 lane K (PLAN.md D74, M95 acceptance 15 and the Tests' first-run
// items): a provider's secret counts as a Model API credential, and sign-out
// keeps provider secrets unless "Also remove model providers" is asked.

import { describe, expect, it, vi } from 'vitest'
import {
  AuthService,
  type AuthBackendFacts,
  type AuthServiceDeps,
} from '../../src/host/auth/authService'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import { providerSecretKey } from '../../src/host/providers/credentialRecords'
import { memorySecrets } from './helpers/fakes'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'

const RECORD = {
  v: 1 as const,
  auth: 'apiKey' as const,
  origin: 'https://openrouter.ai',
  secret: 'sk-or-test-key',
}

function backendFacts(): AuthBackendFacts {
  return {
    resolveCli: () => ({ ok: false, reason: 'Muse Code is not installed' }),
    cliSignIn: () => Promise.resolve('signedOut'),
    abandonCliProbe: () => undefined,
    forgetCliAnswers: () => undefined,
    credentialFilePath: () => '/none',
    credentialFileModifiedAt: () => undefined,
    hasEnvironmentKey: () => false,
    getBackendMode: () => 'auto',
    restartBackend: () => Promise.resolve(),
    logOutCli: () => Promise.resolve(true),
  }
}

function service(
  credentials: CredentialStore,
  deps: Partial<AuthServiceDeps> = {},
): { readonly auth: AuthService } {
  const auth = new AuthService({
    backend: backendFacts(),
    credentials,
    logoutHold: { get: () => false, set: () => Promise.resolve() },
    runInTerminal: () => undefined,
    runInstallerInTerminal: () => undefined,
    installCommand: 'install',
    runDeviceSignIn: () => Promise.reject(new Error('no device flow in this test')),
    promptForApiKey: () => Promise.resolve(undefined),
    broadcast: () => undefined,
    sleep: () => Promise.resolve(),
    now: () => 0,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    ...deps,
  })
  return { auth }
}

function credentialsWithIds(ids: readonly string[]): {
  readonly store: CredentialStore
  readonly secrets: ReturnType<typeof memorySecrets>
} {
  const secrets = memorySecrets()
  const store = new CredentialStore(
    secrets,
    () => undefined,
    'test store',
    () => Promise.resolve(ids),
  )
  return { store, secrets }
}

describe('a provider counts as a Model API credential', () => {
  it('signs in on the Model API backend with only a provider secret', async () => {
    const { store } = credentialsWithIds(['openrouter'])
    await store.setProviderCredential('openrouter', RECORD)
    const { auth } = service(store)
    const snapshot = await auth.refresh()
    expect(snapshot.status).toBe('signedIn')
    expect(snapshot.backend).toBe('modelApi')
  })

  it('stays out with neither a key nor a provider secret', async () => {
    const { store } = credentialsWithIds(['openrouter'])
    const { auth } = service(store)
    const snapshot = await auth.refresh()
    expect(snapshot.status).not.toBe('signedIn')
  })
})

describe('sign-out keeps provider secrets unless asked', () => {
  it('clears the Meta key but keeps the provider secret by default', async () => {
    const { store, secrets } = credentialsWithIds(['openrouter'])
    await store.setApiKey(CURRENT_SHAPE_KEYS[0])
    await store.setProviderCredential('openrouter', RECORD)
    const { auth } = service(store)
    const snapshot = await auth.signOut()
    expect(await store.getApiKey()).toBeUndefined()
    expect(await store.getProviderCredential('openrouter')).toEqual(RECORD)
    // Kept secrets still sign in, so the hold stays with "credentials remain".
    expect(snapshot.status).toBe('error')
    expect(secrets.values.has(providerSecretKey('openrouter'))).toBe(true)
  })

  it('removes provider secrets when asked and wired', async () => {
    const { store } = credentialsWithIds(['openrouter'])
    await store.setProviderCredential('openrouter', RECORD)
    const remover = vi.fn(async () => {
      await store.clearProviderCredential('openrouter')
    })
    const { auth } = service(store, {
      removeAllProviderCredentials: remover,
    })
    const snapshot = await auth.signOut({ removeProviders: true })
    expect(remover).toHaveBeenCalledOnce()
    expect(await store.getProviderCredential('openrouter')).toBeUndefined()
    expect(snapshot.status).toBe('signedOut')
  })

  it('keeps provider secrets when asked but nothing is wired', async () => {
    const { store } = credentialsWithIds(['openrouter'])
    await store.setProviderCredential('openrouter', RECORD)
    const warnings: string[] = []
    const { auth } = service(store, {
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: (message: string) => {
          warnings.push(message)
        },
        error: () => undefined,
      },
    })
    const snapshot = await auth.signOut({ removeProviders: true })
    expect(await store.getProviderCredential('openrouter')).toEqual(RECORD)
    expect(snapshot.status).toBe('error')
    expect(warnings.length).toBeGreaterThan(0)
  })
})
