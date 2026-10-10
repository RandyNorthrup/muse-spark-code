// C-M95-SUB: the host credential wrapper. Fakes only: an in-memory pasted
// key and an in-memory CLI auth file. No real auth file is ever read here.
import { describe, expect, it } from 'vitest'
import { SubscriptionKeySource } from '../../src/core/backends/modelapi/subscriptionKey'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import { UI_TEXT } from '../../src/shared/constants'

const SUB = 'LLM_SUBSCRIPTION_WRAPPER_CANARY_abcdef123456'
const PASTED = 'pasted-payg-key'

function sourceFor(text: string | undefined) {
  const files = new Map<string, string>()
  const source = new SubscriptionKeySource({
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    readFile: (file: string) => {
      const found = files.get(file)
      return found === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(found)
    },
    stat: (file: string) =>
      files.has(file)
        ? Promise.resolve({ size: 8, mtimeMs: 3 })
        : Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })),
  })
  if (text !== undefined) files.set(source.path(), text)
  return source
}

function credential(options: {
  enabled: boolean
  pasted: string | undefined
  text: string | undefined
}) {
  return new SubscriptionCredential({
    credentials: { getApiKey: () => Promise.resolve(options.pasted) },
    isEnabled: () => options.enabled,
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    source: sourceFor(options.text),
  })
}

function fileText(meta: unknown): string {
  return JSON.stringify({ schema_version: 1, providers: { meta } })
}

describe('SubscriptionCredential', () => {
  it('uses the pasted key while the opt-in is off', async () => {
    const wrapper = credential({ enabled: false, pasted: PASTED, text: fileText({ api_key: SUB }) })
    await expect(wrapper.getApiKey()).resolves.toBe(PASTED)
    await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
    await expect(wrapper.hasCredential()).resolves.toBe(true)
  })
  it('reports no credential while off with nothing stored', async () => {
    const wrapper = credential({ enabled: false, pasted: undefined, text: undefined })
    await expect(wrapper.getApiKey()).resolves.toBeUndefined()
    await expect(wrapper.hasCredential()).resolves.toBe(false)
  })
  it('uses the subscription key while on', async () => {
    const wrapper = credential({
      enabled: true,
      pasted: PASTED,
      text: fileText({ api_key: SUB }),
    })
    await expect(wrapper.getApiKey()).resolves.toBe(SUB)
    await expect(wrapper.isSubscriptionBilling()).resolves.toBe(true)
    await expect(wrapper.hasCredential()).resolves.toBe(true)
  })
  it('throws the refusal, without the key, while on and signed out', async () => {
    const wrapper = credential({ enabled: true, pasted: PASTED, text: undefined })
    let failure = 'resolved'
    try {
      await wrapper.getApiKey()
    } catch (error: unknown) {
      failure = String(error)
    }
    expect(failure).toBe(`SubscriptionKeyError: ${UI_TEXT.subscriptionKey.signInAgain}`)
    expect(failure).not.toContain(SUB)
    expect(failure).not.toContain(PASTED)
    await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
    await expect(wrapper.hasCredential()).resolves.toBe(false)
  })
})

function testSecrets(secrets: Map<string, string>) {
  return {
    get: (key: string) => Promise.resolve(secrets.get(key)),
    store: (key: string, value: string) => {
      secrets.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      secrets.delete(key)
      return Promise.resolve()
    },
  }
}

function store(options: { pasted: string | undefined; subscribed: boolean }) {
  const secrets = new Map<string, string>()
  if (options.pasted !== undefined) secrets.set('museSpark.modelApiKey', options.pasted)
  return new CredentialStore(
    testSecrets(secrets),
    () => undefined,
    'test store',
    undefined,
    () => Promise.resolve(options.subscribed),
  )
}

describe('CredentialStore with a subscription', () => {
  it('counts the opted-in subscription as a Model API credential', async () => {
    await expect(
      store({ pasted: undefined, subscribed: true }).hasModelApiCredential(),
    ).resolves.toBe(true)
  })
  it('stays unavailable without any credential', async () => {
    await expect(
      store({ pasted: undefined, subscribed: false }).hasModelApiCredential(),
    ).resolves.toBe(false)
  })
  it('keeps working with no subscription hook', async () => {
    const plain = new CredentialStore(testSecrets(new Map<string, string>()), () => undefined)
    await expect(plain.hasModelApiCredential()).resolves.toBe(false)
  })
})
